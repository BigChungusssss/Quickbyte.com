// store.js
// Placeholder data layer. Swap the inside of each function for real
// queries (Postgres, MySQL, Mongo, whatever you already have) —
// nothing else in the project needs to change if you keep these
// function names and shapes the same.

const orders = new Map(); // orderId -> order object

const TOTAL_BOXES = parseInt(process.env.TOTAL_BOXES || '100', 10);
const usedBoxes = new Set();

// Returns the next free box number, or null if every box is full.
function assignBox() {
  for (let i = 1; i <= TOTAL_BOXES; i++) {
    if (!usedBoxes.has(i)) {
      usedBoxes.add(i);
      return i;
    }
  }
  return null;
}

function releaseBox(boxNumber) {
  usedBoxes.delete(boxNumber);
}

function createOrder(order) {
  orders.set(order.id, order);
  return order;
}

function getOrder(orderId) {
  return orders.get(orderId) || null;
}

function updateOrder(orderId, patch) {
  const existing = orders.get(orderId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  orders.set(orderId, updated);
  return updated;
}

function deleteOrder(orderId) {
  orders.delete(orderId);
}

// Used by the cron jobs — pull every order in a given status.
function getOrdersByStatus(status) {
  return [...orders.values()].filter(o => o.status === status);
}

module.exports = {
  createOrder,
  getOrder,
  updateOrder,
  deleteOrder,
  getOrdersByStatus,
  assignBox,
  releaseBox,
};
