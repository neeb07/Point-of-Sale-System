/**
 * Staff — created and changed here, applied at the tills.
 *
 * This is the second thing the cloud owns outright, and it works the same way
 * the menu does: one writer, whole snapshots, and a version integer a till can
 * ask about for a few bytes. See routes/menu.js for the reasoning; none of it
 * is repeated here.
 *
 * What *is* different is the credential.
 *
 * A till checks PINs offline, against its own SQLite, because that is the whole
 * point of an offline-first till — the shop keeps selling when the line is
 * down. So a PIN created on this dashboard is worthless until the hash reaches
 * the till. There is no design in which the owner creates staff from here and
 * the credential does not travel down the wire.
 *
 * The hash is therefore stored, and these rules hold it in:
 *
 *   - No route on this file ever returns `pin_hash` to the dashboard. It leaves
 *     this server in exactly one direction: down to a till that presented that
 *     branch's own key, in `GET /snapshot`, and only for that branch's staff.
 *   - PINs are write-only from the dashboard's point of view. The owner can set
 *     a new one; nobody, including the owner, can read the existing one.
 *   - bcrypt at the same cost the till uses, so a hash made here and a hash made
 *     there are indistinguishable.
 *
 * None of that changes the underlying fact, which is worth stating plainly
 * rather than burying: a four-digit PIN behind bcrypt is brute-forceable by
 * anyone who obtains this database. What limits the damage is what the PIN
 * actually unlocks — a till, in one of two shops, that the holder must be
 * physically standing at. It grants nothing here, and nothing on the dashboard,
 * which authenticate entirely separately.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db/pg');
const { requireUser } = require('../middleware/session');
const { requireBranch } = require('../middleware/branch-auth');

/** The same cost the till hashes with — see backend/routes/staff.js. */
const SALT_ROUNDS = 10;

/**
 * The only role the dashboard can hand out.
 *
 * Admin is deliberately absent. An administrator's powers on a till are the
 * menu, settings, staff and backups, and every one of those now lives on this
 * dashboard instead. Taking orders is a manager's job. Offering "Admin" here
 * would create an account whose only distinction is the ability to undo, at a
 * till, the things this screen exists to control.
 */
const CREATABLE_ROLES = ['Manager'];

/**
 * Where cloud-created staff numbers start.
 *
 * A till's `staff.id` is an AUTOINCREMENT, so it hands out 1, 2, 3… and knows
 * nothing about this server. If the cloud also allocated from the low numbers,
 * two staff created in the same minute — one here, one at a till that has not
 * pushed yet — would land on the same id, and the downlink would overwrite a
 * real person with a different one.
 *
 * So the cloud allocates from a band the till's counter will not reach: a shop
 * would need ten thousand staff accounts to collide, and it has under ten. The
 * two allocators never have to talk to each other, which is the only way this
 * is safe on a link that is often down.
 */
const CLOUD_ID_BASE = 10000;

const clean = (v) => {
  const t = String(v == null ? '' : v).trim();
  return t.length ? t : null;
};

async function bumpVersion(client) {
  const r = await client.query(
    'UPDATE staff_version SET version = version + 1, updated_at = NOW() WHERE id = 1 RETURNING version');
  return r.rows[0].version;
}

/* ------------------------------------------------------- the dashboard -- */

/**
 * Create a member of staff.
 *
 * The branch is required, unlike on the till, where an unassigned account meant
 * an administrator overseeing both sites. Every account this screen creates is
 * a manager, and a manager runs one shop — an unassigned one would file its
 * sales and expenses under no branch at all.
 */
router.post('/', requireUser, async (req, res) => {
  const name = clean(req.body && req.body.name);
  const role = clean(req.body && req.body.role) || 'Manager';
  const pin = clean(req.body && req.body.pin);
  const color = clean(req.body && req.body.color) || '#DC2626';
  const branchId = Number(req.body && req.body.branch_id) || null;

  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!branchId) return res.status(400).json({ error: 'Choose which branch this manager works at.' });
  if (!CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${CREATABLE_ROLES.join(', ')}.` });
  }
  // Four digits, as the till's keypad expects. Checked here rather than only in
  // the browser: a PIN the till cannot accept would sync down and silently lock
  // the person out, with nothing on either screen to say why.
  if (!pin || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'The PIN must be exactly four digits.' });
  }

  try {
    const branch = await db.one('SELECT id, name FROM branches WHERE id = ? AND active = 1', [branchId]);
    if (!branch) return res.status(400).json({ error: 'Unknown branch.' });

    const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);

    const created = await db.tx(async (client) => {
      // Allocated inside the transaction so two creations in the same second
      // cannot read the same maximum and both claim it.
      const next = await client.query(db.toPg(
        `SELECT COALESCE(MAX(local_id), ?) + 1 AS id
           FROM staff WHERE branch_id = ? AND local_id >= ?`),
        [CLOUD_ID_BASE - 1, branchId, CLOUD_ID_BASE]);
      const localId = Number(next.rows[0].id);

      await client.query(db.toPg(
        `INSERT INTO staff (branch_id, local_id, name, role, color, active,
                            pin_hash, origin, updated_ms, received_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, 'cloud', ?, ?)`),
        [branchId, localId, name, role, color, pinHash, Date.now(), Date.now()]);

      const version = await bumpVersion(client);
      return { localId, version };
    });

    res.status(201).json({
      id: created.localId, name, role, color, active: 1,
      branch_id: branchId, branch_name: branch.name, origin: 'cloud',
      staff_version: created.version,
      // Said on screen rather than left to be discovered: nothing here is
      // instant, and a manager trying to sign in before the till has pulled
      // would otherwise look like a broken PIN.
      note: `${name} can sign in at ${branch.name} once that till has synced.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Change one.
 *
 * Addressed by branch and the till's own number, because `local_id` alone is
 * not unique — branch 1 and branch 2 both have a staff 3, and they are
 * different people.
 */
router.put('/:branchId/:localId', requireUser, async (req, res) => {
  const branchId = Number(req.params.branchId);
  const localId = Number(req.params.localId);
  const body = req.body || {};

  if (!Number.isFinite(branchId) || !Number.isFinite(localId)) {
    return res.status(400).json({ error: 'Bad staff address.' });
  }
  if (body.role !== undefined && !CREATABLE_ROLES.includes(clean(body.role))) {
    return res.status(400).json({ error: `Role must be one of: ${CREATABLE_ROLES.join(', ')}.` });
  }
  if (body.pin !== undefined && body.pin !== null && body.pin !== ''
      && !/^\d{4}$/.test(String(body.pin).trim())) {
    return res.status(400).json({ error: 'The PIN must be exactly four digits.' });
  }
  if (body.branch_id !== undefined && Number(body.branch_id) !== branchId) {
    // Deliberately refused. Moving somebody between branches would change the
    // half of their key that makes it unique, and the till they are leaving has
    // no way to be told the row is gone. Deactivate and create anew.
    return res.status(400).json({
      error: 'A manager cannot be moved between branches. Deactivate this account and create one at the other branch.',
    });
  }

  try {
    const existing = await db.one(
      'SELECT id, name FROM staff WHERE branch_id = ? AND local_id = ?', [branchId, localId]);
    if (!existing) return res.status(404).json({ error: 'No such staff member.' });

    const sets = [];
    const params = [];
    const set = (col, val) => { sets.push(`${col} = ?`); params.push(val); };

    if (body.name !== undefined) set('name', clean(body.name));
    if (body.role !== undefined) set('role', clean(body.role));
    if (body.color !== undefined) set('color', clean(body.color));
    if (body.active !== undefined) set('active', body.active ? 1 : 0);
    if (body.pin) set('pin_hash', await bcrypt.hash(String(body.pin).trim(), SALT_ROUNDS));

    if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });

    // Any edit makes this row cloud-owned, including an edit to one that came
    // up from a till. Otherwise deactivating a till-created account would be
    // undone by that same till's next push, which is precisely the bug this
    // route exists to fix.
    set('origin', 'cloud');
    set('updated_ms', Date.now());

    const version = await db.tx(async (client) => {
      await client.query(db.toPg(
        `UPDATE staff SET ${sets.join(', ')} WHERE branch_id = ? AND local_id = ?`),
        [...params, branchId, localId]);
      return bumpVersion(client);
    });

    res.json({ success: true, staff_version: version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * There is no delete.
 *
 * Every order, shift and expense already recorded names the person who took it.
 * Removing the row would leave those records pointing at nobody, so an account
 * that is finished with is deactivated: it stops being able to sign in and
 * stays attached to its own history. Answered explicitly rather than as a 404,
 * so the screen can say why.
 */
router.delete('/:branchId/:localId', requireUser, (req, res) => {
  res.status(400).json({
    error: 'Staff are deactivated, not deleted, so the orders and shifts they recorded keep their name.',
    code: 'DEACTIVATE_INSTEAD',
  });
});

/* -------------------------------------------------------------- tills -- */

/** One integer. Asked constantly, costs nothing. */
router.get('/version', requireBranch, async (req, res) => {
  try {
    const row = await db.one('SELECT version FROM staff_version WHERE id = 1');
    res.json({ version: row ? Number(row.version) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * This branch's roster, hashes included.
 *
 * Scoped to `req.branch.id`, which comes from the presented key and never from
 * the request — so one branch's key cannot fetch the other branch's PINs.
 *
 * Rows with no hash are included on purpose. Those are accounts that came up
 * from this till in the first place, and the till already holds their PIN; the
 * downlink applies the other fields and leaves the credential alone. See
 * backend/sync/staff-pull.js.
 */
router.get('/snapshot', requireBranch, async (req, res) => {
  try {
    const [version, staff] = await Promise.all([
      db.one('SELECT version FROM staff_version WHERE id = 1'),
      db.q(
        `SELECT local_id, name, role, color, active, pin_hash, origin
           FROM staff WHERE branch_id = ? ORDER BY local_id`,
        [req.branch.id]),
    ]);
    res.json({
      version: version ? Number(version.version) : 0,
      branch_id: req.branch.id,
      staff,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
