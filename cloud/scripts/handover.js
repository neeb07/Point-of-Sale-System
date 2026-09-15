/**
 * The fresh start, before the client gets the keys.
 *
 *   cd cloud
 *   node scripts/handover.js                                   # counts only, refuses
 *   node scripts/handover.js --confirm "blaze.virtiqosolutions.com"
 *
 * Everything built and tested so far has been against a database full of our
 * own test data: test managers, our dashboard logins, backups of our laptops,
 * a payroll adopted from test accounts. The dashboard's own reset clears the
 * trading history and deliberately keeps all of that. A handover needs it gone.
 *
 * It is one script, one confirmation and one transaction rather than hand SQL,
 * because hand SQL against a live database is how a column gets dropped by
 * accident at ten o'clock at night. What goes and what stays is a table in
 * this file, checked by test/handover.js.
 *
 * Deleted: the trading history (same list the dashboard reset uses — imported,
 * so the two cannot drift), every staff account and their PINs, every dashboard
 * login, the payroll, every uploaded backup, every pairing code and session.
 *
 * Kept: the menu and its sizes, the deals, the shop-wide settings, the two
 * branches with their names and codes, and the ingredients mirror. Then both
 * branches are rekeyed — so the laptops this was built on stop being able to
 * report as the client's shops — and the staff version is bumped, so any till
 * still holding a test roster replaces it on its next pull.
 *
 * Exports first. A full copy of every row about to go is written beside this
 * script before anything is deleted, in the same shape as the dashboard's own
 * export, and the script stops if that file cannot be written.
 *
 * Refuses unless --confirm carries the exact domain, so it cannot be run by
 * habit or by tab-completion.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db/pg');
const { generateKey, hashKey } = require('../db/keys');
const { CLEARED } = require('../routes/admin');

const CONFIRM_PHRASE = 'blaze.virtiqosolutions.com';

/** Beyond the trading history: everything that is ours rather than the client's. */
const ALSO_CLEARED = [
  'staff_deletions', 'staff',
  'sessions', 'users',
  'payslips', 'employees',
  'branch_backups',
  'pairing_codes',
];

/** Named so the test can assert on it, and so a future table has to be placed deliberately. */
const KEPT = [
  'branches', 'menu_items', 'item_variants', 'deals', 'deal_items',
  'cloud_settings', 'ingredients', 'menu_version', 'settings_version', 'staff_version',
];

const DELETE_ORDER = [...CLEARED, ...ALSO_CLEARED];

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function counts() {
  const out = {};
  for (const t of DELETE_ORDER) {
    const row = await db.one(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = row ? row.n : 0;
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const confirmAt = args.indexOf('--confirm');
  const confirmed = confirmAt >= 0 ? args[confirmAt + 1] : null;

  console.log('\n  Handover: the fresh start\n');

  const before = await counts();
  const total = Object.values(before).reduce((a, b) => a + b, 0);

  console.log('  Would delete:');
  for (const t of DELETE_ORDER) console.log(`    ${String(before[t]).padStart(7)}  ${t}`);
  console.log(`    ${String(total).padStart(7)}  rows in all`);
  console.log('\n  Would keep:  ' + KEPT.join(', '));
  console.log('  Would rekey: every branch (the tills pair again by code)\n');

  if (confirmed !== CONFIRM_PHRASE) {
    console.log(`  Nothing done. To run it:\n\n    node scripts/handover.js --confirm "${CONFIRM_PHRASE}"\n`);
    await db.close();
    return;
  }

  // The export, first, and the script stops if it cannot be written.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const exportPath = path.join(__dirname, `handover-export-${stamp}.json`);
  const tables = {};
  for (const t of DELETE_ORDER) tables[t] = await db.q(`SELECT * FROM ${t}`);
  const branches = await db.q('SELECT id, name, code FROM branches ORDER BY id');
  fs.writeFileSync(exportPath, JSON.stringify({
    exported_at: new Date().toISOString(),
    note: 'Every row scripts/handover.js deleted. Password hashes and PIN hashes are included; keep this file private.',
    branches,
    tables,
  }, null, 2));
  const written = fs.statSync(exportPath).size;
  if (!written) fail('The export file is empty. Nothing has been deleted.');
  console.log(`  Exported ${(written / 1024).toFixed(0)} KB to ${path.basename(exportPath)}`);

  const deleted = {};
  let rekeyed = 0;
  await db.tx(async (client) => {
    for (const t of DELETE_ORDER) {
      const r = await client.query(`DELETE FROM ${t}`);
      deleted[t] = r.rowCount;
    }
    // The laptops this was built on hold the current keys. New ones, not
    // printed: the client's tills pair by code, which issues a key of its own.
    const all = await client.query('SELECT id FROM branches');
    for (const b of all.rows) {
      await client.query('UPDATE branches SET api_key_hash = $1 WHERE id = $2', [hashKey(generateKey()), b.id]);
      rekeyed += 1;
    }
    // A till still holding a test roster replaces it on its next pull.
    await client.query('UPDATE staff_version SET version = version + 1, updated_at = NOW() WHERE id = 1');
  });

  console.log('\n  Deleted:');
  for (const t of DELETE_ORDER) console.log(`    ${String(deleted[t]).padStart(7)}  ${t}`);
  console.log(`\n  Rekeyed ${rekeyed} branch${rekeyed === 1 ? '' : 'es'}. Staff version bumped.`);
  console.log('\n  Next: node scripts/provision.js owner <client-email> "<password>" "<name>"\n');

  await db.close();
}

// Only when run directly. The test imports this file for its table lists, and
// importing must never run the handover.
if (require.main === module) {
  main().catch((err) => {
    console.error('\n  FAILED:', err.message);
    console.error('  The transaction rolled back; nothing was deleted.\n');
    process.exit(1);
  });
}

module.exports = { DELETE_ORDER, ALSO_CLEARED, KEPT, CONFIRM_PHRASE, main };
