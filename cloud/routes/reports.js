/**
 * Reporting — the cloud's copy.
 *
 * Ported from backend/routes/reports.js, and deliberately kept as close to it
 * as possible. Because the cloud runs SQLite too, the queries carry over
 * unchanged: `strftime`, `DATE()` and the rest all behave identically, so there
 * is no dialect rewrite to get subtly wrong. A silently different `GROUP BY`
 * produces plausible wrong numbers rather than an error, which is exactly the
 * bug you never find.
 *
 * Only three things differ from the till's copy, each marked CLOUD: below.
 *
 *   1. Scoping. The till scopes a manager to their own sales; here the owner
 *      sees everything and may narrow with `?branch=`. A future per-branch
 *      login is pinned to its branch and cannot widen.
 *   2. Category comes from the stored `order_items.category` rather than a join
 *      to `menu_items` — menu item ids are per-machine, so that join is not
 *      resolvable here. See cloud/db/sales-schema.js.
 *   3. `shift_id` is `local_shift_id`, since the till's ids are only unique
 *      within their own branch.
 *
 * When the till's reporting changes, this file must change with it. Keeping
 * them textually similar is what makes that diff readable.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');

const { localToday } = require('../db/local-date');
const { requireUser } = require('../middleware/session');

/**
 * CLOUD: narrow a report to one branch.
 *
 * The till's copy also scopes a manager to their own sales. Here the reader is
 * the owner, who sees the whole shop and may narrow with `?branch=<id>`.
 *
 * A dashboard account carrying a `branch_id` — none today, but the column
 * exists so per-branch logins are a row rather than a migration — is pinned to
 * that branch and cannot widen the view by passing a different one.
 */
function scopeOrders(req, alias = 'orders') {
  const pinned = req.user && req.user.branchId;
  const branch = pinned || Number(req.query.branch) || null;
  if (!branch) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.branch_id = ?`, params: [branch] };
}

/** CLOUD: the same, for expenses. */
function scopeExpenses(req, alias = 'expenses') {
  const pinned = req.user && req.user.branchId;
  const branch = pinned || Number(req.query.branch) || null;
  if (!branch) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.branch_id = ?`, params: [branch] };
}

function getDateRange(req) {
  // Local wall-clock, not toISOString's UTC — at UTC+5 that named yesterday
  // for the first five hours of every trading day.
  const today = localToday();
  const from = req.query.from || today;
  const to = req.query.to || today;
  return { from, to };
}

// KPI summary
router.get('/kpi', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeOrders(req);
  const expScope = scopeExpenses(req);
  try {
    const summary = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(AVG(total), 0) as avg_order_value,
        COALESCE(SUM(discount), 0) as total_discounts
      FROM orders
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
      AND status != 'voided'${scope.sql}
    `).get(from, to, ...scope.params);

    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - (new Date(to) - new Date(from)) / 86400000 - 1);
    const prevTo = new Date(from);
    prevTo.setDate(prevTo.getDate() - 1);

    const prev = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total_revenue, COUNT(*) as total_orders
      FROM orders
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
      AND status != 'voided'${scope.sql}
    `).get(prevFrom.toISOString().split('T')[0], prevTo.toISOString().split('T')[0], ...scope.params);

    /*
     * Expenses belong on the headline, not in a corner.
     *
     * Takings alone flatter the day: a shop can ring up 40,000 and still be
     * down if 9,000 went out on fuel and supplies. `net_revenue` is what the
     * owner actually keeps, and it is the figure the KPI row leads with.
     *
     * Every expense counts here, not only the ones paid out of the drawer —
     * the drawer flag is about reconciling the till, whereas this is about
     * what the day cost. That distinction is preserved in the split below so
     * the two questions never get confused.
     */
    const expenses = db.prepare(`
      SELECT
        COALESCE(SUM(amount), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN from_drawer = 1 THEN amount ELSE 0 END), 0) AS drawer_expenses,
        COUNT(*) AS expense_count
      FROM expenses
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${expScope.sql}
    `).get(from, to, ...expScope.params);

    const revenueTrend = prev.total_revenue > 0
      ? (((summary.total_revenue - prev.total_revenue) / prev.total_revenue) * 100).toFixed(1)
      : 0;
    const ordersTrend = prev.total_orders > 0
      ? (((summary.total_orders - prev.total_orders) / prev.total_orders) * 100).toFixed(1)
      : 0;

    res.json({
      ...summary,
      ...expenses,
      net_revenue: summary.total_revenue - expenses.total_expenses,
      revenue_trend: revenueTrend,
      orders_trend: ordersTrend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revenue over time
router.get('/revenue-over-time', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const groupBy = req.query.groupBy || 'day';
  const scope = scopeOrders(req);
  try {
    let query;
    if (groupBy === 'hour') {
      query = `
        SELECT strftime('%H:00', created_at) as period,
               COALESCE(SUM(total), 0) as revenue,
               COUNT(*) as orders
        FROM orders
        WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        AND status != 'voided'${scope.sql}
        GROUP BY strftime('%H', created_at)
        ORDER BY strftime('%H', created_at)
      `;
    } else if (groupBy === 'month') {
      query = `
        SELECT strftime('%Y-%m', created_at) as period,
               COALESCE(SUM(total), 0) as revenue,
               COUNT(*) as orders
        FROM orders
        WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        AND status != 'voided'${scope.sql}
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY period
      `;
    } else {
      query = `
        SELECT DATE(created_at) as period,
               COALESCE(SUM(total), 0) as revenue,
               COUNT(*) as orders
        FROM orders
        WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        AND status != 'voided'${scope.sql}
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at)
      `;
    }
    const data = db.prepare(query).all(from, to, ...scope.params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top selling items
router.get('/top-items', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeOrders(req, 'o');
  try {
    const items = db.prepare(`
      SELECT
        oi.name,
        SUM(oi.quantity) as total_qty,
        SUM(oi.price * oi.quantity) as total_revenue,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      AND o.status != 'voided'${scope.sql}
      GROUP BY oi.name
      ORDER BY total_qty DESC
      LIMIT 10
    `).all(from, to, ...scope.params);

    const totalRevenue = items.reduce((s, i) => s + i.total_revenue, 0);
    const result = items.map(i => ({
      ...i,
      percentage: totalRevenue > 0 ? ((i.total_revenue / totalRevenue) * 100).toFixed(1) : 0
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sales by category
router.get('/by-category', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeOrders(req, 'o');
  try {
    // CLOUD: the till resolves the category at push time and sends it, because
    // menu item ids are per-machine and the join is not resolvable here. The
    // till's own version of this query carries the reasoning behind the CASE it
    // uses — deals share an id space with menu items, so they get their own
    // bucket rather than being filed under an unrelated item's category.
    const data = db.prepare(`
      SELECT
        COALESCE(oi.category, 'Uncategorized') AS category,
        SUM(oi.quantity) as total_qty,
        SUM(oi.price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN branches br ON br.id = o.branch_id
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      AND o.status != 'voided'${scope.sql}
      GROUP BY category
      ORDER BY total_revenue DESC
    `).all(from, to, ...scope.params);

    const totalRevenue = data.reduce((s, i) => s + i.total_revenue, 0);
    const result = data.map(i => ({
      ...i,
      percentage: totalRevenue > 0 ? ((i.total_revenue / totalRevenue) * 100).toFixed(1) : 0
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hourly heatmap — last 7 days by default
router.get('/hourly-heatmap', requireUser, (req, res) => {
  const scope = scopeOrders(req);
  try {
    const data = db.prepare(`
      SELECT
        CASE strftime('%w', created_at)
          WHEN '0' THEN 'Sun'
          WHEN '1' THEN 'Mon'
          WHEN '2' THEN 'Tue'
          WHEN '3' THEN 'Wed'
          WHEN '4' THEN 'Thu'
          WHEN '5' THEN 'Fri'
          WHEN '6' THEN 'Sat'
        END as day,
        strftime('%w', created_at) as day_num,
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE DATE(created_at) >= DATE('now', '-30 days')
      AND status != 'voided'${scope.sql}
      GROUP BY day_num, hour
      ORDER BY day_num, hour
    `).all(...scope.params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cashier performance
router.get('/cashier-performance', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeOrders(req, 'o');
  try {
    const data = db.prepare(`
      SELECT
        o.cashier_id,
        o.cashier_name,
        COUNT(*) as total_orders,
        COALESCE(SUM(o.total), 0) as total_revenue,
        COALESCE(AVG(o.total), 0) as avg_order_value,
        COALESCE(SUM(o.discount), 0) as total_discounts
      FROM orders o
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
      AND o.status != 'voided'${scope.sql}
      GROUP BY o.cashier_id, o.cashier_name
      ORDER BY total_revenue DESC
    `).all(from, to, ...scope.params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Detailed report — one row per order. Backs the Reports table and the
 * "Detailed" CSV export.
 *
 * Previously this returned `o.*` plus `items_summary`, but both the table and
 * the exporter read `row.subtotal` and `row.items`. Neither existed:
 * `subtotal` is not a column on `orders` (only total/discount/delivery_charge
 * are), and the concatenated item list was named `items_summary`. The result
 * was `undefined.toLocaleString()` — a hard render crash on the Detailed tab —
 * and `undefined.replace()` in the exporter, so the CSV never downloaded.
 *
 * `subtotal` is now derived from the order's own line items, which is the
 * authoritative figure: total = subtotal - discount + delivery_charge.
 *
 * Voided orders are excluded by default so these rows reconcile with the KPI
 * cards and every other report; pass include_voided=1 to audit them.
 */
router.get('/detailed', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const includeVoided = req.query.include_voided === '1' || req.query.include_voided === 'true';
  const scope = scopeOrders(req, 'o');

  try {
    const orders = db.prepare(`
      SELECT
        -- CLOUD: the till's own number, not the cloud's row id. This is the
        -- number printed on the customer's receipt and written in the shop's
        -- own records, so it is the only one the owner can cross-reference.
        -- The cloud's own id exists purely to join rows together.
        o.local_id AS id,
        o.created_at,
        o.cashier_id,
        o.cashier_name,
        o.order_type,
        o.table_number,
        o.payment_method,
        o.status,
        o.discount,
        o.tax_rate,
        o.tax_amount,
        o.is_employee,
        o.employee_discount,
        o.employee_discount_rate,
        o.voided_by,
        o.customer_name,
        o.customer_phone,
        o.customer_address,
        o.delivery_charge,
        o.total,
        br.name AS branch_name,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS subtotal,
        COALESCE(SUM(oi.quantity), 0)            AS total_qty,
        COUNT(oi.id)                             AS line_count,
        GROUP_CONCAT(oi.name || ' x' || oi.quantity, ', ') AS items
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN branches br ON br.id = o.branch_id
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
        ${includeVoided ? '' : "AND o.status != 'voided'"}${scope.sql}
      GROUP BY o.id
      ORDER BY o.created_at ASC
    `).all(from, to, ...scope.params);

    // GROUP_CONCAT returns NULL for an order with no line items.
    res.json(orders.map(o => ({ ...o, items: o.items || '' })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Line-item report — one row per item sold, rather than per order.
 *
 * This is what makes an item-level CSV possible: which dish sold, when, at
 * what unit price, on whose till. Category is resolved through menu_items and
 * falls back to 'Deal / Removed Item' when the id does not resolve, which is
 * the case for deals (they record the deal's id, not a menu item's) and for
 * items deleted from the menu after the sale.
 */
router.get('/line-items', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const includeVoided = req.query.include_voided === '1' || req.query.include_voided === 'true';
  const scope = scopeOrders(req, 'o');

  try {
    const rows = db.prepare(`
      SELECT
        -- CLOUD: the till's own order number — see /detailed above.
        o.local_id      AS order_id,
        o.created_at,
        o.cashier_name,
        o.order_type,
        o.table_number,
        o.payment_method,
        o.status,
        br.name         AS branch_name,
        oi.name         AS item_name,
        -- CLOUD: resolved by the till at push time.
        COALESCE(oi.category, 'Removed Item') AS category,
        oi.quantity,
        oi.price        AS unit_price,
        (oi.price * oi.quantity) AS line_total
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN branches br ON br.id = o.branch_id
      WHERE DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)
        ${includeVoided ? '' : "AND o.status != 'voided'"}${scope.sql}
      ORDER BY o.created_at ASC, oi.id ASC
    `).all(from, to, ...scope.params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Daily summary
router.get('/daily', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeOrders(req);
  const expScope = scopeExpenses(req);
  try {
    /*
     * The day-by-day summary, with what was spent set against what was taken.
     *
     * The list of days is a UNION of both tables rather than just the sales
     * table. A day the shop was shut but still paid a supplier has expenses
     * and no orders; driving the report off orders alone would drop that day
     * entirely and quietly overstate the period's net.
     */
    const data = db.prepare(`
      WITH days AS (
        SELECT DISTINCT DATE(created_at) AS date FROM orders
         WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)
           AND status != 'voided'${scope.sql}
        UNION
        SELECT DISTINCT DATE(created_at) AS date FROM expenses
         WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${expScope.sql}
      )
      SELECT
        d.date,
        COALESCE(o.total_orders, 0)     AS total_orders,
        COALESCE(o.total_revenue, 0)    AS total_revenue,
        COALESCE(o.total_discounts, 0)  AS total_discounts,
        COALESCE(o.avg_order_value, 0)  AS avg_order_value,
        COALESCE(x.total_expenses, 0)   AS total_expenses,
        COALESCE(x.drawer_expenses, 0)  AS drawer_expenses,
        COALESCE(o.total_revenue, 0) - COALESCE(x.total_expenses, 0) AS net_revenue
      FROM days d
      LEFT JOIN (
        SELECT DATE(created_at) AS date,
               COUNT(*) AS total_orders,
               SUM(total) AS total_revenue,
               SUM(discount) AS total_discounts,
               AVG(total) AS avg_order_value
          FROM orders
         WHERE status != 'voided'${scope.sql}
         GROUP BY DATE(created_at)
      ) o ON o.date = d.date
      LEFT JOIN (
        SELECT DATE(created_at) AS date,
               SUM(amount) AS total_expenses,
               SUM(CASE WHEN from_drawer = 1 THEN amount ELSE 0 END) AS drawer_expenses
          FROM expenses
         WHERE 1 = 1${expScope.sql}
         GROUP BY DATE(created_at)
      ) x ON x.date = d.date
      ORDER BY d.date DESC
    `).all(
      from, to, ...scope.params,
      from, to, ...expScope.params,
      ...scope.params,
      ...expScope.params
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Expenses grouped by what the money went on.
 *
 * The mirror image of Sales by Category: that answers where the money came
 * from, this answers where it went. Together they are the whole day.
 */
router.get('/expenses-by-category', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeExpenses(req);
  try {
    res.json(db.prepare(`
      SELECT
        category,
        COUNT(*) AS entries,
        COALESCE(SUM(amount), 0) AS total,
        COALESCE(SUM(CASE WHEN from_drawer = 1 THEN amount ELSE 0 END), 0) AS from_drawer_total
      FROM expenses
      WHERE DATE(created_at) BETWEEN DATE(?) AND DATE(?)${scope.sql}
      GROUP BY category
      ORDER BY total DESC
    `).all(from, to, ...scope.params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Every expense in the period, line by line.
 *
 * Feeds both the on-screen table and the CSV/Excel export, so the owner can
 * account for each payout individually — who recorded it, what for, whether it
 * came out of the till, and which branch it belongs to.
 */
router.get('/expenses-detail', requireUser, (req, res) => {
  const { from, to } = getDateRange(req);
  const scope = scopeExpenses(req, 'e');
  try {
    res.json(db.prepare(`
      SELECT
        -- CLOUD: the till's own number — see /detailed above.
        e.local_id AS id,
        e.created_at,
        e.category,
        e.description,
        e.amount,
        e.from_drawer,
        e.staff_name,
        -- CLOUD: the till's own shift number, which is only unique within its
        -- branch — hence the column name.
        e.local_shift_id AS shift_id,
        b.name AS branch_name
      FROM expenses e
      LEFT JOIN branches b ON b.id = e.branch_id
      WHERE DATE(e.created_at) BETWEEN DATE(?) AND DATE(?)${scope.sql}
      ORDER BY e.created_at DESC, e.id DESC
    `).all(from, to, ...scope.params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
