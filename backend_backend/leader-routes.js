const express = require('express');
const { requireDev, supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

const router = express.Router();

router.get('/dev/check', requireDev, (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

router.get('/dev/leaders', requireDev, async (req, res) => {
  const { data: leaders, error: leadersErr } = await supabaseAdmin
    .from('class_leaders')
    .select('id, name, company_name, student_number, group_number, is_admin, role, created_at')
    .order('name');
  if (leadersErr) return res.status(500).json({ error: 'Failed to load records' });

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
      role: 'student', // Default role upon creation
    })
    .select()
    .single();
  if (leaderErr) return res.status(500).json({ error: 'Failed to create record' });

  const rows = emails.map(email => ({ email: email.trim().toLowerCase(), class_leader_id: leader.id }));
  const { error: emailErr } = await supabaseAdmin.from('class_leader_emails').insert(rows);
  if (emailErr) {
    await supabaseAdmin.from('class_leaders').delete().eq('id', leader.id);
    return res.status(400).json({ error: 'One or more emails already in use' });
  }

  res.status(201).json({ leader: { ...leader, emails: rows.map(r => r.email) } });
});

router.patch('/dev/leaders/:id', requireDev, async (req, res) => {
  const { name, companyName, studentNumber, groupNumber, isAdmin, role } = req.body || {};
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (companyName !== undefined) updates.company_name = companyName;
  if (studentNumber !== undefined) updates.student_number = studentNumber;
  if (groupNumber !== undefined) updates.group_number = groupNumber;
  if (isAdmin !== undefined) updates.is_admin = isAdmin;
  if (role !== undefined) {
    if (!['student', 'supplier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    updates.role = role;
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields to update' });

  const { error } = await supabaseAdmin.from('class_leaders').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to update record' });
  res.json({ ok: true });
});

router.post('/dev/leaders/:id/emails', requireDev, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .insert({ email: email.trim().toLowerCase(), class_leader_id: req.params.id });

  if (error) return res.status(400).json({ error: 'Email already in use or record does not exist' });
  res.status(201).json({ ok: true });
});

router.delete('/dev/leaders/:id/emails/:email', requireDev, async (req, res) => {
  const { error } = await supabaseAdmin
    .from('class_leader_emails')
    .delete()
    .eq('class_leader_id', req.params.id)
    .eq('email', req.params.email.toLowerCase());
  if (error) return res.status(500).json({ error: 'Failed to remove email' });
  res.json({ ok: true });
});

router.delete('/dev/leaders/:id', requireDev, async (req, res) => {
  const { error } = await supabaseAdmin.from('class_leaders').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to remove record' });
  await logSecurityEvent({ req, type: 'leader_removed', detail: `Record ${req.params.id} removed`, email: req.user.email });
  res.json({ ok: true });
});

module.exports = router;