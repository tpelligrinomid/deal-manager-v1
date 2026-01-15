const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDealAccess } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const checklistTemplate = require('../../../config/checklist-template.json');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/checklist/:dealId
 * Get all checklist items for a deal
 */
router.get('/:dealId', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;
    const { category, status } = req.query;

    let query = supabaseAdmin
      .from('checklist_items')
      .select(`
        *,
        documents (id, file_name, uploaded_at)
      `)
      .eq('deal_id', dealId)
      .order('category')
      .order('sort_order');

    if (category) {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: items, error } = await query;

    if (error) throw error;

    // Group by category for easier display
    const grouped = items.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }

      // Sellers don't see internal notes
      if (req.user.role === 'seller') {
        delete item.internal_notes;
      }

      acc[item.category].push(item);
      return acc;
    }, {});

    // Calculate summary stats
    const stats = {
      total: items.length,
      not_requested: items.filter(i => i.status === 'not_requested').length,
      requested: items.filter(i => i.status === 'requested').length,
      received: items.filter(i => i.status === 'received').length,
      reviewed: items.filter(i => i.status === 'reviewed').length,
      flagged: items.filter(i => i.status === 'flagged').length
    };

    res.json({ items: grouped, stats });
  } catch (error) {
    console.error('Error fetching checklist:', error);
    res.status(500).json({ error: 'Failed to fetch checklist' });
  }
});

/**
 * PATCH /api/checklist/:dealId/:itemId
 * Update a checklist item
 */
router.patch('/:dealId/:itemId', requireDealAccess, async (req, res) => {
  try {
    const { dealId, itemId } = req.params;
    const { status, internal_notes, seller_notes } = req.body;

    const updateData = {};

    // Status updates
    if (status) {
      updateData.status = status;

      // Set timestamps based on status change
      if (status === 'requested') {
        updateData.requested_at = new Date().toISOString();
      } else if (status === 'received') {
        updateData.received_at = new Date().toISOString();
      } else if (status === 'reviewed') {
        updateData.reviewed_at = new Date().toISOString();
        updateData.reviewed_by = req.user.id;
      }
    }

    // Only team members can update internal notes
    if (internal_notes !== undefined && ['admin', 'team_member'].includes(req.user.role)) {
      updateData.internal_notes = internal_notes;
    }

    // Seller notes can be updated by anyone with access
    if (seller_notes !== undefined) {
      updateData.seller_notes = seller_notes;
    }

    const { data: item, error } = await supabaseAdmin
      .from('checklist_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('deal_id', dealId)
      .select()
      .single();

    if (error) throw error;

    res.json(item);
  } catch (error) {
    console.error('Error updating checklist item:', error);
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

/**
 * POST /api/checklist/:dealId
 * Add a custom checklist item (team only)
 */
router.post('/:dealId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { category, item_name, description, required = true } = req.body;

    if (!category || !item_name) {
      return res.status(400).json({ error: 'Category and item name are required' });
    }

    // Get max sort_order for category
    const { data: existing } = await supabaseAdmin
      .from('checklist_items')
      .select('sort_order')
      .eq('deal_id', dealId)
      .eq('category', category)
      .order('sort_order', { ascending: false })
      .limit(1);

    const sortOrder = (existing?.[0]?.sort_order || 0) + 1;

    const { data: item, error } = await supabaseAdmin
      .from('checklist_items')
      .insert({
        deal_id: dealId,
        category,
        item_name,
        description,
        required,
        sort_order: sortOrder
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(item);
  } catch (error) {
    console.error('Error adding checklist item:', error);
    res.status(500).json({ error: 'Failed to add checklist item' });
  }
});

/**
 * DELETE /api/checklist/:dealId/:itemId
 * Remove a checklist item (team only)
 */
router.delete('/:dealId/:itemId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId, itemId } = req.params;

    const { error } = await supabaseAdmin
      .from('checklist_items')
      .delete()
      .eq('id', itemId)
      .eq('deal_id', dealId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    res.status(500).json({ error: 'Failed to delete checklist item' });
  }
});

/**
 * POST /api/checklist/:dealId/request-all
 * Mark all not_requested items as requested (team only)
 */
router.post('/:dealId/request-all', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data: items, error } = await supabaseAdmin
      .from('checklist_items')
      .update({
        status: 'requested',
        requested_at: new Date().toISOString()
      })
      .eq('deal_id', dealId)
      .eq('status', 'not_requested')
      .select();

    if (error) throw error;

    res.json({ updated: items.length });
  } catch (error) {
    console.error('Error requesting all items:', error);
    res.status(500).json({ error: 'Failed to request all items' });
  }
});

/**
 * POST /api/checklist/:dealId/reset-from-template
 * Reset checklist to template (team only - careful!)
 */
router.post('/:dealId/reset-from-template', requireRole('admin'), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { preserve_custom = true } = req.body;

    // If not preserving custom, delete all existing items
    if (!preserve_custom) {
      await supabaseAdmin
        .from('checklist_items')
        .delete()
        .eq('deal_id', dealId);
    }

    // Get existing item names to avoid duplicates
    const { data: existing } = await supabaseAdmin
      .from('checklist_items')
      .select('item_name, category')
      .eq('deal_id', dealId);

    const existingKeys = new Set(
      existing?.map(i => `${i.category}:${i.item_name}`) || []
    );

    // Insert template items that don't exist
    const newItems = [];
    for (const category of checklistTemplate.categories) {
      for (let i = 0; i < category.items.length; i++) {
        const key = `${category.name}:${category.items[i].name}`;
        if (!existingKeys.has(key)) {
          newItems.push({
            deal_id: dealId,
            category: category.name,
            item_name: category.items[i].name,
            description: category.items[i].description,
            required: category.items[i].required,
            sort_order: i
          });
        }
      }
    }

    if (newItems.length > 0) {
      await supabaseAdmin
        .from('checklist_items')
        .insert(newItems);
    }

    res.json({ added: newItems.length });
  } catch (error) {
    console.error('Error resetting checklist:', error);
    res.status(500).json({ error: 'Failed to reset checklist' });
  }
});

module.exports = router;
