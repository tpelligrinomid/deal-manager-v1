const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requireDealAccess } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');
const checklistTemplate = require('../../../config/checklist-template.json');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/deals
 * List all deals the user has access to
 */
router.get('/', async (req, res) => {
  try {
    const { status, search, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('deals')
      .select(`
        *,
        survey_progress (completion_percentage, completed_at),
        checklist_items (id, status)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by status if provided
    if (status) {
      query = query.eq('status', status);
    }

    // Search by agency name
    if (search) {
      query = query.ilike('agency_name', `%${search}%`);
    }

    // Non-admin users only see deals they have access to
    if (!['admin', 'team_member'].includes(req.user.role)) {
      const { data: accessList } = await supabaseAdmin
        .from('deal_access')
        .select('deal_id')
        .eq('user_id', req.user.id);

      const dealIds = accessList?.map(a => a.deal_id) || [];
      query = query.in('id', dealIds);
    }

    const { data: deals, error, count } = await query;

    if (error) throw error;

    // Transform deals to include computed fields
    const transformedDeals = deals.map(deal => ({
      ...deal,
      survey_completion: deal.survey_progress?.completion_percentage || 0,
      checklist_stats: {
        total: deal.checklist_items?.length || 0,
        received: deal.checklist_items?.filter(i => ['received', 'reviewed'].includes(i.status)).length || 0,
        flagged: deal.checklist_items?.filter(i => i.status === 'flagged').length || 0
      },
      survey_progress: undefined,
      checklist_items: undefined
    }));

    res.json({ deals: transformedDeals, count });
  } catch (error) {
    console.error('Error listing deals:', error);
    res.status(500).json({ error: 'Failed to list deals' });
  }
});

/**
 * GET /api/deals/:dealId
 * Get a specific deal
 */
router.get('/:dealId', requireDealAccess, async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data: deal, error } = await supabaseAdmin
      .from('deals')
      .select(`
        *,
        survey_progress (*),
        deal_access (user_id, access_level, granted_at)
      `)
      .eq('id', dealId)
      .single();

    if (error) throw error;
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    res.json(deal);
  } catch (error) {
    console.error('Error fetching deal:', error);
    res.status(500).json({ error: 'Failed to fetch deal' });
  }
});

/**
 * POST /api/deals
 * Create a new deal (team members only)
 */
router.post('/', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const {
      agency_name,
      dba_name,
      website,
      city,
      state,
      primary_contact_name,
      primary_contact_email,
      primary_contact_phone,
      source,
      broker_name,
      broker_email,
      nda_signed_date,
      pipedrive_deal_id,
      reported_revenue,
      reported_ebitda,
      asking_price
    } = req.body;

    if (!agency_name) {
      return res.status(400).json({ error: 'Agency name is required' });
    }

    // Create the deal
    const { data: deal, error: dealError } = await supabaseAdmin
      .from('deals')
      .insert({
        agency_name,
        dba_name,
        website,
        city,
        state,
        primary_contact_name,
        primary_contact_email,
        primary_contact_phone,
        source,
        broker_name,
        broker_email,
        nda_signed_date,
        pipedrive_deal_id,
        reported_revenue,
        reported_ebitda,
        asking_price,
        created_by: req.user.id
      })
      .select()
      .single();

    if (dealError) throw dealError;

    // Initialize survey progress
    const surveyConfig = require('../../../config/survey.json');
    const totalQuestions = surveyConfig.sections.reduce(
      (sum, section) => sum + section.questions.filter(q => !q.condition).length,
      0
    );

    await supabaseAdmin
      .from('survey_progress')
      .insert({
        deal_id: deal.id,
        total_questions: totalQuestions
      });

    // Initialize checklist from template
    const checklistItems = [];
    for (const category of checklistTemplate.categories) {
      for (let i = 0; i < category.items.length; i++) {
        checklistItems.push({
          deal_id: deal.id,
          category: category.name,
          item_name: category.items[i].name,
          description: category.items[i].description,
          required: category.items[i].required,
          sort_order: i
        });
      }
    }

    await supabaseAdmin
      .from('checklist_items')
      .insert(checklistItems);

    res.status(201).json(deal);
  } catch (error) {
    console.error('Error creating deal:', error);
    res.status(500).json({ error: 'Failed to create deal' });
  }
});

/**
 * PATCH /api/deals/:dealId
 * Update a deal (team members only)
 */
router.patch('/:dealId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    // Filter out fields that shouldn't be updated directly
    const {
      id, created_at, created_by, survey_progress, deal_access, checklist_items,
      ...updateData
    } = req.body;

    const { data: deal, error } = await supabaseAdmin
      .from('deals')
      .update(updateData)
      .eq('id', dealId)
      .select()
      .single();

    if (error) throw error;
    if (!deal) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    res.json(deal);
  } catch (error) {
    console.error('Error updating deal:', error);
    res.status(500).json({ error: 'Failed to update deal' });
  }
});

/**
 * DELETE /api/deals/:dealId
 * Delete a deal (admin only)
 */
router.delete('/:dealId', requireRole('admin'), async (req, res) => {
  try {
    const { dealId } = req.params;

    const { error } = await supabaseAdmin
      .from('deals')
      .delete()
      .eq('id', dealId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting deal:', error);
    res.status(500).json({ error: 'Failed to delete deal' });
  }
});

/**
 * POST /api/deals/:dealId/invite-seller
 * Invite a seller to access the deal portal
 */
router.post('/:dealId/invite-seller', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { email, full_name } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if user already exists
    let { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .single();

    let userId;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create a new user via Supabase Auth (they'll need to set password)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { full_name, role: 'seller' }
      });

      if (authError) throw authError;
      userId = authData.user.id;

      // Update their profile to seller role
      await supabaseAdmin
        .from('profiles')
        .update({ role: 'seller', full_name })
        .eq('id', userId);
    }

    // Grant access to the deal
    const { error: accessError } = await supabaseAdmin
      .from('deal_access')
      .upsert({
        deal_id: dealId,
        user_id: userId,
        access_level: 'seller',
        granted_by: req.user.id
      });

    if (accessError) throw accessError;

    res.json({ success: true, message: `Invitation sent to ${email}` });
  } catch (error) {
    console.error('Error inviting seller:', error);
    res.status(500).json({ error: 'Failed to invite seller' });
  }
});

/**
 * POST /api/deals/:dealId/notes
 * Add a note to a deal
 */
router.post('/:dealId/notes', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { content, note_type = 'general' } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Note content is required' });
    }

    const { data: note, error } = await supabaseAdmin
      .from('deal_notes')
      .insert({
        deal_id: dealId,
        content,
        note_type,
        created_by: req.user.id
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(note);
  } catch (error) {
    console.error('Error adding note:', error);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

/**
 * GET /api/deals/:dealId/notes
 * Get all notes for a deal
 */
router.get('/:dealId/notes', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    const { data: notes, error } = await supabaseAdmin
      .from('deal_notes')
      .select(`
        *,
        profiles:created_by (full_name, email)
      `)
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(notes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

module.exports = router;
