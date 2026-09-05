// order-routes.js
const express = require('express');
const { supabaseAdmin } = require('./auth-and-security');
const { requireProfile, requireRole } = require('./roles');
const { releaseBoxForOrder } = require('./box-logic');

const router = express.Router();

const SIGNED_URL_EXPIRY_SECONDS = 60 * 5; // 5 minutes — plenty for a single download click

// GET /orders/mine  (student) — their own order history, grouped by leader implicitly via class_leader_id
router.get('/orders/mine', requireProfile, requireRole('student'), async (req, res) => {
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, source_filename, status, box_number, version, created_at, updated_at')
    .eq('student_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to load orders' });
  res.json({ orders });
});

// GET /orders/mine/:id/download  (student) — signed URL to their own file
router.get('/orders/mine/:id/download', requireProfile, requireRole('student'), async (req, res) => {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('file_storage_path')
    .eq('id', req.params.id)
    .eq('student_id', req.user.id) // students can only download their own
    .maybeSingle();

  if (!order?.file_storage_path) return res.status(404).json({ error: 'File not found' });

  const { data, error } = await supabaseAdmin.storage
    .from('order-uploads')
    .createSignedUrl(order.file_storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (error) return res.status(500).json({ error: 'Failed to create download link' });
  res.json({ url: data.signedUrl });
});

// GET /supplier/orders  (supplier) — list, organized by leader; optional ?status= and ?classLeaderId= filters
router.get('/supplier/orders', requireProfile, requireRole('supplier'), async (req, res) => {
  let query = supabaseAdmin
    .from('orders')
    .select('*, profiles!orders_student_id_fkey(full_name, email), class_leaders(name)')
    .order('class_leader_id', { ascending: true })
    .order('created_at', { ascending: false });

  if (req.query.status) query = query.eq('status', req.query.status);
  if (req.query.classLeaderId) query = query.eq('class_leader_id', req.query.classLeaderId);

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ error: 'Failed to load orders' });
  res.json({ orders });
});

// GET /supplier/orders/:id/download  (supplier) — signed URL to any order's file
router.get('/supplier/orders/:id/download', requireProfile, requireRole('supplier'), async (req, res) => {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('file_storage_path')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!order?.file_storage_path) return res.status(404).json({ error: 'File not found' });

  const { data, error } = await supabaseAdmin.storage
    .from('order-uploads')
    .createSignedUrl(order.file_storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (error) return res.status(500).json({ error: 'Failed to create download link' });
  res.json({ url: data.signedUrl });
});

// PATCH /supplier/orders/:id/ready  (supplier) — marks the whole order ready, notifies the student
router.patch('/supplier/orders/:id/ready', requireProfile, requireRole('supplier'), async (req, res) => {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .update({ status: 'ready' })
    .eq('id', req.params.id)
    .select('id, student_id, box_number')
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });

  await supabaseAdmin.from('notifications').insert({
    student_id: order.student_id,
    order_id: order.id,
    message: `Your order is ready — box ${order.box_number ?? 'TBD'}.`,
  });

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