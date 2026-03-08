const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities/:entityId/spv-equity
 * List SPV equity rows for an entity, optionally filtered by scenario_id
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { scenario_id } = req.query;

    let query = req.supabase
      .from('model_spv_equity')
      .select('*')
      .eq('entity_id', req.params.entityId)
      .order('party_type')
      .order('party_name');

    if (scenario_id) query = query.eq('scenario_id', scenario_id);

    const { data: rows, error } = await query;

    if (error) throw error;
    res.json(rows || []);
  } catch (error) {
    console.error('Error listing SPV equity:', error);
    res.status(500).json({ error: 'Failed to list SPV equity' });
  }
});

/**
 * POST /api/models/:modelId/entities/:entityId/spv-equity
 * Create an SPV equity row
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const {
      scenario_id, party_name, party_type, base_equity_pct,
      carry_pct, hurdle_rate_annual, contributed_capital,
      contribution_period_index, commitment_status, notes
    } = req.body;

    if (!scenario_id || !party_name || !party_type || base_equity_pct === undefined) {
      return res.status(400).json({ error: 'scenario_id, party_name, party_type, and base_equity_pct are required' });
    }

    const { data: row, error } = await req.supabase
      .from('model_spv_equity')
      .insert({
        entity_id: req.params.entityId,
        scenario_id,
        party_name,
        party_type,
        base_equity_pct,
        carry_pct: carry_pct || 0,
        hurdle_rate_annual: hurdle_rate_annual || 0,
        contributed_capital: contributed_capital || 0,
        contribution_period_index: contribution_period_index || 0,
        commitment_status: commitment_status || 'soft_circle',
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(row);
  } catch (error) {
    console.error('Error creating SPV equity:', error);
    res.status(500).json({ error: 'Failed to create SPV equity' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId/spv-equity/:equityId
 * Update an SPV equity row
 */
router.patch('/:equityId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, entity_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: row, error } = await req.supabase
      .from('model_spv_equity')
      .update(updateData)
      .eq('id', req.params.equityId)
      .eq('entity_id', req.params.entityId)
      .select()
      .single();

    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'SPV equity record not found' });

    res.json(row);
  } catch (error) {
    console.error('Error updating SPV equity:', error);
    res.status(500).json({ error: 'Failed to update SPV equity' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId/spv-equity/:equityId
 * Delete an SPV equity row
 */
router.delete('/:equityId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_spv_equity')
      .delete()
      .eq('id', req.params.equityId)
      .eq('entity_id', req.params.entityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting SPV equity:', error);
    res.status(500).json({ error: 'Failed to delete SPV equity' });
  }
});

module.exports = router;
