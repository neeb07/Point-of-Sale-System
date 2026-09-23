/**
 * A branch renamed on the dashboard reaches the till's receipts.
 *
 *   cd backend
 *   node scripts/run-script.js test/branch-rename.js
 *
 * Runs against a throwaway copy of the database, with a stand-in cloud on
 * loopback. The case that matters is the awkward one: the till has already
 * recorded the settings version the rename bumped — because it was offline
 * when it moved, or running a build that did not yet read the branch out of
 * the snapshot — so a version check alone would leave it printing the old
 * code on every receipt for good.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failures = 0;
const ok = (l, c) => { if (!c) failures += 1; console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + l); };

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blaze-rename-'));
fs.copyFileSync(path.join(ROOT, 'pos_database.db'), path.join(dir, 'pos_database.db'));
process.env.POS_USER_DATA_PATH = dir;

// The cloud, as far as this test is concerned: one branch, one version.
let served = { version: 7, branch: { id: 2, name: 'CBR Town Branch', code: 'CBR-Town' } };
let snapshotRequests = 0;
const cloud = http.createServer((req, res) => {
  if (req.url.startsWith('/api/settings/snapshot')) {
    snapshotRequests += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ version: served.version, settings: {}, branch: served.branch }));
  }
  res.writeHead(404).end();
});

(async () => {
 try {
  await new Promise(r => cloud.listen(0, '127.0.0.1', r));
  const port = cloud.address().port;

  const db = require(path.join(ROOT, 'db', 'database'));
  const { writeIdentity } = require(path.join(ROOT, 'db', 'till-identity'));
  const { formatOrderNo } = require(path.join(ROOT, 'db', 'order-no'));
  const { branchCode } = require(path.join(ROOT, 'db', 'branch'));

  writeIdentity({
    enabled: true, cloud_url: `http://127.0.0.1:${port}`,
    branch_id: 2, branch_name: 'CBR Town Branch', api_key: 'test-key',
  });
  db.prepare(`INSERT INTO branches (id, name, code) VALUES (2, 'CBR Town Branch', 'CBR-Town')
              ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code`).run();
  // The till believes it is already current — the rename's version bump
  // landed while it could not use it.
  db.prepare(`INSERT INTO settings (key, value) VALUES ('cloud_settings_version', '7')
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
  db.prepare("DELETE FROM settings WHERE key = 'branch_checked_at'").run();

  const pull = require(path.join(ROOT, 'sync', 'settings-pull'));
  const codeNow = () => branchCode(2);

  console.log('=== BEFORE THE RENAME ===');
  ok('the till prints the old code', formatOrderNo(codeNow(), 146) === 'CBR-Town-146');

  console.log();
  console.log('=== THE DASHBOARD RENAMES THE BRANCH ===');
  served.branch = { id: 2, name: 'Lehtrar Road Branch', code: 'LR' };
  // The version does NOT move: this till already recorded it. A pull gated
  // only on the version would do nothing here, which was the bug.
  const r = await pull.pullIfNewer(served.version);
  ok('the till still fetched the snapshot', snapshotRequests === 1 && r.ok);
  ok('and took the new name', (db.prepare('SELECT name FROM branches WHERE id = 2').get() || {}).name === 'Lehtrar Road Branch');
  ok('and the new code', codeNow() === 'LR');
  ok('so receipts read LR-146', formatOrderNo(codeNow(), 146) === 'LR-146');
  ok('including orders rung up before the rename', formatOrderNo(branchCode(2), 12) === 'LR-012');

  console.log();
  console.log('=== AND IT DOES NOT ASK AGAIN EVERY MINUTE ===');
  await pull.pullIfNewer(served.version);
  await pull.pullIfNewer(served.version);
  ok('the hourly check holds', snapshotRequests === 1);

  console.log();
  console.log('=== A RENAME WHILE THE CLOUD IS UNREACHABLE IS NOT FATAL ===');
  db.prepare("DELETE FROM settings WHERE key = 'branch_checked_at'").run();
  await new Promise(r => cloud.close(r));
  const offline = await pull.pullIfNewer(served.version);
  ok('the pull reports the failure rather than throwing', offline.ok === false && !!offline.error);
  ok('and the till keeps the name it has', codeNow() === 'LR');

  console.log();
  console.log(failures ? failures + ' FAILED' : 'all passed');
 } catch (e) {
  console.error('THREW:', e);
  failures += 1;
 } finally {
  try { cloud.close(); } catch (e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
 }
})();
