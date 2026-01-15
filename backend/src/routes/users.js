const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { supabaseAdmin } = require('../lib/supabase');

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/users/me
 * Get current user's profile
 */
router.get('/me', async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * PATCH /api/users/me
 * Update current user's profile
 */
router.patch('/me', async (req, res) => {
  try {
    const { full_name, phone, company_name } = req.body;

    const updateData = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (company_name !== undefined) updateData.company_name = company_name;

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;

    res.json(profile);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * GET /api/users
 * List all users (team only)
 */
router.get('/', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { role, search, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (role) {
      query = query.eq('role', role);
    }

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, error, count } = await query;

    if (error) throw error;

    res.json({ users, count });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * GET /api/users/:userId
 * Get a specific user (team only)
 */
router.get('/:userId', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        *,
        deal_access (
          deal_id,
          access_level,
          granted_at,
          deals:deal_id (agency_name, status)
        )
      `)
      .eq('id', userId)
      .single();

    if (error) throw error;
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * PATCH /api/users/:userId
 * Update a user's profile (admin only)
 */
router.patch('/:userId', requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, full_name, phone, company_name } = req.body;

    const updateData = {};
    if (role !== undefined) updateData.role = role;
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (company_name !== undefined) updateData.company_name = company_name;

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json(profile);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * POST /api/users/invite
 * Pre-authorize a user by creating their profile before they sign up (admin only)
 * This adds them to the "allowlist" so when they sign up, they get access
 */
router.post('/invite', requireRole('admin'), async (req, res) => {
  try {
    const { email, full_name, role = 'team_member', company_name } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate role
    const validRoles = ['admin', 'team_member', 'seller', 'advisor'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Check if profile already exists
    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // Create profile without an auth ID (will be linked when they sign up)
    // Generate a temporary UUID that will be replaced when they actually sign up
    const tempId = require('crypto').randomUUID();

    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: tempId,
        email: email.toLowerCase(),
        full_name: full_name || email.split('@')[0],
        role,
        company_name
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: `User ${email} has been pre-authorized as ${role}. They can now sign up.`,
      profile
    });
  } catch (error) {
    console.error('Error inviting user:', error);
    res.status(500).json({ error: 'Failed to invite user' });
  }
});

/**
 * DELETE /api/users/:userId
 * Remove a user (admin only)
 */
router.delete('/:userId', requireRole('admin'), async (req, res) => {
  try {
    const { userId } = req.params;

    // Don't allow deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * GET /api/users/team/members
 * Get team members only (for assignment dropdowns, etc.)
 */
router.get('/team/members', requireRole(['admin', 'team_member']), async (req, res) => {
  try {
    const { data: team, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role')
      .in('role', ['admin', 'team_member'])
      .order('full_name');

    if (error) throw error;

    res.json(team);
  } catch (error) {
    console.error('Error fetching team:', error);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

module.exports = router;
