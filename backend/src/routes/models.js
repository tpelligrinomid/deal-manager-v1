const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { requireModelAccess } = require('../middleware/modelAuth');
const { supabaseAdmin } = require('../lib/supabase');

// Sub-routers
const baselineRouter = require('./models/baseline');
const entitiesRouter = require('./models/entities');
const scenariosRouter = require('./models/scenarios');
const operatingScenariosRouter = require('./models/operating-scenarios');
const accessRouter = require('./models/access');
const dealReferencesRouter = require('./models/deal-references');
const lineItemsRouter = require('./models/line-items');
const segmentsRouter = require('./models/segments');
const driversRouter = require('./models/drivers');
const spvEquityRouter = require('./models/spv-equity');
const compensationRouter = require('./models/compensation');
const covenantsRouter = require('./models/covenants');
const liquidityEventsRouter = require('./models/liquidity-events');
const snapshotsRouter = require('./models/snapshots');
const versionsRouter = require('./models/versions');
const calculateRouter = require('./models/calculate');

// All routes require authentication
router.use(authenticate);

// Mount /baseline BEFORE /:modelId to avoid "baseline" matching as a modelId
router.use('/baseline', baselineRouter);

// --- Model CRUD ---

/**
 * GET /api/models
 * List all models the user has access to
 */
router.get('/', async (req, res) => {
  try {
    const { search, limit = 50, offset = 0 } = req.query;

    // Admin/team_member see all models
    if (['admin', 'team_member'].includes(req.user.role)) {
      let query = req.supabase
        .from('financial_models')
        .select('*')
        .order('updated_at', { ascending: false })
        .range(offset, Number(offset) + Number(limit) - 1);

      if (search) query = query.ilike('name', `%${search}%`);

      const { data: models, error } = await query;
      if (error) throw error;
      return res.json(models || []);
    }

    // Other users: filter by model_access
    const { data: accessList } = await req.supabase
      .from('model_access')
      .select('model_id')
      .eq('profile_id', req.user.id);

    const modelIds = accessList?.map(a => a.model_id) || [];
    if (modelIds.length === 0) return res.json([]);

    let query = req.supabase
      .from('financial_models')
      .select('*')
      .in('id', modelIds)
      .order('updated_at', { ascending: false })
      .range(offset, Number(offset) + Number(limit) - 1);

    if (search) query = query.ilike('name', `%${search}%`);

    const { data: models, error } = await query;
    if (error) throw error;
    res.json(models || []);
  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

/**
 * GET /api/models/:modelId
 * Get a single model with summary data
 */
router.get('/:modelId', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: model, error } = await req.supabase
      .from('financial_models')
      .select(`
        *,
        model_entities (id, entity_type, entity_name, sort_order),
        model_scenarios (id, name, is_base_case),
        model_operating_scenarios (id, name, case_type, is_default),
        model_access (id, profile_id, role)
      `)
      .eq('id', req.params.modelId)
      .single();

    if (error) throw error;
    if (!model) return res.status(404).json({ error: 'Model not found' });

    res.json(model);
  } catch (error) {
    console.error('Error fetching model:', error);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

/**
 * POST /api/models
 * Create a new model with auto-generated children:
 *   - 1 model_access row (owner)
 *   - 4 singleton entities
 *   - 3 operating scenarios
 *   - 1 default deal structure scenario
 *   - 5 standard covenants
 */
router.post('/', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const {
      name, description, start_date,
      period_count, profit_metric, presentation_granularity
    } = req.body;

    if (!name || !start_date) {
      return res.status(400).json({ error: 'name and start_date are required' });
    }

    // Create the model
    const { data: model, error: modelError } = await req.supabase
      .from('financial_models')
      .insert({
        name,
        description: description || null,
        start_date,
        period_count: period_count || 120,
        profit_metric: profit_metric || 'ebitda',
        presentation_granularity: presentation_granularity || 'monthly',
        created_by: req.user.id,
        updated_by: req.user.id
      })
      .select()
      .single();

    if (modelError) throw modelError;

    try {
      // 1. Bootstrap model_access with supabaseAdmin (avoids RLS chicken-and-egg)
      const { error: accessError } = await supabaseAdmin
        .from('model_access')
        .insert({
          model_id: model.id,
          profile_id: req.user.id,
          role: 'owner'
        });

      if (accessError) throw accessError;

      // 2. Get active baseline for mid_holdco link
      const { data: activeBaseline } = await req.supabase
        .from('mid_baseline')
        .select('id')
        .eq('is_active', true)
        .single();

      // 3. Create 4 singleton entities
      const entityRows = [
        { model_id: model.id, entity_type: 'aragon', entity_name: 'Aragon Holdings', sort_order: 0 },
        {
          model_id: model.id, entity_type: 'mid_holdco', entity_name: 'MiD Holdings',
          baseline_id: activeBaseline?.id || null, sort_order: 1
        },
        { model_id: model.id, entity_type: 'intermediate_holdco', entity_name: 'Intermediate HoldCo', sort_order: 2 },
        { model_id: model.id, entity_type: 'consolidated', entity_name: 'Consolidated', sort_order: 3 }
      ];

      const { data: entities, error: entError } = await req.supabase
        .from('model_entities')
        .insert(entityRows)
        .select();

      if (entError) throw entError;

      // 4. Create 3 operating scenarios
      const osRows = [
        { model_id: model.id, name: 'Downside', case_type: 'downside' },
        { model_id: model.id, name: 'Base', case_type: 'base', is_default: true },
        { model_id: model.id, name: 'Upside', case_type: 'upside' }
      ];

      const { data: operatingScenarios, error: osError } = await req.supabase
        .from('model_operating_scenarios')
        .insert(osRows)
        .select();

      if (osError) throw osError;

      // 5. Create 1 default deal structure scenario
      const { data: scenario, error: scenError } = await req.supabase
        .from('model_scenarios')
        .insert({
          model_id: model.id,
          name: 'Base Case',
          is_base_case: true
        })
        .select()
        .single();

      if (scenError) throw scenError;

      // 6. Create 5 standard covenants linked to the base case scenario
      const covenantRows = [
        { model_id: model.id, scenario_id: scenario.id, covenant_name: 'Min DSCR', covenant_type: 'dscr_min', threshold_value: 1.25 },
        { model_id: model.id, scenario_id: scenario.id, covenant_name: 'Downside DSCR', covenant_type: 'dscr_min', threshold_value: 1.0, notes: 'Downside scenario covenant' },
        { model_id: model.id, scenario_id: scenario.id, covenant_name: 'Max Leverage', covenant_type: 'leverage_max', threshold_value: 5.0 },
        { model_id: model.id, scenario_id: scenario.id, covenant_name: 'Min Cash', covenant_type: 'cash_min', threshold_value: 250000 },
        { model_id: model.id, scenario_id: scenario.id, covenant_name: 'Fixed Charge Coverage', covenant_type: 'fixed_charge_min', threshold_value: 1.1 }
      ];

      const { data: covenants, error: covError } = await req.supabase
        .from('model_covenants')
        .insert(covenantRows)
        .select();

      if (covError) throw covError;

      // Return model with all created children
      res.status(201).json({
        ...model,
        model_entities: entities,
        model_operating_scenarios: operatingScenarios,
        model_scenarios: [scenario],
        model_covenants: covenants,
        model_access: [{ model_id: model.id, profile_id: req.user.id, role: 'owner' }]
      });
    } catch (childError) {
      // If any child insert fails, delete the model (CASCADE cleans up)
      console.error('Error creating model children, rolling back:', childError);
      await supabaseAdmin.from('financial_models').delete().eq('id', model.id);
      throw childError;
    }
  } catch (error) {
    console.error('Error creating model:', error);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

/**
 * PATCH /api/models/:modelId
 * Update model fields (name, description, start_date, period_count, etc.)
 */
router.patch('/:modelId', requireModelAccess('editor'), async (req, res) => {
  try {
    const { id, created_at, created_by, model_entities, model_scenarios,
            model_operating_scenarios, model_access, model_covenants, ...updateData } = req.body;

    updateData.updated_at = new Date().toISOString();
    updateData.updated_by = req.user.id;

    // If start_date changed, recalculate close_period_index for all deal references
    if (updateData.start_date) {
      const { data: refs } = await req.supabase
        .from('model_deal_references')
        .select('id, close_date, entity_id')
        .eq('model_id', req.params.modelId);

      if (refs && refs.length > 0) {
        const periodCount = updateData.period_count || 120;
        for (const ref of refs) {
          const start = new Date(updateData.start_date);
          const close = new Date(ref.close_date);
          const newIndex = (close.getFullYear() - start.getFullYear()) * 12
                         + (close.getMonth() - start.getMonth());

          if (newIndex >= 0 && newIndex < periodCount) {
            await req.supabase
              .from('model_deal_references')
              .update({ close_period_index: newIndex, updated_at: new Date().toISOString() })
              .eq('id', ref.id);

            await req.supabase
              .from('model_entities')
              .update({ close_period_index: newIndex, updated_at: new Date().toISOString() })
              .eq('id', ref.entity_id);
          }
        }
      }
    }

    const { data: model, error } = await req.supabase
      .from('financial_models')
      .update(updateData)
      .eq('id', req.params.modelId)
      .select()
      .single();

    if (error) throw error;
    if (!model) return res.status(404).json({ error: 'Model not found' });

    res.json(model);
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ error: 'Failed to update model' });
  }
});

/**
 * DELETE /api/models/:modelId
 * Delete a model (owner only — CASCADE cleans up all children)
 */
router.delete('/:modelId', requireModelAccess('owner'), async (req, res) => {
  try {
    const { error } = await req.supabase
      .from('financial_models')
      .delete()
      .eq('id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// --- Mount sub-routers under /:modelId ---
router.use('/:modelId/entities/:entityId/line-items', lineItemsRouter);
router.use('/:modelId/entities/:entityId/segments', segmentsRouter);
router.use('/:modelId/entities/:entityId/drivers', driversRouter);
router.use('/:modelId/entities/:entityId/spv-equity', spvEquityRouter);
router.use('/:modelId/entities/:entityId/compensation', compensationRouter);
router.use('/:modelId/entities', entitiesRouter);
router.use('/:modelId/scenarios', scenariosRouter);
router.use('/:modelId/operating-scenarios', operatingScenariosRouter);
router.use('/:modelId/deal-references', dealReferencesRouter);
router.use('/:modelId/covenants', covenantsRouter);
router.use('/:modelId/liquidity-events', liquidityEventsRouter);
router.use('/:modelId/snapshots', snapshotsRouter);
router.use('/:modelId/versions', versionsRouter);
router.use('/:modelId/access', accessRouter);
router.use('/:modelId/calculate', calculateRouter);

module.exports = router;
