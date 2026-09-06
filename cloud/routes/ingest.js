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
const db = require('../db/database');
const { requireBranch } = require('../middleware/branch-auth');

/** Caps a single request. The till batches to match; a bad payload is refused before it is worked on. */
const MAX_ROWS = 200;

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v == null ? null : String(v));

const upsertOrder = db.prepare(`
  INSERT INTO orders (
    branch_id, local_id, total, discount, payment_method, status, cashier_name,
    cashier_id, created_at, order_type, delivery_charge, local_shift_id,
    table_number, voided_at, tax_rate, tax_amount, is_employee,
    employee_discount, employee_discount_rate, voided_by, voided_by_id,
    customer_name, customer_phone, customer_address, received_at
  ) VALUES (
    @branch_id, @local_id, @total, @discount, @payment_method, @status, @cashier_name,
    @cashier_id, @created_at, @order_type, @delivery_charge, @local_shift_id,
    @table_number, @voided_at, @tax_rate, @tax_amount, @is_employee,
    @employee_discount, @employee_discount_rate, @voided_by, @voided_by_id,
    @customer_name, @customer_phone, @customer_address, @received_at
  )
  ON CONFLICT(branch_id, local_id) DO UPDATE SET
    -- Orders are mutable: an order already sent can later be voided, and that
    -- has to reach the cloud or the dashboard reports revenue the shop never
    -- took. Everything is refreshed rather than only the void fields, so a
    -- correction of any kind lands.
    total = excluded.total, discount = excluded.discount,
    payment_method = excluded.payment_method, status = excluded.status,
    cashier_name = excluded.cashier_name, cashier_id = excluded.cashier_id,
    created_at = excluded.created_at, order_type = excluded.order_type,
    delivery_charge = excluded.delivery_charge, local_shift_id = excluded.local_shift_id,
    table_number = excluded.table_number, voided_at = excluded.voided_at,
    tax_rate = excluded.tax_rate, tax_amount = excluded.tax_amount,
    is_employee = excluded.is_employee, employee_discount = excluded.employee_discount,
    employee_discount_rate = excluded.employee_discount_rate,
    voided_by = excluded.voided_by, voided_by_id = excluded.voided_by_id,
    customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
    customer_address = excluded.customer_address, received_at = excluded.received_at
`);

const findOrderId = db.prepare('SELECT id FROM orders WHERE branch_id = ? AND local_id = ?');

const upsertItem = db.prepare(`
  INSERT INTO order_items (
    branch_id, local_id, order_id, menu_item_id, name, price, quantity,
    is_deal, variant_id, category
  ) VALUES (
    @branch_id, @local_id, @order_id, @menu_item_id, @name, @price, @quantity,
    @is_deal, @variant_id, @category
  )
  ON CONFLICT(branch_id, local_id) DO UPDATE SET
    order_id = excluded.order_id, name = excluded.name, price = excluded.price,
    quantity = excluded.quantity, is_deal = excluded.is_deal,
    variant_id = excluded.variant_id, category = excluded.category
`);

const upsertShift = db.prepare(`
  INSERT INTO shifts (
    branch_id, local_id, staff_id, staff_name, opening_cash, closing_cash,
    expected_cash, variance, opened_at, closed_at, status, received_at
  ) VALUES (
    @branch_id, @local_id, @staff_id, @staff_name, @opening_cash, @closing_cash,
    @expected_cash, @variance, @opened_at, @closed_at, @status, @received_at
  )
  ON CONFLICT(branch_id, local_id) DO UPDATE SET
    -- A shift is sent while open and again once counted, so it must update.
    staff_id = excluded.staff_id, staff_name = excluded.staff_name,
    opening_cash = excluded.opening_cash, closing_cash = excluded.closing_cash,
    expected_cash = excluded.expected_cash, variance = excluded.variance,
    opened_at = excluded.opened_at, closed_at = excluded.closed_at,
    status = excluded.status, received_at = excluded.received_at
`);

const upsertExpense = db.prepare(`
  INSERT INTO expenses (
    branch_id, local_id, local_shift_id, staff_id, staff_name, category,
    description, amount, from_drawer, created_at, received_at
  ) VALUES (
    @branch_id, @local_id, @local_shift_id, @staff_id, @staff_name, @category,
    @description, @amount, @from_drawer, @created_at, @received_at
  )
  ON CONFLICT(branch_id, local_id) DO UPDATE SET
    local_shift_id = excluded.local_shift_id, staff_id = excluded.staff_id,
    staff_name = excluded.staff_name, category = excluded.category,
    description = excluded.description, amount = excluded.amount,
    from_drawer = excluded.from_drawer, created_at = excluded.created_at,
    received_at = excluded.received_at
`);

const bumpCursor = db.prepare(`
  INSERT INTO sync_cursor (branch_id, table_name, rows_received, last_synced_ms)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(branch_id, table_name) DO UPDATE SET
    rows_received = sync_cursor.rows_received + excluded.rows_received,
    last_synced_ms = excluded.last_synced_ms
`);

function ingestOrders(branchId, rows, receivedAt) {
  for (const row of rows) {
    upsertOrder.run({
      branch_id: branchId,
      local_id: num(row.id),
      total: num(row.total),
      discount: num(row.discount),
      payment_method: str(row.payment_method),
      status: str(row.status),
      cashier_name: str(row.cashier_name),
      cashier_id: num(row.cashier_id),
      created_at: str(row.created_at),
      order_type: str(row.order_type),
      delivery_charge: num(row.delivery_charge),
      local_shift_id: num(row.shift_id),
      table_number: str(row.table_number),
      voided_at: str(row.voided_at),
      tax_rate: num(row.tax_rate),
      tax_amount: num(row.tax_amount),
      is_employee: num(row.is_employee),
      employee_discount: num(row.employee_discount),
      employee_discount_rate: num(row.employee_discount_rate),
      voided_by: str(row.voided_by),
      voided_by_id: num(row.voided_by_id),
      customer_name: str(row.customer_name),
      customer_phone: str(row.customer_phone),
      customer_address: str(row.customer_address),
      received_at: receivedAt,
    });

    /*
     * Remap the line items onto the CLOUD's order id.
     *
     * The till sends its own order id, which is only unique within that branch.
     * Storing it unchanged would make E-18's items join onto CBR Town's order of
     * the same number — quietly attributing one shop's food to the other's sale.
     */
    const cloudOrderId = findOrderId.get(branchId, num(row.id)).id;

    for (const item of row.items || []) {
      upsertItem.run({
        branch_id: branchId,
        local_id: num(item.id),
        order_id: cloudOrderId,
        menu_item_id: num(item.menu_item_id),
        name: str(item.name),
        price: num(item.price),
        quantity: num(item.quantity),
        is_deal: num(item.is_deal),
        variant_id: num(item.variant_id),
        // Resolved by the till, because menu item ids are per-machine and
        // cannot be resolved here.
        category: str(item.category),
      });
    }
  }
}

function ingestShifts(branchId, rows, receivedAt) {
  for (const row of rows) {
    upsertShift.run({
      branch_id: branchId,
      local_id: num(row.id),
      staff_id: num(row.staff_id),
      staff_name: str(row.staff_name),
      opening_cash: num(row.opening_cash),
      closing_cash: num(row.closing_cash),
      expected_cash: num(row.expected_cash),
      variance: num(row.variance),
      opened_at: str(row.opened_at),
      closed_at: str(row.closed_at),
      status: str(row.status),
      received_at: receivedAt,
    });
  }
}

function ingestExpenses(branchId, rows, receivedAt) {
  for (const row of rows) {
    upsertExpense.run({
      branch_id: branchId,
      local_id: num(row.id),
      local_shift_id: num(row.shift_id),
      staff_id: num(row.staff_id),
      staff_name: str(row.staff_name),
      category: str(row.category),
      description: str(row.description),
      amount: num(row.amount),
      from_drawer: num(row.from_drawer),
      created_at: str(row.created_at),
      received_at: receivedAt,
    });
  }
}

const HANDLERS = { orders: ingestOrders, shifts: ingestShifts, expenses: ingestExpenses };

/**
 * POST /api/ingest/batch — one table's worth of pending rows.
 *
 * All-or-nothing: the whole batch commits or none of it does. A partial batch
 * would leave the till marking rows synced that the cloud never stored.
 */
router.post('/batch', requireBranch, (req, res) => {
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
    db.transaction(() => {
      handler(req.branch.id, rows, receivedAt);
      bumpCursor.run(req.branch.id, table, rows.length, receivedAt);
    })();

    // The till marks rows synced only on this reply, so it is the till's proof
    // that the data is durable here.
    res.json({
      ok: true,
      accepted: rows.length,
      local_ids: rows.map(r => num(r.id)),
    });
  } catch (err) {
    console.error(`Ingest of ${table} failed:`, err.message);
    res.status(500).json({ error: 'Could not store batch' });
  }
});

module.exports = router;
