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
 * POST /api/models/:modelId/entities
 * Create a new entity (typically SPV/target for acquisitions)
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { entity_type, entity_name, close_period_index, sort_order } = req.body;

    if (!entity_type || !entity_name) {
      return res.status(400).json({ error: 'entity_type and entity_name are required' });
    }

    const allowedTypes = ['spv', 'target', 'mid_holdco', 'intermediate_holdco'];
    if (!allowedTypes.includes(entity_type)) {
      return res.status(400).json({ error: `entity_type must be one of: ${allowedTypes.join(', ')}` });
    }

    // Auto-set parent_entity_id: SPVs and targets are siblings under Intermediate HoldCo
    let parentEntityId = req.body.parent_entity_id || null;
    if (!parentEntityId && ['spv', 'target'].includes(entity_type)) {
      const { data: intHoldco } = await req.supabase
        .from('model_entities')
        .select('id')
        .eq('model_id', req.params.modelId)
        .eq('entity_type', 'intermediate_holdco')
        .single();

      if (intHoldco) parentEntityId = intHoldco.id;
    }

    // Determine sort_order if not provided
    // SPVs/targets start at 3 (after aragon=0, intermediate_holdco=1, mid_holdco=2)
    let nextSort = sort_order;
    if (nextSort == null) {
      const { data: siblings } = await req.supabase
        .from('model_entities')
        .select('sort_order')
        .eq('model_id', req.params.modelId)
        .in('entity_type', ['spv', 'target', 'mid_holdco'])
        .order('sort_order', { ascending: false })
        .limit(1)
        .single();

      nextSort = Math.max((siblings?.sort_order || 2) + 1, 3);
    }

    const { data: entity, error } = await req.supabase
      .from('model_entities')
      .insert({
        model_id: req.params.modelId,
        entity_type,
        entity_name,
        parent_entity_id: parentEntityId,
        close_period_index: close_period_index != null ? close_period_index : null,
        sort_order: nextSort
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(entity);
  } catch (error) {
    console.error('Error creating entity:', error);
    res.status(500).json({ error: 'Failed to create entity' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId
 * Delete an entity (CASCADE removes child records)
 */
router.delete('/:entityId', requireModelAccess('editor'), async (req, res) => {
  try {
    // Prevent deleting singleton entities
    const { data: entity, error: fetchErr } = await req.supabase
      .from('model_entities')
      .select('entity_type')
      .eq('id', req.params.entityId)
      .eq('model_id', req.params.modelId)
      .single();

    if (fetchErr || !entity) {
      return res.status(404).json({ error: 'Entity not found' });
    }

    const singletonTypes = ['aragon', 'consolidated'];
    if (singletonTypes.includes(entity.entity_type)) {
      return res.status(400).json({ error: 'Cannot delete singleton entity' });
    }

    const { error } = await req.supabase
      .from('model_entities')
      .delete()
      .eq('id', req.params.entityId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting entity:', error);
    res.status(500).json({ error: 'Failed to delete entity' });
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
