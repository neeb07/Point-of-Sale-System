/**
 * Clearing the till's trading history, and what it must refuse.
 *
 *   cd backend
 *   node scripts/run-script.js test/till-reset.js
 *
 * Runs against a throwaway copy of the database. No cloud, no network — the
 * copy is unpaired, so nothing can be pushed and every sale counts as unsent,
 * which is the case the reset must be most careful about.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

let failures = 0;
const ok = (l, c) => { if (!c) failures += 1; console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l); };

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-reset-'));
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
  // Unpaired: nothing can be sent, so everything pending stays pending.
  db.prepare("DELETE FROM settings WHERE key IN ('cloud_url', 'cloud_api_key', 'branch_id')").run();
  db.prepare("UPDATE shifts SET status = 'closed', closed_at = datetime('now','localtime') WHERE status = 'open'").run();

  const PIN = '4488', WRONG = '0000';
  const admin = db.prepare("SELECT id FROM staff WHERE role IN ('Admin','Administrator','Owner') AND active = 1 ORDER BY id LIMIT 1").get();
  const manager = db.prepare("SELECT id FROM staff WHERE role = 'Manager' AND active = 1 ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(bcrypt.hashSync(PIN, 10), admin.id);
  db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(bcrypt.hashSync(PIN, 10), manager.id);
  const A = (await call('POST', '/staff/login', null, { pin: PIN, staff_id: admin.id })).body.token;
  const M = (await call('POST', '/staff/login', null, { pin: PIN, staff_id: manager.id })).body.token;

  const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  const before = {
    orders: count('orders'), items: count('order_items'), menu: count('menu_items'),
    staff: count('staff'), ingredients: count('ingredients'), settings: count('settings'),
  };
  const lastOrderId = db.prepare('SELECT MAX(id) m FROM orders').get().m || 0;
  console.log(`   starting with ${before.orders} orders, ${before.menu} menu items, ${before.staff} staff`);
  ok('there is something to delete', before.orders > 0);

  console.log();
  console.log('=== WHO MAY, AND WITH WHAT ===');
  ok('a manager without a PIN is refused', (await call('POST', '/settings/reset', M, {})).status === 400);
  const mWrong = await call('POST', '/settings/reset', M, { pin: WRONG });
  ok('a manager with the wrong PIN is refused', mWrong.status === 403 && mWrong.body.code === 'WRONG_PIN');
  ok('the owner without a PIN is refused', (await call('POST', '/settings/reset', A, {})).status === 400);
  const wrong = await call('POST', '/settings/reset', A, { pin: WRONG });
  ok('the owner with the wrong PIN is refused', wrong.status === 403 && wrong.body.code === 'WRONG_PIN');
  ok('and nothing was deleted', count('orders') === before.orders);

  console.log();
  console.log('=== NOT WHILE A DRAWER IS OPEN ===');
  db.prepare("INSERT INTO shifts (staff_id, opening_cash, status, opened_at) VALUES (?, 1000, 'open', datetime('now','localtime'))").run(admin.id);
  const open = await call('POST', '/settings/reset', A, { pin: PIN });
  ok('refused with the reason', open.status === 409 && open.body.code === 'SHIFT_OPEN');
  db.prepare("UPDATE shifts SET status = 'closed', closed_at = datetime('now','localtime') WHERE status = 'open'").run();

  console.log();
  console.log('=== NOT WHILE SALES ARE UNSENT ===');
  db.prepare("UPDATE orders SET sync_state = 'pending'").run();
  const unsent = await call('POST', '/settings/reset', A, { pin: PIN });
  ok('refused, naming how many', unsent.status === 409 && unsent.body.code === 'UNSYNCED' && unsent.body.pending.orders === before.orders);
  ok('and nothing was deleted', count('orders') === before.orders);

  console.log();
  console.log('=== FORCED THROUGH, BY THE MANAGER ===');
  const backupDir = path.join(dir, 'backups');
  const preResets = () => (fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(f => /^pre_reset_/.test(f)) : []);
  const backupsBefore = preResets().length;
  const done = await call('POST', '/settings/reset', M, { pin: PIN, force: true });
  ok('succeeds', done.status === 200 && done.body.success === true);
  ok('reports what it deleted', done.body.deleted && done.body.deleted.orders === before.orders);
  ok('and what it discarded unsent (orders, plus any pending shifts and expenses)', done.body.unsent_discarded >= before.orders);
  ok('orders are gone', count('orders') === 0 && count('order_items') === 0);
  ok('so are shifts, expenses, held tickets and customers',
     count('shifts') === 0 && count('expenses') === 0 && count('held_orders') === 0 && count('customers') === 0);
  ok('the menu is untouched', count('menu_items') === before.menu);
  ok('the staff are untouched', count('staff') === before.staff);
  ok('inventory is untouched', count('ingredients') === before.ingredients);
  ok('settings are untouched', count('settings') === before.settings);

  const copies = preResets();
  ok('a copy was saved first', copies.length === backupsBefore + 1 && done.body.safety_copy === copies[copies.length - 1]);
  const Database = require('better-sqlite3');
  const copy = new Database(path.join(backupDir, copies[copies.length - 1]), { readonly: true });
  ok('and it still holds every order', copy.prepare('SELECT COUNT(*) n FROM orders').get().n === before.orders);
  copy.close();

  console.log();
  console.log('=== ORDER NUMBERS CARRY ON ===');
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get();
  ok('the next order id is above the last one deleted', Boolean(seq) && seq.seq >= lastOrderId);
  ok('the till still answers', (await call('GET', '/settings', A)).status === 200);
  ok('and the owner is still signed in', (await call('GET', '/staff', A)).status === 200);

  console.log();
  console.log(failures ? failures + ' FAILED' : 'all passed');
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
 }
})();
