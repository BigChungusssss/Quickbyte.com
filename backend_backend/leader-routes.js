const express = require('express');
const { requireDev, supabaseAdmin, logSecurityEvent } = require('./auth-and-security');

const router = express.Router();

router.get('/dev/check', requireDev, (req, res) => {
  res.json({ ok: true, email: req.user.email });
});

async function findAuthUserByEmail(email) {
  const { data: usersPage, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return usersPage.users.find(u => u.email?.toLowerCase() === email.trim().toLowerCase());
}

router.get('/dev/leaders', requireDev, async (req, res) => {
  const { data: leaders, error: leadersErr } = await supabaseAdmin
    .from('class_leaders')
    .select('id, name, company_name, student_number, group_number, is_admin, created_at')
    .order('name');
  if (leadersErr) return res.status(500).json({ error: 'Failed to load records' });

  const { data: emails, error: emailsErr } = await supabaseAdmin
    .from('class_leader_emails')
    .select('email, class_leader_id');
  if (emailsErr) return res.status(500).json({ error: 'Failed to load emails' });

  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, class_leader_id');
  if (profilesErr) return res.status(500).json({ error: 'Failed to load profiles' });

  const result = (leaders || []).map(l => {
    const leaderEmails = (emails || []).filter(e => e.class_leader_id === l.id).map(e => e.email);
    
    // Find profile matching class_leader_id or matching one of their emails
    const profile = (profiles || []).find(p => 
      p.class_leader_id === l.id || leaderEmails.includes(p.email?.toLowerCase())
    );

    return {
      ...l,
      role: profile ? profile.role : 'student', // default if no profile set yet
      emails: leaderEmails,
    };
  });

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
  const leaderId = req.params.id;

  // Handle metadata updates for class_leaders
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (companyName !== undefined) updates.company_name = companyName;
  if (studentNumber !== undefined) updates.student_number = studentNumber;
  if (groupNumber !== undefined) updates.group_number = groupNumber;
  if (isAdmin !== undefined) updates.is_admin = isAdmin;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabaseAdmin.from('class_leaders').update(updates).eq('id', leaderId);
    if (error) return res.status(500).json({ error: 'Failed to update record' });
  }

  // Handle role updates in the profiles table
  if (role !== undefined) {
    if (!['student', 'supplier'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Get emails for this leader to find their auth user
    const { data: leaderEmails } = await supabaseAdmin
      .from('class_leader_emails')
      .select('email')
      .eq('class_leader_id', leaderId);

    if (leaderEmails && leaderEmails.length > 0) {
      const primaryEmail = leaderEmails[0].email;
      let authUser;
      try {
        authUser = await findAuthUserByEmail(primaryEmail);
      } catch (e) {
        return res.status(500).json({ error: 'Failed to look up user auth account' });
      }

      if (authUser) {
        const { error: profileErr } = await supabaseAdmin
          .from('profiles')
          .upsert({
            id: authUser.id,
            email: authUser.email,
            role,
            class_leader_id: role === 'supplier' ? null : leaderId, // null for suppliers per schema rule
          });
        if (profileErr) return res.status(500).json({ error: 'Failed to update profile role' });
      } else {
        return res.status(404).json({ error: 'User must sign in with Google at least once before a role can be assigned.' });
      }
    }
  }

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