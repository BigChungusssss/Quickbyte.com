// box-logic.js
const { supabaseAdmin } = require('./auth-and-security');

function getBoxCapacity() {
  return parseInt(process.env.BOX_CAPACITY || '88', 10);
}

async function countActiveBoxes() {
  const { count } = await supabaseAdmin
    .from('box_assignments')
    .select('*', { count: 'exact', head: true })
    .is('released_at', null);
  return count || 0;
}

async function findNextFreeBoxNumber() {
  const capacity = getBoxCapacity();
  const { data: active } = await supabaseAdmin
    .from('box_assignments')
    .select('box_number')
    .is('released_at', null);
  const used = new Set((active || []).map(r => r.box_number));
  for (let n = 1; n <= capacity; n++) {
    if (!used.has(n)) return n;
  }
  return null; // shouldn't happen if countActiveBoxes < capacity, but be safe
}

// Called right after an order finishes parsing successfully, or whenever a
// box is released — either promotes the order to pending_fulfillment with a
// real box number, or leaves/moves it to waiting_list if full.
async function tryAssignBox(orderId) {
  const capacity = getBoxCapacity();
  const active = await countActiveBoxes();

  if (active >= capacity) {
    await supabaseAdmin.from('orders').update({ status: 'waiting_list' }).eq('id', orderId);
    return null;
  }

  const boxNumber = await findNextFreeBoxNumber();
  if (boxNumber === null) {
    await supabaseAdmin.from('orders').update({ status: 'waiting_list' }).eq('id', orderId);
    return null;
  }

  await supabaseAdmin.from('box_assignments').insert({ box_number: boxNumber, order_id: orderId });
  await supabaseAdmin.from('orders').update({ status: 'pending_fulfillment', box_number: boxNumber }).eq('id', orderId);
  return boxNumber;
}

// Call when an order is fully picked up — frees the box and promotes the
// oldest waiting-list order into the newly-freed spot.
async function releaseBoxForOrder(orderId) {
  const { data: order } = await supabaseAdmin.from('orders').select('box_number').eq('id', orderId).single();
  if (!order?.box_number) return;

  await supabaseAdmin
    .from('box_assignments')
    .update({ released_at: new Date().toISOString() })
    .eq('box_number', order.box_number)
    .is('released_at', null);

  const { data: nextWaiting } = await supabaseAdmin
    .from('orders')
    .select('id')
    .eq('status', 'waiting_list')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextWaiting) await tryAssignBox(nextWaiting.id);
}

module.exports = { getBoxCapacity, tryAssignBox, releaseBoxForOrder };
