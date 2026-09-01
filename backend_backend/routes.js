// routes.js
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createOrder, getOrder, updateOrder, assignBox, releaseBox } = require('./store');
const { generateUniqueCode } = require('./codeGen');
const { requireAuth, authRateLimiter, logSecurityEvent } = require('./auth-and-security');
const {
  sendSupplierOrderEmail,
  sendCustomerPickupCode,
  sendSupplierPickupCode,
} = require('./email');

const router = express.Router();
router.use(cors()); // the cart page is a different origin than this API

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const SUPPLIER_EMAIL = process.env.SUPPLIER_EMAIL; // one fixed address for every order
const PICKUP_WINDOW_HOURS = 1; // how long a "ready" order sits before it's removed

// POST /orders
// Body: { items: [{ name, variantLabel, price, qty }, ...] }
// Called by the cart's "Send to supplier" button. Requires a signed-in, 2FA'd
// class leader — customerEmail now comes from their verified session, not the
// request body, so an order can't be placed under a spoofed email.
router.post('/orders', authRateLimiter, requireAuth, async (req, res) => {
  const { items } = req.body;
  const customerEmail = req.user.email;

  if (!Array.isArray(items) || items.length === 0) {
    await logSecurityEvent({ req, type: 'bad_input', detail: 'Empty or invalid items array', email: req.user.email });
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  if (!SUPPLIER_EMAIL) {
    return res.status(500).json({ error: 'SUPPLIER_EMAIL is not configured on the server' });
  }

  const boxNumber = assignBox();
  if (boxNumber === null) {
    return res.status(503).json({ error: 'No boxes available right now — try again shortly' });
  }

  const total = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);

  const order = {
    id: crypto.randomUUID(),
    boxNumber,
    supplierEmail: SUPPLIER_EMAIL,
    customerEmail,
    leaderName: req.user.leaderName,
    companyName: req.user.companyName,
    studentNumber: req.user.studentNumber,
    groupNumber: req.user.groupNumber,
    items,
    total,
    submittedAt: Date.now(),
    status: 'pending', // pending -> ready -> picked_up | expired
    readyToken: crypto.randomBytes(16).toString('hex'), // secures the magic link
    code: null,
    codeGeneratedAt: null,
    readyAt: null,
    pickupWindowHours: PICKUP_WINDOW_HOURS,
  };

  createOrder(order);

  const readyLink = `${APP_BASE_URL}/orders/${order.id}/ready?token=${order.readyToken}`;
  try {
    await sendSupplierOrderEmail(order, readyLink);
  } catch (err) {
    releaseBox(boxNumber);
    updateOrder(order.id, { status: 'failed' });
    console.error('Failed to email supplier:', err);
    return res.status(502).json({ error: 'Order saved but the supplier email failed to send' });
  }

  res.status(201).json({ id: order.id, boxNumber: order.boxNumber, status: order.status });
});

// GET /orders/:id/ready?token=...
// This is the link the supplier clicks from their email. Intentionally NOT behind
// requireAuth — the supplier isn't a class leader and has no account. The random
// readyToken in the link is what proves it's really them; do not add login here.
router.get('/orders/:id/ready', async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).send('Order not found.');
  if (order.readyToken !== req.query.token) {
    await logSecurityEvent({ req, type: 'bad_input', detail: 'Invalid or reused ready-link token' });
    return res.status(403).send('Invalid or expired link.');
  }
  if (order.status !== 'pending') return res.send('This order was already marked ready.');

  const code = generateUniqueCode();
  const updated = updateOrder(order.id, {
    status: 'ready',
    code,
    codeGeneratedAt: Date.now(),
    readyAt: Date.now(),
  });

  const results = await Promise.allSettled([
    sendCustomerPickupCode(updated),
    sendSupplierPickupCode(updated),
  ]);
  const failures = results.filter(r => r.status === 'rejected');

  if (failures.length > 0) {
    failures.forEach(f => console.error('Pickup code email failed:', f.reason));
    return res.status(207).send(
      'Marked ready, but one of the notification emails failed to send. Check the server logs — the pickup code is still saved on the order.'
    );
  }

  res.send('Marked ready — the customer and you have both been emailed the pickup code.');
});

// POST /orders/:id/picked-up
// Call this when the customer actually opens the box (from your locker
// hardware later, or manually by staff for now). Not behind requireAuth yet
// since it's staff/hardware-triggered, not a class leader action — worth
// revisiting once you know what's calling this in production.
router.post('/orders/:id/picked-up', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  updateOrder(order.id, { status: 'picked_up' });
  releaseBox(order.boxNumber);
  res.json({ status: 'picked_up' });
});

module.exports = router;