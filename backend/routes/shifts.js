const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAdminRole } = require('../middleware/auth');

/**
 * Shift management.
 *
 * FIX (Bug 5): the Settings > Shift screen previously rendered hardcoded
 * numbers — 23 orders, Rs. 12,400, and three invented history rows that
 * existed only in React state and vanished on refresh. Every figure below is
 * now derived from the orders actually rung up during the shift.
 */

/** Live totals for a shift, computed from its orders. */
const shiftTotalsStmt = db.prepare(`
  SELECT
    COUNT(*)                                                     AS total_orders,
    COALESCE(SUM(total), 0)                                      AS total_revenue,
    COALESCE(SUM(discount), 0)                                   AS total_discounts,
    COALESCE(SUM(CASE WHEN LOWER(payment_method) = 'cash' THEN total ELSE 0 END), 0) AS cash_revenue,
    COALESCE(SUM(CASE WHEN LOWER(payment_method) != 'cash' THEN total ELSE 0 END), 0) AS non_cash_revenue
  FROM orders
  WHERE shift_id = ? AND status != 'voided'
`);

/**
 * Cash paid out of the drawer during the shift.
 *
 * Rider fuel, staff lunch and the like leave the till but are not sales, so
 * without this the drawer is expected to hold money that was handed out hours
 * ago and every shift closes short by exactly what was spent.
 */
const shiftExpensesStmt = db.prepare(`
  SELECT
    COALESCE(SUM(amount), 0) AS drawer_expenses,
    COUNT(*)                 AS expense_count
  FROM expenses
  WHERE shift_id = ? AND from_drawer = 1
`);

/*
 * A shift belongs to the person who opened it.
 *
 * There used to be one global open shift, so whoever signed in next saw — and
 * could close — somebody else's drawer, and their sales were filed against it.
 * With a manager per branch that is not just untidy, it is wrong: two people
 * counting one drawer they did not both fill cannot reconcile it.
 *
 * Every lookup is therefore keyed on the staff member. An administrator is not
 * exempt: their own till work is their own shift, and they read across
 * everybody's takings on the Reports screen instead.
 */
const getOpenShiftForStmt = db.prepare(
  "SELECT * FROM shifts WHERE status = 'open' AND staff_id IS ? ORDER BY opened_at DESC LIMIT 1"
);

/** The signed-in person's open shift, or null. */
function openShiftFor(req) {
  const staffId = (req.user && req.user.staffId) || null;
  return getOpenShiftForStmt.get(staffId) || null;
}

function withTotals(shift) {
  if (!shift) return null;
  const totals = shiftTotalsStmt.get(shift.id);
  const spend = shiftExpensesStmt.get(shift.id);

  // What the drawer should hold right now: the float, plus cash taken in,
  // minus cash paid back out. Card and online sales never touch it.
  const expectedCash =
    Number(shift.opening_cash || 0) +
    Number(totals.cash_revenue || 0) -
    Number(spend.drawer_expenses || 0);

  return {
    ...shift,
    ...totals,
    ...spend,
    // A closed shift keeps the figure recorded at the time; a live one is
    // computed so the screen updates as sales and payouts happen.
    expected_cash: shift.status === 'closed' && shift.expected_cash !== null
      ? shift.expected_cash
      : expectedCash,
  };
}

// GET the currently open shift (or null)
router.get('/current', (req, res) => {
  try {
    const shift = openShiftFor(req);
    res.json(shift ? withTotals(shift) : null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET recent closed shifts
router.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  // Past shifts follow the same rule as the open one: a manager sees their own
  // history, an administrator sees the whole shop's.
  const isAdmin = !req.user || isAdminRole(req.user.role);
  try {
    const shifts = isAdmin
      ? db.prepare(
          "SELECT * FROM shifts WHERE status = 'closed' ORDER BY closed_at DESC LIMIT ?"
        ).all(limit)
      : db.prepare(
          "SELECT * FROM shifts WHERE status = 'closed' AND staff_id IS ? ORDER BY closed_at DESC LIMIT ?"
        ).all(req.user.staffId, limit);
    res.json(shifts.map(withTotals));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET a single shift's summary
router.get('/:id/summary', (req, res) => {
  try {
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    // Guarding the listings alone would leave the drawer readable by anyone
    // who guessed an id, which is the whole of what is being protected here.
    const isAdmin = !req.user || isAdminRole(req.user.role);
    if (!isAdmin && shift.staff_id !== req.user.staffId) {
      return res.status(403).json({ error: 'That shift belongs to another member of staff.' });
    }

    const topItems = db.prepare(`
      SELECT oi.name, SUM(oi.quantity) AS total_qty, SUM(oi.price * oi.quantity) AS total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.shift_id = ? AND o.status != 'voided'
      GROUP BY oi.name
      ORDER BY total_qty DESC
      LIMIT 10
    `).all(shift.id);

    res.json({ ...withTotals(shift), top_items: topItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST open a shift
router.post('/open', (req, res) => {
  const { opening_cash, staff_id, staff_name } = req.body;

  try {
    // Only this person's own open shift blocks them. Another manager having a
    // drawer open at the same time is the normal case, not a conflict.
    const existing = openShiftFor(req);
    if (existing) {
      return res.status(409).json({ error: 'You already have a shift open. Close it first.' });
    }

    // Local wall-clock, not CURRENT_TIMESTAMP's UTC — see db/database.js.
    const result = db.prepare(`
      INSERT INTO shifts (staff_id, staff_name, opening_cash, status, opened_at)
      VALUES (?, ?, ?, 'open', datetime('now', 'localtime'))
    `).run(
      // Ownership comes from the session, never the request body: it decides
      // who may later see and close this drawer.
      (req.user && req.user.staffId) || staff_id || null,
      (req.user && req.user.name) || staff_name || 'Unknown',
      Number(opening_cash) || 0
    );

    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(withTotals(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST close the open shift
router.post('/close', (req, res) => {
  const { closing_cash } = req.body;

  try {
    const shift = openShiftFor(req);
    if (!shift) return res.status(404).json({ error: 'You have no open shift to close' });

    const totals = shiftTotalsStmt.get(shift.id);
    const spend = shiftExpensesStmt.get(shift.id);

    // Expected drawer = float + cash taken in - cash paid out of the till.
    // Card and online sales never touch the drawer, so they are excluded, and
    // petty cash handed out has to come off or the count is short by that much.
    const expected =
      Number(shift.opening_cash || 0) +
      Number(totals.cash_revenue || 0) -
      Number(spend.drawer_expenses || 0);
    const actual = Number(closing_cash) || 0;

    db.prepare(`
      UPDATE shifts
      SET closing_cash = ?, expected_cash = ?, variance = ?,
          closed_at = datetime('now', 'localtime'), status = 'closed'
      WHERE id = ?
    `).run(actual, expected, actual - expected, shift.id);

    const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);
    res.json(withTotals(closed));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
