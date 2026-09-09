const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveBranchId } = require('../db/branch');
const { isAdminRole, requireAdmin } = require('../middleware/auth');
const {
  openShiftFor, withTotals, shiftTotalsStmt, shiftExpensesStmt,
} = require('../db/shift-totals');

/**
 * Shift management.
 *
 * FIX (Bug 5): the Settings > Shift screen previously rendered hardcoded
 * numbers — 23 orders, Rs. 12,400, and three invented history rows that
 * existed only in React state and vanished on refresh. Every figure below is
 * now derived from the orders actually rung up during the shift.
 */

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
  // An administrator may narrow to one site, the same way the reports screen
  // does. A manager cannot: they already see only their own drawers.
  const branch = isAdmin ? Number(req.query.branch) || null : null;
  try {
    const shifts = isAdmin
      ? (branch
          ? db.prepare(
              "SELECT * FROM shifts WHERE status = 'closed' AND branch_id = ? ORDER BY closed_at DESC LIMIT ?"
            ).all(branch, limit)
          : db.prepare(
              "SELECT * FROM shifts WHERE status = 'closed' ORDER BY closed_at DESC LIMIT ?"
            ).all(limit))
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
      INSERT INTO shifts (staff_id, staff_name, opening_cash, status, opened_at, branch_id)
      VALUES (?, ?, ?, 'open', datetime('now', 'localtime'), ?)
    `).run(
      // Ownership comes from the session, never the request body: it decides
      // who may later see and close this drawer.
      (req.user && req.user.staffId) || staff_id || null,
      (req.user && req.user.name) || staff_name || 'Unknown',
      Number(opening_cash) || 0,
      // Where the drawer physically is, taken from the machine rather than
      // from whoever is signed in — see db/branch.js.
      resolveBranchId(req)
    );

    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(withTotals(shift));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
 * Close a shift.
 *
 * `/close` closes your own. `/:id/close` closes anybody's and is administrator
 * only — without it a drawer left open by somebody who has gone home could not
 * be closed by anyone at all, because openShiftFor() is strictly the signed-in
 * person's own shift and always has been, for administrators too.
 *
 * That was survivable while the app could still be shut down over an open
 * shift. It stopped being survivable when closing the POS started requiring
 * every shift to be closed first: without this route a forgotten drawer would
 * leave the till unable to close, with nobody able to do anything about it.
 */
function closeShift(shift, req, res) {
  if (!shift) return res.status(404).json({ error: 'You have no open shift to close' });
  const { closing_cash } = req.body;

  try {
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
          closed_at = datetime('now', 'localtime'), status = 'closed',
          -- A shift the cloud already holds as open has just gained its
          -- closing count and variance, so it has to go up again.
          sync_state = 'pending'
      WHERE id = ?
    `).run(actual, expected, actual - expected, shift.id);

    const closed = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift.id);
    res.json(withTotals(closed));

    /*
     * Closing the drawer is the natural end of the trading day, so push now
     * rather than waiting for the timer — it is what gives the owner their
     * end-of-day figures without anyone remembering to press anything.
     *
     * Deliberately after res.json and deliberately not awaited: the manager is
     * standing at the till waiting for their variance, and must never wait on
     * the network to get it.
     */
    require('../sync/push').syncOnce().catch(() => { /* the timer will retry */ });

    /*
     * And take a backup, for the same reason.
     *
     * A closed drawer is a complete day, and it is the moment a shop is most
     * likely to shut the machine down — so it is the last chance to capture
     * the day before anything can happen to it overnight. Forced past the
     * unchanged-check, because a day that ends exactly as the last upload left
     * it is still a day worth having its own copy of.
     */
    require('../sync/backup-upload')
      .uploadOnce({ force: true, reason: 'shift-close' })
      .catch(() => { /* the timer will retry; never block a close */ });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Your own.
router.post('/close', (req, res) => closeShift(openShiftFor(req), req, res));

/*
 * Anybody's, by id. Administrator only.
 *
 * The drawer somebody went home without counting. The variance is recorded
 * against whoever opened it, exactly as if they had closed it themselves —
 * this changes who presses the button, not whose shift it was.
 */
router.post('/:id/close', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad shift.' });
  const shift = db.prepare("SELECT * FROM shifts WHERE id = ? AND status = 'open'").get(id);
  if (!shift) return res.status(404).json({ error: 'No open shift with that number.' });
  return closeShift(shift, req, res);
});

module.exports = router;
