const { supabaseAdmin, createSupabaseClient } = require('../lib/supabase');

/**
 * Authentication middleware
 * Verifies the Supabase JWT token and attaches user info to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Verify the token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Get user profile with role
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return res.status(401).json({ error: 'User profile not found' });
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
      ...profile
    };

    // Create a Supabase client with the user's token for RLS queries
    req.supabase = createSupabaseClient(token);

    // Check if user is pending (not yet authorized)
    if (profile.role === 'pending') {
      return res.status(403).json({
        error: 'Account pending authorization',
        code: 'PENDING_AUTHORIZATION',
        message: 'Your account is awaiting authorization. Please contact an administrator.'
      });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Require specific role(s)
 * Usage: requireRole('admin') or requireRole(['admin', 'team_member'])
 */
const requireRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

/**
 * Check if user has access to a specific deal
 */
const requireDealAccess = async (req, res, next) => {
  try {
    const dealId = req.params.dealId || req.body.deal_id;

    if (!dealId) {
      return res.status(400).json({ error: 'Deal ID required' });
    }

    // Admin and team members have access to all deals
    if (['admin', 'team_member'].includes(req.user.role)) {
      return next();
    }

    // Check deal_access table for other users
    const { data: access, error } = await supabaseAdmin
      .from('deal_access')
      .select('*')
      .eq('deal_id', dealId)
      .eq('user_id', req.user.id)
      .single();

    if (error || !access) {
      return res.status(403).json({ error: 'Access denied to this deal' });
    }

    req.dealAccess = access;
    next();
  } catch (error) {
    console.error('Deal access check error:', error);
    res.status(500).json({ error: 'Failed to verify deal access' });
  }
};

module.exports = {
  authenticate,
  requireRole,
  requireDealAccess
};
