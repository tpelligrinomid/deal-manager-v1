const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/covenants
 * List all covenants, optionally filtered by scenario_id
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { scenario_id } = req.query;

    let query = req.supabase
      .from('model_covenants')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('covenant_type')
      .order('covenant_name');

    if (scenario_id) query = query.eq('scenario_id', scenario_id);

    const { data: covenants, error } = await query;

    if (error) throw error;
    res.json(covenants || []);
  } catch (error) {
    console.error('Error listing covenants:', error);
    res.status(500).json({ error: 'Failed to list covenants' });
  }
});

/**
 * POST /api/models/:modelId/covenants
 * Create a covenant
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const {
      scenario_id, covenant_name, covenant_type, threshold_value,
      measurement_frequency, measurement_basis, cure_period_days, notes
    } = req.body;

    if (!scenario_id || !covenant_name || !covenant_type || threshold_value === undefined) {
      return res.status(400).json({ error: 'scenario_id, covenant_name, covenant_type, and threshold_value are required' });
    }

    const { data: covenant, error } = await req.supabase
      .from('model_covenants')
      .insert({
        model_id: req.params.modelId,
        scenario_id,
        covenant_name,
        covenant_type,
        threshold_value,
        measurement_frequency: measurement_frequency || 'quarterly',
        measurement_basis: measurement_basis || 'trailing_12',
        cure_period_days: cure_period_days !== undefined ? cure_period_days : 30,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(covenant);
  } catch (error) {
    console.error('Error creating covenant:', error);
    res.status(500).json({ error: 'Failed to create covenant' });
  }
});

/**
 * PATCH /api/models/:modelId/covenants/:covenantId
 * Update a covenant
 */
router.patch('/:covenantId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, model_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: covenant, error } = await req.supabase
      .from('model_covenants')
      .update(updateData)
      .eq('id', req.params.covenantId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!covenant) return res.status(404).json({ error: 'Covenant not found' });

    res.json(covenant);
  } catch (error) {
    console.error('Error updating covenant:', error);
    res.status(500).json({ error: 'Failed to update covenant' });
  }
});

/**
 * DELETE /api/models/:modelId/covenants/:covenantId
 * Delete a covenant
 */
router.delete('/:covenantId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_covenants')
      .delete()
      .eq('id', req.params.covenantId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting covenant:', error);
    res.status(500).json({ error: 'Failed to delete covenant' });
  }
});

module.exports = router;
