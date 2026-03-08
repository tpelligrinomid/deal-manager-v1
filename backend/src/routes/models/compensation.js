const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities/:entityId/compensation
 * List holdco compensation rows for an entity
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: rows, error } = await req.supabase
      .from('model_holdco_compensation')
      .select('*')
      .eq('entity_id', req.params.entityId)
      .eq('model_id', req.params.modelId)
      .order('period_start')
      .order('party_name');

    if (error) throw error;
    res.json(rows || []);
  } catch (error) {
    console.error('Error listing compensation:', error);
    res.status(500).json({ error: 'Failed to list compensation' });
  }
});

/**
 * POST /api/models/:modelId/entities/:entityId/compensation
 * Create a compensation row
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { party_name, compensation_type, amount_annual, period_start, period_end, notes } = req.body;

    if (!party_name || !compensation_type || amount_annual === undefined) {
      return res.status(400).json({ error: 'party_name, compensation_type, and amount_annual are required' });
    }

    const { data: row, error } = await req.supabase
      .from('model_holdco_compensation')
      .insert({
        model_id: req.params.modelId,
        entity_id: req.params.entityId,
        party_name,
        compensation_type,
        amount_annual,
        period_start: period_start || 0,
        period_end: period_end || null,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(row);
  } catch (error) {
    console.error('Error creating compensation:', error);
    res.status(500).json({ error: 'Failed to create compensation' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId/compensation/:compId
 * Update a compensation row
 */
router.patch('/:compId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, model_id, entity_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: row, error } = await req.supabase
      .from('model_holdco_compensation')
      .update(updateData)
      .eq('id', req.params.compId)
      .eq('entity_id', req.params.entityId)
      .select()
      .single();

    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Compensation record not found' });

    res.json(row);
  } catch (error) {
    console.error('Error updating compensation:', error);
    res.status(500).json({ error: 'Failed to update compensation' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId/compensation/:compId
 * Delete a compensation row
 */
router.delete('/:compId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_holdco_compensation')
      .delete()
      .eq('id', req.params.compId)
      .eq('entity_id', req.params.entityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting compensation:', error);
    res.status(500).json({ error: 'Failed to delete compensation' });
  }
});

module.exports = router;
