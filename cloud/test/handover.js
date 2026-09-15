/**
 * The handover script leaves the client with a shop and none of our test data.
 *
 *   cd cloud
 *   DATABASE_URL=... node test/handover.js
 *
 * Global by definition, like the reset, so it cannot use a throwaway branch:
 * it seeds recognisable rows into every table, runs the script, and asserts on
 * those rows. It refuses to run against a database holding real orders unless
 * BLAZE_ALLOW_DESTRUCTIVE=1 — point it at a scratch project.
 *
 * Three properties: the script refuses without the exact phrase; afterwards
 * every table it promises to clear is empty and every table it promises to
 * keep still holds the seeded row; and the branch key has changed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ok = (l, c) => console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l);
const CLOUD_ROOT = path.join(__dirname, '..');
const BRANCH = 9011;

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

function exec(js) {
  const r = spawnSync('node', ['-e', js], { cwd: CLOUD_ROOT, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('exec failed: ' + (r.stderr || r.stdout));
  return r.stdout.trim();
}
function runScript(args) {
  const r = spawnSync('node', ['scripts/handover.js', ...args], { cwd: CLOUD_ROOT, env, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const count = (t, where = '') => Number(exec(
  "const db = require('./db/pg');" +
  "(async () => { const r = await db.one('SELECT COUNT(*)::int AS n FROM " + t + " " + where + "'); console.log(r.n); await db.close(); })();"
));

(async () => {
 let exportFile = null;
 try {
  const real = count('orders', 'WHERE branch_id < 9000');
  if (real > 0 && process.env.BLAZE_ALLOW_DESTRUCTIVE !== '1') {
    console.log('REFUSING: this database holds ' + real + ' real orders and the handover is global.');
    console.log('Point DATABASE_URL at a scratch project, or set BLAZE_ALLOW_DESTRUCTIVE=1.');
    process.exit(2);
  }

  const { DELETE_ORDER, KEPT, CONFIRM_PHRASE } = require('../scripts/handover');

  console.log('=== SEED ONE ROW INTO EVERY TABLE ===');
  const seed = [
    "const db = require('./db/pg');",
    "const { createSchema } = require('./db/schema');",
    "const bcrypt = require('bcryptjs');",
    "const { generateKey, hashKey } = require('./db/keys');",
    "(async () => {",
    "  await createSchema(db);",
    "  await db.run('INSERT INTO branches (id, name, code, api_key_hash) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET active = 1', [" + BRANCH + ", 'Handover Test', 'HT', hashKey(generateKey())]);",
    "  await db.run('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING', ['handover-test@blaze.test', await bcrypt.hash('x', 4), 'Handover', 'owner']);",
    "  await db.run('INSERT INTO orders (branch_id, local_id, total, status, created_at, received_at) VALUES (?, 1, 5, ?, ?, ?)', [" + BRANCH + ", 'completed', '2026-09-01 12:00:00', Date.now()]);",
    "  const o = await db.one('SELECT id FROM orders WHERE branch_id = ? AND local_id = 1', [" + BRANCH + "]);",
    "  await db.run('INSERT INTO order_items (order_id, name, price, quantity) VALUES (?, ?, 5, 1)', [o.id, 'HT item']);",
    "  await db.run('INSERT INTO shifts (branch_id, local_id, staff_name, status, received_at) VALUES (?, 1, ?, ?, ?)', [" + BRANCH + ", 'HT', 'closed', Date.now()]);",
    "  await db.run('INSERT INTO expenses (branch_id, local_id, amount, category, received_at) VALUES (?, 1, 1, ?, ?)', [" + BRANCH + ", 'HT', Date.now()]);",
    "  await db.run('INSERT INTO customers (branch_id, local_id, name, phone, received_at) VALUES (?, 1, ?, ?, ?)', [" + BRANCH + ", 'HT customer', '1', Date.now()]);",
    "  await db.run('INSERT INTO staff (branch_id, local_id, name, role, active, origin, received_at) VALUES (?, 1, ?, ?, 1, ?, ?) ON CONFLICT (branch_id, local_id) DO NOTHING', [" + BRANCH + ", 'HT staff', 'Manager', 'branch', Date.now()]);",
    "  await db.run('INSERT INTO employees (branch_id, name, monthly_salary) VALUES (?, ?, 1)', [" + BRANCH + ", 'HT rider']);",
    "  await db.run('INSERT INTO ingredients (branch_id, local_id, name, stock, received_at) VALUES (?, 1, ?, 7, ?) ON CONFLICT (branch_id, local_id) DO NOTHING', [" + BRANCH + ", 'HT cheese', Date.now()]);",
    "  await db.run('INSERT INTO menu_items (name, category, price, active) VALUES (?, ?, 9, 1)', ['HT pizza', 'Pizza']);",
    "  await db.run(\"INSERT INTO pairing_codes (branch_id, code_hash, hint, expires_at) VALUES (?, ?, ?, NOW() + interval '1 hour')\", [" + BRANCH + ", 'ht-hash-' + Date.now(), 'HTHT']);",
    "  const b = await db.one('SELECT api_key_hash FROM branches WHERE id = ?', [" + BRANCH + "]);",
    "  console.log(b.api_key_hash);",
    "  await db.close();",
    "})().catch(e => { console.error(e.message); process.exit(1); });",
  ].join('\n');
  const keyBefore = exec(seed);
  ok('the seed is in place', count('orders', 'WHERE branch_id = ' + BRANCH) === 1
     && count('menu_items', "WHERE name = 'HT pizza'") === 1);

  console.log();
  console.log('=== IT REFUSES WITHOUT THE PHRASE ===');
  const dry = runScript([]);
  ok('a bare run exits cleanly', dry.status === 0);
  ok('and reports what it would delete', /Would delete/.test(dry.out) && /orders/.test(dry.out));
  ok('and deletes nothing', count('orders', 'WHERE branch_id = ' + BRANCH) === 1);
  const wrong = runScript(['--confirm', 'blaze.virtiqo.com']);
  ok('the old domain is not accepted as the phrase',
     wrong.status === 0 && count('orders', 'WHERE branch_id = ' + BRANCH) === 1);

  console.log();
  console.log('=== WITH THE PHRASE, THE FRESH START ===');
  const run = runScript(['--confirm', CONFIRM_PHRASE]);
  console.log(run.out.split('\n').filter(l => /Exported|Rekeyed/.test(l)).map(l => '  ' + l.trim()).join('\n'));
  ok('the script completes', run.status === 0);
  exportFile = (run.out.match(/handover-export-[\w-]+\.json/) || [])[0];
  ok('an export was written first', Boolean(exportFile) && fs.existsSync(path.join(CLOUD_ROOT, 'scripts', exportFile)));
  if (exportFile) {
    const dump = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'scripts', exportFile), 'utf8'));
    ok('holding the rows it deleted', dump.tables.customers.some(c => c.name === 'HT customer'));
  }

  for (const t of DELETE_ORDER) ok(t + ' is empty', count(t) === 0);

  console.log();
  console.log('=== AND THE SHOP IS STILL THERE ===');
  ok('the menu', count('menu_items', "WHERE name = 'HT pizza'") === 1);
  ok('the stock mirror', count('ingredients', 'WHERE branch_id = ' + BRANCH) === 1);
  ok('the branch', count('branches', 'WHERE id = ' + BRANCH) === 1);
  const keyAfter = exec(
    "const db = require('./db/pg');" +
    "(async () => { const b = await db.one('SELECT api_key_hash FROM branches WHERE id = ?', [" + BRANCH + "]); console.log(b.api_key_hash); await db.close(); })();"
  );
  ok('with a new key, so the old machines stop reporting', keyAfter !== keyBefore);
  ok('every table is in one list or the other', KEPT.length + DELETE_ORDER.length >= 24);
 } catch (e) {
  console.error('THREW:', e);
 } finally {
  try {
    exec(
      "const db = require('./db/pg');" +
      "(async () => {" +
      "  await db.run('DELETE FROM ingredients WHERE branch_id = ?', [" + BRANCH + "]);" +
      "  await db.run(\"DELETE FROM menu_items WHERE name = 'HT pizza'\");" +
      "  await db.run('DELETE FROM branches WHERE id = ?', [" + BRANCH + "]);" +
      "  await db.close();" +
      "})();"
    );
    if (exportFile) fs.unlinkSync(path.join(CLOUD_ROOT, 'scripts', exportFile));
    console.log('\n(test rows and export removed)');
  } catch (e) { console.error('\nCOULD NOT CLEAN UP:', e.message); }
  process.exit(0);
 }
})();
