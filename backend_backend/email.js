// email.js
// Uses Resend's HTTP API directly (no SDK needed — one fetch call).
// SendGrid, Postmark, Mailgun, AWS SES all work the same way if you'd
// rather use one of those: same idea, different endpoint/payload shape.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.ORDERS_FROM_EMAIL || 'orders@yourdomain.com';

async function sendEmail({ to, subject, html }) {
  // Check if emails are temporarily paused
  if (process.env.EMAIL_ENABLED === 'false') {
    console.log(`[Email Paused] Skipped sending to ${to} with subject: "${subject}"`);
    return { id: 'email-service-paused' }; // Returns a mock object so code waiting for a response doesn't break
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Email send failed (${res.status}): ${body}`);
  }
  return res.json();
}

// Sent to the supplier the moment an order is placed.
function itemsTableHTML(items) {
  const rows = items.map(it => `
    <tr>
      <td style="padding:4px 12px 4px 0;">${it.name}${it.variantLabel ? ` (${it.variantLabel})` : ''}</td>
      <td style="padding:4px 0;text-align:center;">${it.qty}</td>
    </tr>
  `).join('');
  return `<table style="border-collapse:collapse;">${rows}</table>`;
}

function sendSupplierOrderEmail(order, readyLink) {
  return sendEmail({
    to: order.supplierEmail,
    subject: `New order #${order.id} — box ${order.boxNumber}`,
    html: `
      <p>New order received.</p>
      <ul>
        <li><strong>Order:</strong> #${order.id}</li>
        <li><strong>Box:</strong> ${order.boxNumber}</li>
        <li><strong>Submitted:</strong> ${new Date(order.submittedAt).toLocaleString()}</li>
      </ul>
      ${itemsTableHTML(order.items)}
      <p><a href="${readyLink}">Click here once the order is packed and ready for pickup.</a></p>
      <p style="color:#888;font-size:12px;">This link is single-use and unique to this order.</p>
    `,
  });
}

// Sent to the customer once the supplier marks the order ready.
function sendCustomerPickupCode(order) {
  return sendEmail({
    to: order.customerEmail,
    subject: `Your order is ready — box ${order.boxNumber}`,
    html: `
      <p>Your order is ready for pickup at box <strong>${order.boxNumber}</strong>.</p>
      <p>Unlock code: <strong style="font-size:20px;letter-spacing:4px;">${order.code}</strong></p>
      <p>Please collect within ${order.pickupWindowHours} hours — after that the order will be removed and the box freed up.</p>
      <p style="color:#888;font-size:12px;">For security, this code resets automatically after 24 hours if unused.</p>
    `,
  });
}

// Sent to the supplier at the same time, so they have the code on hand too.
function sendSupplierPickupCode(order) {
  return sendEmail({
    to: order.supplierEmail,
    subject: `Pickup code for order #${order.id} — box ${order.boxNumber}`,
    html: `
      <p>Order #${order.id} is marked ready. Box <strong>${order.boxNumber}</strong>.</p>
      <p>Customer's unlock code: <strong style="font-size:20px;letter-spacing:4px;">${order.code}</strong></p>
    `,
  });
}

function sendOrderExpiredNotice(order) {
  return sendEmail({
    to: order.supplierEmail,
    subject: `Order #${order.id} expired — not picked up`,
    html: `<p>Order #${order.id} in box ${order.boxNumber} was not picked up in time and has been removed. The box is now free.</p>`,
  });
}

module.exports = {
  sendSupplierOrderEmail,
  sendCustomerPickupCode,
  sendSupplierPickupCode,
  sendOrderExpiredNotice,
};