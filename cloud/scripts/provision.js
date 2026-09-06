/**
 * Provision branches and the owner account.
 *
 *   node scripts/provision.js branch 1 "E-18 Branch"
 *   node scripts/provision.js branch 2 "CBR Town Branch"
 *   node scripts/provision.js owner owner@blaze.com "a good password" "Blaze Owner"
 *   node scripts/provision.js list
 *   node scripts/provision.js rekey 1
 *
 * The branch id must match the `branch_id` the till is configured with — the
 * ids in the POS's own `branches` table, which are 1 (E-18) and 2 (CBR Town).
 * Getting this wrong files a shop's takings under the other shop, so the script
 * makes you pass it explicitly rather than allocating one.
 *
 * A branch key is printed ONCE, here. Only its hash is stored, so it cannot be
 * recovered afterwards — if it is lost, `rekey` issues a new one and the old
 * one stops working immediately.
 */

const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { generateKey, hashKey } = require('../db/keys');

const [, , command, ...args] = process.argv;

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function createBranch(idArg, name) {
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) fail('Branch id must be a positive whole number.');
  if (!name) fail('Branch name required.');

  if (db.prepare('SELECT 1 FROM branches WHERE id = ?').get(id)) {
    fail(`Branch ${id} already exists. Use "rekey ${id}" to issue a new key.`);
  }

  const key = generateKey();
  db.prepare('INSERT INTO branches (id, name, api_key_hash) VALUES (?, ?, ?)')
    .run(id, name, hashKey(key));

  console.log(`\n  Branch ${id} created: ${name}`);
  printKey(id, name, key);
}

function rekeyBranch(idArg) {
  const id = Number(idArg);
  const branch = db.prepare('SELECT id, name FROM branches WHERE id = ?').get(id);
  if (!branch) fail(`No branch ${idArg}.`);

  const key = generateKey();
  db.prepare('UPDATE branches SET api_key_hash = ? WHERE id = ?').run(hashKey(key), id);

  console.log(`\n  New key issued for branch ${id}. The previous key stopped working just now.`);
  printKey(branch.id, branch.name, key);
}

function printKey(id, name, key) {
  console.log('\n  ---------------------------------------------------------------');
  console.log('  Put this on that branch\'s till, and nowhere else.');
  console.log('  It is shown once and cannot be recovered — only its hash is stored.');
  console.log('  ---------------------------------------------------------------\n');
  console.log('  File: <userData>\\cloud-sync.json   (beside pos_database.db)\n');
  console.log(JSON.stringify({
    enabled: true,
    cloud_url: 'https://blaze.virtiqo.com',
    branch_id: id,
    branch_name: name,
    api_key: key,
  }, null, 2).split('\n').map(l => '    ' + l).join('\n'));
  console.log('');
}

async function createOwner(email, password, name) {
  if (!email || !password) fail('Usage: provision.js owner <email> <password> [name]');
  if (String(password).length < 10) {
    // This account can read the shop's entire trading history from anywhere in
    // the world. A four-digit habit from the till would not survive a week.
    fail('Password must be at least 10 characters. This login is on the public internet.');
  }

  const normalised = String(email).trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalised)) {
    fail(`${normalised} already exists.`);
  }

  const hash = await bcrypt.hash(String(password), 10);
  db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(normalised, hash, name || null, 'owner');

  console.log(`\n  Owner account created: ${normalised}\n`);
}

function list() {
  const branches = db.prepare('SELECT id, name, active, created_at FROM branches ORDER BY id').all();
  const users = db.prepare('SELECT id, email, name, role, branch_id, active FROM users ORDER BY id').all();

  console.log('\n  Branches');
  if (!branches.length) console.log('    (none — run "provision.js branch 1 \\"E-18 Branch\\"")');
  branches.forEach(b => console.log(`    ${b.id}  ${b.name}${b.active ? '' : '  (inactive)'}`));

  console.log('\n  Dashboard accounts');
  if (!users.length) console.log('    (none — run "provision.js owner <email> <password>")');
  users.forEach(u => console.log(
    `    ${u.id}  ${u.email}  ${u.role}${u.branch_id ? `  branch ${u.branch_id}` : '  all branches'}${u.active ? '' : '  (disabled)'}`
  ));
  console.log('');
}

(async () => {
  switch (command) {
    case 'branch': createBranch(args[0], args[1]); break;
    case 'rekey':  rekeyBranch(args[0]); break;
    case 'owner':  await createOwner(args[0], args[1], args[2]); break;
    case 'list':   list(); break;
    default:
      console.log(`
  Usage:
    node scripts/provision.js branch <id> <name>       create a branch, print its key
    node scripts/provision.js rekey  <id>              issue a new key for a branch
    node scripts/provision.js owner  <email> <password> [name]
    node scripts/provision.js list                     show what exists
`);
  }
  db.close();
})();
