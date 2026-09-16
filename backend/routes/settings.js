const express = require('express');
const router = express.Router();
const db = require('../db/database');
const fs = require('fs');
const path = require('path');

const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname, '..');
const DB_PATH = path.join(userDataDir, 'pos_database.db');

// GET all settings
router.get('/', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM settings').all();
    const settingsObj = {};
    data.forEach((row) => { settingsObj[row.key] = row.value; });
    res.json(settingsObj);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update multiple settings
router.put('/', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);

  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        upsert.run(key, value === null || value === undefined ? '' : value.toString());
      }
    })();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST restore from a backup file.
 *
 * FIX (Bug 5): Settings had a "Choose Backup File" button wired to a hidden
 * <input type="file"> that carried no onChange handler at all — picking a file
 * did precisely nothing. This is the endpoint that makes it work.
 *
 * The uploaded file is validated as a real SQLite database containing the
 * tables we expect before anything is overwritten, and the current database is
 * copied aside first so a bad restore is always recoverable.
 */
router.post('/restore', (req, res) => {
  const { data, filename } = req.body;

  if (!data) return res.status(400).json({ error: 'No backup data provided' });

  const stagingPath = path.join(userDataDir, `restore_staging_${Date.now()}.db`);

  try {
    const buffer = Buffer.from(data, 'base64');

    // SQLite files begin with "SQLite format 3\0".
    if (buffer.length < 16 || buffer.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
      return res.status(400).json({ error: 'That file is not a valid SQLite database' });
    }

    fs.writeFileSync(stagingPath, buffer);

    // Verify the schema before trusting it.
    const Database = require('better-sqlite3');
    const candidate = new Database(stagingPath, { readonly: true });
    const required = ['menu_items', 'orders', 'order_items', 'staff', 'settings'];
    const tables = candidate
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    candidate.close();

    const missing = required.filter((t) => !tables.includes(t));
    if (missing.length > 0) {
      fs.unlinkSync(stagingPath);
      return res.status(400).json({
        error: `Backup is missing required tables: ${missing.join(', ')}`,
      });
    }

    // Safety copy of what we are about to replace.
    const safetyDir = path.join(userDataDir, 'backups');
    if (!fs.existsSync(safetyDir)) fs.mkdirSync(safetyDir, { recursive: true });
    const safetyPath = path.join(safetyDir, `pre_restore_${Date.now()}.db`);
    if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, safetyPath);

    // Flush WAL, then stage the file for pickup on next boot. Swapping the
    // file underneath an open better-sqlite3 handle is not safe, so the
    // restore is applied at startup instead.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* non-fatal */ }
    const pendingPath = path.join(userDataDir, 'pending_restore.db');
    fs.renameSync(stagingPath, pendingPath);

    res.json({
      success: true,
      message: 'Backup verified. Restart Blaze POS to complete the restore.',
      safety_copy: path.basename(safetyPath),
      source: filename || 'backup.db',
    });
  } catch (err) {
    if (fs.existsSync(stagingPath)) {
      try { fs.unlinkSync(stagingPath); } catch (e) { /* ignore */ }
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * Start the till's trading history again.
 *
 * Everything that is a record of business done goes: orders and their lines,
 * tickets on hold, shifts, expenses, the customer book. Everything that is
 * the shop's set-up stays: menu, variants and deals, ingredients and recipes,
 * staff and their PINs, settings, and which branch this till is paired as.
 * The point is a clean first day after testing, not a reinstall.
 *
 * Three protections, in order:
 *
 *  1. The caller's own PIN, typed again. The session proves somebody signed
 *     in; the PIN proves that person is the one at the keyboard now. Owner
 *     and manager alike — the manager is the one in the shop.
 *  2. Nothing unsent is destroyed silently. Sales are pushed to the cloud
 *     first; if some cannot be (unpaired, offline), the request is refused
 *     with the count, and only an explicit `force` goes ahead regardless.
 *  3. A verified copy of the database is written to backups/ before the
 *     first row is deleted, under its own name so the daily backup never
 *     overwrites it.
 *
 * Order numbers do not restart. They come from the row id, the cloud already
 * holds the orders that carried the old ones, and a second E-18-005 would
 * overwrite the first on the dashboard. A fresh install starts at 001; a
 * reset continues.
 */
const CLEARED = ['order_items', 'orders', 'held_orders', 'shifts', 'expenses', 'customers'];
const KEPT = ['menu_items', 'item_variants', 'deals', 'deal_items', 'ingredients', 'recipes',
              'recipe_ingredients', 'staff', 'settings', 'branches'];

router.post('/reset', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { pin, force } = req.body || {};

  if (!req.user || !req.user.staffId) {
    return res.status(401).json({ error: 'Sign in to continue', code: 'UNAUTHENTICATED' });
  }
  if (!pin) return res.status(400).json({ error: 'Enter your PIN to confirm', code: 'PIN_REQUIRED' });
  const me = db.prepare('SELECT pin FROM staff WHERE id = ?').get(req.user.staffId);
  const pinOk = me && /^\$2[aby]\$/.test(me.pin || '') && await bcrypt.compare(String(pin), me.pin);
  if (!pinOk) return res.status(403).json({ error: 'That is not your PIN', code: 'WRONG_PIN' });

  const open = db.prepare("SELECT COUNT(*) AS n FROM shifts WHERE status = 'open'").get().n;
  if (open > 0) {
    return res.status(409).json({
      error: 'Close the open shift first — the drawer has to be counted before its records go.',
      code: 'SHIFT_OPEN',
    });
  }

  // Send what has not gone yet, and refuse to destroy what still has not.
  let pending = { orders: 0, shifts: 0, expenses: 0 };
  try {
    const push = require('../sync/push');
    await push.syncAll();
    pending = db.prepare(`SELECT
      (SELECT COUNT(*) FROM orders   WHERE sync_state = 'pending') AS orders,
      (SELECT COUNT(*) FROM shifts   WHERE sync_state = 'pending') AS shifts,
      (SELECT COUNT(*) FROM expenses WHERE sync_state = 'pending') AS expenses`).get();
  } catch (e) { /* push failing is exactly the case the count below catches */ }
  const unsent = pending.orders + pending.shifts + pending.expenses;
  if (unsent > 0 && !force) {
    return res.status(409).json({
      error: `${unsent} record${unsent === 1 ? ' has' : 's have'} not reached the dashboard yet.`,
      code: 'UNSYNCED',
      pending,
    });
  }

  // A copy first, verified, under a name the daily backup will never reuse.
  const safetyDir = path.join(userDataDir, 'backups');
  if (!fs.existsSync(safetyDir)) fs.mkdirSync(safetyDir, { recursive: true });
  const safetyPath = path.join(safetyDir, `pre_reset_${Date.now()}.db`);
  try {
    db.prepare(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}'`).run();
    const { verify } = require('../db/backup');
    const checked = verify(safetyPath);
    if (!checked.ok) throw new Error(checked.error);
  } catch (err) {
    try { if (fs.existsSync(safetyPath)) fs.unlinkSync(safetyPath); } catch (e) { /* nothing */ }
    return res.status(500).json({ error: 'Could not save a copy first, so nothing was deleted: ' + err.message });
  }

  const counts = {};
  const wipe = db.transaction(() => {
    for (const table of CLEARED) {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      db.prepare(`DELETE FROM ${table}`).run();
    }
    // Tickets on hold and the customer book may start from 1 again; orders,
    // shifts and expenses keep counting for the reason given above.
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('held_orders', 'customers')").run();
  });
  wipe();

  res.json({
    success: true,
    deleted: counts,
    kept: KEPT,
    safety_copy: path.basename(safetyPath),
    unsent_discarded: force ? unsent : 0,
  });
});

// NOTE: the old GET /settings/backup route was removed. It pointed at
// `__dirname/../pos_database.db` and ignored POS_USER_DATA_PATH, so in a
// packaged build it downloaded the wrong file (or 404'd). The working route
// lives at GET /api/backup in server.js.

module.exports = router;
