'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');
const {
  calculateModel,
  generatePeriods,
  computeLiquidityEvent,
  computeKeyMetrics
} = require('../../lib/modelEngine');

/**
 * GET /api/models/:modelId/versions
 * List published versions. Viewers only see investor_visible versions.
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    let query = req.supabase
      .from('model_published_versions')
      .select('id, version_number, version_name, version_notes, published_by, published_at, is_current, investor_visible')
      .eq('model_id', req.params.modelId)
      .order('version_number', { ascending: false });

    // If the user is a viewer (not editor/owner), only show investor_visible versions
    if (req.modelAccess.role === 'viewer') {
      query = query.eq('investor_visible', true);
    }

    const { data: versions, error } = await query;

    if (error) throw error;
    res.json(versions || []);
  } catch (error) {
    console.error('Error listing versions:', error);
    res.status(500).json({ error: 'Failed to list versions' });
  }
});

/**
 * GET /api/models/:modelId/versions/:versionId
 */
router.get('/:versionId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: version, error } = await req.supabase
      .from('model_published_versions')
      .select('*')
      .eq('id', req.params.versionId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!version) return res.status(404).json({ error: 'Version not found' });

    // Viewers cannot see non-investor-visible versions
    if (req.modelAccess.role === 'viewer' && !version.investor_visible) {
      return res.status(404).json({ error: 'Version not found' });
    }

    res.json(version);
  } catch (error) {
    console.error('Error fetching version:', error);
    res.status(500).json({ error: 'Failed to fetch version' });
  }
});

/**
 * POST /api/models/:modelId/versions/publish
 * Runs engine, freezes output into an immutable published version.
 */
router.post('/publish', requireModelAccess('editor'), async (req, res) => {
  const startTime = Date.now();
  const { modelId } = req.params;

  try {
    const {
      versionName,
      versionNotes,
      featuredScenarioId,
      featuredOperatingScenarioId,
      notifyInvestors
    } = req.body;

    // Validate required fields
    if (!versionName || !featuredScenarioId || !featuredOperatingScenarioId) {
      return res.status(400).json({
        error: 'versionName, featuredScenarioId, and featuredOperatingScenarioId are required'
      });
    }

    // ── 1. Load model ──────────────────────────────────────────────
    const { data: model, error: modelErr } = await req.supabase
      .from('financial_models')
      .select('*')
      .eq('id', modelId)
      .single();

    if (modelErr || !model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // ── 2. Load entities (exclude aragon/consolidated) ─────────────
    const { data: entities, error: entErr } = await req.supabase
      .from('model_entities')
      .select('*')
      .eq('model_id', modelId)
      .not('entity_type', 'in', '("aragon","consolidated")')
      .order('close_period_index', { ascending: true, nullsFirst: true });

    if (entErr) throw entErr;

    // ── 3. Load scenario + operating scenario ──────────────────────
    const [{ data: scenarios, error: scenErr }, { data: opScenarios, error: opErr }] = await Promise.all([
      req.supabase
        .from('model_scenarios')
        .select('*')
        .eq('model_id', modelId)
        .eq('id', featuredScenarioId),
      req.supabase
        .from('model_operating_scenarios')
        .select('*')
        .eq('model_id', modelId)
        .eq('id', featuredOperatingScenarioId)
    ]);

    if (scenErr) throw scenErr;
    if (opErr) throw opErr;

    if (!scenarios || scenarios.length === 0) {
      return res.status(400).json({ error: 'Featured scenario not found' });
    }
    if (!opScenarios || opScenarios.length === 0) {
      return res.status(400).json({ error: 'Featured operating scenario not found' });
    }

    // ── 4. Load per-entity data (line items, drivers, segments, deal refs, overrides) ──
    for (const entity of entities) {
      const [
        { data: lineItems, error: liErr },
        { data: drivers, error: drErr },
        { data: segments, error: segErr },
        { data: dealRefs, error: drfErr }
      ] = await Promise.all([
        req.supabase
          .from('model_line_items')
          .select('*')
          .eq('entity_id', entity.id)
          .eq('statement', 'pl')
          .order('sort_order'),
        req.supabase
          .from('model_drivers')
          .select('*')
          .eq('entity_id', entity.id),
        req.supabase
          .from('model_segments')
          .select('*')
          .eq('entity_id', entity.id),
        req.supabase
          .from('model_deal_references')
          .select('*, deals(reported_revenue)')
          .eq('entity_id', entity.id)
          .eq('model_id', modelId)
      ]);

      if (liErr) throw liErr;
      if (drErr) throw drErr;
      if (segErr) throw segErr;
      if (drfErr) throw drfErr;

      entity.lineItems = lineItems || [];
      entity.drivers = drivers || [];
      entity.segments = segments || [];
      entity.dealRefs = dealRefs || [];

      // Filter out display-only subtotal rows (item_type = 'total') — not projection inputs.
      // Trust base_amount values from model_line_items as the source of truth.
      entity.lineItems = entity.lineItems.filter(li => li.item_type !== 'total');

      // Load overrides
      const lineItemIds = entity.lineItems.map(li => li.id);
      if (lineItemIds.length > 0) {
        const { data: overrides, error: ovErr } = await req.supabase
          .from('model_values')
          .select('*')
          .in('line_item_id', lineItemIds)
          .eq('is_override', true);

        if (ovErr) throw ovErr;

        if (overrides && overrides.length > 0) {
          const overrideMap = {};
          for (const ov of overrides) {
            const key = `${ov.line_item_id}_${ov.period_index}_${ov.scenario_id}_${ov.operating_scenario_id}`;
            overrideMap[key] = ov.amount;
          }
          entity._overrideMap = overrideMap;
        }
      }
    }

    // ── 5. Load deal scenario terms ────────────────────────────────
    const dealTerms = {};
    for (const scenario of scenarios) {
      const dealRefIds = entities.flatMap(e => (e.dealRefs || []).map(r => r.id));

      let scenarioTerms = [];
      if (dealRefIds.length > 0) {
        const { data: terms, error: termsErr } = await req.supabase
          .from('model_deal_scenario_terms')
          .select('*')
          .in('model_deal_reference_id', dealRefIds)
          .eq('scenario_id', scenario.id);

        if (termsErr) throw termsErr;
        scenarioTerms = terms || [];
      }

      const facility = {
        amount: Number(scenario.initial_tranche_amount) || 0,
        rate: Number(scenario.facility_rate) || 0,
        termMonths: scenario.facility_term_months || 84,
        ioMonths: scenario.facility_io_months || 0,
        deferredMonths: scenario.facility_deferred_months || 0,
        pik: scenario.facility_pik || false,
        balloonMonth: scenario.facility_balloon_month || null
      };

      const entitiesTerms = {};
      for (const entity of entities) {
        const entityRefs = (entity.dealRefs || []);
        const entityDealTerms = scenarioTerms.filter(t =>
          entityRefs.some(r => r.id === t.model_deal_reference_id)
        );

        if (entityDealTerms.length > 0) {
          const dt = entityDealTerms[0];
          const equityFromInvestors = Number(scenario.equity_from_investors) || 0;
          const equityFromAragon = Number(scenario.equity_from_aragon) || 0;
          const equityFromOther = Number(scenario.equity_from_other) || 0;
          const equityFromTargetBalance = Number(dt.equity_from_target_balance) || 0;

          entitiesTerms[entity.id] = {
            purchasePrice: Number(dt.purchase_price) || 0,
            trancheAmount: Number(dt.tranche_amount) || 0,
            sellerNoteAmount: Number(dt.seller_note_amount) || 0,
            sellerNoteRate: Number(dt.seller_note_rate) || Number(scenario.default_seller_note_rate) || 0.06,
            sellerNoteTermMonths: dt.seller_note_term_months || scenario.default_seller_note_term_months || 60,
            sellerNoteIoMonths: dt.seller_note_io_months || scenario.default_seller_note_io_months || 0,
            sellerNoteDeferredMonths: dt.seller_note_deferred_months || scenario.default_seller_note_deferred_months || 0,
            sellerNotePik: dt.seller_note_pik != null ? dt.seller_note_pik : (scenario.default_seller_note_pik || false),
            equityContributed: equityFromInvestors + equityFromAragon + equityFromOther + equityFromTargetBalance,
            workingCapitalReserve: Number(dt.working_capital_reserve) || 0,
            transactionCosts: Number(dt.transaction_costs) || 0
          };
        }
      }

      dealTerms[scenario.id] = { facility, entities: entitiesTerms };
    }

    // ── 6. Run engine ──────────────────────────────────────────────
    const engineInput = {
      model,
      entities,
      scenarios,
      operatingScenarios: opScenarios,
      dealTerms
    };

    const result = calculateModel(engineInput);

    // ── 7. Compute input hash ──────────────────────────────────────
    const inputSnapshot = {
      entities: entities.map(e => ({
        id: e.id, entity_name: e.entity_name, entity_type: e.entity_type,
        close_period_index: e.close_period_index
      })),
      scenarios: scenarios.map(s => ({ id: s.id, name: s.name })),
      operatingScenarios: opScenarios.map(os => ({ id: os.id, name: os.name })),
      lineItems: entities.flatMap(e => (e.lineItems || []).map(li => ({
        id: li.id, category: li.category, item_name: li.item_name,
        base_amount: li.base_amount, item_type: li.item_type
      }))),
      drivers: entities.flatMap(e => (e.drivers || []).map(d => ({
        id: d.id, driver_type: d.driver_type, value: d.value,
        period_start: d.period_start, period_end: d.period_end
      }))),
      dealTerms
    };

    const inputsHash = crypto.createHash('sha256')
      .update(JSON.stringify(inputSnapshot))
      .digest('hex')
      .slice(0, 32);

    // ── 8. Compute waterfalls for all liquidity events ─────────────
    const periods = generatePeriods(model);

    const { data: liquidityEvents } = await req.supabase
      .from('model_liquidity_events')
      .select('*')
      .eq('model_id', modelId)
      .eq('scenario_id', featuredScenarioId)
      .eq('operating_scenario_id', featuredOperatingScenarioId);

    const waterfallResults = [];
    const entityIds = entities.map(e => e.id);

    if (liquidityEvents && liquidityEvents.length > 0) {
      // We need entity PL grids and debt schedules for waterfall computation.
      // Use engine run output for the featured scenario+opScenario.
      const featuredRun = result.runs.find(r =>
        r.scenarioId === featuredScenarioId &&
        r.operatingScenarioId === featuredOperatingScenarioId
      ) || result.runs[0];

      if (featuredRun) {
        const entityPLGrids = (featuredRun.entityResults || []).map(er => ({
          entityId: er.entityId,
          grid: er.grid
        }));

        const debtSchedules = (featuredRun.debtSchedules || []);

        // Load SPV equity tables
        const { data: equityRows } = await req.supabase
          .from('model_spv_equity')
          .select('*')
          .in('entity_id', entityIds)
          .eq('scenario_id', featuredScenarioId)
          .order('base_equity_pct', { ascending: false });

        const equityMap = {};
        for (const row of (equityRows || [])) {
          if (!equityMap[row.entity_id]) equityMap[row.entity_id] = { entityId: row.entity_id, entries: [] };
          equityMap[row.entity_id].entries.push(row);
        }
        const equityTables = Object.values(equityMap);

        // Load deal terms for acquisition_cost method
        const { data: dealRefRows } = await req.supabase
          .from('model_deal_references')
          .select('entity_id, model_deal_scenario_terms!inner(purchase_price)')
          .eq('model_id', modelId)
          .in('entity_id', entityIds);

        const wfDealTerms = (dealRefRows || []).map(dr => ({
          entityId: dr.entity_id,
          purchasePrice: dr.model_deal_scenario_terms?.[0]?.purchase_price || 0
        }));

        for (const exitEvent of liquidityEvents) {
          const wfResult = computeLiquidityEvent({
            exitEvent,
            entityPLGrids,
            debtSchedules,
            equityTables,
            model,
            periods,
            dealTerms: wfDealTerms
          });
          waterfallResults.push(wfResult);
        }
      }
    }

    // ── 9. Compute key metrics ─────────────────────────────────────
    const keyMetrics = computeKeyMetrics(result.runs, waterfallResults);

    // ── 10. Write to model_published_versions ──────────────────────
    // Set all existing versions to non-current
    await req.supabase
      .from('model_published_versions')
      .update({ is_current: false })
      .eq('model_id', modelId);

    // Determine next version number
    const { data: maxRow } = await req.supabase
      .from('model_published_versions')
      .select('version_number')
      .eq('model_id', modelId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    const nextVersionNumber = (maxRow?.version_number || 0) + 1;

    // Assemble JSONB output columns from the featured run
    const featuredRun = result.runs.find(r =>
      r.scenarioId === featuredScenarioId &&
      r.operatingScenarioId === featuredOperatingScenarioId
    ) || result.runs[0];

    const plOutput = (featuredRun.entityResults || []).map(er => ({
      entityId: er.entityId, entityName: er.entityName, grid: er.grid
    }));
    const bsOutput = (featuredRun.entityBSResults || []).map(ebs => ({
      entityId: ebs.entityId, grid: ebs.grid
    }));
    const cfOutput = (featuredRun.entityCFResults || []).map(ecf => ({
      entityId: ecf.entityId, grid: ecf.grid
    }));
    const corkscrewOutput = (featuredRun.debtSchedules || []).map(ds => ({
      entityId: ds.entityId, instrumentName: ds.instrumentName,
      instrumentType: ds.instrumentType, schedule: ds.schedule
    }));
    const covenantOutput = {
      consolidatedPL: featuredRun.consolidatedPL || null,
      consolidatedBS: featuredRun.consolidatedBS || null,
      consolidatedCF: featuredRun.consolidatedCF || null
    };

    const { data: published, error: pubErr } = await req.supabase
      .from('model_published_versions')
      .insert({
        model_id: modelId,
        version_number: nextVersionNumber,
        version_name: versionName,
        version_notes: versionNotes || null,
        published_by: req.user.id,
        scenario_id: featuredScenarioId,
        operating_scenario_id: featuredOperatingScenarioId,
        model_inputs_hash: inputsHash,
        pl_output: plOutput,
        bs_output: bsOutput,
        cf_output: cfOutput,
        corkscrew_output: corkscrewOutput,
        covenant_output: covenantOutput,
        waterfall_output: waterfallResults,
        key_metrics: keyMetrics,
        input_snapshot: inputSnapshot,
        is_current: true,
        investor_visible: true
      })
      .select('id')
      .single();

    if (pubErr) throw pubErr;

    // ── 11. Write draft output to DB (same as calculate) ───────────
    const INSERT_CHUNK = 5000;
    for (const run of result.runs) {
      // P&L values
      const allLineItemIds = [];
      for (const er of run.entityResults) {
        allLineItemIds.push(...Object.keys(er.lineItemValues));
      }

      if (allLineItemIds.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < allLineItemIds.length; i += CHUNK_SIZE) {
          const chunk = allLineItemIds.slice(i, i + CHUNK_SIZE);
          await req.supabase
            .from('model_values')
            .delete()
            .in('line_item_id', chunk)
            .eq('scenario_id', run.scenarioId)
            .eq('operating_scenario_id', run.operatingScenarioId)
            .eq('is_override', false);
        }
      }

      const insertRows = [];
      for (const er of run.entityResults) {
        for (const [lineItemId, values] of Object.entries(er.lineItemValues)) {
          for (const v of values) {
            if (v.amount !== 0) {
              insertRows.push({
                line_item_id: lineItemId,
                scenario_id: run.scenarioId,
                operating_scenario_id: run.operatingScenarioId,
                period_index: v.periodIndex,
                amount: v.amount,
                is_override: false
              });
            }
          }
        }
      }

      for (let i = 0; i < insertRows.length; i += INSERT_CHUNK) {
        const chunk = insertRows.slice(i, i + INSERT_CHUNK);
        const { error: insErr } = await req.supabase.from('model_values').insert(chunk);
        if (insErr) throw insErr;
      }

      // Debt corkscrews
      if (run.debtSchedules && run.debtSchedules.length > 0) {
        await req.supabase
          .from('model_debt_corkscrews')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId);

        const corkRows = [];
        for (const ds of run.debtSchedules) {
          for (const row of ds.schedule) {
            corkRows.push({
              model_id: modelId,
              scenario_id: run.scenarioId,
              entity_id: ds.entityId,
              instrument_name: ds.instrumentName,
              instrument_type: ds.instrumentType,
              start_period_index: row.periodIndex === ds.schedule[0]?.periodIndex ? 0 : row.periodIndex,
              period_index: row.periodIndex,
              beginning_balance: row.beginningBalance,
              new_borrowings: row.newBorrowings,
              cash_interest: row.cashInterest,
              pik_interest: row.pikInterest,
              cash_principal: row.cashPrincipal,
              balloon_payment: row.balloonPayment,
              ending_balance: row.endingBalance,
              current_portion: row.currentPortion,
              lt_portion: row.ltPortion
            });
          }
        }

        for (let i = 0; i < corkRows.length; i += INSERT_CHUNK) {
          const chunk = corkRows.slice(i, i + INSERT_CHUNK);
          const { error: insErr } = await req.supabase.from('model_debt_corkscrews').insert(chunk);
          if (insErr) throw insErr;
        }
      }

      // Balance sheet values
      if (run.entityBSResults && run.entityBSResults.length > 0) {
        const bsEntityIds = run.entityBSResults.map(e => e.entityId);
        await req.supabase
          .from('model_balance_sheet_values')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId)
          .eq('operating_scenario_id', run.operatingScenarioId)
          .in('entity_id', bsEntityIds);

        const bsRows = [];
        for (const ebs of run.entityBSResults) {
          for (const row of ebs.grid) {
            bsRows.push({
              model_id: modelId,
              entity_id: ebs.entityId,
              scenario_id: run.scenarioId,
              operating_scenario_id: run.operatingScenarioId,
              period_index: row.periodIndex,
              cash: row.cash,
              accounts_receivable: row.accountsReceivable,
              prepaid_expenses: row.prepaidExpenses,
              other_current_assets: row.otherCurrentAssets || 0,
              goodwill: row.goodwill,
              other_intangibles: row.otherIntangibles || 0,
              fixed_assets_net: row.fixedAssetsNet,
              other_lt_assets: row.otherLtAssets || 0,
              total_assets: row.totalAssets,
              accounts_payable: row.accountsPayable,
              accrued_expenses: row.accruedExpenses,
              current_portion_ltd: row.currentPortionLtd,
              other_current_liabilities: row.otherCurrentLiabilities || 0,
              long_term_debt: row.longTermDebt,
              other_lt_liabilities: row.otherLtLiabilities || 0,
              total_liabilities: row.totalLiabilities,
              contributed_capital: row.contributedCapital,
              retained_earnings: row.retainedEarnings,
              total_equity: row.totalEquity,
              is_balanced: row.isBalanced
            });
          }
        }

        for (let i = 0; i < bsRows.length; i += INSERT_CHUNK) {
          const chunk = bsRows.slice(i, i + INSERT_CHUNK);
          const { error: insErr } = await req.supabase.from('model_balance_sheet_values').insert(chunk);
          if (insErr) throw insErr;
        }
      }

      // Cash flow values
      if (run.entityCFResults && run.entityCFResults.length > 0) {
        const cfEntityIds = run.entityCFResults.map(e => e.entityId);
        await req.supabase
          .from('model_cf_values')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId)
          .eq('operating_scenario_id', run.operatingScenarioId)
          .in('entity_id', cfEntityIds);

        const cfRows = [];
        for (const ecf of run.entityCFResults) {
          for (const row of ecf.grid) {
            cfRows.push({
              model_id: modelId,
              entity_id: ecf.entityId,
              scenario_id: run.scenarioId,
              operating_scenario_id: run.operatingScenarioId,
              period_index: row.periodIndex,
              net_income: row.netIncome,
              depreciation_amortization: row.da,
              change_in_ar: row.changeInAr,
              change_in_ap: row.changeInAp,
              change_in_prepaid: row.changeInPrepaid,
              change_in_accrued: row.changeInAccrued,
              other_operating: row.pikInterest || 0,
              cash_from_operations: row.cashFromOperations,
              capex: row.capex,
              acquisitions: row.acquisitions,
              other_investing: 0,
              cash_from_investing: row.cashFromInvesting,
              debt_proceeds: row.debtProceeds,
              debt_repayment: row.debtRepayment,
              equity_contributions: row.equityContributions,
              dividends: 0,
              other_financing: 0,
              cash_from_financing: row.cashFromFinancing,
              net_change_in_cash: row.netChange,
              beginning_cash: row.beginningCash,
              ending_cash: row.endingCash,
              ties_to_bs: true
            });
          }
        }

        for (let i = 0; i < cfRows.length; i += INSERT_CHUNK) {
          const chunk = cfRows.slice(i, i + INSERT_CHUNK);
          const { error: insErr } = await req.supabase.from('model_cf_values').insert(chunk);
          if (insErr) throw insErr;
        }
      }
    }

    // ── 12. Audit row ──────────────────────────────────────────────
    const duration = Date.now() - startTime;
    await req.supabase
      .from('model_calculate_runs')
      .insert({
        model_id: modelId,
        triggered_by: req.user.id,
        scenario_ids: [featuredScenarioId],
        operating_scenario_ids: [featuredOperatingScenarioId],
        duration_ms: duration,
        passed: true,
        warning_count: result.runs.reduce((s, r) => s + r.warnings.length, 0),
        error_count: 0,
        model_version_hash: inputsHash,
        summary: { action: 'publish', versionNumber: nextVersionNumber }
      });

    // ── 13. Notify investors ───────────────────────────────────────
    if (notifyInvestors && process.env.N8N_WEBHOOK_URL) {
      const { data: viewers } = await req.supabase
        .from('model_access')
        .select('profiles:profile_id (email, full_name)')
        .eq('model_id', modelId)
        .eq('role', 'viewer');

      const frontendUrl = process.env.FRONTEND_URL || 'https://deals.aragon-holdings.com';

      for (const viewer of (viewers || [])) {
        const profile = viewer.profiles;
        if (!profile?.email) continue;

        fetch(process.env.N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'model_version_published',
            to: profile.email,
            modelName: model.model_name || model.name || 'Financial Model',
            versionNumber: nextVersionNumber,
            versionName,
            versionNotes: versionNotes || null,
            publishedBy: req.user.full_name || req.user.email,
            viewLink: `${frontendUrl}/models/${modelId}/view`
          })
        }).catch(err => console.error('Failed to send publish notification webhook:', err));
      }
    }

    // ── 14. Return ─────────────────────────────────────────────────
    res.status(201).json({
      success: true,
      versionNumber: nextVersionNumber,
      versionId: published.id,
      durationMs: duration
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ error: 'Publish failed', message: error.message });
  }
});

/**
 * PATCH /api/models/:modelId/versions/:versionId
 * Update version metadata (name, notes, investor_visible).
 */
router.patch('/:versionId', requireModelAccess('editor'), async (req, res) => {
  try {
    const allowedFields = ['version_name', 'version_notes', 'investor_visible'];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: version, error } = await req.supabase
      .from('model_published_versions')
      .update(updates)
      .eq('id', req.params.versionId)
      .eq('model_id', req.params.modelId)
      .select('id, version_number, version_name, version_notes, investor_visible, is_current')
      .single();

    if (error) throw error;
    if (!version) return res.status(404).json({ error: 'Version not found' });

    res.json(version);
  } catch (error) {
    console.error('Error updating version:', error);
    res.status(500).json({ error: 'Failed to update version' });
  }
});

/**
 * DELETE /api/models/:modelId/versions/:versionId
 * Delete a published version (owner only).
 * If deleting the current version, promotes the next most recent.
 */
router.delete('/:versionId', requireModelAccess('owner'), async (req, res) => {
  try {
    const { modelId, versionId } = req.params;

    // Check if this is the current version
    const { data: target, error: fetchErr } = await req.supabase
      .from('model_published_versions')
      .select('id, is_current')
      .eq('id', versionId)
      .eq('model_id', modelId)
      .single();

    if (fetchErr || !target) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Delete the version
    const { error: delErr } = await req.supabase
      .from('model_published_versions')
      .delete()
      .eq('id', versionId);

    if (delErr) throw delErr;

    // If we deleted the current version, promote the next most recent
    if (target.is_current) {
      const { data: nextVersion } = await req.supabase
        .from('model_published_versions')
        .select('id')
        .eq('model_id', modelId)
        .order('version_number', { ascending: false })
        .limit(1)
        .single();

      if (nextVersion) {
        await req.supabase
          .from('model_published_versions')
          .update({ is_current: true })
          .eq('id', nextVersion.id);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting version:', error);
    res.status(500).json({ error: 'Failed to delete version' });
  }
});

module.exports = router;
