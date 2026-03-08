const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities/:entityId/line-items
 * List line items for an entity, optionally filtered by category/statement/scenario
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { category, statement, scenario_id, operating_scenario_id } = req.query;

    let query = req.supabase
      .from('model_line_items')
      .select('*')
      .eq('entity_id', req.params.entityId)
      .order('sort_order');

    if (category) query = query.eq('category', category);
    if (statement) query = query.eq('statement', statement);
    if (scenario_id) query = query.eq('scenario_id', scenario_id);
    if (operating_scenario_id) query = query.eq('operating_scenario_id', operating_scenario_id);

    const { data: items, error } = await query;

    if (error) throw error;
    res.json(items || []);
  } catch (error) {
    console.error('Error listing line items:', error);
    res.status(500).json({ error: 'Failed to list line items' });
  }
});

/**
 * POST /api/models/:modelId/entities/:entityId/line-items
 * Create a line item
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const {
      scenario_id, operating_scenario_id, segment_id,
      category, revenue_type, statement, group_name, item_name,
      growth_type, item_type, growth_rate, base_amount, sort_order, notes
    } = req.body;

    if (!category || !statement || !group_name || !item_name || !item_type) {
      return res.status(400).json({ error: 'category, statement, group_name, item_name, and item_type are required' });
    }

    const { data: item, error } = await req.supabase
      .from('model_line_items')
      .insert({
        entity_id: req.params.entityId,
        scenario_id: scenario_id || null,
        operating_scenario_id: operating_scenario_id || null,
        segment_id: segment_id || null,
        category,
        revenue_type: revenue_type || null,
        statement,
        group_name,
        item_name,
        growth_type: growth_type || null,
        item_type,
        growth_rate: growth_rate || null,
        base_amount: base_amount || null,
        sort_order: sort_order || 0,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(item);
  } catch (error) {
    console.error('Error creating line item:', error);
    res.status(500).json({ error: 'Failed to create line item' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId/line-items/:itemId
 * Update a line item
 */
router.patch('/:itemId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, entity_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: item, error } = await req.supabase
      .from('model_line_items')
      .update(updateData)
      .eq('id', req.params.itemId)
      .eq('entity_id', req.params.entityId)
      .select()
      .single();

    if (error) throw error;
    if (!item) return res.status(404).json({ error: 'Line item not found' });

    res.json(item);
  } catch (error) {
    console.error('Error updating line item:', error);
    res.status(500).json({ error: 'Failed to update line item' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId/line-items/:itemId
 * Delete a line item
 */
router.delete('/:itemId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_line_items')
      .delete()
      .eq('id', req.params.itemId)
      .eq('entity_id', req.params.entityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting line item:', error);
    res.status(500).json({ error: 'Failed to delete line item' });
  }
});

module.exports = router;
