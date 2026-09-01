// leader-routes.js
// In your main server file:
//   const leaderRoutes = require('./leader-routes');
//   app.use(leaderRoutes);
// Every route here is dev-only (requireDev) — restricted to the emails listed in
// the DEV_EMAILS env var, regardless of anything in the class_leaders table.

const express = require('express');
const { requireDev, supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

const router = express.Router();

// Lets the dev-area frontend confirm access before rendering anything.
router.get('/dev/check', requireDev, (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

// List every class leader and the emails attached to each.
router.get('/dev/leaders', requireDev, async (req, res) => {
  const { data: leaders, error: leadersErr } = await supabaseAdmin
    .from('class_leaders')
    .select('id, name, company_name, student_number, group_number, is_admin, created_at')
    .order('name');
  if (leadersErr) return res.status(500).json({ error: 'Failed to load leaders' });

  const { data: emails, error: emailsErr } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leader_id');
  if (emailsErr) return res.status(500).json({ error: 'Failed to load emails' });

  const result = leaders.map(l => ({
    ...l,
    emails: emails.filter(e => e.class_leader_id === l.id).map(e => e.email),
  }));

  res.json({ leaders: result });
});

// Create a new class leader with one or more starting emails.
// body: { name, companyName, studentNumber, groupNumber, emails: [...], isAdmin: false }
router.post('/dev/leaders', requireDev, async (req, res) => {
  const { name, companyName, studentNumber, groupNumber, emails = [], isAdmin = false } = req.body || {};
  if (!name || !companyName || !studentNumber || !groupNumber || !Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'name, companyName, studentNumber, groupNumber and at least one email are required' });
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
    // Roll back the leader if the emails failed (e.g. duplicate email already in use).
    await supabaseAdmin.from('class_leaders').delete().eq('id', leader.id);
    return res.status(400).json({ error: 'One or more emails already in use' });
  }

  res.status(201).json({ leader: { ...leader, emails: rows.map(r => r.email) } });
});

// Edit a leader's name/company/student number/group number (not their emails — use the /emails routes for that).
// body: any subset of { name, companyName, studentNumber, groupNumber, isAdmin }
router.patch('/dev/leaders/:id', requireDev, async (req, res) => {
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

// Add another email to an existing leader (e.g. their school email as well as personal Gmail).
router.post('/dev/leaders/:id/emails', requireDev, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .insert({ email: email.trim().toLowerCase(), class_leader_id: req.params.id });

  if (error) return res.status(400).json({ error: 'Email already in use or leader does not exist' });
  res.status(201).json({ ok: true });
});

// Remove one email from a leader (doesn't delete the leader).
router.delete('/dev/leaders/:id/emails/:email', requireDev, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .delete()
    .eq('class_leader_id', req.params.id)
    .eq('email', req.params.email.toLowerCase());
  if (error) return res.status(500).json({ error: 'Failed to remove email' });
  res.json({ ok: true });
});

// Remove a leader entirely (cascades and removes all their emails too).
router.delete('/dev/leaders/:id', requireDev, async (req, res) => {
  const { error } = await supabaseAdmin.from('class_leaders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to remove leader' });
  await logSecurityEvent({ req, type: 'leader_removed', detail: `Leader ${req.params.id} removed`, email: req.user.email });
  res.json({ ok: true });
});

module.exports = router;
