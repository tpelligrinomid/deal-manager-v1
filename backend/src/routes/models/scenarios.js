const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/scenarios
 * List all deal structure scenarios
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: scenarios, error } = await req.supabase
      .from('model_scenarios')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('created_at');

    if (error) throw error;
    res.json(scenarios || []);
  } catch (error) {
    console.error('Error listing scenarios:', error);
    res.status(500).json({ error: 'Failed to list scenarios' });
  }
});

/**
 * GET /api/models/:modelId/scenarios/:scenarioId
 * Get a single scenario
 */
router.get('/:scenarioId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: scenario, error } = await req.supabase
      .from('model_scenarios')
      .select('*')
      .eq('id', req.params.scenarioId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    res.json(scenario);
  } catch (error) {
    console.error('Error fetching scenario:', error);
    res.status(500).json({ error: 'Failed to fetch scenario' });
  }
});

/**
 * POST /api/models/:modelId/scenarios
 * Create a new deal structure scenario
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { name, ...rest } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Strip non-schema fields
    const { id, created_at, updated_at, updated_by, model_id, ...fields } = rest;

    const { data: scenario, error } = await req.supabase
      .from('model_scenarios')
      .insert({ model_id: req.params.modelId, name, ...fields })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(scenario);
  } catch (error) {
    console.error('Error creating scenario:', error);
    res.status(500).json({ error: 'Failed to create scenario' });
  }
});

/**
 * PATCH /api/models/:modelId/scenarios/:scenarioId
 * Update scenario fields
 */
router.patch('/:scenarioId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, model_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: scenario, error } = await req.supabase
      .from('model_scenarios')
      .update(updateData)
      .eq('id', req.params.scenarioId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    res.json(scenario);
  } catch (error) {
    console.error('Error updating scenario:', error);
    res.status(500).json({ error: 'Failed to update scenario' });
  }
});

/**
 * DELETE /api/models/:modelId/scenarios/:scenarioId
 * Delete a scenario (cannot delete base case if it's the only one)
 */
router.delete('/:scenarioId', requireModelAccess('owner'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_scenarios')
      .delete()
      .eq('id', req.params.scenarioId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting scenario:', error);
    res.status(500).json({ error: 'Failed to delete scenario' });
  }
});

module.exports = router;
