'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');
const { supabaseAdmin } = require('../../lib/supabase');
const { generatePeriods, computeLiquidityEvent } = require('../../lib/modelEngine');

// ─── CRUD ──────────────────────────────────────────────────────────

/**
 * GET /api/models/:modelId/liquidity-events
 * List all liquidity events for this model.
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { scenario_id, operating_scenario_id } = req.query;

    let query = req.supabase
      .from('model_liquidity_events')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('event_period_index');

    if (scenario_id) query = query.eq('scenario_id', scenario_id);
    if (operating_scenario_id) query = query.eq('operating_scenario_id', operating_scenario_id);

    const { data: events, error } = await query;

    if (error) throw error;
    res.json(events || []);
  } catch (error) {
    console.error('Error listing liquidity events:', error);
    res.status(500).json({ error: 'Failed to list liquidity events' });
  }
});

/**
 * GET /api/models/:modelId/liquidity-events/:eventId
 */
router.get('/:eventId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: event, error } = await req.supabase
      .from('model_liquidity_events')
      .select('*')
      .eq('id', req.params.eventId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!event) return res.status(404).json({ error: 'Liquidity event not found' });

    res.json(event);
  } catch (error) {
    console.error('Error fetching liquidity event:', error);
    res.status(500).json({ error: 'Failed to fetch liquidity event' });
  }
});

/**
 * POST /api/models/:modelId/liquidity-events
 * Create a new liquidity event configuration.
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { modelId } = req.params;
    const {
      scenario_id, operating_scenario_id, exit_type, event_name,
      event_period_index, profit_metric, trailing_periods,
      exit_multiple_low, exit_multiple_base, exit_multiple_high,
      exit_transaction_costs_pct, recap_leverage_multiple,
      recap_refi_costs_pct, recap_new_facility_term_months,
      ebitda_allocation_method, notes
    } = req.body;

    if (!scenario_id || !operating_scenario_id) {
      return res.status(400).json({ error: 'scenario_id and operating_scenario_id are required' });
    }

    const { data: event, error } = await req.supabase
      .from('model_liquidity_events')
      .insert({
        model_id: modelId,
        scenario_id,
        operating_scenario_id,
        exit_type: exit_type || 'full_exit',
        event_name,
        event_period_index: event_period_index != null ? event_period_index : 35,
        profit_metric,
        trailing_periods: trailing_periods || 12,
        exit_multiple_low,
        exit_multiple_base,
        exit_multiple_high,
        exit_transaction_costs_pct: exit_transaction_costs_pct != null ? exit_transaction_costs_pct : 0.04,
        recap_leverage_multiple,
        recap_refi_costs_pct,
        recap_new_facility_term_months,
        ebitda_allocation_method: ebitda_allocation_method || 'ebitda_contribution',
        notes
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating liquidity event:', error);
    res.status(500).json({ error: 'Failed to create liquidity event' });
  }
});

/**
 * PATCH /api/models/:modelId/liquidity-events/:eventId
 * Update a liquidity event configuration.
 */
router.patch('/:eventId', requireModelAccess('editor'), async (req, res) => {
  try {
    const allowedFields = [
      'exit_type', 'event_name', 'event_period_index', 'profit_metric',
      'trailing_periods', 'exit_multiple_low', 'exit_multiple_base',
      'exit_multiple_high', 'exit_transaction_costs_pct',
      'recap_leverage_multiple', 'recap_refi_costs_pct',
      'recap_new_facility_term_months', 'ebitda_allocation_method', 'notes'
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data: event, error } = await req.supabase
      .from('model_liquidity_events')
      .update(updates)
      .eq('id', req.params.eventId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!event) return res.status(404).json({ error: 'Liquidity event not found' });

    res.json(event);
  } catch (error) {
    console.error('Error updating liquidity event:', error);
    res.status(500).json({ error: 'Failed to update liquidity event' });
  }
});

/**
 * DELETE /api/models/:modelId/liquidity-events/:eventId
 * Delete a liquidity event.
 */
router.delete('/:eventId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_liquidity_events')
      .delete()
      .eq('id', req.params.eventId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting liquidity event:', error);
    res.status(500).json({ error: 'Failed to delete liquidity event' });
  }
});

// ─── COMPUTE ───────────────────────────────────────────────────────

/**
 * GET /api/models/:modelId/liquidity-events/:eventId/compute
 * Computes the full waterfall for this exit event.
 * Reads persisted model output — no DB writes.
 *
 * Returns: GEV, net proceeds, debt repaid, SPV waterfalls,
 *   per-party XIRR/MOIC, and for recaps: dividend + post-recap debt state.
 */
router.get('/:eventId/compute', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { modelId, eventId } = req.params;

    // 1. Load exit event
    const { data: exitEvent, error: evErr } = await req.supabase
      .from('model_liquidity_events')
      .select('*')
      .eq('id', eventId)
      .eq('model_id', modelId)
      .single();

    if (evErr || !exitEvent) {
      return res.status(404).json({ error: 'Liquidity event not found' });
    }

    // 2. Load model
    const { data: model, error: mdlErr } = await req.supabase
      .from('financial_models')
      .select('*')
      .eq('id', modelId)
      .single();

    if (mdlErr || !model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const periods = generatePeriods(model);

    // 3. Load entities (projectable types only)
    const { data: entities, error: entErr } = await req.supabase
      .from('model_entities')
      .select('*')
      .eq('model_id', modelId)
      .in('entity_type', ['spv', 'target', 'mid_holdco', 'intermediate_holdco'])
      .order('close_period_index', { ascending: true, nullsFirst: true });

    if (entErr) throw entErr;
    if (!entities || entities.length === 0) {
      return res.status(400).json({ error: 'No projectable entities found' });
    }

    const entityIds = entities.map(e => e.id);

    // 4. Load persisted P&L values to reconstruct entity EBITDA grids
    //    We need per-entity EBITDA at each period for the trailing window.
    //    Load from model_balance_sheet_values or reconstruct from entity PL.
    //    Simplest: load from model_values (line items) and aggregate,
    //    but it's faster to load consolidated from cf_values or reconstruct.
    //    Best approach: load entity P&L summary rows if available.

    // Load entity P&L by reading line items + values per entity
    const entityPLGrids = [];

    for (const entity of entities) {
      // Load line items for this entity
      const { data: lineItems, error: liErr } = await req.supabase
        .from('model_line_items')
        .select('id, category')
        .eq('entity_id', entity.id)
        .eq('statement', 'pl');

      if (liErr) throw liErr;

      const lineItemIds = (lineItems || []).map(li => li.id);
      const revenueIds = (lineItems || []).filter(li => li.category === 'revenue').map(li => li.id);
      const cogsIds = (lineItems || []).filter(li => li.category === 'cogs').map(li => li.id);
      const expenseIds = (lineItems || []).filter(li => li.category === 'expense').map(li => li.id);

      // Load values for this scenario/opScenario combo
      let values = [];
      if (lineItemIds.length > 0) {
        const { data: vals, error: valErr } = await req.supabase
          .from('model_values')
          .select('line_item_id, period_index, amount')
          .in('line_item_id', lineItemIds)
          .eq('scenario_id', exitEvent.scenario_id)
          .eq('operating_scenario_id', exitEvent.operating_scenario_id);

        if (valErr) throw valErr;
        values = vals || [];
      }

      // Aggregate into period grid
      const periodMap = {};
      for (const v of values) {
        if (!periodMap[v.period_index]) {
          periodMap[v.period_index] = { revenue: 0, cogs: 0, opex: 0 };
        }
        if (revenueIds.includes(v.line_item_id)) {
          periodMap[v.period_index].revenue += Number(v.amount);
        } else if (cogsIds.includes(v.line_item_id)) {
          periodMap[v.period_index].cogs += Number(v.amount);
        } else if (expenseIds.includes(v.line_item_id)) {
          periodMap[v.period_index].opex += Number(v.amount);
        }
      }

      const grid = periods.map(p => {
        const pm = periodMap[p.index] || { revenue: 0, cogs: 0, opex: 0 };
        const grossProfit = pm.revenue - pm.cogs;
        const ebitda = grossProfit - pm.opex;
        return {
          periodIndex: p.index,
          revenue: pm.revenue,
          cogs: pm.cogs,
          opex: pm.opex,
          grossProfit,
          ebitda
        };
      });

      entityPLGrids.push({ entityId: entity.id, grid });
    }

    // 5. Load debt corkscrews for this scenario
    const { data: corkscrews, error: corkErr } = await req.supabase
      .from('model_debt_corkscrews')
      .select('*')
      .eq('model_id', modelId)
      .eq('scenario_id', exitEvent.scenario_id)
      .in('entity_id', entityIds)
      .order('period_index');

    if (corkErr) throw corkErr;

    // Group corkscrews by entity + instrument
    const debtMap = {};
    for (const row of (corkscrews || [])) {
      const key = `${row.entity_id}::${row.instrument_name}`;
      if (!debtMap[key]) {
        debtMap[key] = {
          entityId: row.entity_id,
          instrumentName: row.instrument_name,
          instrumentType: row.instrument_type,
          schedule: []
        };
      }
      debtMap[key].schedule.push({
        periodIndex: row.period_index,
        beginningBalance: Number(row.beginning_balance),
        newBorrowings: Number(row.new_borrowings),
        cashInterest: Number(row.cash_interest),
        pikInterest: Number(row.pik_interest),
        cashPrincipal: Number(row.cash_principal),
        balloonPayment: Number(row.balloon_payment),
        endingBalance: Number(row.ending_balance),
        currentPortion: Number(row.current_portion),
        ltPortion: Number(row.lt_portion)
      });
    }
    const debtSchedules = Object.values(debtMap);

    // 6. Load SPV equity tables for this scenario
    const { data: equityRows, error: eqErr } = await req.supabase
      .from('model_spv_equity')
      .select('*')
      .in('entity_id', entityIds)
      .eq('scenario_id', exitEvent.scenario_id)
      .order('base_equity_pct', { ascending: false });

    if (eqErr) throw eqErr;

    // Group by entity
    const equityMap = {};
    for (const row of (equityRows || [])) {
      if (!equityMap[row.entity_id]) {
        equityMap[row.entity_id] = { entityId: row.entity_id, entries: [] };
      }
      equityMap[row.entity_id].entries.push(row);
    }
    const equityTables = Object.values(equityMap);

    // 7. Load deal terms for acquisition_cost method
    const { data: dealRefs, error: drErr } = await req.supabase
      .from('model_deal_references')
      .select('entity_id, model_deal_scenario_terms!inner(purchase_price)')
      .eq('model_id', modelId)
      .in('entity_id', entityIds);

    if (drErr) throw drErr;

    const dealTerms = (dealRefs || []).map(dr => ({
      entityId: dr.entity_id,
      purchasePrice: dr.model_deal_scenario_terms?.[0]?.purchase_price || 0
    }));

    // 8. Compute
    const result = computeLiquidityEvent({
      exitEvent,
      entityPLGrids,
      debtSchedules,
      equityTables,
      model,
      periods,
      dealTerms
    });

    res.json(result);
  } catch (error) {
    console.error('Error computing liquidity event:', error);
    res.status(500).json({ error: 'Failed to compute liquidity event', message: error.message });
  }
});

module.exports = router;
