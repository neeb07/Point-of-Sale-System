/**
 * Clearing the trading history from the dashboard.
 *
 *   cd cloud
 *   DATABASE_URL=... node test/reset.js
 *
 * This one is different from the others: it cannot use a throwaway branch,
 * because the reset is global by definition. So it runs against a database it
 * first fills with its own recognisable rows, and asserts on THOSE rows only —
 * and it will not run at all against a database that already holds real
 * trading data, because it would delete it.
 *
 *   BLAZE_ALLOW_DESTRUCTIVE=1 lifts that guard. See test/guard.js.
 *
 * The properties that matter, in order of how expensive they would be to get
 * wrong: the reset refuses to run without a fresh export; it refuses the wrong
 * password; it clears exactly the trading tables; and it leaves the menu, the
 * stock, the staff, the payroll and the backups untouched.
 */
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ok = (l, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l);

const CLOUD_ROOT = path.join(__dirname, '..');
const PORT = 4391;
const CLOUD = `http://127.0.0.1:${PORT}/api`;
const BRANCH = 9010;
const EMAIL = `reset-test-${crypto.randomBytes(4).toString('hex')}@blaze.test`;
const PASSWORD = crypto.randomBytes(18).toString('hex');

const env = { ...process.env, PORT: String(PORT) };
delete env.ELECTRON_RUN_AS_NODE;

function exec(js) {
  const r = spawnSync('node', ['-e', js], { cwd: CLOUD_ROOT, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('exec failed: ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}

let cookie = null;
async function api(method, p, { body, raw } = {}) {
  const headers = {};
  if (!raw) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const r = await fetch(CLOUD + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (raw) return { status: r.status, headers: r.headers, text: await r.text() };
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function waitFor(url, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

let proc = null;

(async () => {
 try {
  // The guard: a populated database is somebody's shop.
  const populated = exec(`
    const db = require('./db/pg');
    (async () => {
      const r = await db.one("SELECT (SELECT COUNT(*) FROM orders WHERE branch_id < 9000)::int AS n");
      console.log(r.n);
      await db.close();
    })().catch(e => { console.error(e.message); process.exit(1); });
  `);
  if (Number(populated) > 0 && process.env.BLAZE_ALLOW_DESTRUCTIVE !== '1') {
    console.log(`REFUSING: this database holds ${populated} real orders and the reset is global.`);
    console.log('Point DATABASE_URL at a scratch project, or set BLAZE_ALLOW_DESTRUCTIVE=1.');
    process.exit(2);
  }

  exec(`
    const db = require('./db/pg');
    const { createSchema } = require('./db/schema');
    const bcrypt = require('bcryptjs');
    const { generateKey, hashKey } = require('./db/keys');
    (async () => {
      await createSchema(db);
      await db.run('INSERT INTO branches (id, name, api_key_hash) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET active = 1',
        [${BRANCH}, 'Reset Test', hashKey(generateKey())]);
      await db.run('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING',
        ['${EMAIL}', await bcrypt.hash('${PASSWORD}', 10), 'Reset Test', 'owner']);
      // Trading rows that should go.
      await db.run('INSERT INTO orders (branch_id, local_id, total, status, created_at, received_at) VALUES (?, 1, 500, ?, ?, ?)',
        [${BRANCH}, 'completed', '2026-09-01 12:00:00', Date.now()]);
      const o = await db.one('SELECT id FROM orders WHERE branch_id = ? AND local_id = 1', [${BRANCH}]);
      await db.run('INSERT INTO order_items (order_id, name, price, quantity) VALUES (?, ?, ?, ?)', [o.id, 'Zinger', 500, 1]);
      await db.run('INSERT INTO shifts (branch_id, local_id, staff_name, status, received_at) VALUES (?, 1, ?, ?, ?)', [${BRANCH}, 'Tester', 'closed', Date.now()]);
      await db.run('INSERT INTO expenses (branch_id, local_id, amount, category, received_at) VALUES (?, 1, 90, ?, ?)', [${BRANCH}, 'Fuel', Date.now()]);
      await db.run('INSERT INTO customers (branch_id, local_id, name, phone, received_at) VALUES (?, 1, ?, ?, ?)', [${BRANCH}, 'Reset Customer', '0300', Date.now()]);
      // Rows that must survive.
      await db.run('INSERT INTO staff (branch_id, local_id, name, role, active, origin, received_at) VALUES (?, 1, ?, ?, 1, ?, ?) ON CONFLICT (branch_id, local_id) DO NOTHING',
        [${BRANCH}, 'Keeper', 'Manager', 'branch', Date.now()]);
      await db.run('INSERT INTO ingredients (branch_id, local_id, name, stock, received_at) VALUES (?, 1, ?, 42, ?) ON CONFLICT (branch_id, local_id) DO NOTHING',
        [${BRANCH}, 'Reset Cheese', Date.now()]);
      await db.run('INSERT INTO employees (branch_id, name, monthly_salary) VALUES (?, ?, 1000)', [${BRANCH}, 'Reset Rider']);
      await db.close();
    })().catch(e => { console.error(e.message); process.exit(1); });
  `);

  proc = spawn('node', ['server.js'], { cwd: CLOUD_ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
  if (!await waitFor(`${CLOUD}/health`)) { console.log('cloud would not start'); process.exit(1); }

  const login = await api('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200) { console.log('sign-in failed'); process.exit(1); }

  const count = async (t) => Number(exec(`
    const db = require('./db/pg');
    (async () => { const r = await db.one('SELECT COUNT(*)::int AS n FROM ${t}'); console.log(r.n); await db.close(); })();
  `));
  const menuBefore = await count('menu_items');
  const stockBefore = await count('ingredients');
  const staffBefore = await count('staff');
  const payrollBefore = await count('employees');
  const backupsBefore = await count('branch_backups');

  console.log('=== THE PREVIEW SAYS WHAT WOULD GO ===');
  const preview = await api('GET', '/admin/reset/preview');
  console.log(`   ${JSON.stringify(preview.body.counts)}`);
  ok('it lists the trading tables', Array.isArray(preview.body.cleared) && preview.body.cleared.includes('orders'));
  ok('and not the menu or stock', !preview.body.cleared.includes('menu_items') && !preview.body.cleared.includes('ingredients'));
  ok('with live counts', preview.body.counts.orders >= 1);

  console.log();
  console.log('=== NOTHING RUNS WITHOUT A BACKUP FIRST ===');
  const eager = await api('POST', '/admin/reset', { body: { password: PASSWORD } });
  console.log(`   reset with no export -> ${eager.status} ${eager.body.code || ''}`);
  ok('a reset without an export is refused', eager.status === 409 && eager.body.code === 'EXPORT_REQUIRED');
  ok('and nothing was deleted', (await count('orders')) >= 1);

  console.log();
  console.log('=== THE BACKUP IS COMPLETE AND READABLE ===');
  const exp = await api('GET', '/admin/export', { raw: true });
  const token = exp.headers.get('x-export-token');
  ok('the export downloads', exp.status === 200 && Boolean(token));
  ok('as a file', /attachment; filename="blaze-trading-history-.*\.json"/.test(exp.headers.get('content-disposition') || ''));
  const parsed = JSON.parse(exp.text);
  ok('it is plain JSON a person could open', parsed && parsed.tables && Array.isArray(parsed.tables.orders));
  ok('holding the rows about to be deleted',
     parsed.tables.orders.some(o => o.branch_id === BRANCH) &&
     parsed.tables.customers.some(c => c.name === 'Reset Customer'));
  ok('and naming the branches so ids can be read', parsed.branches.some(b => b.id === BRANCH));

  console.log();
  console.log('=== THE WRONG PASSWORD DOES NOTHING ===');
  const wrong = await api('POST', '/admin/reset', { body: { password: 'not-it', export_token: token } });
  console.log(`   -> ${wrong.status} ${wrong.body.code || ''}`);
  ok('a wrong password is refused', wrong.status === 403 && wrong.body.code === 'BAD_PASSWORD');
  ok('and nothing was deleted', (await count('orders')) >= 1);

  console.log();
  console.log('=== THE RIGHT PASSWORD, AFTER A BACKUP, CLEARS IT ===');
  const done = await api('POST', '/admin/reset', { body: { password: PASSWORD, export_token: token } });
  console.log(`   -> ${done.status} deleted ${JSON.stringify(done.body.deleted)}`);
  ok('the reset runs', done.status === 200 && done.body.success === true);
  ok('orders are gone', (await count('orders')) === 0);
  ok('and their lines', (await count('order_items')) === 0);
  ok('and shifts', (await count('shifts')) === 0);
  ok('and expenses', (await count('expenses')) === 0);
  ok('and the customer book', (await count('customers')) === 0);

  console.log();
  console.log('=== AND LEAVES THE BUSINESS ITSELF ALONE ===');
  ok('the menu is untouched', (await count('menu_items')) === menuBefore);
  ok('the stock is untouched', (await count('ingredients')) === stockBefore);
  ok('the staff are untouched', (await count('staff')) === staffBefore);
  ok('the payroll is untouched', (await count('employees')) === payrollBefore);
  ok('the backups are untouched', (await count('branch_backups')) === backupsBefore);
  ok('and the owner can still sign in', (await api('GET', '/auth/me')).status === 200);

  console.log();
  console.log('=== A SECOND RESET NEEDS A SECOND BACKUP ===');
  const reuse = await api('POST', '/admin/reset', { body: { password: PASSWORD, export_token: token } });
  ok('the export token is spent', reuse.status === 409);
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try {
    exec([
      "const db = require('./db/pg');",
      '(async () => {',
      `  for (const t of ['employees','staff','ingredients','order_items','orders','shifts','expenses','customers','live_status','sync_cursor','branch_backups','pairing_codes','staff_deletions']) {`,
      `    try { await db.run('DELETE FROM ' + t + ' WHERE branch_id = ?', [${BRANCH}]); } catch (e) {}`,
      '  }',
      `  await db.run('DELETE FROM branches WHERE id = ?', [${BRANCH}]);`,
      `  await db.run('DELETE FROM users WHERE email = ?', ['${EMAIL}']);`,
      '  await db.close();',
      "})().catch(e => { console.error(e.message); process.exit(1); });",
    ].join('\n'));
    console.log('\n(test branch and login removed)');
  } catch (e) {
    console.error('\nCOULD NOT CLEAN UP:', e.message);
  }
  if (proc) { try { proc.kill(); } catch (e) {} }
  process.exit(0);
 }
})();
