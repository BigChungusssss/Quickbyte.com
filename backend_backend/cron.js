// cron.js
// Two independent timers. Run via `npm i node-cron` then require this
// file once from server.js (see server.js). If your host doesn't keep a
// long-running process alive (e.g. serverless), swap node-cron for a
// scheduled function (Vercel Cron, AWS EventBridge, etc.) that calls
// checkExpiredOrders() / resetStaleCodes() on the same schedule instead.

const cron = require('node-cron');
const { getOrdersByStatus, updateOrder, deleteOrder, releaseBox } = require('./store');
const { generateUniqueCode } = require('./codeGen');
const {
  sendOrderExpiredNotice,
  sendCustomerPickupCode,
  sendSupplierPickupCode,
} = require('./email');

const HOUR = 60 * 60 * 1000;

// Orders sitting in "ready" longer than their pickup window get removed
// and the box freed up.
async function checkExpiredOrders() {
  const readyOrders = getOrdersByStatus('ready');
  const now = Date.now();

  for (const order of readyOrders) {
    const windowMs = order.pickupWindowHours * HOUR;
    if (now - order.readyAt > windowMs) {
      await sendOrderExpiredNotice(order);
      releaseBox(order.boxNumber);
      deleteOrder(order.id); // or updateOrder(order.id, { status: 'expired' }) if you want to keep history
    }
  }
}

// Any code older than 24h that's still unclaimed gets replaced, and both
// customer and supplier get the new one.
async function resetStaleCodes() {
  const readyOrders = getOrdersByStatus('ready');
  const now = Date.now();

  for (const order of readyOrders) {
    if (order.codeGeneratedAt && now - order.codeGeneratedAt > 24 * HOUR) {
      const newCode = generateUniqueCode();
      const updated = updateOrder(order.id, {
        code: newCode,
        codeGeneratedAt: now,
      });
      await Promise.all([
        sendCustomerPickupCode(updated),
        sendSupplierPickupCode(updated),
      ]);
    }
  }
}

function startCronJobs() {
  // Every 15 minutes: check for orders past their pickup window.
  cron.schedule('*/15 * * * *', () => {
    checkExpiredOrders().catch(err => console.error('checkExpiredOrders failed:', err));
  });

  // Every hour: check for codes older than 24h.
  cron.schedule('0 * * * *', () => {
    resetStaleCodes().catch(err => console.error('resetStaleCodes failed:', err));
  });
}

module.exports = { startCronJobs, checkExpiredOrders, resetStaleCodes };
