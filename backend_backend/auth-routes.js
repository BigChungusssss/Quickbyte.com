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