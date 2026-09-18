/**
 * Takeaway, and a delivery charge decided per order.
 *
 *   cd backend
 *   node scripts/run-script.js test/order-types.js
 *
 * Runs against a throwaway copy of the database. No cloud, no network.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

let failures = 0;
const ok = (l, c) => { if (!c) failures += 1; console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l); };

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-types-'));
fs.copyFileSync(path.join(ROOT, 'pos_database.db'), path.join(dir, 'pos_database.db'));

process.env.POS_USER_DATA_PATH = dir;
process.env.PORT = '3395';
const API = 'http://127.0.0.1:3395/api';

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
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('delivery_price', '150'), ('tax_rate', '0')").run();

  const PIN = '5151';
  const manager = db.prepare("SELECT id FROM staff WHERE role = 'Manager' AND active = 1 ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(bcrypt.hashSync(PIN, 10), manager.id);
  const M = (await call('POST', '/staff/login', null, { pin: PIN, staff_id: manager.id })).body.token;
  await call('POST', '/shifts/open', M, { opening_cash: 1000 });

  const item = db.prepare('SELECT id, name, price FROM menu_items WHERE price > 0 ORDER BY id LIMIT 1').get();
  const items = [{ id: item.id, name: item.name, price: item.price, quantity: 1 }];
  const price = Number(item.price);

  console.log('=== TAKEAWAY IS AN ORDER TYPE ===');
  const take = await call('POST', '/orders', M, { items, order_type: 'Takeaway', payment_method: 'Cash' });
  ok('accepted', take.status === 200 || take.status === 201);
  const takeRow = db.prepare('SELECT order_type, delivery_charge, total FROM orders WHERE id = ?').get(take.body.id);
  ok('filed as Takeaway', takeRow && takeRow.order_type === 'Takeaway');
  ok('with no delivery charge', takeRow && Number(takeRow.delivery_charge) === 0 && Number(takeRow.total) === price);

  console.log();
  console.log('=== THE DELIVERY CHARGE IS DECIDED PER ORDER ===');
  const far = await call('POST', '/orders', M, { items, order_type: 'Delivery', delivery_charge: 400, payment_method: 'Cash',
    customer_name: 'Far Away', customer_phone: '0300', customer_address: 'Other side of town' });
  const farRow = db.prepare('SELECT delivery_charge, total FROM orders WHERE id = ?').get(far.body.id);
  ok('a longer ride charges what the manager typed', farRow && Number(farRow.delivery_charge) === 400 && Number(farRow.total) === price + 400);

  const free = await call('POST', '/orders', M, { items, order_type: 'Delivery', delivery_charge: 0, payment_method: 'Cash' });
  const freeRow = db.prepare('SELECT delivery_charge, total FROM orders WHERE id = ?').get(free.body.id);
  ok('a regular can be charged nothing', freeRow && Number(freeRow.delivery_charge) === 0 && Number(freeRow.total) === price);

  const neg = await call('POST', '/orders', M, { items, order_type: 'Delivery', delivery_charge: -50, payment_method: 'Cash' });
  const negRow = db.prepare('SELECT delivery_charge FROM orders WHERE id = ?').get(neg.body.id);
  ok('but never less than nothing', negRow && Number(negRow.delivery_charge) === 0);

  const dine = await call('POST', '/orders', M, { items, order_type: 'Dine-in', delivery_charge: 200, payment_method: 'Cash' });
  const dineRow = db.prepare('SELECT delivery_charge, total FROM orders WHERE id = ?').get(dine.body.id);
  ok('and a dine-in order cannot carry one at all', dineRow && Number(dineRow.delivery_charge) === 0 && Number(dineRow.total) === price);

  const odd = await call('POST', '/orders', M, { items, order_type: 'Drive-thru', payment_method: 'Cash' });
  const oddRow = db.prepare('SELECT order_type FROM orders WHERE id = ?').get(odd.body.id);
  ok('an order type the till does not know is filed as dine-in', oddRow && oddRow.order_type === 'Dine-in');

  console.log();
  console.log('=== HELD TICKETS KEEP THE TYPE AND THE CHARGE ===');
  const held = await call('POST', '/orders/hold', M, { items, order_type: 'Delivery', delivery_charge: 250, payment_method: 'Cash' });
  ok('held', held.status === 200 || held.status === 201);
  const ticket = (await call('GET', `/orders/held/${held.body.id}`, M)).body;
  ok('the ticket says Delivery and 250', ticket.order_type === 'Delivery' && Number(ticket.delivery_charge) === 250);
  const confirmed = await call('POST', `/orders/held/${held.body.id}/confirm`, M, {});
  ok('and confirms at 250', (confirmed.status === 200 || confirmed.status === 201) && Number(confirmed.body.delivery_charge) === 250);

  console.log();
  console.log('=== A DEAL LISTS WHAT IS INSIDE IT ===');
  const deal = db.prepare('SELECT d.id, d.name, d.price FROM deals d WHERE EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id) ORDER BY d.id LIMIT 1').get();
  if (deal) {
    const sold = await call('POST', '/orders', M, { items: [{ id: deal.id, name: deal.name, price: deal.price, quantity: 1, is_deal: true }], order_type: 'Takeaway', payment_method: 'Cash' });
    const line = (sold.body.items || [])[0] || {};
    ok('the sale describes the deal with its contents', Array.isArray(line.contents) && line.contents.length > 0 && line.contents.every(c => c.name && c.quantity >= 1));
    const again = (await call('GET', `/orders/${sold.body.id}`, M)).body;
    ok('and so does the order when fetched again for a reprint', Array.isArray((again.items || [])[0]?.contents) && again.items[0].contents.length === line.contents.length);
    console.log('   ' + deal.name + ': ' + line.contents.map(c => `${c.quantity}x ${c.name}`).join(', '));
  } else {
    console.log('   (no deal with items in this database — skipped)');
  }

  // A deal with a pizza in it is priced against one pizza but sold with the
  // flavour the customer picks; the receipt must show the flavour, never the
  // pizza the deal happened to be built with.
  const pizzaDeal = db.prepare(`
    SELECT d.id, d.name, d.price, mi.name AS placeholder, iv.label AS size
      FROM deals d JOIN deal_items di ON di.deal_id = d.id
      JOIN menu_items mi ON mi.id = di.menu_item_id
      LEFT JOIN item_variants iv ON iv.id = di.variant_id
     WHERE mi.category LIKE '%Pizza%' ORDER BY d.id LIMIT 1`).get();
  if (pizzaDeal) {
    const soldAs = `${pizzaDeal.name} (Vegetable Pizza)`;
    const r = await call('POST', '/orders', M, { items: [{ id: pizzaDeal.id, name: soldAs, price: pizzaDeal.price, quantity: 1, is_deal: true }], order_type: 'Dine-in', payment_method: 'Cash' });
    const names = ((r.body.items || [])[0]?.contents || []).map(c => c.name);
    console.log('   ' + soldAs + ': ' + names.join(', '));
    ok('the chosen flavour is listed with the size', names.some(n => n.startsWith('Vegetable Pizza') && (!pizzaDeal.size || n.includes(pizzaDeal.size))));
    ok('and the placeholder pizza is not', !names.some(n => n.startsWith(pizzaDeal.placeholder)));
  }

  console.log();
  console.log('=== THE REPORT SPLITS THEM ===');
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const kpi = (await call('GET', `/reports/kpi?from=${today}&to=${today}`, M)).body;
  const byType = Object.fromEntries((kpi.by_type || []).map(r => [r.order_type, r]));
  ok('reports takeaway', byType.Takeaway && byType.Takeaway.orders >= 1);
  ok('reports delivery with the charges taken', byType.Delivery && byType.Delivery.orders >= 4 && Number(byType.Delivery.delivery_charges) >= 650);
  ok('and dine-in', byType['Dine-in'] && byType['Dine-in'].orders >= 2);
  const sum = (kpi.by_type || []).reduce((a, r) => a + Number(r.orders), 0);
  ok('the three add up to every order', sum === kpi.total_orders);

  console.log();
  console.log(failures ? failures + ' FAILED' : 'all passed');
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
 }
})();
