/**
 * Branch-owned data, read-only.
 *
 * Expenses, shifts, staff and stock all belong to the branch that records them.
 * The dashboard shows them; it does not change them, and the response shapes
 * deliberately match the till's own API so the POS screens can be reused
 * unaltered.
 *
 * **Why read-only, rather than an oversight.** There is no downlink for these.
 * Sales travel up; the only thing that comes down is the menu, and that works
 * precisely because the cloud is its single writer. A stock count edited in two
 * places at once has no correct resolution, and a PIN changed on the dashboard
 * could not reach a till that is offline — which is exactly when someone would
 * want to change it. Better an honest "recorded at the branch" than a button
 * that appears to work and silently does nothing.
 *
 * Every figure here is derived from what the tills have actually delivered, so
 * it is only as current as the last successful sync. `/api/branches/completeness`
 * is what tells the dashboard how far behind that is.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/pg');
const { requireUser } = require('../middleware/session');
const { localToday } = require('../db/local-date');

/** Narrow to one branch when asked, or to a per-branch account's own site. */
function scope(req, alias) {
  const pinned = req.user && req.user.branchId;
  const branch = pinned || Number(req.query.branch) || null;
  if (!branch) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.branch_id = ?`, params: [branch] };
}

const range = (req) => ({
  from: req.query.from || localToday(),
  to: req.query.to || localToday(),
});

/* ------------------------------------------------------------- expenses -- */

/** Mirrors the till's list: the rows, plus totals split drawer vs not. */
router.get('/expenses', requireUser, async (req, res) => {
  const { from, to } = range(req);
  const s = scope(req, 'e');
  try {
    const expenses = await db.q(`
      SELECT e.local_id AS id, e.created_at, e.category, e.description,
             e.amount, e.from_drawer, e.staff_name, e.staff_id,
             e.local_shift_id AS shift_id, b.name AS branch_name
        FROM expenses e
        LEFT JOIN branches b ON b.id = e.branch_id
       WHERE e.created_at::date BETWEEN ?::date AND ?::date${s.sql}
       ORDER BY e.created_at DESC, e.local_id DESC
    `, [from, to, ...s.params]);

    const totals = await db.one(`
      SELECT COALESCE(SUM(e.amount), 0)::float8 AS total,
             COALESCE(SUM(CASE WHEN e.from_drawer = 1 THEN e.amount ELSE 0 END), 0)::float8 AS from_drawer_total,
             COUNT(*)::int AS count
        FROM expenses e
       WHERE e.created_at::date BETWEEN ?::date AND ?::date${s.sql}
    `, [from, to, ...s.params]);

    res.json({ expenses, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * The categories actually used, rather than the till's fixed list.
 *
 * The dashboard cannot create an expense, so offering categories nobody has
 * used would be listing options that lead nowhere.
 */
router.get('/expenses/categories', requireUser, async (req, res) => {
  try {
    const rows = await db.q(
      'SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL ORDER BY category');
    res.json(rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --------------------------------------------------------------- shifts -- */

/*
 * Shift totals, recomputed from the synced orders and expenses.
 *
 * The same arithmetic as db/shift-totals.js on the till: the float, plus cash
 * taken in, minus cash paid back out. A closed shift keeps the figure counted
 * at the time, because that is the number the manager actually reconciled
 * against — recomputing it from later-synced rows would quietly rewrite it.
 */
const SHIFT_SELECT = `
  SELECT
    s.local_id AS id, s.staff_id, s.staff_name, s.opening_cash, s.closing_cash,
    s.variance, s.opened_at, s.closed_at, s.status, s.branch_id,
    b.name AS branch_name,
    COALESCE(o.total_orders, 0)      AS total_orders,
    COALESCE(o.total_revenue, 0)     AS total_revenue,
    COALESCE(o.total_discounts, 0)   AS total_discounts,
    COALESCE(o.cash_revenue, 0)      AS cash_revenue,
    COALESCE(o.non_cash_revenue, 0)  AS non_cash_revenue,
    COALESCE(x.drawer_expenses, 0)   AS drawer_expenses,
    COALESCE(x.expense_count, 0)     AS expense_count,
    CASE
      WHEN s.status = 'closed' AND s.expected_cash IS NOT NULL THEN s.expected_cash
      ELSE COALESCE(s.opening_cash, 0) + COALESCE(o.cash_revenue, 0) - COALESCE(x.drawer_expenses, 0)
    END AS expected_cash
  FROM shifts s
  LEFT JOIN branches b ON b.id = s.branch_id
  LEFT JOIN (
    SELECT branch_id, local_shift_id,
           COUNT(*)::int AS total_orders,
           COALESCE(SUM(total), 0)::float8 AS total_revenue,
           COALESCE(SUM(discount), 0)::float8 AS total_discounts,
           COALESCE(SUM(CASE WHEN LOWER(payment_method) = 'cash' THEN total ELSE 0 END), 0)::float8 AS cash_revenue,
           COALESCE(SUM(CASE WHEN LOWER(payment_method) <> 'cash' THEN total ELSE 0 END), 0)::float8 AS non_cash_revenue
      FROM orders WHERE status <> 'voided'
     GROUP BY branch_id, local_shift_id
  ) o ON o.branch_id = s.branch_id AND o.local_shift_id = s.local_id
  LEFT JOIN (
    SELECT branch_id, local_shift_id,
           COALESCE(SUM(amount), 0)::float8 AS drawer_expenses,
           COUNT(*)::int AS expense_count
      FROM expenses WHERE from_drawer = 1
     GROUP BY branch_id, local_shift_id
  ) x ON x.branch_id = s.branch_id AND x.local_shift_id = s.local_id
`;

/**
 * Whatever is open right now, across the branches in view.
 *
 * The till returns a single shift because a till has one drawer. Here there can
 * be one per branch, so this returns the most recently opened and the dashboard's
 * Live tab is the place to see them side by side.
 */
router.get('/shifts/current', requireUser, async (req, res) => {
  const s = scope(req, 's');
  try {
    const rows = await db.q(
      `${SHIFT_SELECT} WHERE s.status = 'open'${s.sql} ORDER BY s.opened_at DESC LIMIT 1`,
      s.params);
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/shifts/history', requireUser, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const s = scope(req, 's');
  try {
    res.json(await db.q(
      `${SHIFT_SELECT} WHERE s.status = 'closed'${s.sql} ORDER BY s.closed_at DESC LIMIT ?`,
      [...s.params, limit]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------- staff -- */

/** Matches the till's staff list, including the today figures its cards show. */
router.get('/staff', requireUser, async (req, res) => {
  const s = scope(req, 'st');
  const today = localToday();
  try {
    res.json(await db.q(`
      SELECT
        st.local_id AS id, st.name, st.role, st.color, st.active,
        st.branch_id, b.name AS branch_name,
        COALESCE((
          SELECT COUNT(*)::int FROM orders o
           WHERE o.branch_id = st.branch_id AND o.cashier_id = st.local_id
             AND o.status <> 'voided' AND o.created_at::date = ?::date
        ), 0) AS "todayOrders",
        COALESCE((
          SELECT SUM(o.total)::float8 FROM orders o
           WHERE o.branch_id = st.branch_id AND o.cashier_id = st.local_id
             AND o.status <> 'voided' AND o.created_at::date = ?::date
        ), 0) AS "todayRevenue"
      FROM staff st
      LEFT JOIN branches b ON b.id = st.branch_id
      WHERE 1 = 1${s.sql}
      ORDER BY st.role DESC, st.name ASC
    `, [today, today, ...s.params]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Per-person takings over a range, as the till's Staff screen expects. */
router.get('/staff/performance', requireUser, async (req, res) => {
  const { from, to } = range(req);
  const s = scope(req, 'st');
  try {
    res.json(await db.q(`
      SELECT
        st.local_id AS id, st.name, st.role, st.color, st.active,
        b.name AS branch_name,
        COALESCE(agg.orders, 0)  AS orders,
        COALESCE(agg.revenue, 0) AS revenue,
        COALESCE(agg.avg_order_value, 0) AS avg_order_value
      FROM staff st
      LEFT JOIN branches b ON b.id = st.branch_id
      LEFT JOIN (
        SELECT branch_id, cashier_id,
               COUNT(*)::int AS orders,
               COALESCE(SUM(total), 0)::float8 AS revenue,
               COALESCE(AVG(total), 0)::float8 AS avg_order_value
          FROM orders
         WHERE status <> 'voided' AND created_at::date BETWEEN ?::date AND ?::date
         GROUP BY branch_id, cashier_id
      ) agg ON agg.branch_id = st.branch_id AND agg.cashier_id = st.local_id
      WHERE 1 = 1${s.sql}
      ORDER BY revenue DESC
    `, [from, to, ...s.params]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ------------------------------------------------------------ inventory -- */

/**
 * Stock, per branch.
 *
 * Genuinely different at each site — one shop running low on cheese says
 * nothing about the other — so the branch is included on every row rather than
 * the two being summed into a single misleading number.
 */
router.get('/inventory', requireUser, async (req, res) => {
  const s = scope(req, 'i');
  try {
    res.json(await db.q(`
      SELECT i.local_id AS id, i.name, i.unit, i.stock,
             i.low_stock_threshold, i.cost_per_unit,
             i.branch_id, b.name AS branch_name
        FROM ingredients i
        LEFT JOIN branches b ON b.id = i.branch_id
       WHERE 1 = 1${s.sql}
       ORDER BY b.name NULLS FIRST, i.name
    `, s.params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
