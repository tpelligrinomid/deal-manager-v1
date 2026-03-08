'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');
const { computeDSCR } = require('../../lib/modelEngine');

// ─── helpers ────────────────────────────────────────────────────────

/**
 * Compute all snapshot exhibits for a given period.
 * Shared by POST /preview and POST / (save).
 */
async function computeSnapshotExhibits(supabase, modelId, {
  periodIndex, scenarioId, operatingScenarioId, dealReferenceId
}) {
  // 1. Verify latest calculate run exists
  const { data: latestRun, error: runErr } = await supabase
    .from('model_calculate_runs')
    .select('model_version_hash')
    .eq('model_id', modelId)
    .order('run_at', { ascending: false })
    .limit(1)
    .single();

  if (runErr || !latestRun) {
    return { error: 'No calculate run found. Run the model first.', status: 409 };
  }

  const modelVersionHash = latestRun.model_version_hash;

  // 2. Sources & Uses (only if dealReferenceId provided)
  let sourcesUses = {};
  if (dealReferenceId) {
    // Load deal scenario terms for this deal ref + scenario
    const { data: terms } = await supabase
      .from('model_deal_scenario_terms')
      .select('*')
      .eq('model_deal_reference_id', dealReferenceId)
      .eq('scenario_id', scenarioId)
      .single();

    // Load scenario facility terms
    const { data: scenario } = await supabase
      .from('model_scenarios')
      .select('total_facility_size, initial_tranche_amount, facility_rate, facility_term_months, equity_from_investors, equity_from_aragon, equity_from_other')
      .eq('id', scenarioId)
      .single();

    // Load deal reference for close_period_index
    const { data: dealRef } = await supabase
      .from('model_deal_references')
      .select('close_period_index, entity_id')
      .eq('id', dealReferenceId)
      .single();

    if (terms && scenario && dealRef) {
      const uses = {
        purchasePrice: Number(terms.purchase_price) || 0,
        transactionCosts: Number(terms.transaction_costs) || 0,
        workingCapitalReserve: Number(terms.working_capital_reserve) || 0
      };
      uses.totalUses = uses.purchasePrice + uses.transactionCosts + uses.workingCapitalReserve;

      const sources = {
        trancheAmount: Number(terms.tranche_amount) || 0,
        sellerNoteAmount: Number(terms.seller_note_amount) || 0,
        equityFromTargetBalance: Number(terms.equity_from_target_balance) || 0
      };

      // Cumulative facility utilization: sum tranche_amount for all deal refs with close_period_index <= periodIndex
      const { data: allTerms } = await supabase
        .from('model_deal_scenario_terms')
        .select('tranche_amount, model_deal_reference_id')
        .eq('scenario_id', scenarioId);

      if (allTerms) {
        // Get deal refs to check close_period_index
        const refIds = allTerms.map(t => t.model_deal_reference_id);
        const { data: allRefs } = await supabase
          .from('model_deal_references')
          .select('id, close_period_index')
          .in('id', refIds);

        if (allRefs) {
          const closedRefs = new Set(allRefs.filter(r => r.close_period_index <= periodIndex).map(r => r.id));
          sources.cumulativeFacilityUtilization = allTerms
            .filter(t => closedRefs.has(t.model_deal_reference_id))
            .reduce((sum, t) => sum + (Number(t.tranche_amount) || 0), 0);
        }
      }

      sources.equityFromInvestors = Number(scenario.equity_from_investors) || 0;
      sources.equityFromAragon = Number(scenario.equity_from_aragon) || 0;
      sources.equityFromOther = Number(scenario.equity_from_other) || 0;
      sources.totalSources = sources.trancheAmount + sources.sellerNoteAmount +
        sources.equityFromTargetBalance + sources.equityFromInvestors +
        sources.equityFromAragon + sources.equityFromOther;

      sourcesUses = { uses, sources };
    }
  }

  // 3. DSCR — aggregate EBITDA from model_values (trailing 12)
  const trailingPeriods = 12;
  const windowStart = Math.max(0, periodIndex - trailingPeriods + 1);

  // Get EBITDA line items: load pl line items with their values
  const { data: lineItems } = await supabase
    .from('model_line_items')
    .select('id, category, entity_id')
    .in('category', ['revenue', 'cogs', 'expense'])
    .eq('statement', 'pl');

  let entityPLRows = [];
  if (lineItems && lineItems.length > 0) {
    const lineItemIds = lineItems.map(li => li.id);

    const { data: values } = await supabase
      .from('model_values')
      .select('line_item_id, period_index, amount')
      .in('line_item_id', lineItemIds)
      .eq('scenario_id', scenarioId)
      .eq('operating_scenario_id', operatingScenarioId)
      .gte('period_index', windowStart)
      .lte('period_index', periodIndex);

    if (values) {
      // Aggregate by period to get EBITDA = revenue - cogs - expense
      const categoryByLineItem = {};
      for (const li of lineItems) {
        categoryByLineItem[li.id] = li.category;
      }

      const periodMap = {};
      for (const v of values) {
        const pi = v.period_index;
        if (!periodMap[pi]) periodMap[pi] = { revenue: 0, cogs: 0, expense: 0 };
        const cat = categoryByLineItem[v.line_item_id];
        if (cat) periodMap[pi][cat] += Number(v.amount) || 0;
      }

      for (const [pi, agg] of Object.entries(periodMap)) {
        entityPLRows.push({
          periodIndex: Number(pi),
          ebitda: agg.revenue - agg.cogs - agg.expense
        });
      }
    }
  }

  // Load debt service from model_debt_corkscrews
  const { data: debtRows } = await supabase
    .from('model_debt_corkscrews')
    .select('period_index, cash_interest, cash_principal')
    .eq('model_id', modelId)
    .eq('scenario_id', scenarioId)
    .gte('period_index', windowStart)
    .lte('period_index', periodIndex);

  const dscrData = computeDSCR(periodIndex, trailingPeriods, entityPLRows, debtRows || []);

  // 4. Debt State — corkscrews at periodIndex grouped by entity + instrument
  const { data: debtState } = await supabase
    .from('model_debt_corkscrews')
    .select('entity_id, instrument_name, instrument_type, beginning_balance, ending_balance, cash_interest, pik_interest, cash_principal, balloon_payment, current_portion, lt_portion')
    .eq('model_id', modelId)
    .eq('scenario_id', scenarioId)
    .eq('period_index', periodIndex);

  // 5. Balance Sheet — consolidated across entities at periodIndex
  const { data: bsRows } = await supabase
    .from('model_balance_sheet_values')
    .select('*')
    .eq('model_id', modelId)
    .eq('scenario_id', scenarioId)
    .eq('operating_scenario_id', operatingScenarioId)
    .eq('period_index', periodIndex);

  let balanceSheet = {};
  if (bsRows && bsRows.length > 0) {
    // Consolidate across entities
    const numericFields = [
      'cash', 'accounts_receivable', 'prepaid_expenses', 'other_current_assets',
      'goodwill', 'other_intangibles', 'fixed_assets_net', 'other_lt_assets', 'total_assets',
      'accounts_payable', 'accrued_expenses', 'current_portion_ltd', 'other_current_liabilities',
      'long_term_debt', 'other_lt_liabilities', 'total_liabilities',
      'contributed_capital', 'retained_earnings', 'total_equity'
    ];
    for (const field of numericFields) {
      balanceSheet[field] = 0;
    }
    for (const row of bsRows) {
      for (const field of numericFields) {
        balanceSheet[field] += Number(row[field]) || 0;
      }
    }
    balanceSheet.entityCount = bsRows.length;
    balanceSheet.isBalanced = bsRows.every(r => r.is_balanced);
  }

  return {
    exhibits: {
      sourcesUses,
      dscrData,
      debtState: debtState || [],
      balanceSheet
    },
    modelVersionHash
  };
}

// ─── GET / — list snapshots ─────────────────────────────────────────

router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: snapshots, error } = await req.supabase
      .from('model_snapshots')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(snapshots || []);
  } catch (error) {
    console.error('Error listing snapshots:', error);
    res.status(500).json({ error: 'Failed to list snapshots' });
  }
});

// ─── GET /:snapshotId — single snapshot ─────────────────────────────

router.get('/:snapshotId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: snapshot, error } = await req.supabase
      .from('model_snapshots')
      .select('*')
      .eq('id', req.params.snapshotId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

    res.json(snapshot);
  } catch (error) {
    console.error('Error fetching snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

// ─── POST /preview — compute exhibits without saving ────────────────

router.post('/preview', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { periodIndex, scenarioId, operatingScenarioId, dealReferenceId } = req.body;

    if (periodIndex == null || !scenarioId || !operatingScenarioId) {
      return res.status(400).json({ error: 'periodIndex, scenarioId, and operatingScenarioId are required' });
    }

    const result = await computeSnapshotExhibits(req.supabase, req.params.modelId, {
      periodIndex, scenarioId, operatingScenarioId, dealReferenceId
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error('Error computing snapshot preview:', error);
    res.status(500).json({ error: 'Failed to compute snapshot preview' });
  }
});

// ─── POST / — save snapshot ─────────────────────────────────────────

router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const {
      periodIndex, scenarioId, operatingScenarioId,
      snapshotType, dealReferenceId, name, notes
    } = req.body;

    if (periodIndex == null || !scenarioId || !operatingScenarioId || !snapshotType || !name) {
      return res.status(400).json({
        error: 'periodIndex, scenarioId, operatingScenarioId, snapshotType, and name are required'
      });
    }

    const validTypes = ['close', 'freeform', 'covenant_certificate'];
    if (!validTypes.includes(snapshotType)) {
      return res.status(400).json({ error: `snapshotType must be one of: ${validTypes.join(', ')}` });
    }

    const result = await computeSnapshotExhibits(req.supabase, req.params.modelId, {
      periodIndex, scenarioId, operatingScenarioId, dealReferenceId
    });

    if (result.error) {
      return res.status(result.status).json({ error: result.error });
    }

    const { exhibits, modelVersionHash } = result;

    const { data: snapshot, error } = await req.supabase
      .from('model_snapshots')
      .insert({
        model_id: req.params.modelId,
        scenario_id: scenarioId,
        operating_scenario_id: operatingScenarioId,
        period_index: periodIndex,
        snapshot_type: snapshotType,
        deal_reference_id: dealReferenceId || null,
        name,
        notes: notes || null,
        sources_uses: exhibits.sourcesUses,
        dscr_data: exhibits.dscrData,
        debt_state: exhibits.debtState,
        balance_sheet: exhibits.balanceSheet,
        model_version_hash: modelVersionHash,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(snapshot);
  } catch (error) {
    console.error('Error saving snapshot:', error);
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});

// ─── PATCH /:snapshotId — update name/notes ─────────────────────────

router.patch('/:snapshotId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { name, notes } = req.body;

    if (name == null && notes === undefined) {
      return res.status(400).json({ error: 'Provide name and/or notes to update' });
    }

    const updates = {};
    if (name != null) updates.name = name;
    if (notes !== undefined) updates.notes = notes;

    const { data: snapshot, error } = await req.supabase
      .from('model_snapshots')
      .update(updates)
      .eq('id', req.params.snapshotId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

    res.json(snapshot);
  } catch (error) {
    console.error('Error updating snapshot:', error);
    res.status(500).json({ error: 'Failed to update snapshot' });
  }
});

// ─── DELETE /:snapshotId ────────────────────────────────────────────

router.delete('/:snapshotId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error, count } = await req.supabase
      .from('model_snapshots')
      .delete()
      .eq('id', req.params.snapshotId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting snapshot:', error);
    res.status(500).json({ error: 'Failed to delete snapshot' });
  }
});

module.exports = router;
