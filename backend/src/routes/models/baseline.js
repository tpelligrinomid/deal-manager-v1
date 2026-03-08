const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/models/baseline
 * List all MiD baselines
 */
router.get('/', async (req, res) => {
  try {
    const { data: baselines, error } = await req.supabase
      .from('mid_baseline')
      .select('*, mid_baseline_entities(*)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(baselines || []);
  } catch (error) {
    console.error('Error listing baselines:', error);
    res.status(500).json({ error: 'Failed to list baselines' });
  }
});

/**
 * GET /api/models/baseline/:id
 * Get a single baseline with its entities
 */
router.get('/:id', async (req, res) => {
  try {
    const { data: baseline, error } = await req.supabase
      .from('mid_baseline')
      .select('*, mid_baseline_entities(*)')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!baseline) return res.status(404).json({ error: 'Baseline not found' });

    res.json(baseline);
  } catch (error) {
    console.error('Error fetching baseline:', error);
    res.status(500).json({ error: 'Failed to fetch baseline' });
  }
});

/**
 * POST /api/models/baseline
 * Create a new baseline (team only)
 */
router.post('/', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { name, effective_date, entities } = req.body;

    if (!name || !effective_date) {
      return res.status(400).json({ error: 'name and effective_date are required' });
    }

    const { data: baseline, error } = await req.supabase
      .from('mid_baseline')
      .insert({
        name,
        effective_date,
        is_active: false,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    // Create baseline entities if provided
    if (entities && entities.length > 0) {
      const entityRows = entities.map(e => ({
        baseline_id: baseline.id,
        entity_name: typeof e === 'string' ? e : e.entity_name
      }));

      const { error: entError } = await req.supabase
        .from('mid_baseline_entities')
        .insert(entityRows);

      if (entError) throw entError;
    }

    // Re-fetch with entities
    const { data: full, error: fetchError } = await req.supabase
      .from('mid_baseline')
      .select('*, mid_baseline_entities(*)')
      .eq('id', baseline.id)
      .single();

    if (fetchError) throw fetchError;

    res.status(201).json(full);
  } catch (error) {
    console.error('Error creating baseline:', error);
    res.status(500).json({ error: 'Failed to create baseline' });
  }
});

/**
 * PATCH /api/models/baseline/:id
 * Update baseline name/effective_date
 */
router.patch('/:id', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { name, effective_date } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (effective_date !== undefined) update.effective_date = effective_date;
    update.updated_at = new Date().toISOString();

    const { data: baseline, error } = await req.supabase
      .from('mid_baseline')
      .update(update)
      .eq('id', req.params.id)
      .select('*, mid_baseline_entities(*)')
      .single();

    if (error) throw error;
    if (!baseline) return res.status(404).json({ error: 'Baseline not found' });

    res.json(baseline);
  } catch (error) {
    console.error('Error updating baseline:', error);
    res.status(500).json({ error: 'Failed to update baseline' });
  }
});

/**
 * POST /api/models/baseline/:id/activate
 * Set this baseline as the active one (deactivates others)
 */
router.post('/:id/activate', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    // Deactivate all baselines
    const { error: deactivateError } = await req.supabase
      .from('mid_baseline')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // update all

    if (deactivateError) throw deactivateError;

    // Activate the selected one
    const { data: baseline, error } = await req.supabase
      .from('mid_baseline')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*, mid_baseline_entities(*)')
      .single();

    if (error) throw error;
    if (!baseline) return res.status(404).json({ error: 'Baseline not found' });

    res.json(baseline);
  } catch (error) {
    console.error('Error activating baseline:', error);
    res.status(500).json({ error: 'Failed to activate baseline' });
  }
});

/**
 * DELETE /api/models/baseline/:id
 * Delete a baseline (admin only)
 */
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('mid_baseline')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting baseline:', error);
    res.status(500).json({ error: 'Failed to delete baseline' });
  }
});

// --- Baseline Entity sub-routes ---

/**
 * POST /api/models/baseline/:id/entities
 * Add an entity to a baseline
 */
router.post('/:id/entities', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { entity_name } = req.body;
    if (!entity_name) {
      return res.status(400).json({ error: 'entity_name is required' });
    }

    const { data: entity, error } = await req.supabase
      .from('mid_baseline_entities')
      .insert({ baseline_id: req.params.id, entity_name })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(entity);
  } catch (error) {
    console.error('Error adding baseline entity:', error);
    res.status(500).json({ error: 'Failed to add baseline entity' });
  }
});

/**
 * DELETE /api/models/baseline/:id/entities/:entityId
 * Remove an entity from a baseline
 */
router.delete('/:id/entities/:entityId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('mid_baseline_entities')
      .delete()
      .eq('id', req.params.entityId)
      .eq('baseline_id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting baseline entity:', error);
    res.status(500).json({ error: 'Failed to delete baseline entity' });
  }
});

module.exports = router;
