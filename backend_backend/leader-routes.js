const express = require('express');
const { requireDev, supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

const router = express.Router();

router.get('/dev/check', requireDev, (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

// List every user profile with their role and admin status
router.get('/dev/users', requireDev, async (req, res) => {
  const { data: users, error: usersErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, full_name, is_admin, class_leader_id, created_at')
    .order('created_at', { ascending: false });
  if (usersErr) return res.status(500).json({ error: 'Failed to load users' });

  res.json({ users });
});

async function findAuthUserByEmail(email) {
  const { data: usersPage, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return usersPage.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
}

// Create or assign a role to a user (student or supplier, with optional admin flag)
router.post('/dev/users', requireDev, async (req, res) => {
  const { role, email, fullName, isAdmin = false, classLeaderId } = req.body || {};

  if (!email || !role) return res.status(400).json({ error: 'email and role are required' });
  if (role === 'student' && !classLeaderId) {
    return res.status(400).json({ error: 'classLeaderId is required for students' });
  }

  let authUser;
  try {
    authUser = await findAuthUserByEmail(email);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to look up user' });
  }
  if (!authUser) {
    return res.status(404).json({ error: 'No account found for that email — they need to sign in with Google at least once first' });
  }

  const { error: upsertErr } = await supabaseAdmin
    .from('profiles')
    .upsert({
      id: authUser.id,
      email: authUser.email,
      role, // 'student' or 'supplier'
      full_name: fullName || null,
      is_admin: Boolean(isAdmin),
      class_leader_id: role === 'student' ? classLeaderId : null,
    });

  if (upsertErr) return res.status(500).json({ error: 'Failed to save user role' });
  return res.status(201).json({ ok: true });
});

// Update a user's admin status
router.patch('/dev/users/:id', requireDev, async (req, res) => {
  const { isAdmin } = req.body || {};
  if (isAdmin === undefined) return res.status(400).json({ error: 'No fields to update' });

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ is_admin: Boolean(isAdmin) })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: 'Failed to update user' });
  res.json({ ok: true });
});

// Remove a user's role assignment
router.delete('/dev/users/:id', requireDev, async (req, res) => {
  const { error } = await supabaseAdmin.from('profiles').delete().eq('id', req.params.id);
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: "Can't remove — this person has existing orders/notifications." });
    }
    return res.status(500).json({ error: 'Failed to remove user' });
  }
  res.json({ ok: true });
});

module.exports = router;