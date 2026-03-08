const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/entities/:entityId/drivers
 * List drivers for an entity, optionally filtered by operating_scenario_id or driver_type
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { operating_scenario_id, driver_type } = req.query;

    let query = req.supabase
      .from('model_drivers')
      .select('*')
      .eq('entity_id', req.params.entityId)
      .order('driver_type')
      .order('period_start');

    if (operating_scenario_id) query = query.eq('operating_scenario_id', operating_scenario_id);
    if (driver_type) query = query.eq('driver_type', driver_type);

    const { data: drivers, error } = await query;

    if (error) throw error;
    res.json(drivers || []);
  } catch (error) {
    console.error('Error listing drivers:', error);
    res.status(500).json({ error: 'Failed to list drivers' });
  }
});

/**
 * POST /api/models/:modelId/entities/:entityId/drivers
 * Create a driver
 */
router.post('/', requireModelAccess('editor'), async (req, res) => {
  try {
    const { operating_scenario_id, driver_type, value, period_start, period_end, notes } = req.body;

    if (!driver_type || value === undefined) {
      return res.status(400).json({ error: 'driver_type and value are required' });
    }

    const { data: driver, error } = await req.supabase
      .from('model_drivers')
      .insert({
        entity_id: req.params.entityId,
        operating_scenario_id: operating_scenario_id || null,
        driver_type,
        value,
        period_start: period_start || 0,
        period_end: period_end || null,
        notes: notes || null
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(driver);
  } catch (error) {
    console.error('Error creating driver:', error);
    res.status(500).json({ error: 'Failed to create driver' });
  }
});

/**
 * PATCH /api/models/:modelId/entities/:entityId/drivers/:driverId
 * Update a driver
 */
router.patch('/:driverId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, entity_id, ...updateData } = req.body;
    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    const { data: driver, error } = await req.supabase
      .from('model_drivers')
      .update(updateData)
      .eq('id', req.params.driverId)
      .eq('entity_id', req.params.entityId)
      .select()
      .single();

    if (error) throw error;
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    res.json(driver);
  } catch (error) {
    console.error('Error updating driver:', error);
    res.status(500).json({ error: 'Failed to update driver' });
  }
});

/**
 * DELETE /api/models/:modelId/entities/:entityId/drivers/:driverId
 * Delete a driver
 */
router.delete('/:driverId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('model_drivers')
      .delete()
      .eq('id', req.params.driverId)
      .eq('entity_id', req.params.entityId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({ error: 'Failed to delete driver' });
  }
});

module.exports = router;
