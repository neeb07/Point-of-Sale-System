/**
 * Held orders: a ticket is not a sale until somebody confirms it.
 *
 *   cd backend
 *   node scripts/run-script.js test/held-orders.js
 *
 * Runs against a throwaway copy of the database. No cloud, no network.
 *
 * The property under test is the one that would be quietly wrong if held
 * orders had been a status on the orders table: while a ticket is held it
 * must appear in nothing that counts sales — not the orders list, not the shift
 * totals, not the day's KPIs, not the sync queue, not the stock count. Then it
 * is confirmed, and it must appear in all of them, exactly as a direct sale
 * would.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ok = (l, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l);

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-held-'));
fs.copyFileSync(path.join(ROOT, 'pos_database.db'), path.join(dir, 'pos_database.db'));

process.env.POS_USER_DATA_PATH = dir;
process.env.PORT = '3394';
const API = 'http://127.0.0.1:3394/api';

async function call(method, p, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function waitFor(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

(async () => {
 try {
  require(path.join(ROOT, 'server'));
  if (!await waitFor(`${API}/health`)) { console.log('till would not start'); process.exit(1); }

  const db = require(path.join(ROOT, 'db', 'database'));
  db.prepare("UPDATE shifts SET status = 'closed', closed_at = datetime('now','localtime') WHERE status = 'open'").run();
  db.prepare('DELETE FROM held_orders').run();

  const T = (await call('POST', '/staff/login', null, { pin: '1234', staff_id: 1 })).body.token;
  const today = new Date().toLocaleDateString('en-CA');
  const ordersBefore = db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  const pendingBefore = db.prepare("SELECT COUNT(*) n FROM orders WHERE sync_state = 'pending'").get().n;

  const ticket = {
    items: [
      { id: 1, name: 'Zinger', price: 600, quantity: 2 },
      { id: 2, name: 'Fries', price: 250, quantity: 1 },
    ],
    payment_method: 'Cash', order_type: 'Dine-in', table_number: '7',
  };

  console.log('=== A TICKET NEEDS AN OPEN SHIFT, LIKE A SALE ===');
  const noShift = await call('POST', '/orders/hold', T, ticket);
  ok('holding with no shift open is refused', noShift.status === 409 && noShift.body.code === 'NO_OPEN_SHIFT');

  await call('POST', '/shifts/open', T, { opening_cash: 1000 });

  console.log();
  console.log('=== SENDING A TICKET TO THE KITCHEN ===');
  const held = await call('POST', '/orders/hold', T, ticket);
  console.log(`   ${held.status} ${held.body.ticket_no} — ${held.body.items?.length} lines, total ${held.body.total}`);
  ok('the ticket is held', held.status === 201 && held.body.held === true);
  ok('and numbered as a ticket, not an invoice', /^H-\d+$/.test(held.body.ticket_no || ''));
  ok('priced by the server', held.body.total === 1450 && held.body.subtotal === 1450);
  const ID = held.body.id;

  console.log();
  console.log('=== WHILE HELD, IT IS NOT A SALE ===');
  const ordersNow = db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  ok('nothing was written to the orders table', ordersNow === ordersBefore);

  const list = await call('GET', `/orders?from=${today}&to=${today}`, T);
  ok('it is not in the orders list', !(list.body || []).some(o => o.total === 1450 && o.table_number === '7'));

  const shift = await call('GET', '/shifts/current', T);
  console.log(`   shift so far: ${shift.body.total_orders} orders, revenue ${shift.body.total_revenue}`);
  ok('the shift total does not include it', Number(shift.body.total_orders) === 0);

  const kpi = await call('GET', `/reports/kpi?from=${today}&to=${today}`, T);
  ok('the day’s revenue does not include it', Number(kpi.body.total_revenue || 0) === 0);

  // Compared against the count before, not matched by value: the database this
  // runs on already holds real pending orders, some at this same total.
  const pending = db.prepare("SELECT COUNT(*) n FROM orders WHERE sync_state = 'pending'").get().n;
  ok('nothing new is queued for the cloud', pending === pendingBefore);

  const stockBefore = db.prepare('SELECT COALESCE(SUM(stock), 0) s FROM ingredients').get().s;
  console.log(`   stock on hand: ${stockBefore}`);

  console.log();
  console.log('=== IT CAN BE CHANGED WHILE HELD ===');
  const edited = await call('PUT', `/orders/held/${ID}`, T, {
    ...ticket,
    items: [
      { id: 1, name: 'Zinger', price: 600, quantity: 1 },            // one fewer
      { id: 3, name: 'Pizza (Large)', price: 2050, quantity: 1 },   // added
    ],
    table_number: '9',
  });
  console.log(`   now ${edited.body.items?.length} lines, table ${edited.body.table_number}, total ${edited.body.total}`);
  ok('items and table can be changed', edited.status === 200 && edited.body.total === 2650);
  ok('it keeps its ticket number', edited.body.ticket_no === held.body.ticket_no);

  const board = await call('GET', '/orders/held', T);
  ok('it shows on the board', (board.body || []).some(h => h.id === ID));

  console.log();
  console.log('=== CONFIRMING MAKES IT A SALE ===');
  const confirmed = await call('POST', `/orders/held/${ID}/confirm`, T, { payment_method: 'Card' });
  console.log(`   ${confirmed.status} -> order ${confirmed.body.order_no}, was ${confirmed.body.ticket_no}, paid by ${confirmed.body.payment_method}`);
  ok('the ticket becomes an order', confirmed.status === 201 && Number(confirmed.body.id) > 0);
  ok('with a real order number', Boolean(confirmed.body.order_no));
  ok('at the edited figures, not the original', confirmed.body.total === 2650);
  ok('with the payment chosen at confirmation', confirmed.body.payment_method === 'Card');

  const gone = await call('GET', `/orders/held/${ID}`, T);
  ok('and it is off the board', gone.status === 404);

  const ordersAfter = db.prepare("SELECT COUNT(*) n FROM orders").get().n;
  ok('one row was written to orders', ordersAfter === ordersBefore + 1);

  const lines = db.prepare('SELECT COUNT(*) n FROM order_items WHERE order_id = ?').get(confirmed.body.id).n;
  ok('with the edited lines, not the original ones', lines === 2);

  const shiftAfter = await call('GET', '/shifts/current', T);
  ok('the shift now counts it', Number(shiftAfter.body.total_orders) === 1);
  ok('as card, not cash, so the drawer is untouched', Number(shiftAfter.body.cash_revenue) === 0);

  const kpiAfter = await call('GET', `/reports/kpi?from=${today}&to=${today}`, T);
  ok('the day’s revenue now includes it', Number(kpiAfter.body.total_revenue) === 2650);

  const queued = db.prepare("SELECT sync_state FROM orders WHERE id = ?").get(confirmed.body.id).sync_state;
  ok('and it is queued for the cloud', queued === 'pending');

  const twice = await call('POST', `/orders/held/${ID}/confirm`, T, {});
  ok('it cannot be confirmed a second time', twice.status === 404);

  console.log();
  console.log('=== A TICKET CAN BE CANCELLED ===');
  const second = await call('POST', '/orders/hold', T, ticket);
  const cancel = await call('DELETE', `/orders/held/${second.body.id}`, T);
  ok('cancelling removes it', cancel.status === 200);
  ok('and writes no sale', db.prepare("SELECT COUNT(*) n FROM orders").get().n === ordersBefore + 1);

  console.log();
  console.log('=== A DIRECT SALE STILL WORKS AS BEFORE ===');
  const direct = await call('POST', '/orders', T, ticket);
  ok('paid-and-done in one step', direct.status === 201 && direct.body.total === 1450 && Boolean(direct.body.order_no));
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
 }
})();
