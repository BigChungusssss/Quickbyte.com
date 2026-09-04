// roles.js
const { supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

// Verifies the Supabase session (Google + 2FA, same as requireAuth) and looks
// up their role in `profiles` — separate from the class_leaders/dev system,
// since students and suppliers are a different population from class leaders.
async function requireProfile(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    await logSecurityEvent({ req, type: 'auth_missing_token', detail: 'No bearer token supplied' });
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    await logSecurityEvent({ req, type: 'auth_invalid_token', detail: error?.message });
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  if (payload.aal !== 'aal2') {
    await logSecurityEvent({ req, type: 'auth_2fa_incomplete', detail: 'Session missing aal2', email: user.email });
    return res.status(401).json({ error: '2FA required' });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, full_name, class_leader_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    await logSecurityEvent({ req, type: 'auth_not_allowlisted', detail: 'No profile row', email: user.email });
    return res.status(403).json({ error: 'Account not set up. Contact the site admin.' });
  }

  req.user = profile;
  next();
}

// Use after requireProfile: requireRole('supplier') or requireRole('student')
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      logSecurityEvent({ req, type: 'admin_route_denied', detail: `Required role ${role}, had ${req.user?.role}`, email: req.user?.email });
      return res.status(403).json({ error: `${role}s only` });
    }
    next();
  };
}

module.exports = { requireProfile, requireRole };
