// auth-routes.js
// In your main server file:
//   const authRoutes = require('./auth-routes');
//   app.use(authRoutes);

const express = require('express');
const { requireAuth, requireAdminOrDev, supabaseAdmin } = require('./auth-and-security');

const router = express.Router();

// Called by Sign/signin.js right after a session reaches aal2, to confirm the
// account is actually approved before sending the user to the main site.
// Also used by auth-guard.js to decide whether to show the secret admin logs link.
router.get('/auth/check-allowed', requireAuth, (req, res) => {
  res.json({
    ok: true,
    email: req.user.email,
    name: req.user.leaderName,
    companyName: req.user.companyName,
    studentNumber: req.user.studentNumber,
    groupNumber: req.user.groupNumber,
    isAdmin: req.user.isAdmin,
  });
});

// Used ONLY by signin.js right after login, to decide where to send someone.
// Checks profiles first (student/supplier/admin), then falls back to the
// class_leader system — these are two independent populations that can
// overlap or not, so this tries both rather than assuming one or the other.
router.get('/auth/whoami', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Not authenticated' });

  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  if (payload.aal !== 'aal2') return res.status(401).json({ error: '2FA required' });

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profile) {
    return res.json({ ok: true, kind: 'profile', role: profile.role, name: profile.full_name, email: user.email });
  }

  const { data: emailRow } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leaders ( name )')
    .eq('email', user.email)
    .maybeSingle();

  if (emailRow) {
    return res.json({ ok: true, kind: 'leader', name: emailRow.class_leaders.name, email: user.email });
  }

  res.status(403).json({ ok: false, error: 'Account not approved for access' });
});

// Devs AND admin class leaders can view the security log.
router.get('/admin/security-logs', requireAdminOrDev, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const { data, error } = await supabaseAdmin
    .from('security_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: 'Failed to load logs' });
  res.json({ logs: data });
});

module.exports = router;