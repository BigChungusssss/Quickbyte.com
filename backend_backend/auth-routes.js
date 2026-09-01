// auth-routes.js
// In your main server file:
//   const authRoutes = require('./auth-routes');
//   app.use(authRoutes);

const express = require('express');
const { requireAuth, requireAdmin, supabaseAdmin } = require('./auth-and-security');

const router = express.Router();

// Called by Sign/signin.js right after a session reaches aal2, to confirm the
// account is actually approved before sending the user to the main site.
router.get('/auth/check-allowed', requireAuth, (req, res) => {
  res.json({
    ok: true,
    email: req.user.email,
    name: req.user.leaderName,
    companyName: req.user.companyName,
    studentNumber: req.user.studentNumber,
    groupNumber: req.user.groupNumber,
  });
});

// Admin-only: recent flagged/rejected requests, newest first.
router.get('/admin/security-logs', requireAuth, requireAdmin, async (req, res) => {
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
