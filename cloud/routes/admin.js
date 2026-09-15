/**
 * Wiping the trading history.
 *
 * The one destructive thing the dashboard can do, and it is built so that the
 * destructive part is the last step of several, each of which has to succeed
 * before the next runs.
 *
 * What goes is the *record of trading*: orders and their lines, shifts,
 * expenses, the customer book, the live status and the sync cursors. What
 * stays is everything the business is made of rather than what it has done:
 * the branches and their keys, the dashboard logins, the staff and their PINs,
 * the menu, the deals, the settings, the stock counts, the payroll, and the
 * backups. Those last two are judgement calls, made conservatively — a wage
 * history deleted by accident is a dispute nobody can settle, and the backups
 * are the only thing that could undo this.
 *
 * Two things stand between the button and the data:
 *
 *   1. The owner's password, entered again. A session cookie proves somebody
 *      signed in at some point; it does not prove that the person at the
 *      keyboard now is the one who can authorise this. Re-entering the password
 *      does, and it is rate limited so it cannot be guessed at.
 *
 *   2. An export, first. The dashboard downloads a full copy of exactly the
 *      rows about to be deleted and only calls this route once that download
 *      has completed in the browser. The reset cannot run without the export
 *      having been fetched, because the export carries a token the reset
 *      requires — so "back up first" is enforced rather than merely advised.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/pg');
const { requireUser } = require('../middleware/session');

/**
 * The tables that are trading history, in the order they can be deleted.
 *
 * order_items first, because it references orders. Everything else stands
 * alone. Named here, once, so the export and the reset can never disagree
 * about what "everything" means.
 */
const CLEARED = ['order_items', 'orders', 'shifts', 'expenses', 'customers', 'live_status', 'sync_cursor'];

/** Named so the screen can say what survives without the list drifting from the code. */
const KEPT = [
  'branches', 'users', 'staff', 'menu_items', 'item_variants', 'deals', 'deal_items',
  'ingredients', 'cloud_settings', 'employees', 'payslips', 'branch_backups', 'pairing_codes',
];

/*
 * Export tokens.
 *
 * An export hands back a short-lived token, and the reset demands it. That is
 * what makes "download a backup first" a rule the code enforces rather than a
 * sentence in a dialog. In memory and per process: a restart invalidates
 * outstanding tokens, which just means exporting again.
 */
const exportTokens = new Map(); // token -> { userId, issuedAt }
const TOKEN_TTL_MS = 15 * 60 * 1000;

/* Re-entering a password is a login attempt, and is limited like one. */
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
function tooMany(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function recordAttempt(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}

/** What a reset would remove, so the screen can show the numbers before asking. */
router.get('/reset/preview', requireUser, async (req, res) => {
  try {
    const counts = {};
    for (const t of CLEARED) {
      const row = await db.one(`SELECT COUNT(*)::int AS n FROM ${t}`);
      counts[t] = row ? row.n : 0;
    }
    res.json({ cleared: CLEARED, kept: KEPT, counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/export — every row that a reset would delete, as one JSON file.
 *
 * Plain JSON rather than a database dump, on purpose: it can be opened and
 * read by a person, loaded into a spreadsheet, and does not need this
 * software to make sense of. A backup nobody can open is a guess.
 *
 * The token in the header is what the reset will ask for.
 */
router.get('/export', requireUser, async (req, res) => {
  try {
    const tables = {};
    for (const t of CLEARED) tables[t] = await db.q(`SELECT * FROM ${t}`);

    const branches = await db.q('SELECT id, name, code FROM branches ORDER BY id');

    const token = crypto.randomBytes(24).toString('hex');
    exportTokens.set(token, { userId: req.user.id, issuedAt: Date.now() });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="blaze-trading-history-${stamp}.json"`);
    res.setHeader('X-Export-Token', token);
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Token');
    res.send(JSON.stringify({
      exported_at: new Date().toISOString(),
      exported_by: req.user.email,
      note: 'Every row the dashboard reset deletes. Branches are listed so branch_id values can be read.',
      branches,
      tables,
    }, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/reset — delete the trading history.
 *
 * Needs the owner's password and a live export token. One transaction: either
 * every table is cleared or none is, so a failure halfway cannot leave orders
 * without their lines or a shift total with no orders behind it.
 */
router.post('/reset', requireUser, async (req, res) => {
  const password = String((req.body && req.body.password) || '');
  const token = String((req.body && req.body.export_token) || '');
  const key = `${req.user.id}`;

  if (tooMany(key)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  // The export must have happened, recently, and for this user.
  const issued = exportTokens.get(token);
  if (!issued || issued.userId !== req.user.id || Date.now() - issued.issuedAt > TOKEN_TTL_MS) {
    return res.status(409).json({
      error: 'Download the backup first. The reset only runs after a fresh export has been saved.',
      code: 'EXPORT_REQUIRED',
    });
  }

  try {
    const user = await db.one('SELECT password_hash FROM users WHERE id = ? AND active = 1', [req.user.id]);
    const hash = (user && user.password_hash) || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordOk = await bcrypt.compare(password, hash);
    if (!passwordOk) {
      recordAttempt(key);
      return res.status(403).json({ error: 'That is not your password.', code: 'BAD_PASSWORD' });
    }

    // Spent. A second reset needs a second export, so the backup is always
    // as new as the deletion it precedes.
    exportTokens.delete(token);

    const counts = {};
    await db.tx(async (client) => {
      for (const t of CLEARED) {
        const r = await client.query(`DELETE FROM ${t}`);
        counts[t] = r.rowCount;
      }
    });

    console.log(`Trading history reset by ${req.user.email}: ${JSON.stringify(counts)}`);
    res.json({ success: true, deleted: counts, kept: KEPT });
  } catch (err) {
    console.error('Reset failed:', err.message);
    res.status(500).json({ error: 'The reset did not complete. Nothing was deleted.' });
  }
});

module.exports = router;
// The lists, for scripts/handover.js — one definition of what trading data is.
module.exports.CLEARED = CLEARED;
module.exports.KEPT = KEPT;
