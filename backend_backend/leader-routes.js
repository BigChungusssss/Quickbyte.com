// leader-routes.js
// In your main server file:
//   const leaderRoutes = require('./leader-routes');
//   app.use(leaderRoutes);
// Every route here requires requireAdminOrDev — accessible to DEV_EMAILS,
// AND to any class leader with is_admin = true. requireAdminOrDev checks
// DEV_EMAILS first, then falls back to the class_leaders.is_admin flag.
// Class leaders are the ordering population (cart + Excel uploads) — there is
// no "student" role anymore. profiles only exists for 'supplier'/'admin', and
// only gets a row once that person has actually signed in with Google
// themselves — we never create auth accounts on their behalf here, since a
// pre-existing auth.users row with no Google identity attached can break
// that email's real Google sign-in later.

const express = require('express');
const { requireAdminOrDev, supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

const router = express.Router();

router.get('/dev/check', requireAdminOrDev, (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

async function findAuthUserByEmail(email) {
  const { data: usersPage, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return usersPage.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
}

// List every class leader (with emails) AND every supplier/admin profile.
router.get('/dev/leaders', requireAdminOrDev, async (req, res) => {
  const { data: leaders, error: leadersErr } = await supabaseAdmin
    .from('class_leaders')
    .select('id, name, company_name, student_number, group_number, is_admin, created_at')
    .order('name');
  if (leadersErr) return res.status(500).json({ error: 'Failed to load leaders' });

  const { data: emails, error: emailsErr } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leader_id');
  if (emailsErr) return res.status(500).json({ error: 'Failed to load emails' });

  const result = (leaders || []).map(l => ({
    ...l,
    emails: (emails || []).filter(e => e.class_leader_id === l.id).map(e => e.email),
  }));

  const { data: people, error: peopleErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, full_name, class_leader_id, created_at')
    .order('created_at', { ascending: false });
  if (peopleErr) return res.status(500).json({ error: 'Failed to load people' });

  res.json({ leaders: result, people: people || [] });
});

// Create a class leader. Does NOT touch profiles/auth at all — a class leader
// is fully usable (cart + uploads) via class_leaders/class_leader_emails alone.
router.post('/dev/leaders', requireAdminOrDev, async (req, res) => {
  const { name, companyName, studentNumber, groupNumber, emails = [], isAdmin = false } = req.body || {};
  if (!name || !companyName || !studentNumber || !groupNumber || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'All fields and at least one email are required' });
  }

  const { data: leader, error: leaderErr } = await supabaseAdmin
    .from('class_leaders')
    .insert({
      name,
      company_name: companyName,
      student_number: studentNumber,
      group_number: groupNumber,
      is_admin: isAdmin,
    })
    .select()
    .single();

  if (leaderErr) return res.status(500).json({ error: 'Failed to create leader' });

  const rows = emails.map(email => ({ email: email.trim().toLowerCase(), class_leader_id: leader.id }));
  const { error: emailErr } = await supabaseAdmin.from('class_leader_emails').insert(rows);
  if (emailErr) {
    await supabaseAdmin.from('class_leaders').delete().eq('id', leader.id);
    return res.status(400).json({ error: 'One or more emails already in use' });
  }

  res.status(201).json({ leader: { ...leader, emails: rows.map(r => r.email) } });
});

// Create/update a student, supplier, or admin. Requires the person to have
// already signed in with Google at least once (we look their auth id up by
// email) — we never create the account for them. Students need classLeaderId
// (which group they belong to); supplier/admin don't.
router.post('/dev/people', requireAdminOrDev, async (req, res) => {
  const { email, fullName, role, classLeaderId } = req.body || {};
  if (!email || !['student', 'supplier', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'email and a valid role (student, supplier, or admin) are required' });
  }
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
      role,
      full_name: fullName || null,
      class_leader_id: role === 'student' ? classLeaderId : null,
    });

  if (upsertErr) return res.status(500).json({ error: 'Failed to save role' });
  res.status(201).json({ ok: true });
});

// Edit a leader's name/company/student number/group number/admin flag (not their emails — use the /emails routes for that).
router.patch('/dev/leaders/:id', requireAdminOrDev, async (req, res) => {
  const { name, companyName, studentNumber, groupNumber, isAdmin } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (companyName !== undefined) updates.company_name = companyName;
  if (studentNumber !== undefined) updates.student_number = studentNumber;
  if (groupNumber !== undefined) updates.group_number = groupNumber;
  if (isAdmin !== undefined) updates.is_admin = isAdmin;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const { error } = await supabaseAdmin.from('class_leaders').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to update leader' });
  res.json({ ok: true });
});

router.post('/dev/leaders/:id/emails', requireAdminOrDev, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .insert({ email: email.trim().toLowerCase(), class_leader_id: req.params.id });

  if (error) return res.status(400).json({ error: 'Email already in use or leader does not exist' });
  res.status(201).json({ ok: true });
});

router.delete('/dev/leaders/:id/emails/:email', requireAdminOrDev, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .delete()
    .eq('class_leader_id', req.params.id)
    .eq('email', req.params.email.toLowerCase());
  if (error) return res.status(500).json({ error: 'Failed to remove email' });
  res.json({ ok: true });
});

router.delete('/dev/leaders/:id', requireAdminOrDev, async (req, res) => {
  const { error } = await supabaseAdmin.from('class_leaders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to remove leader' });
  await logSecurityEvent({ req, type: 'leader_removed', detail: `Leader ${req.params.id} removed`, email: req.user.email });
  res.json({ ok: true });
});

router.delete('/dev/people/:id', requireAdminOrDev, async (req, res) => {
  const { error } = await supabaseAdmin.from('profiles').delete().eq('id', req.params.id);
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: "Can't remove — this person has existing orders/notifications." });
    }
    return res.status(500).json({ error: 'Failed to remove person' });
  }
  res.json({ ok: true });
});

module.exports = router;