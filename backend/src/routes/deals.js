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

    // Use user's authenticated client (respects RLS)
    let query = req.supabase
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
      const { data: accessList } = await req.supabase
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

    const { data: deal, error } = await req.supabase
      .from('deals')
      .select(`
        *,
        survey_progress (*),
        deal_access (user_id, access_level, granted_at),
        nda:nda_id (id, signer_company_name, signer_full_name, signer_email, signed_at, pdf_path)
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
 * Optionally attach an NDA by providing nda_id
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
      asking_price,
      nda_id // Optional: attach an NDA to this deal
    } = req.body;

    if (!agency_name) {
      return res.status(400).json({ error: 'Agency name is required' });
    }

    // If nda_id provided, verify it exists and is not already attached
    if (nda_id) {
      const { data: nda, error: ndaError } = await req.supabase
        .from('ndas')
        .select('id, deal_id, signer_company_name')
        .eq('id', nda_id)
        .single();

      if (ndaError || !nda) {
        return res.status(400).json({ error: 'NDA not found' });
      }

      if (nda.deal_id) {
        return res.status(400).json({ error: 'NDA is already attached to another deal' });
      }
    }

    // Create the deal using user's authenticated client
    const { data: deal, error: dealError } = await req.supabase
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
        nda_id: nda_id || null,
        created_by: req.user.id
      })
      .select()
      .single();

    if (dealError) throw dealError;

    // If NDA attached, update the NDA status
    if (nda_id) {
      await req.supabase
        .from('ndas')
        .update({
          deal_id: deal.id,
          status: 'attached',
          attached_at: new Date().toISOString(),
          attached_by: req.user.id
        })
        .eq('id', nda_id);
    }

    // Initialize survey progress
    const surveyConfig = require('../../../config/survey.json');
    const totalQuestions = surveyConfig.sections.reduce(
      (sum, section) => sum + section.questions.filter(q => !q.condition).length,
      0
    );

    await req.supabase
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

    await req.supabase
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

    const { data: deal, error } = await req.supabase
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

    const { error } = await req.supabase
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
 * POST /api/deals/:dealId/invite
 * Invite a user to access the deal portal
 * Supports different access levels:
 *   - 'seller': Can fill out survey, upload documents
 *   - 'advisor': View-only access to deal, surveys, documents (cannot fill out survey)
 * Uses authorized_emails table - user signs up and gets access automatically
 */
router.post('/:dealId/invite', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;
    const { email, full_name, access_level = 'seller' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate access level
    const validAccessLevels = ['seller', 'advisor'];
    if (!validAccessLevels.includes(access_level)) {
      return res.status(400).json({ error: 'Invalid access level. Must be "seller" or "advisor"' });
    }

    const normalizedEmail = email.toLowerCase();

    // Get the deal info for the email
    const { data: deal } = await req.supabase
      .from('deals')
      .select('agency_name')
      .eq('id', dealId)
      .single();

    // Check if user already has a profile
    const { data: existingUser } = await req.supabase
      .from('profiles')
      .select('id, role')
      .eq('email', normalizedEmail)
      .single();

    let isNewInvite = false;

    if (existingUser) {
      // User exists - grant deal access directly
      const { error: accessError } = await req.supabase
        .from('deal_access')
        .upsert({
          deal_id: dealId,
          user_id: existingUser.id,
          access_level: access_level,
          granted_by: req.user.id
        });

      if (accessError) throw accessError;

      isNewInvite = true; // Still send email to notify them
    } else {
      // User doesn't exist - add to authorized_emails so they get role on signup
      // First check if already invited
      const { data: existingInvite } = await req.supabase
        .from('authorized_emails')
        .select('id, claimed_at')
        .eq('email', normalizedEmail)
        .single();

      if (existingInvite && !existingInvite.claimed_at) {
        // Allow resending the email for existing pending invites
        if (req.body.resend) {
          isNewInvite = true; // Will trigger email below
        } else {
          return res.status(409).json({
            error: 'User already has a pending invitation',
            canResend: true
          });
        }
      }

      if (!existingInvite) {
        // Add to authorized_emails with deal_id for auto-access on signup
        // Note: advisors get 'advisor' role, sellers get 'seller' role
        const { error: inviteError } = await req.supabase
          .from('authorized_emails')
          .insert({
            email: normalizedEmail,
            full_name: full_name || null,
            role: access_level, // 'seller' or 'advisor'
            invited_by: req.user.id,
            deal_id: dealId,
            access_level: access_level // Store access level for deal_access creation on signup
          });

        if (inviteError) throw inviteError;
        isNewInvite = true;
      }
    }

    // Send invite email via n8n webhook (non-blocking)
    if (isNewInvite && process.env.N8N_WEBHOOK_URL) {
      fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: access_level === 'advisor' ? 'advisor_invite' : 'seller_invite',
          to: normalizedEmail,
          name: full_name || normalizedEmail.split('@')[0],
          dealName: deal?.agency_name || 'your deal',
          invitedBy: req.user.full_name || req.user.email,
          signupUrl: process.env.FRONTEND_URL || 'https://aragon-deal-space.lovable.app',
          isExistingUser: !!existingUser,
          accessLevel: access_level
        })
      }).catch(err => console.error('Failed to send invite email webhook:', err));
    }

    const roleLabel = access_level === 'advisor' ? 'an advisor' : 'a seller';
    res.json({
      success: true,
      message: existingUser
        ? `${email} has been granted ${access_level} access to this deal.`
        : `${email} has been authorized as ${roleLabel}. They will receive access when they sign up.`,
      existingUser: !!existingUser,
      access_level
    });
  } catch (error) {
    console.error('Error inviting user:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

// Legacy endpoint - redirects to /invite with access_level: 'seller'
// Frontend should migrate to using POST /api/deals/:dealId/invite
router.post('/:dealId/invite-seller', requireRole(['admin', 'team_member']), async (req, res) => {
  req.body.access_level = 'seller';
  // Import the invite logic inline to avoid duplication
  const { dealId } = req.params;
  const { email, full_name, access_level = 'seller' } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const normalizedEmail = email.toLowerCase();

  try {
    const { data: deal } = await req.supabase
      .from('deals')
      .select('agency_name')
      .eq('id', dealId)
      .single();

    const { data: existingUser } = await req.supabase
      .from('profiles')
      .select('id, role')
      .eq('email', normalizedEmail)
      .single();

    let isNewInvite = false;

    if (existingUser) {
      const { error: accessError } = await req.supabase
        .from('deal_access')
        .upsert({
          deal_id: dealId,
          user_id: existingUser.id,
          access_level: 'seller',
          granted_by: req.user.id
        });
      if (accessError) throw accessError;
      isNewInvite = true;
    } else {
      const { data: existingInvite } = await req.supabase
        .from('authorized_emails')
        .select('id, claimed_at')
        .eq('email', normalizedEmail)
        .single();

      if (existingInvite && !existingInvite.claimed_at) {
        if (req.body.resend) {
          isNewInvite = true;
        } else {
          return res.status(409).json({ error: 'User already has a pending invitation', canResend: true });
        }
      }

      if (!existingInvite) {
        const { error: inviteError } = await req.supabase
          .from('authorized_emails')
          .insert({
            email: normalizedEmail,
            full_name: full_name || null,
            role: 'seller',
            invited_by: req.user.id,
            deal_id: dealId
          });
        if (inviteError) throw inviteError;
        isNewInvite = true;
      }
    }

    if (isNewInvite && process.env.N8N_WEBHOOK_URL) {
      fetch(process.env.N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'seller_invite',
          to: normalizedEmail,
          name: full_name || normalizedEmail.split('@')[0],
          dealName: deal?.agency_name || 'your deal',
          invitedBy: req.user.full_name || req.user.email,
          signupUrl: process.env.FRONTEND_URL || 'https://aragon-deal-space.lovable.app',
          isExistingUser: !!existingUser
        })
      }).catch(err => console.error('Failed to send invite email webhook:', err));
    }

    res.json({
      success: true,
      message: existingUser
        ? `${email} has been granted access to this deal.`
        : `${email} has been authorized as a seller. They will receive access when they sign up.`,
      existingUser: !!existingUser
    });
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

    const { data: note, error } = await req.supabase
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

    const { data: notes, error } = await req.supabase
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

/**
 * GET /api/deals/:dealId/sellers
 * Get all sellers (and pending invites) for a deal
 */
router.get('/:dealId/sellers', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId } = req.params;

    // Get active sellers with deal access - use explicit join query
    const { data: dealAccessRecords, error: sellersError } = await req.supabase
      .from('deal_access')
      .select('id, user_id, access_level, is_primary_contact, granted_at, granted_by')
      .eq('deal_id', dealId)
      .eq('access_level', 'seller');

    if (sellersError) throw sellersError;

    // Fetch profile data for each seller
    const sellers = [];
    if (dealAccessRecords && dealAccessRecords.length > 0) {
      const userIds = dealAccessRecords.map(da => da.user_id);

      const { data: profiles, error: profilesError } = await req.supabase
        .from('profiles')
        .select('id, email, full_name, phone')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      // Map profiles to deal access records
      const profileMap = {};
      for (const profile of (profiles || [])) {
        profileMap[profile.id] = profile;
      }

      for (const da of dealAccessRecords) {
        const profile = profileMap[da.user_id];
        if (profile) {
          sellers.push({
            id: da.id,
            user_id: da.user_id,
            email: profile.email,
            full_name: profile.full_name,
            phone: profile.phone,
            is_primary_contact: da.is_primary_contact || false,
            access_level: da.access_level,
            granted_at: da.granted_at
          });
        }
      }
    }

    // Get pending seller invites for this deal
    const { data: pendingRecords, error: invitesError } = await req.supabase
      .from('authorized_emails')
      .select('id, email, full_name, invited_at, invited_by')
      .eq('deal_id', dealId)
      .eq('role', 'seller')
      .is('claimed_at', null);

    if (invitesError) throw invitesError;

    // Fetch inviter names for pending invites
    const pendingInvites = [];
    if (pendingRecords && pendingRecords.length > 0) {
      const inviterIds = pendingRecords.map(p => p.invited_by).filter(Boolean);

      let inviterMap = {};
      if (inviterIds.length > 0) {
        const { data: inviters } = await req.supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', inviterIds);

        for (const inviter of (inviters || [])) {
          inviterMap[inviter.id] = inviter.full_name;
        }
      }

      for (const invite of pendingRecords) {
        pendingInvites.push({
          id: invite.id,
          email: invite.email,
          full_name: invite.full_name,
          invited_at: invite.invited_at,
          invited_by_name: inviterMap[invite.invited_by] || null
        });
      }
    }

    res.json({
      sellers,
      pending_invites: pendingInvites
    });
  } catch (error) {
    console.error('Error fetching sellers:', error);
    res.status(500).json({ error: 'Failed to fetch sellers' });
  }
});

/**
 * DELETE /api/deals/:dealId/sellers/:odId
 * Revoke a seller's access to a deal
 */
router.delete('/:dealId/sellers/:userId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { dealId, userId } = req.params;

    const { error } = await req.supabase
      .from('deal_access')
      .delete()
      .eq('deal_id', dealId)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error removing seller:', error);
    res.status(500).json({ error: 'Failed to remove seller' });
  }
});

module.exports = router;
