const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * Calculate close_period_index from model start_date and deal close_date
 */
function calculateClosePeriodIndex(modelStartDate, closeDate) {
  const start = new Date(modelStartDate);
  const close = new Date(closeDate);
  return (close.getFullYear() - start.getFullYear()) * 12
       + (close.getMonth() - start.getMonth());
}

/**
 * GET /api/models/:modelId/deal-references
 * List all deal references with entity and deal info
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: refs, error } = await req.supabase
      .from('model_deal_references')
      .select(`
        *,
        deals:deal_id (id, agency_name, reported_revenue, reported_ebitda, asking_price),
        entity:entity_id (id, entity_name, entity_type)
      `)
      .eq('model_id', req.params.modelId)
      .order('close_period_index');

    if (error) throw error;
    res.json(refs || []);
  } catch (error) {
    console.error('Error listing deal references:', error);
    res.status(500).json({ error: 'Failed to list deal references' });
  }
});

/**
 * GET /api/models/:modelId/deal-references/:refId
 * Get a single deal reference with scenario terms
 */
router.get('/:refId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: ref, error } = await req.supabase
      .from('model_deal_references')
      .select(`
        *,
        deals:deal_id (id, agency_name, reported_revenue, reported_ebitda, asking_price),
        entity:entity_id (id, entity_name, entity_type),
        model_deal_scenario_terms (*)
      `)
      .eq('id', req.params.refId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!ref) return res.status(404).json({ error: 'Deal reference not found' });

    res.json(ref);
  } catch (error) {
    console.error('Error fetching deal reference:', error);
    res.status(500).json({ error: 'Failed to fetch deal reference' });
  }
});

/**
 * POST /api/models/:modelId/deal-references
 * Add a deal to the model — auto-creates SPV entity
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { deal_id, close_date, pull_reported_revenue, pull_reported_ebitda, pull_asking_price, notes } = req.body;

    if (!deal_id || !close_date) {
      return res.status(400).json({ error: 'deal_id and close_date are required' });
    }

    // Get model for start_date and period_count
    const { data: model, error: modelError } = await req.supabase
      .from('financial_models')
      .select('start_date, period_count')
      .eq('id', req.params.modelId)
      .single();

    if (modelError || !model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const closePeriodIndex = calculateClosePeriodIndex(model.start_date, close_date);
    if (closePeriodIndex < 0 || closePeriodIndex >= model.period_count) {
      return res.status(400).json({ error: `close_date must fall within model period range (0 to ${model.period_count - 1})` });
    }

    // Get deal name for SPV entity
    const { data: deal, error: dealError } = await req.supabase
      .from('deals')
      .select('agency_name')
      .eq('id', deal_id)
      .single();

    if (dealError || !deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    // Get intermediate_holdco entity to use as parent
    const { data: ihc, error: ihcError } = await req.supabase
      .from('model_entities')
      .select('id')
      .eq('model_id', req.params.modelId)
      .eq('entity_type', 'intermediate_holdco')
      .single();

    if (ihcError || !ihc) {
      return res.status(400).json({ error: 'Model missing intermediate_holdco entity' });
    }

    // Create SPV entity
    const { data: spvEntity, error: spvError } = await req.supabase
      .from('model_entities')
      .insert({
        model_id: req.params.modelId,
        entity_type: 'spv',
        entity_name: deal.agency_name,
        parent_entity_id: ihc.id,
        close_period_index: closePeriodIndex,
        sort_order: closePeriodIndex
      })
      .select()
      .single();

    if (spvError) throw spvError;

    // Create deal reference
    const { data: ref, error: refError } = await req.supabase
      .from('model_deal_references')
      .insert({
        model_id: req.params.modelId,
        deal_id,
        entity_id: spvEntity.id,
        close_date,
        close_period_index: closePeriodIndex,
        pull_reported_revenue: pull_reported_revenue !== undefined ? pull_reported_revenue : true,
        pull_reported_ebitda: pull_reported_ebitda !== undefined ? pull_reported_ebitda : true,
        pull_asking_price: pull_asking_price !== undefined ? pull_asking_price : true,
        notes: notes || null
      })
      .select(`
        *,
        deals:deal_id (id, agency_name, reported_revenue, reported_ebitda, asking_price),
        entity:entity_id (id, entity_name, entity_type)
      `)
      .single();

    if (refError) {
      // Clean up SPV entity on failure
      await req.supabase.from('model_entities').delete().eq('id', spvEntity.id);
      throw refError;
    }

    res.status(201).json(ref);
  } catch (error) {
    console.error('Error creating deal reference:', error);
    res.status(500).json({ error: 'Failed to create deal reference' });
  }
});

/**
 * PATCH /api/models/:modelId/deal-references/:refId
 * Update deal reference (close_date recalculates close_period_index)
 */
router.patch('/:refId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { close_date, pull_reported_revenue, pull_reported_ebitda, pull_asking_price, seed_overridden, notes } = req.body;
    const update = { updated_at: new Date().toISOString(), updated_by: req.user.id };

    if (close_date !== undefined) {
      const { data: model } = await req.supabase
        .from('financial_models')
        .select('start_date, period_count')
        .eq('id', req.params.modelId)
        .single();

      const closePeriodIndex = calculateClosePeriodIndex(model.start_date, close_date);
      if (closePeriodIndex < 0 || closePeriodIndex >= model.period_count) {
        return res.status(400).json({ error: `close_date must fall within model period range` });
      }
      update.close_date = close_date;
      update.close_period_index = closePeriodIndex;

      // Also update the SPV entity's close_period_index
      const { data: ref } = await req.supabase
        .from('model_deal_references')
        .select('entity_id')
        .eq('id', req.params.refId)
        .single();

      if (ref) {
        await req.supabase
          .from('model_entities')
          .update({ close_period_index: closePeriodIndex, updated_at: new Date().toISOString() })
          .eq('id', ref.entity_id);
      }
    }

    if (pull_reported_revenue !== undefined) update.pull_reported_revenue = pull_reported_revenue;
    if (pull_reported_ebitda !== undefined) update.pull_reported_ebitda = pull_reported_ebitda;
    if (pull_asking_price !== undefined) update.pull_asking_price = pull_asking_price;
    if (seed_overridden !== undefined) update.seed_overridden = seed_overridden;
    if (notes !== undefined) update.notes = notes;

    const { data: ref, error } = await req.supabase
      .from('model_deal_references')
      .update(update)
      .eq('id', req.params.refId)
      .eq('model_id', req.params.modelId)
      .select(`
        *,
        deals:deal_id (id, agency_name, reported_revenue, reported_ebitda, asking_price),
        entity:entity_id (id, entity_name, entity_type)
      `)
      .single();

    if (error) throw error;
    if (!ref) return res.status(404).json({ error: 'Deal reference not found' });

    res.json(ref);
  } catch (error) {
    console.error('Error updating deal reference:', error);
    res.status(500).json({ error: 'Failed to update deal reference' });
  }
});

/**
 * DELETE /api/models/:modelId/deal-references/:refId
 * Remove deal reference and its SPV entity
 */
router.delete('/:refId', requireModelAccess('owner'), async (req, res) => {
  try {
    // Get entity_id before deleting
    const { data: ref, error: fetchError } = await req.supabase
      .from('model_deal_references')
      .select('entity_id')
      .eq('id', req.params.refId)
      .eq('model_id', req.params.modelId)
      .single();

    if (fetchError || !ref) {
      return res.status(404).json({ error: 'Deal reference not found' });
    }

    // Delete deal reference (cascade cleans up scenario terms)
    const { error: deleteError } = await req.supabase
      .from('model_deal_references')
      .delete()
      .eq('id', req.params.refId);

    if (deleteError) throw deleteError;

    // Delete the SPV entity (cascade cleans up line items, drivers, etc.)
    const { error: entityError } = await req.supabase
      .from('model_entities')
      .delete()
      .eq('id', ref.entity_id);

    if (entityError) throw entityError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting deal reference:', error);
    res.status(500).json({ error: 'Failed to delete deal reference' });
  }
});

// --- Deal Scenario Terms ---

/**
 * GET /api/models/:modelId/deal-references/:refId/terms
 * List scenario terms for a deal reference
 */
router.get('/:refId/terms', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: terms, error } = await req.supabase
      .from('model_deal_scenario_terms')
      .select('*, model_scenarios:scenario_id (id, name)')
      .eq('model_deal_reference_id', req.params.refId)
      .order('created_at');

    if (error) throw error;
    res.json(terms || []);
  } catch (error) {
    console.error('Error listing deal scenario terms:', error);
    res.status(500).json({ error: 'Failed to list deal scenario terms' });
  }
});

/**
 * PUT /api/models/:modelId/deal-references/:refId/terms
 * Upsert scenario terms for a deal reference (array of { scenario_id, ...fields })
 */
router.put('/:refId/terms', requireModelAccess('editor'), async (req, res) => {
  try {
    const terms = req.body;
    if (!Array.isArray(terms) || terms.length === 0) {
      return res.status(400).json({ error: 'Body must be an array of scenario term objects' });
    }

    const rows = terms.map(t => ({
      model_deal_reference_id: req.params.refId,
      scenario_id: t.scenario_id,
      purchase_price: t.purchase_price,
      transaction_costs: t.transaction_costs,
      working_capital_reserve: t.working_capital_reserve,
      equity_from_target_balance: t.equity_from_target_balance,
      tranche_amount: t.tranche_amount,
      seller_note_amount: t.seller_note_amount,
      seller_note_rate: t.seller_note_rate,
      seller_note_term_months: t.seller_note_term_months,
      seller_note_io_months: t.seller_note_io_months,
      seller_note_deferred_months: t.seller_note_deferred_months,
      seller_note_pik: t.seller_note_pik,
      earnout_amount: t.earnout_amount,
      earnout_threshold: t.earnout_threshold,
      earnout_cap: t.earnout_cap,
      earnout_period_months: t.earnout_period_months,
      earnout_is_equity_instrument: t.earnout_is_equity_instrument,
      seller_equity_rollover_pct: t.seller_equity_rollover_pct,
      updated_at: new Date().toISOString(),
      updated_by: req.user.id
    }));

    const { data: result, error } = await req.supabase
      .from('model_deal_scenario_terms')
      .upsert(rows, { onConflict: 'model_deal_reference_id,scenario_id' })
      .select('*, model_scenarios:scenario_id (id, name)');

    if (error) throw error;
    res.json(result);
  } catch (error) {
    console.error('Error upserting deal scenario terms:', error);
    res.status(500).json({ error: 'Failed to upsert deal scenario terms' });
  }
});

module.exports = router;
