/**
 * Closing a drawer somebody else left open.
 *
 *   cd backend
 *   node scripts/run-script.js test/shift-close-guard.js
 *
 * Runs against a throwaway copy of the database. No cloud, no network.
 *
 * The POS now refuses to close while any shift is open. That refusal is only
 * safe if every open shift can actually be closed by somebody who is standing
 * there — and until this change none could be, once its owner had gone home:
 * the close route resolved the shift from the session, so it only ever found
 * your own, administrator or not. A forgotten drawer would have left the till
 * unable to close with nobody able to do anything about it.
 *
 * So this checks the escape route as carefully as the rule.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');

const ok = (l, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l);

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-shiftguard-'));
fs.copyFileSync(path.join(ROOT, 'pos_database.db'), path.join(dir, 'pos_database.db'));

process.env.POS_USER_DATA_PATH = dir;
process.env.PORT = '3392';
const API = 'http://127.0.0.1:3392/api';

async function call(method, p, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + p, {
    method, headers, body: body ? JSON.stringify(body) : undefined });
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

  const PIN = '7731';
  const manager = db.prepare("SELECT id, name FROM staff WHERE role = 'Manager' AND active = 1 ORDER BY id LIMIT 1").get();
  db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(bcrypt.hashSync(PIN, 10), manager.id);

  const M = (await call('POST', '/staff/login', null, { pin: PIN, staff_id: manager.id })).body.token;
  const A = (await call('POST', '/staff/login', null, { pin: '1234', staff_id: 1 })).body.token;
  if (!M || !A) { console.log('could not sign in'); process.exit(1); }

  console.log('=== WHAT THE APP ASKS BEFORE IT CLOSES ===');
  // Deliberately unauthenticated: the Electron main process has no session and
  // no way to obtain one.
  const quiet = await (await fetch(`${API}/shifts/open-count`)).json();
  console.log(`   ${quiet.open} open`);
  ok('with nothing open, the count is zero', quiet.open === 0);
  ok('and it answers without a session', Array.isArray(quiet.shifts));

  await call('POST', '/shifts/open', M, { opening_cash: 2000 });
  const busy = await (await fetch(`${API}/shifts/open-count`)).json();
  console.log(`   ${busy.open} open: ${busy.shifts.map(s => s.staff_name).join(', ')}`);
  ok('an open drawer is reported', busy.open === 1);
  // The refusal has to be able to say whose drawer it is, or somebody at the
  // end of a shift is left guessing.
  ok('and named, so the dialog can say whose', busy.shifts[0].staff_name === manager.name);
  ok('with no takings in it', busy.shifts[0].total_revenue === undefined);

  console.log();
  console.log('=== A DRAWER SOMEBODY ELSE LEFT OPEN ===');
  const theirs = busy.shifts[0].id;

  // The trap this whole route exists for: the manager has gone home and
  // somebody else is signed in.
  const ownClose = await call('POST', '/shifts/close', A, { closing_cash: 2000 });
  console.log(`   admin closing via /close -> ${ownClose.status} ${ownClose.body.error || ''}`);
  ok('the ordinary close still only closes your own', ownClose.status === 404);

  const stillOpen = await (await fetch(`${API}/shifts/open-count`)).json();
  ok('so that drawer is still open', stillOpen.open === 1);

  const byId = await call('POST', `/shifts/${theirs}/close`, A, { closing_cash: 1800 });
  console.log(`   admin closing by id -> ${byId.status}, variance ${byId.body.variance}`);
  ok('an administrator can close it by number', byId.status === 200);
  ok('the variance is recorded', byId.body.variance === -200);
  // Whose shift it was does not change because somebody else pressed the
  // button — the takings still belong to the person who took them.
  ok('and it stays their shift', byId.body.staff_id === manager.id);

  const after = await (await fetch(`${API}/shifts/open-count`)).json();
  ok('nothing is left open, so the app can close', after.open === 0);

  console.log();
  console.log('=== ONLY AN ADMINISTRATOR ===');
  await call('POST', '/shifts/open', A, { opening_cash: 500 });
  const adminShift = (await (await fetch(`${API}/shifts/open-count`)).json()).shifts[0];
  const refused = await call('POST', `/shifts/${adminShift.id}/close`, M, { closing_cash: 500 });
  console.log(`   manager closing the owner's drawer -> ${refused.status}`);
  ok('a manager cannot close somebody else by number', refused.status === 403);

  const nonsense = await call('POST', '/shifts/999999/close', A, { closing_cash: 0 });
  ok('and a shift that is not open is refused', nonsense.status === 404);
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
 }
})();
