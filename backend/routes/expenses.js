const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveBranchId, openShiftIdFor } = require('../db/branch');
const { isAdminRole } = require('../middleware/auth');
const { localToday } = require('../db/local-date');

/**
 * Petty cash paid out — rider fuel, staff lunch, a repair, and so on.
 *
 * The point of `from_drawer` is reconciliation. Money handed out of the till is
 * gone from the drawer but is not a sale, so without recording it every shift
 * closes short by exactly the amount that was spent and the manager gets
 * blamed for a shortfall that is really a fuel receipt. A drawer expense is
 * attached to whichever shift was open at the time, so it lands in the right
 * trading period even if it is entered a few minutes later.
 *
 * An expense paid from someone's own pocket or by card is still worth
 * recording, but must not move the drawer — hence the flag rather than always
 * subtracting.
 *
 * Both roles may add expenses: it is day-to-day till work, and a manager
 * handing a rider fuel money cannot wait for the owner.
 */

/** Common categories, offered in the UI. Free text is still accepted. */
const CATEGORIES = [
  'Delivery / Fuel',
  'Staff Meal',
  'Supplies',
  'Maintenance',
  'Utilities',
  'Miscellaneous',
];

router.get('/categories', (req, res) => res.json(CATEGORIES));

/**
 * Restrict a manager to their own spending.
 *
 * An administrator sees everything the shop paid out. A manager sees only what
 * they recorded themselves, so the E-18 manager's fuel money never appears on
 * the CBR Town manager's screen — and neither of them can read the owner's
 * outgoings.
 *
 * The filter comes from the session, not from a query parameter, so a manager
 * cannot ask for somebody else's figures. This matches how the sales reports
 * are scoped, and it costs nothing in reconciliation: a manager only ever
 * counts a drawer against their own shift, and the payouts that moved that
 * drawer are their own by construction.
 */
function scope(req, alias = 'e') {
  if (!req.user || isAdminRole(req.user.role)) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.staff_id = ?`, params: [req.user.staffId] };
}

/** List expenses for a date range, newest first. */
router.get('/', (req, res) => {
  // Local wall-clock, not toISOString's UTC: at UTC+5 that named yesterday
  // for the first five hours of every trading day.
  const today = localToday();
  const from = req.query.from || today;
  const to = req.query.to || today;
  const mine = scope(req);

  try {
    const rows = db.prepare(`
      SELECT e.*, s.status AS shift_status
      FROM expenses e
      LEFT JOIN shifts s ON s.id = e.shift_id
      WHERE DATE(e.created_at) BETWEEN DATE(?) AND DATE(?)${mine.sql}
      ORDER BY e.created_at DESC, e.id DESC
    `).all(from, to, ...mine.params);

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(CASE WHEN from_drawer = 1 THEN amount ELSE 0 END), 0) AS from_drawer_total,
        COUNT(*) AS count
      FROM expenses e
      WHERE DATE(e.created_at) BETWEEN DATE(?) AND DATE(?)${mine.sql}
    `).get(from, to, ...mine.params);

    res.json({ expenses: rows, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST a new expense
router.post('/', (req, res) => {
  const { category, description, amount, from_drawer } = req.body;

  const value = Number(amount);
  if (!category || !String(category).trim()) {
    return res.status(400).json({ error: 'Choose what the money was spent on' });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return res.status(400).json({ error: 'Enter an amount greater than zero' });
  }

  try {
    // Attach to the open shift so the drawer maths lands in the right period.
    // With no shift open the expense is still recorded, it just cannot move a
    // drawer that is not counted.
    // The recorder's own open shift, so a payout only ever moves the drawer
    // that person is actually counting.
    const openShiftId = openShiftIdFor(req.user && req.user.staffId);

    const fromDrawer = from_drawer === false || from_drawer === 0 ? 0 : 1;

    const info = db.prepare(`
      INSERT INTO expenses
        (shift_id, staff_id, staff_name, category, description, amount, from_drawer, branch_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      fromDrawer ? openShiftId : null,
      // Attribution comes from the session, never the request body.
      (req.user && req.user.staffId) || null,
      (req.user && req.user.name) || 'Unknown',
      String(category).trim(),
      description ? String(description).trim() : null,
      Math.round(value * 100) / 100,
      fromDrawer,
      resolveBranchId(req)
    );

    const created = db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({
      ...created,
      // Tells the UI whether this actually moved a drawer, so it can say so
      // rather than implying a reconciliation that did not happen.
      affected_shift: Boolean(fromDrawer && openShiftId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Delete an expense.
 *
 * A manager may remove their own mistake; only an administrator can remove
 * somebody else's, since deleting a drawer expense silently changes what the
 * till is expected to hold.
 */
router.delete('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Expense not found' });

    const isAdmin = req.user && isAdminRole(req.user.role);
    const isOwnEntry = req.user && row.staff_id === req.user.staffId;

    if (!isAdmin && !isOwnEntry) {
      return res.status(403).json({
        error: 'You can only remove expenses you recorded yourself.',
      });
    }

    db.prepare('DELETE FROM expenses WHERE id = ?').run(row.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
