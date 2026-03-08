const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireModelAccess } = require('../../middleware/modelAuth');

/**
 * GET /api/models/:modelId/access
 * List all access grants for a model
 */
router.get('/', requireModelAccess('viewer'), async (req, res) => {
  try {
    const { data: access, error } = await req.supabase
      .from('model_access')
      .select(`
        *,
        profiles:profile_id (id, email, full_name)
      `)
      .eq('model_id', req.params.modelId)
      .order('created_at');

    if (error) throw error;
    res.json(access || []);
  } catch (error) {
    console.error('Error listing model access:', error);
    res.status(500).json({ error: 'Failed to list model access' });
  }
});

/**
 * POST /api/models/:modelId/access
 * Grant access to a user (owner only)
 */
router.post('/', requireModelAccess('owner'), async (req, res) => {
  try {
    const { profile_id, email, role } = req.body;

    if (!role || !['owner', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role must be owner, editor, or viewer' });
    }

    let targetProfileId = profile_id;

    // Look up by email if profile_id not provided
    if (!targetProfileId && email) {
      const { data: profile, error: profileError } = await req.supabase
        .from('profiles')
        .select('id')
        .eq('email', email.toLowerCase())
        .single();

      if (profileError || !profile) {
        // User not found — invite flow (Option B: platform invite, no auto model-access)
        const normalizedEmail = email.toLowerCase();

        // Check if already invited
        const { data: existingInvite } = await req.supabase
          .from('authorized_emails')
          .select('id, claimed_at')
          .eq('email', normalizedEmail)
          .single();

        if (existingInvite && !existingInvite.claimed_at) {
          // Already has a pending invite — just send notification
        } else if (!existingInvite) {
          const { error: inviteError } = await req.supabase
            .from('authorized_emails')
            .insert({
              email: normalizedEmail,
              role: 'viewer',
              invited_by: req.user.id
            });

          if (inviteError) throw inviteError;
        }

        // Fire n8n webhook for invite
        if (process.env.N8N_WEBHOOK_URL) {
          const frontendUrl = process.env.FRONTEND_URL || 'https://deals.aragon-holdings.com';

          // Load model name for the email
          const { data: model } = await req.supabase
            .from('financial_models')
            .select('model_name')
            .eq('id', req.params.modelId)
            .single();

          fetch(process.env.N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'model_invite',
              to: normalizedEmail,
              modelName: model?.model_name || 'Financial Model',
              invitedBy: req.user.full_name || req.user.email,
              signupLink: `${frontendUrl}/signup?email=${encodeURIComponent(normalizedEmail)}`
            })
          }).catch(err => console.error('Failed to send model invite webhook:', err));
        }

        return res.status(201).json({
          success: true,
          message: 'Invitation sent',
          pending: true
        });
      }
      targetProfileId = profile.id;
    }

    if (!targetProfileId) {
      return res.status(400).json({ error: 'profile_id or email is required' });
    }

    const { data: access, error } = await req.supabase
      .from('model_access')
      .upsert(
        { model_id: req.params.modelId, profile_id: targetProfileId, role },
        { onConflict: 'model_id,profile_id' }
      )
      .select(`
        *,
        profiles:profile_id (id, email, full_name)
      `)
      .single();

    if (error) throw error;
    res.status(201).json(access);
  } catch (error) {
    console.error('Error granting model access:', error);
    res.status(500).json({ error: 'Failed to grant model access' });
  }
});

/**
 * PATCH /api/models/:modelId/access/:accessId
 * Update a user's role (owner only)
 */
router.patch('/:accessId', requireModelAccess('owner'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['owner', 'editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'role must be owner, editor, or viewer' });
    }

    const { data: access, error } = await req.supabase
      .from('model_access')
      .update({ role })
      .eq('id', req.params.accessId)
      .eq('model_id', req.params.modelId)
      .select(`
        *,
        profiles:profile_id (id, email, full_name)
      `)
      .single();

    if (error) throw error;
    if (!access) return res.status(404).json({ error: 'Access record not found' });

    res.json(access);
  } catch (error) {
    console.error('Error updating model access:', error);
    res.status(500).json({ error: 'Failed to update model access' });
  }
});

/**
 * DELETE /api/models/:modelId/access/:accessId
 * Revoke access (owner only, cannot revoke own owner access)
 */
router.delete('/:accessId', requireModelAccess('owner'), async (req, res) => {
  try {
    // Prevent removing own owner access
    const { data: target, error: fetchError } = await req.supabase
      .from('model_access')
      .select('profile_id, role')
      .eq('id', req.params.accessId)
      .single();

    if (fetchError || !target) {
      return res.status(404).json({ error: 'Access record not found' });
    }

    if (target.profile_id === req.user.id && target.role === 'owner') {
      return res.status(400).json({ error: 'Cannot revoke your own owner access' });
    }

    const { error } = await req.supabase
      .from('model_access')
      .delete()
      .eq('id', req.params.accessId)
      .eq('model_id', req.params.modelId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking model access:', error);
    res.status(500).json({ error: 'Failed to revoke model access' });
  }
});

module.exports = router;
