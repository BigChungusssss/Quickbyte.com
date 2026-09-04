// order-routes.js
const express = require('express');
const { supabaseAdmin, logSecurityEvent } = require('./auth-and-security');
const { requireProfile, requireRole } = require('./roles');
const { releaseBoxForOrder } = require('./box-logic');

const router = express.Router();

// GET /orders/mine  (student)
router.get('/orders/mine', requireProfile, requireRole('student'), async (req, res) => {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('*, order_items(*)')
    .eq('student_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to load orders' });
  res.json({ orders });
});

// GET /supplier/orders  (supplier) — optional ?status= and ?classLeaderId= filters
router.get('/supplier/orders', requireProfile, requireRole('supplier'), async (req, res) => {
  let query = supabaseAdmin
    .from('orders')
    .select('*, order_items(*), profiles!orders_student_id_fkey(full_name, email)')
    .order('created_at', { ascending: false });

  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.classLeaderId) query = query.eq('class_leader_id', req.query.classLeaderId);

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to load orders' });
  res.json({ orders });
});

// PATCH /supplier/order-items/:id/ready  (supplier)
// body: { ready: true|false }
router.patch('/supplier/order-items/:id/ready', requireProfile, requireRole('supplier'), async (req, res) => {
  const ready = !!req.body.ready;

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('order_items')
    .update({ is_ready: ready, ready_at: ready ? new Date().toISOString() : null })
    .eq('id', req.params.id)
    .select('*, orders(id, student_id, box_number, status)')
    .single();

  if (itemErr || !item) return res.status(404).json({ error: 'Item not found' });

  if (ready) {
    // In-app notification only — no email, per requirements.
    await supabaseAdmin.from('notifications').insert({
      student_id: item.orders.student_id,
      order_id: item.orders.id,
      message: `${item.item_name} is ready — box ${item.orders.box_number ?? 'TBD'}.`,
    });
  }

  // If every item on this order is now ready, mark the whole order ready.
  const { data: siblings } = await supabaseAdmin
    .from('order_items')
    .select('is_ready')
    .eq('order_id', item.orders.id);

  const allReady = siblings.every(s => s.is_ready);
  if (allReady && item.orders.status !== 'ready') {
    await supabaseAdmin.from('orders').update({ status: 'ready' }).eq('id', item.orders.id);
  }

  res.json({ ok: true });
});

// POST /supplier/orders/:id/picked-up  (supplier) — frees the box, promotes next waiting order
router.post('/supplier/orders/:id/picked-up', requireProfile, requireRole('supplier'), async (req, res) => {
  const { error } = await supabaseAdmin.from('orders').update({ status: 'picked_up' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to update order' });

  await releaseBoxForOrder(req.params.id);
  res.json({ ok: true });
});

// GET /notifications/mine  (student)
router.get('/notifications/mine', requireProfile, requireRole('student'), async (req, res) => {
  const { data: notifications, error } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('student_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: 'Failed to load notifications' });
  res.json({ notifications });
});

// PATCH /notifications/:id/read  (student)
router.patch('/notifications/:id/read', requireProfile, requireRole('student'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('student_id', req.user.id);

  if (error) return res.status(500).json({ error: 'Failed to update notification' });
  res.json({ ok: true });
});

module.exports = router;
