/**
 * What a manager can reach on the till, and what is still the owner's.
 *
 *   cd backend
 *   node scripts/run-script.js test/manager-access.js
 *
 * Runs entirely against a throwaway copy of the database. No cloud, no network.
 *
 * The owner is never in the shop — that is the premise of the whole dashboard —
 * so anything that can only be done by somebody standing at the machine has to
 * be a manager's job. That is one half of this file.
 *
 * The other half is the part that is easy to get wrong while doing the first:
 * a manager still sees only their own expenses, shifts and figures. Widening
 * access is one careless `isAdminRole` away from undoing that, so both halves
 * are asserted together.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const ok = (l, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l);

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-access-'));
fs.copyFileSync(path.join(ROOT, 'pos_database.db'), path.join(dir, 'pos_database.db'));

process.env.POS_USER_DATA_PATH = dir;
process.env.PORT = '3391';
const API = 'http://127.0.0.1:3391/api';

async function call(method, p, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + p, {
    method, headers, body: body ? JSON.stringify(body) : undefined });
  let payload = null;
  const type = r.headers.get('content-type') || '';
  if (type.includes('json')) payload = await r.json().catch(() => ({}));
  return { status: r.status, body: payload || {} };
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

  // A manager with a PIN this test knows, so it can hold a real session rather
  // than assert on the guard in isolation.
  const PIN = '4318';
  db.prepare("UPDATE staff SET pin = ? WHERE role = 'Manager' AND active = 1 AND id = (SELECT MIN(id) FROM staff WHERE role = 'Manager' AND active = 1)")
    .run(bcrypt.hashSync(PIN, 10));
  const manager = db.prepare("SELECT id, name FROM staff WHERE role = 'Manager' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!manager) { console.log('no manager account to test with'); process.exit(1); }

  const M = (await call('POST', '/staff/login', null, { pin: PIN, staff_id: manager.id })).body.token;
  const A = (await call('POST', '/staff/login', null, { pin: '1234', staff_id: 1 })).body.token;
  if (!M || !A) { console.log('could not sign in'); process.exit(1); }
  console.log(`signed in as ${manager.name} (manager) and Admin\n`);

  console.log('=== THE MANAGER CAN SET THE MACHINE UP ===');
  const status = await call('GET', '/sync/status', M);
  ok('they can see whether this till is paired', status.status === 200);
  ok('and it still never returns the key',
     JSON.stringify(status.body).indexOf('api_key') === -1);

  // Reaching the route is the point; a made-up code is expected to be refused
  // by the cloud, not by the role check.
  const pair = await call('POST', '/sync/pair', M, { cloud_url: 'not-a-url', code: 'AAAA-AAAA' });
  ok('they can reach pairing', pair.status !== 403);
  ok('and bad input is what stops them, not their role', pair.status === 400);

  console.log();
  console.log('=== AND RESTORE A BACKUP ===');
  // Refused for the right reason — no file — rather than for the wrong one.
  const restore = await call('POST', '/settings/restore', M, {});
  ok('restore is not blocked by role', restore.status !== 403);
  ok('it asks for a file instead', restore.status === 400);

  console.log();
  console.log('=== BUT NOT WALK OFF WITH THE DATABASE ===');
  const download = await call('GET', '/backup', M);
  console.log(`   manager -> ${download.status}, admin -> ${(await call('GET', '/backup', A)).status}`);
  // The file holds every customer's address and every manager's expenses, so
  // handing it over would undo the isolation below in a single click.
  ok("downloading the whole database is still the owner's", download.status === 403);

  console.log();
  console.log('=== THE STAFF LIST IS VISIBLE, NOT EDITABLE ===');
  const list = await call('GET', '/staff', M);
  ok('a manager can see who is set up here', list.status === 200 && Array.isArray(list.body));
  ok('with no PIN hash in it', JSON.stringify(list.body).indexOf('$2') === -1);

  const create = await call('POST', '/staff', M, { name: 'Nope', pin: '9999', role: 'Manager' });
  const edit = await call('PUT', `/staff/${manager.id}`, M, { name: 'Renamed' });
  const remove = await call('DELETE', `/staff/${manager.id}`, M);
  ok('they cannot add anybody', create.status === 403);
  ok('cannot edit anybody', edit.status === 403);
  ok('and cannot remove anybody', remove.status === 403);

  const perf = await call('GET', '/staff/performance', M);
  ok("and cannot see every cashier's takings side by side", perf.status === 403);

  console.log();
  console.log('=== WHAT STAYS PRIVATE, STAYS PRIVATE ===');
  /*
   * The rule that widening access is most likely to break by accident. It was
   * asked for explicitly: one manager's spending is not another's business.
   */
  // Two real expenses, one recorded by each, so the check has something to
  // fail on. Asserting isolation against an empty list proves nothing.
  await call('POST', '/expenses', A, {
    category: 'Utilities', description: 'Owner electricity bill', amount: 4000, from_drawer: 0 });
  await call('POST', '/expenses', M, {
    category: 'Staff Meal', description: 'Manager lunch run', amount: 900, from_drawer: 1 });

  const rowsOf = (r) => (Array.isArray(r.body) ? r.body : (r.body && r.body.expenses) || []);
  const mine = rowsOf(await call('GET', '/expenses', M));
  const all = rowsOf(await call('GET', '/expenses', A));
  console.log(`   expenses visible today: manager ${mine.length}, admin ${all.length}`);

  ok('the owner sees both', all.length >= 2);
  ok('the manager sees fewer', mine.length < all.length);
  ok('and only their own', mine.length > 0
     && mine.every(e => Number(e.staff_id) === Number(manager.id)));
  ok('never the owner’s spending',
     !mine.some(e => /electricity/i.test(e.description || '')));

  console.log();
  console.log("=== THE SHOP'S OWN SETTINGS ARE STILL THE OWNER'S ===");
  const price = await call('PUT', '/settings', M, { tax_rate: '99' });
  const paper = await call('PUT', '/settings', M, { paper_size: '80mm' });
  ok('a manager cannot change the tax rate', price.status === 403);
  ok('but can still change their own printer', paper.status === 200);

  const wa = await call('POST', '/whatsapp/send-daily', M, {});
  ok("and cannot send the day's figures out of the building", wa.status === 403);
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
 }
})();
