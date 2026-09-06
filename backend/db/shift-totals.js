/**
 * A shift's live totals.
 *
 * Extracted from routes/shifts.js so that the local Shift screen and the cloud
 * heartbeat are produced by *the same* code. If the dashboard computed its own
 * figures they would eventually disagree with the till's, and the owner would
 * be right to trust neither.
 */

const db = require('./database');

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

/**
 * Every shift currently open on this machine, whoever opened it.
 *
 * Deliberately not exposed as a route. The HTTP surface is scoped per user on
 * purpose — one manager must not read another's drawer — but the sync agent
 * reports for the whole till, so it needs a way past that which is reachable
 * only in-process.
 */
function allOpenShifts() {
  return db.prepare(
    "SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at ASC"
  ).all().map(withTotals);
}

module.exports = {
  shiftTotalsStmt,
  shiftExpensesStmt,
  getOpenShiftForStmt,
  openShiftFor,
  withTotals,
  allOpenShifts,
};
