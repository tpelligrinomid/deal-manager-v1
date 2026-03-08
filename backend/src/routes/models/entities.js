const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities
 * List all entities for a model
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: entities, error } = await req.supabase
      .from('model_entities')
      .select('*')
      .eq('model_id', req.params.modelId)
      .order('sort_order');

    if (error) throw error;
    res.json(entities || []);
  } catch (error) {
    console.error('Error listing entities:', error);
    res.status(500).json({ error: 'Failed to list entities' });
  }
});

/**
 * GET /api/models/:modelId/entities/:entityId
 * Get a single entity
 */
router.get('/:entityId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: entity, error } = await req.supabase
      .from('model_entities')
      .select('*')
      .eq('id', req.params.entityId)
      .eq('model_id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!entity) return res.status(404).json({ error: 'Entity not found' });

    res.json(entity);
  } catch (error) {
    console.error('Error fetching entity:', error);
    res.status(500).json({ error: 'Failed to fetch entity' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId
 * Update entity name, sort_order, baseline_id, inherit_baseline
 */
router.patch('/:entityId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { entity_name, sort_order, baseline_id, inherit_baseline } = req.body;
    const update = { updated_at: new Date().toISOString(), updated_by: req.user.id };
    if (entity_name !== undefined) update.entity_name = entity_name;
    if (sort_order !== undefined) update.sort_order = sort_order;
    if (baseline_id !== undefined) update.baseline_id = baseline_id;
    if (inherit_baseline !== undefined) update.inherit_baseline = inherit_baseline;

    const { data: entity, error } = await req.supabase
      .from('model_entities')
      .update(update)
      .eq('id', req.params.entityId)
      .eq('model_id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!entity) return res.status(404).json({ error: 'Entity not found' });

    res.json(entity);
  } catch (error) {
    console.error('Error updating entity:', error);
    res.status(500).json({ error: 'Failed to update entity' });
  }
});

module.exports = router;
