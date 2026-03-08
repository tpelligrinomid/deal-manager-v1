const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/operating-scenarios
 * List all operating scenarios
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: scenarios, error } = await req.supabase
      .from('model_operating_scenarios')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('case_type');

    if (error) throw error;
    res.json(scenarios || []);
  } catch (error) {
    console.error('Error listing operating scenarios:', error);
    res.status(500).json({ error: 'Failed to list operating scenarios' });
  }
});

/**
 * GET /api/models/:modelId/operating-scenarios/:osId
 * Get a single operating scenario
 */
router.get('/:osId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: scenario, error } = await req.supabase
      .from('model_operating_scenarios')
      .select('*')
      .eq('id', req.params.osId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!scenario) return res.status(404).json({ error: 'Operating scenario not found' });

    res.json(scenario);
  } catch (error) {
    console.error('Error fetching operating scenario:', error);
    res.status(500).json({ error: 'Failed to fetch operating scenario' });
  }
});

/**
 * PATCH /api/models/:modelId/operating-scenarios/:osId
 * Update operating scenario (name, description, is_default)
 */
router.patch('/:osId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { name, description, is_default } = req.body;
    const update = { updated_at: new Date().toISOString(), updated_by: req.user.id };
    if (name !== undefined) update.name = name;
    if (description !== undefined) update.description = description;
    if (is_default !== undefined) update.is_default = is_default;

    const { data: scenario, error } = await req.supabase
      .from('model_operating_scenarios')
      .update(update)
      .eq('id', req.params.osId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!scenario) return res.status(404).json({ error: 'Operating scenario not found' });

    res.json(scenario);
  } catch (error) {
    console.error('Error updating operating scenario:', error);
    res.status(500).json({ error: 'Failed to update operating scenario' });
  }
});

module.exports = router;
