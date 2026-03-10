'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');
const { calculateModel } = require('../../lib/modelEngine');

/**
 * POST /api/models/:modelId/calculate
 * Runs the 3-statement engine and writes output to model_values,
 * model_debt_corkscrews, model_balance_sheet_values, model_cf_values + audit trail.
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  const startTime = Date.now();
  const { modelId } = req.params;
  const { scenarioIds, operatingScenarioIds } = req.body || {};

  try {
    // 1. Load model
    const { data: model, error: modelErr } = await req.supabase
      .from('financial_models')
      .select('*')
      .eq('id', modelId)
      .single();

    if (modelErr || !model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // 2. Load entities (exclude aragon/consolidated — engine filters too, but skip the DB load)
    const { data: entities, error: entErr } = await req.supabase
      .from('model_entities')
      .select('*')
      .eq('model_id', modelId)
      .not('entity_type', 'in', '("aragon","consolidated")')
      .order('close_period_index', { ascending: true, nullsFirst: true });

    if (entErr) throw entErr;

    // 3. Load scenarios + operating scenarios
    let scenarioQuery = req.supabase
      .from('model_scenarios')
      .select('*')
      .eq('model_id', modelId);

    if (scenarioIds && scenarioIds.length > 0) {
      scenarioQuery = scenarioQuery.in('id', scenarioIds);
    }

    let opQuery = req.supabase
      .from('model_operating_scenarios')
      .select('*')
      .eq('model_id', modelId);

    if (operatingScenarioIds && operatingScenarioIds.length > 0) {
      opQuery = opQuery.in('id', operatingScenarioIds);
    }

    const [{ data: scenarios, error: scenErr }, { data: opScenarios, error: opErr }] = await Promise.all([
      scenarioQuery,
      opQuery
    ]);

    if (scenErr) throw scenErr;
    if (opErr) throw opErr;

    if (!scenarios || scenarios.length === 0) {
      return res.status(400).json({ error: 'No scenarios found for this model' });
    }
    if (!opScenarios || opScenarios.length === 0) {
      return res.status(400).json({ error: 'No operating scenarios found for this model' });
    }

    // 4. For each entity, load line items (pl only), drivers, segments, and deal references
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

      // 5. Filter out display-only subtotal rows (item_type = 'total') — not projection inputs.
      // Trust base_amount values from model_line_items as the source of truth.
      // No seeding: the frontend sets base_amount when line items are created.
      entity.lineItems = entity.lineItems.filter(li => li.item_type !== 'total');

      // 6. Load overrides: model_values where is_override = true
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

    // 6b. Load deal scenario terms for each scenario
    const dealTerms = {};
    for (const scenario of scenarios) {
      const entityIds = entities.map(e => e.id);
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

      // Build dealTerms structure
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
        // Find deal scenario terms for this entity's deal reference(s)
        const entityDealTerms = scenarioTerms.filter(t =>
          entityRefs.some(r => r.id === t.model_deal_reference_id)
        );

        if (entityDealTerms.length > 0) {
          const dt = entityDealTerms[0]; // one per entity per scenario
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

    // 7. Call engine
    const engineInput = {
      model,
      entities,
      scenarios,
      operatingScenarios: opScenarios,
      dealTerms
    };

    const result = calculateModel(engineInput);

    // 8. Write output to DB
    const scenarioIdList = scenarios.map(s => s.id);
    const opScenarioIdList = opScenarios.map(os => os.id);
    let totalRowsWritten = 0;
    const allWarnings = [];
    const allValidationErrors = [];

    for (const run of result.runs) {
      // 8a. Delete + insert model_values (P&L line item values)
      const allLineItemIds = [];
      for (const er of run.entityResults) {
        allLineItemIds.push(...Object.keys(er.lineItemValues));
      }

      if (allLineItemIds.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < allLineItemIds.length; i += CHUNK_SIZE) {
          const chunk = allLineItemIds.slice(i, i + CHUNK_SIZE);
          const { error: delErr } = await req.supabase
            .from('model_values')
            .delete()
            .in('line_item_id', chunk)
            .eq('scenario_id', run.scenarioId)
            .eq('operating_scenario_id', run.operatingScenarioId)
            .eq('is_override', false);

          if (delErr) throw delErr;
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

      const INSERT_CHUNK = 5000;
      for (let i = 0; i < insertRows.length; i += INSERT_CHUNK) {
        const chunk = insertRows.slice(i, i + INSERT_CHUNK);
        const { error: insErr } = await req.supabase
          .from('model_values')
          .insert(chunk);

        if (insErr) throw insErr;
      }
      totalRowsWritten += insertRows.length;

      // 8b. Write debt corkscrews
      if (run.debtSchedules && run.debtSchedules.length > 0) {
        // Delete existing corkscrews for this scenario
        const { error: delCorkErr } = await req.supabase
          .from('model_debt_corkscrews')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId);

        if (delCorkErr) throw delCorkErr;

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
          const { error: insErr } = await req.supabase
            .from('model_debt_corkscrews')
            .insert(chunk);

          if (insErr) throw insErr;
        }
        totalRowsWritten += corkRows.length;
      }

      // 8c. Write balance sheet values
      if (run.entityBSResults && run.entityBSResults.length > 0) {
        // Delete existing BS values for this scenario combo
        const entityIds = run.entityBSResults.map(e => e.entityId);
        const { error: delBsErr } = await req.supabase
          .from('model_balance_sheet_values')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId)
          .eq('operating_scenario_id', run.operatingScenarioId)
          .in('entity_id', entityIds);

        if (delBsErr) throw delBsErr;

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
          const { error: insErr } = await req.supabase
            .from('model_balance_sheet_values')
            .insert(chunk);

          if (insErr) throw insErr;
        }
        totalRowsWritten += bsRows.length;
      }

      // 8d. Write cash flow values
      if (run.entityCFResults && run.entityCFResults.length > 0) {
        const entityIds = run.entityCFResults.map(e => e.entityId);
        const { error: delCfErr } = await req.supabase
          .from('model_cf_values')
          .delete()
          .eq('model_id', modelId)
          .eq('scenario_id', run.scenarioId)
          .eq('operating_scenario_id', run.operatingScenarioId)
          .in('entity_id', entityIds);

        if (delCfErr) throw delCfErr;

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
          const { error: insErr } = await req.supabase
            .from('model_cf_values')
            .insert(chunk);

          if (insErr) throw insErr;
        }
        totalRowsWritten += cfRows.length;
      }

      allWarnings.push(...run.warnings);
      allValidationErrors.push(...(run.validationErrors || []));
    }

    // 9. Compute model version hash
    const hashInput = JSON.stringify({
      model: model.id,
      scenarios: scenarioIdList,
      opScenarios: opScenarioIdList,
      entityCount: entities.length,
      timestamp: Date.now()
    });
    const versionHash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

    // 10. Insert audit row
    const duration = Date.now() - startTime;
    const { error: auditErr } = await req.supabase
      .from('model_calculate_runs')
      .insert({
        model_id: modelId,
        triggered_by: req.user.id,
        scenario_ids: scenarioIdList,
        operating_scenario_ids: opScenarioIdList,
        duration_ms: duration,
        passed: allValidationErrors.length === 0,
        warning_count: allWarnings.length,
        error_count: allValidationErrors.length,
        model_version_hash: versionHash,
        summary: {
          totalRowsWritten,
          entityCount: result.runs[0]?.entityResults.length || 0,
          runCount: result.runs.length,
          warnings: allWarnings,
          validationErrors: allValidationErrors
        }
      });

    if (auditErr) {
      console.error('Failed to write audit row:', auditErr);
    }

    // 11. Return response
    res.json({
      success: true,
      modelId,
      versionHash,
      durationMs: duration,
      periods: result.periods.length,
      runs: result.runs.map(run => ({
        scenarioId: run.scenarioId,
        scenarioName: run.scenarioName,
        operatingScenarioId: run.operatingScenarioId,
        operatingScenarioName: run.operatingScenarioName,
        entities: run.entityResults.map((er, idx) => ({
          entityId: er.entityId,
          entityName: er.entityName,
          entityType: er.entityType,
          pl: er.grid,
          bs: run.entityBSResults[idx]?.grid || [],
          cf: run.entityCFResults[idx]?.grid || []
        })),
        debtSchedules: (run.debtSchedules || []).map(ds => ({
          instrumentName: ds.instrumentName,
          instrumentType: ds.instrumentType,
          entityId: ds.entityId,
          schedule: ds.schedule
        })),
        consolidatedPL: run.consolidatedPL,
        consolidatedBS: run.consolidatedBS,
        consolidatedCF: run.consolidatedCF,
        warnings: run.warnings,
        validationErrors: run.validationErrors || []
      })),
      totalRowsWritten
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('Calculate error:', error);

    try {
      await req.supabase
        .from('model_calculate_runs')
        .insert({
          model_id: modelId,
          triggered_by: req.user.id,
          scenario_ids: scenarioIds || [],
          operating_scenario_ids: operatingScenarioIds || [],
          duration_ms: duration,
          passed: false,
          warning_count: 0,
          error_count: 1,
          model_version_hash: 'error',
          summary: { error: error.message }
        });
    } catch (auditErr) {
      console.error('Failed to write error audit row:', auditErr);
    }

    res.status(500).json({ error: 'Calculation failed', message: error.message });
  }
});

module.exports = router;
