const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities/:entityId/segments
 * List segments for an entity
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: segments, error } = await req.supabase
      .from('model_segments')
      .select('*')
      .eq('entity_id', req.params.entityId)
      .order('sort_order');

    if (error) throw error;
    res.json(segments || []);
  } catch (error) {
    console.error('Error listing segments:', error);
    res.status(500).json({ error: 'Failed to list segments' });
  }
});

/**
 * POST /api/models/:modelId/entities/:entityId/segments
 * Create a segment
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { segment_name, sort_order } = req.body;
    if (!segment_name) {
      return res.status(400).json({ error: 'segment_name is required' });
    }

    const { data: segment, error } = await req.supabase
      .from('model_segments')
      .insert({
        entity_id: req.params.entityId,
        segment_name,
        sort_order: sort_order || 0
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(segment);
  } catch (error) {
    console.error('Error creating segment:', error);
    res.status(500).json({ error: 'Failed to create segment' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId/segments/:segmentId
 * Update a segment
 */
router.patch('/:segmentId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { segment_name, sort_order } = req.body;
    const update = {};
    if (segment_name !== undefined) update.segment_name = segment_name;
    if (sort_order !== undefined) update.sort_order = sort_order;

    const { data: segment, error } = await req.supabase
      .from('model_segments')
      .update(update)
      .eq('id', req.params.segmentId)
      .eq('entity_id', req.params.entityId)
      .select()
      .single();

    if (error) throw error;
    if (!segment) return res.status(404).json({ error: 'Segment not found' });

    res.json(segment);
  } catch (error) {
    console.error('Error updating segment:', error);
    res.status(500).json({ error: 'Failed to update segment' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId/segments/:segmentId
 * Delete a segment
 */
router.delete('/:segmentId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_segments')
      .delete()
      .eq('id', req.params.segmentId)
      .eq('entity_id', req.params.entityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting segment:', error);
    res.status(500).json({ error: 'Failed to delete segment' });
  }
});

module.exports = router;
