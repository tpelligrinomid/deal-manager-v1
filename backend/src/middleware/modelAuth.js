const { supabaseAdmin } = require('../lib/supabase');

const ROLE_HIERARCHY = { viewer: 1, editor: 2, owner: 3 };

/**
 * Require model access with minimum role.
 * Admin/team_member bypass (treated as owner).
 * Attaches req.modelAccess with { model_id, profile_id, role }.
 */
const requireModelAccess = (minRole = 'viewer') => {
  return async (req, res, next) => {
    try {
      const modelId = req.params.modelId;

      if (!modelId) {
        return res.status(400).json({ error: 'Model ID required' });
      }

      // Admin and team_member bypass — treated as owner
      if (['admin', 'team_member'].includes(req.user.role)) {
        req.modelAccess = { model_id: modelId, profile_id: req.user.id, role: 'owner' };
        return next();
      }

      // Check model_access table
      const { data: access, error } = await req.supabase
        .from('model_access')
        .select('model_id, profile_id, role')
        .eq('model_id', modelId)
        .eq('profile_id', req.user.id)
        .single();

      if (error || !access) {
        return res.status(403).json({ error: 'Access denied to this model' });
      }

      // Check role hierarchy
      if ((ROLE_HIERARCHY[access.role] || 0) < (ROLE_HIERARCHY[minRole] || 0)) {
        return res.status(403).json({ error: 'Insufficient model permissions' });
      }

      req.modelAccess = access;
      next();
    } catch (error) {
      console.error('Model access check error:', error);
      res.status(500).json({ error: 'Failed to verify model access' });
    }
  };
};

module.exports = { requireModelAccess };
