const supabase = require('./supabase');

/**
 * authenticateUser middleware
 *
 * Validates the JWT Bearer token from the Authorization header
 * using Supabase Auth. Looks up the user profile in our users table
 * and attaches it to req.user.
 *
 * Usage: router.get('/protected', authenticateUser, handler)
 */
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization header' });
    }

    const token = authHeader.split(' ')[1];

    // Validate token with Supabase Auth
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Look up user profile in our users table
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, name, email, role, store_id, language_pref')
      .eq('auth_id', authUser.id)
      .single();

    if (profileError || !userProfile) {
      return res.status(401).json({ error: 'User profile not found' });
    }

    // Attach user to request
    req.user = userProfile;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * requireRole middleware factory
 *
 * Returns middleware that checks if the authenticated user
 * has one of the specified roles.
 *
 * Usage: router.post('/admin-only', authenticateUser, requireRole('owner', 'gm'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }

    next();
  };
}

module.exports = { authenticateUser, requireRole };
