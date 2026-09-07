/**
 * Sales ingest.
 *
 * The opposite contract to the heartbeat next door: this channel must never
 * lose a row. A missed heartbeat is superseded a moment later; a missed sale is
 * money the owner never sees.
 *
 * The design that makes that survivable on a bad link is **idempotency**, not
 * careful delivery. On a fluctuating connection the till frequently cannot tell
 * whether a batch arrived — the request may have been answered after it gave
 * up, or the reply lost on the way back. Rather than trying to resolve that
 * ambiguity, re-sending is made harmless: every row is keyed on
 * `(branch_id, local_id)`, so the same batch applied three times leaves exactly
 * one copy of each sale.
 *
 * The branch always comes from the API key, never from the body.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/pg');
const { requireBranch } = require('../middleware/branch-auth');

/** Caps a single request. The till batches to match; a bad payload is refused before it is worked on. */
const MAX_ROWS = 200;

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v == null ? null : String(v));

/**
 * Build an idempotent upsert.
 *
 * Every synced table has the same shape — `(branch_id, local_id)` unique, the
 * rest refreshed on conflict — so the statement is generated rather than
 * written out five times and kept in step by hand.
 */
function upsertSql(table, columns) {
  const cols = ['branch_id', 'local_id', ...columns, 'received_at'];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = [...columns, 'received_at'].map(c => `${c} = EXCLUDED.${c}`).join(', ');
  return `
    INSERT INTO ${table} (${cols.join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (branch_id, local_id) DO UPDATE SET ${updates}
  `;
}

/*
 * Orders are mutable: one already sent can later be voided, and that has to
 * reach the cloud or the dashboard reports revenue the shop never took. Every
 * column is refreshed rather than only the void fields, so a correction of any
 * kind lands.
 */
const ORDER_COLS = [
  'total', 'discount', 'payment_method', 'status', 'cashier_name', 'cashier_id',
  'created_at', 'order_type', 'delivery_charge', 'local_shift_id', 'table_number',
  'voided_at', 'tax_rate', 'tax_amount', 'is_employee', 'employee_discount',
  'employee_discount_rate', 'voided_by', 'voided_by_id',
  'customer_name', 'customer_phone', 'customer_address',
];
const SHIFT_COLS = [
  'staff_id', 'staff_name', 'opening_cash', 'closing_cash', 'expected_cash',
  'variance', 'opened_at', 'closed_at', 'status',
];
const EXPENSE_COLS = [
  'local_shift_id', 'staff_id', 'staff_name', 'category', 'description',
  'amount', 'from_drawer', 'created_at',
];
const STAFF_COLS = ['name', 'role', 'color', 'active'];
const INGREDIENT_COLS = ['name', 'unit', 'stock', 'low_stock_threshold', 'cost_per_unit'];

async function ingestOrders(client, branchId, rows, receivedAt) {
  const orderSql = upsertSql('orders', ORDER_COLS);
  const itemSql = `
    INSERT INTO order_items (
      branch_id, local_id, order_id, menu_item_id, name, price, quantity,
      is_deal, variant_id, category
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (branch_id, local_id) DO UPDATE SET
      order_id = EXCLUDED.order_id, name = EXCLUDED.name, price = EXCLUDED.price,
      quantity = EXCLUDED.quantity, is_deal = EXCLUDED.is_deal,
      variant_id = EXCLUDED.variant_id, category = EXCLUDED.category
  `;

  for (const row of rows) {
    await client.query(orderSql, [
      branchId, num(row.id),
      num(row.total), num(row.discount), str(row.payment_method), str(row.status),
      str(row.cashier_name), num(row.cashier_id), str(row.created_at),
      str(row.order_type), num(row.delivery_charge), num(row.shift_id),
      str(row.table_number), str(row.voided_at), num(row.tax_rate), num(row.tax_amount),
      num(row.is_employee), num(row.employee_discount), num(row.employee_discount_rate),
      str(row.voided_by), num(row.voided_by_id),
      str(row.customer_name), str(row.customer_phone), str(row.customer_address),
      receivedAt,
    ]);

    /*
     * Remap the line items onto the CLOUD's order id.
     *
     * The till sends its own order id, which is only unique within that branch.
     * Storing it unchanged would make E-18's items join onto CBR Town's order of
     * the same number — quietly attributing one shop's food to the other's sale.
     */
    const found = await client.query(
      'SELECT id FROM orders WHERE branch_id = $1 AND local_id = $2',
      [branchId, num(row.id)]
    );
    const cloudOrderId = found.rows[0].id;

    for (const item of row.items || []) {
      await client.query(itemSql, [
        branchId, num(item.id), cloudOrderId, num(item.menu_item_id),
        str(item.name), num(item.price), num(item.quantity),
        num(item.is_deal), num(item.variant_id),
        // Resolved by the till, because menu item ids are per-machine and
        // cannot be resolved here.
        str(item.category),
      ]);
    }
  }
}

/** The simple tables: one upsert per row, no children to remap. */
function simpleIngest(table, columns, mapRow) {
  return async (client, branchId, rows, receivedAt) => {
    const sql = upsertSql(table, columns);
    for (const row of rows) {
      await client.query(sql, [branchId, num(row.id), ...mapRow(row), receivedAt]);
    }
  };
}

const HANDLERS = {
  orders: ingestOrders,

  shifts: simpleIngest('shifts', SHIFT_COLS, r => [
    num(r.staff_id), str(r.staff_name), num(r.opening_cash), num(r.closing_cash),
    num(r.expected_cash), num(r.variance), str(r.opened_at), str(r.closed_at), str(r.status),
  ]),

  expenses: simpleIngest('expenses', EXPENSE_COLS, r => [
    num(r.shift_id), num(r.staff_id), str(r.staff_name), str(r.category),
    str(r.description), num(r.amount), num(r.from_drawer), str(r.created_at),
  ]),

  // Staff and stock are pushed so the owner can see them on the dashboard.
  // Note what is absent from STAFF_COLS: the PIN, hashed or otherwise. It is
  // of no use here, and every copy of a credential is another place it can
  // leak from.
  staff: simpleIngest('staff', STAFF_COLS, r => [
    str(r.name), str(r.role), str(r.color), num(r.active),
  ]),

  ingredients: simpleIngest('ingredients', INGREDIENT_COLS, r => [
    str(r.name), str(r.unit), num(r.stock), num(r.low_stock_threshold), num(r.cost_per_unit),
  ]),
};

/**
 * POST /api/ingest/batch — one table's worth of pending rows.
 *
 * All-or-nothing: the whole batch commits or none of it does. A partial batch
 * would leave the till marking rows synced that the cloud never stored.
 */
router.post('/batch', requireBranch, async (req, res) => {
  const { table, rows } = req.body || {};
  const handler = HANDLERS[table];

  if (!handler) {
    return res.status(400).json({ error: `Unknown table "${table}"` });
  }
  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'rows must be an array' });
  }
  if (rows.length > MAX_ROWS) {
    return res.status(413).json({ error: `Batch too large (max ${MAX_ROWS} rows)` });
  }
  if (rows.length === 0) {
    return res.json({ ok: true, accepted: 0 });
  }

  try {
    const receivedAt = Date.now();

    await db.tx(async (client) => {
      await handler(client, req.branch.id, rows, receivedAt);
      await client.query(`
        INSERT INTO sync_cursor (branch_id, table_name, rows_received, last_synced_ms)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (branch_id, table_name) DO UPDATE SET
          rows_received = sync_cursor.rows_received + EXCLUDED.rows_received,
          last_synced_ms = EXCLUDED.last_synced_ms
      `, [req.branch.id, table, rows.length, receivedAt]);
    });

    // The till marks rows synced only on this reply, so it is the till's proof
    // that the data is durable here.
    res.json({ ok: true, accepted: rows.length });
  } catch (err) {
    console.error(`Ingest of ${table} failed:`, err.message);
    res.status(500).json({ error: 'Could not store batch' });
  }
});

module.exports = router;
