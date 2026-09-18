const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { resolveBranchId, branchCode, recordCustomer, openShiftIdFor } = require('../db/branch');
const { formatOrderNo } = require('../db/order-no');

/*
 * Pricing, committing and describing a sale are three separate steps.
 *
 * They used to be one request handler. Held orders split them apart: a ticket
 * sent to the kitchen has to be priced — the kitchen copy shows the table and
 * the screen shows the total — but must not be committed, because it is not a
 * sale yet. Nothing about it may reach a report, a shift total, the cloud, the
 * stock count or the customer book until somebody confirms it. Keeping the
 * pricing and the committing as separate functions, and having the confirm
 * route call the very same commit as a direct sale, is what guarantees that a
 * confirmed ticket is a sale in exactly the way a direct sale is.
 */

/**
 * What is inside a deal, for the receipt.
 *
 * A deal is sold as one line — "Pizza Deal 2" — but the kitchen has to make
 * the pizza, the wings and the drink, and a customer wants to see what the
 * price covered. Read from the deal's current definition when the order is
 * described, not stored per order: the definition is what the shop sells
 * today, and a deal edited later is a rare thing to reprint.
 */
const dealContentsStmt = db.prepare(`
  SELECT di.quantity, mi.name, iv.label AS variant_label
    FROM deal_items di
    LEFT JOIN menu_items    mi ON mi.id = di.menu_item_id
    LEFT JOIN item_variants iv ON iv.id = di.variant_id
   WHERE di.deal_id = ?
   ORDER BY di.id
`);
function dealContents(dealId) {
  try {
    return dealContentsStmt.all(dealId).map(r => ({
      name: r.variant_label ? `${r.name} (${r.variant_label})` : (r.name || 'Item'),
      quantity: Number(r.quantity) || 1,
    }));
  } catch (e) { return []; }
}
/** Attach `contents` to every deal line; other lines are returned as they are. */
function withDealContents(items) {
  return (items || []).map((i) => {
    const isDeal = i.is_deal === 1 || i.is_deal === true;
    const dealId = i.menu_item_id != null ? i.menu_item_id : i.id;
    return isDeal && dealId != null ? { ...i, contents: dealContents(dealId) } : i;
  });
}

const VALID_PAYMENTS = ['Cash', 'Card', 'Online'];
/** Where the food goes. Anything else is filed as dine-in rather than refused. */
const VALID_ORDER_TYPES = ['Dine-in', 'Takeaway', 'Delivery'];
const orderTypeOf = (v) => (VALID_ORDER_TYPES.includes(v) ? v : 'Dine-in');

const trimmed = (v) => (v && String(v).trim()) || null;

/**
 * Price an order from its request body and the shop's settings.
 *
 * Pure apart from two settings reads. Throws a 400-shaped error for a body that
 * cannot be priced, and never trusts a figure the client sent: the total, the
 * tax and the staff discount are all recomputed here.
 */
function priceOrder(body) {
  const { items, total, discount, payment_method, delivery_charge } = body || {};

  if (!items || items.length === 0) {
    const err = new Error('Order must have at least one item');
    err.status = 400;
    throw err;
  }

  // FIX (Bug 6): discount and payment_method were always sent as 0/'Cash'
  // from the UI. Now that the client sends real values, validate them here
  // so a bad payload can't write a negative or nonsensical order.
  const paymentMethod = VALID_PAYMENTS.includes(payment_method) ? payment_method : 'Cash';
  const safeDiscount = Math.max(0, Number(discount) || 0);
  // The charge is the till's to decide per order — a longer ride, a regular
  // who is never charged — but only a delivery has a rider to pay.
  const orderType = orderTypeOf(body && body.order_type);
  const safeDelivery = orderType === 'Delivery' ? Math.max(0, Number(delivery_charge) || 0) : 0;

  // Recompute the total server-side rather than trusting the client.
  const itemsSubtotal = items.reduce(
    (sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0
  );

  /**
   * Staff discount.
   *
   * Like tax, the rate is read from settings rather than taken from the
   * request — the client says only *whether* this is a staff purchase, never
   * how much comes off. It is taken off the subtotal, and any manual discount
   * then applies to what is left, so the two together can never exceed the
   * order value.
   */
  const isEmployee = body.is_employee === true || body.is_employee === 1;
  const empRateRow = db.prepare("SELECT value FROM settings WHERE key = 'employee_discount_rate'").get();
  const employeeRate = Math.max(0, Math.min(100, Number(empRateRow && empRateRow.value) || 0));
  const employeeDiscount = isEmployee ? Math.round(itemsSubtotal * employeeRate) / 100 : 0;

  const manualDiscount = Math.min(safeDiscount, Math.max(0, itemsSubtotal - employeeDiscount));

  // `discount` stays the combined figure so every existing report, export and
  // reconciliation (subtotal - discount + tax + delivery = total) is unchanged.
  const cappedDiscount = Math.min(employeeDiscount + manualDiscount, itemsSubtotal);

  // Tax rate comes from settings, never from the request: the client must not
  // be able to choose what tax a sale is charged. It is applied to the
  // discounted subtotal, and the delivery fee is added afterwards so the rider's
  // charge is neither discounted nor taxed.
  const taxRateRow = db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get();
  const taxRate = Math.max(0, Number(taxRateRow && taxRateRow.value) || 0);
  const taxable = Math.max(0, itemsSubtotal - cappedDiscount);
  const taxAmount = Math.round(taxable * taxRate) / 100;

  const computedTotal = Math.max(0, taxable + taxAmount + safeDelivery);

  // Trust the server figure; log when the client disagreed.
  if (total !== undefined && Number(total) !== computedTotal) {
    console.warn(`Order total mismatch — client sent ${total}, server computed ${computedTotal}. Using server value.`);
  }

  return {
    items, paymentMethod, orderType, safeDelivery, itemsSubtotal, isEmployee, employeeRate,
    employeeDiscount, manualDiscount, cappedDiscount, taxRate, taxAmount, computedTotal,
  };
}

/**
 * Write a priced order as a sale. Returns the new order id.
 *
 * Everything that makes a sale a sale happens here and nowhere else: the row,
 * its lines, the stock deduction, the customer book. Both a direct sale and a
 * confirmed ticket come through this one function.
 */
function commitOrder(body, req, p, branchId) {
  const {
    cashier_id, cashier_name, order_type, table_number,
    customer_name, customer_phone, customer_address,
  } = body;

  const run = db.transaction(() => {
    // FIX (Bug 5): attach the order to the open shift so shift totals are
    // derived from real sales instead of hardcoded demo numbers.
    // The cashier's own open shift — not whichever shift is open globally,
    // which with two managers trading at once filed one's sales against the
    // other's drawer.
    const openShiftId = openShiftIdFor(req.user && req.user.staffId);

    /*
     * No shift, no sale.
     *
     * A sale rung up with no drawer open has nowhere to belong: it is missing
     * from the shift totals, so the cash is in the till but not in the expected
     * figure, and whoever counts up at the end is short by exactly that amount
     * with nothing to explain it. Refusing at the point of sale is the only
     * moment anyone can still do something about it.
     */
    if (!openShiftId) {
      const err = new Error('Open a shift before taking orders.');
      err.code = 'NO_OPEN_SHIFT';
      throw err;
    }

    const orderResult = db.prepare(
      // created_at is set explicitly to local wall-clock time. The column
      // default is CURRENT_TIMESTAMP, which SQLite evaluates in UTC — at
      // UTC+5 that filed every sale rung up between midnight and 5am under
      // the previous trading day in reports, shift totals and receipts.
      `INSERT INTO orders
         (total, discount, payment_method, status, cashier_id, cashier_name,
          order_type, delivery_charge, table_number, shift_id, created_at,
          tax_rate, tax_amount, is_employee, employee_discount, employee_discount_rate,
          customer_name, customer_phone, customer_address, branch_id)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      p.computedTotal,
      p.cappedDiscount,
      p.paymentMethod,
      // Attribution comes from the signed-in session, not the request body.
      // Taking it from the body let a caller credit a sale to somebody else,
      // and it is what the manager report scoping keys on — so it has to be
      // something the client cannot choose. The body values are used only as a
      // fallback for a request with no session, which the route guard prevents.
      (req.user && req.user.staffId) || cashier_id || null,
      (req.user && req.user.name) || cashier_name || 'Unknown',
      p.orderType,
      p.safeDelivery,
      table_number || null,
      openShiftId,
      p.taxRate,
      p.taxAmount,
      p.isEmployee ? 1 : 0,
      p.employeeDiscount,
      p.isEmployee ? p.employeeRate : 0,
      // Delivery details are optional — the cashier may skip the prompt.
      trimmed(customer_name),
      trimmed(customer_phone),
      trimmed(customer_address),
      // The sale belongs to the branch the till is standing in. Stamped at
      // write time rather than derived later, so moving a manager between
      // branches never rewrites the history of sales they already rang up.
      branchId
    );

    const orderId = orderResult.lastInsertRowid;

    // Remember whoever this went out to, so the next time they call the
    // cashier can pick them from the list instead of taking the address down
    // again. Only delivery orders — a walk-in has nothing worth keeping.
    if (p.orderType === 'Delivery') {
      recordCustomer({
        name: customer_name, phone: customer_phone, address: customer_address,
        total: p.computedTotal,
      });
    }

    // is_deal is recorded so reporting can distinguish a deal from a menu item
    // — they share an id space in this column, which previously made deal
    // revenue land under an unrelated category.
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, is_deal, variant_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const getRecipe = db.prepare(
      'SELECT id FROM recipes WHERE menu_item_id = ? AND (variant_id = ? OR variant_id IS NULL)'
    );
    const getRecipeIngredients = db.prepare(
      'SELECT ingredient_id, quantity_required FROM recipe_ingredients WHERE recipe_id = ?'
    );
    const deductStock = db.prepare('UPDATE ingredients SET stock = stock - ? WHERE id = ?');

    p.items.forEach(item => {
      insertItem.run(orderId, item.id, item.name, item.price, item.quantity, item.is_deal ? 1 : 0, item.variant_id || null);

      // --- INVENTORY DEDUCTION ---
      // Deal deduction is intentionally deferred: deals are not exploded into
      // their component items for stock purposes. They are treated like items
      // with no recipe.
      if (item.is_deal) return;

      const recipeRow = getRecipe.get(item.id, item.variant_id || null);
      if (recipeRow) {
        getRecipeIngredients.all(recipeRow.id).forEach(ing => {
          deductStock.run(ing.quantity_required * item.quantity, ing.ingredient_id);
        });
      }
    });

    return orderId;
  });

  return run();
}

/** The figures the receipt prints — the server's, never the client's arithmetic. */
function describeOrder(body, p, branchId, extra = {}) {
  return {
    success: true,
    ...extra,
    total: p.computedTotal,
    discount: p.cappedDiscount,
    subtotal: p.itemsSubtotal,
    tax_rate: p.taxRate,
    tax_amount: p.taxAmount,
    delivery_charge: p.safeDelivery,
    is_employee: p.isEmployee ? 1 : 0,
    employee_discount: p.employeeDiscount,
    employee_discount_rate: p.employeeRate,
    manual_discount: p.manualDiscount,
    payment_method: p.paymentMethod,
    order_type: p.orderType,
    table_number: body.table_number || null,
    items: withDealContents(p.items),
    customer_name: trimmed(body.customer_name),
    customer_phone: trimmed(body.customer_phone),
    customer_address: trimmed(body.customer_address),
  };
}

function sendOrderError(res, err, what) {
  if (err.code === 'NO_OPEN_SHIFT') {
    // 409, not 500: nothing is broken, the till is simply not ready to trade.
    return res.status(409).json({
      error: 'Open a shift before taking orders. Go to Shifts and enter your opening cash.',
      code: 'NO_OPEN_SHIFT',
    });
  }
  if (err.status === 400) return res.status(400).json({ error: err.message });
  console.error(`Error ${what}:`, err);
  return res.status(500).json({ error: err.message });
}

// Create a new completed order — a direct sale, paid and done in one step.
router.post('/', (req, res) => {
  try {
    const p = priceOrder(req.body);
    // Resolved once, ahead of the transaction: the row's branch and the branch
    // code printed on the receipt must be the same answer, not two lookups.
    const branchId = resolveBranchId(req);
    const orderId = commitOrder(req.body, req, p, branchId);
    res.status(201).json(describeOrder(req.body, p, branchId, {
      id: orderId,
      // What the receipt prints and the customer quotes back. Computed here so
      // the till, the receipt and the dashboard cannot disagree about it.
      order_no: formatOrderNo(branchCode(branchId), orderId),
    }));
  } catch (err) {
    sendOrderError(res, err, 'creating order');
  }
});

/* ------------------------------------------------------------ held orders -- */

/*
 * A ticket that has gone to the kitchen and has not been paid for.
 *
 * Not a sale, and deliberately not a row in `orders`. Forty-odd queries across
 * the till and the cloud read that table as the record of sales — reports,
 * shift totals, the heartbeat, the sync push, the backup counts — and a held
 * order must appear in none of them. Adding a status to that table would mean
 * every one of those queries having to remember to exclude it, and each one
 * that forgot would be a phantom sale in a report. A separate table cannot be
 * forgotten by anything.
 *
 * What is stored is the request body itself. Editing a ticket replaces it;
 * confirming one prices and commits it through the very same functions a direct
 * sale uses. So a confirmed ticket is a sale in exactly the way a direct sale
 * is, and there is one definition of what an order is worth.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS held_orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    payload       TEXT NOT NULL,
    order_type    TEXT,
    table_number  TEXT,
    customer_name TEXT,
    total         REAL NOT NULL DEFAULT 0,
    item_count    INTEGER NOT NULL DEFAULT 0,
    staff_id      INTEGER,
    staff_name    TEXT,
    held_at       DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at    DATETIME
  )
`);

/** Ticket numbers read "H-12" on the kitchen copy, to say plainly they are not invoices. */
const ticketNo = (id) => `H-${id}`;

/** A held row, with its payload re-priced so the screen shows current figures. */
function describeHeld(row) {
  const body = JSON.parse(row.payload);
  const p = priceOrder(body);
  return describeOrder(body, p, null, {
    id: row.id,
    ticket_no: ticketNo(row.id),
    // Said explicitly so a receipt printed from a ticket can label itself
    // provisional rather than pass for a paid bill.
    held: true,
    held_at: row.held_at,
    updated_at: row.updated_at,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
  });
}

/**
 * Price the ticket and store it. Needs an open shift, the same as a sale —
 * the rule is "no trading without a drawer", and a ticket is trading.
 */
function storeHeld(body, req, existingId = null) {
  const p = priceOrder(body);
  if (!openShiftIdFor(req.user && req.user.staffId)) {
    const err = new Error('Open a shift before taking orders.');
    err.code = 'NO_OPEN_SHIFT';
    throw err;
  }
  const itemCount = p.items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  if (existingId) {
    db.prepare(`
      UPDATE held_orders
         SET payload = ?, order_type = ?, table_number = ?, customer_name = ?,
             total = ?, item_count = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?
    `).run(JSON.stringify(body), orderTypeOf(body.order_type), body.table_number || null,
           trimmed(body.customer_name), p.computedTotal, itemCount, existingId);
    return existingId;
  }
  return db.prepare(`
    INSERT INTO held_orders
      (payload, order_type, table_number, customer_name, total, item_count, staff_id, staff_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(JSON.stringify(body), orderTypeOf(body.order_type), body.table_number || null,
         trimmed(body.customer_name), p.computedTotal, itemCount,
         (req.user && req.user.staffId) || null, (req.user && req.user.name) || null)
    .lastInsertRowid;
}

const getHeld = () => db.prepare('SELECT * FROM held_orders WHERE id = ?');

// Send a ticket to the kitchen without taking payment.
router.post('/hold', (req, res) => {
  try {
    const id = storeHeld(req.body, req);
    res.status(201).json(describeHeld(getHeld().get(id)));
  } catch (err) {
    sendOrderError(res, err, 'holding order');
  }
});

// Every open ticket, oldest first. Anyone at the till sees all of them: a
// manager confirms tickets other people took.
router.get('/held', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM held_orders ORDER BY held_at ASC').all().map(describeHeld));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/held/:id', (req, res) => {
  const row = getHeld().get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That ticket is no longer held.' });
  try {
    res.json(describeHeld(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change a ticket — add or remove items, change a size, correct the table.
/**
 * What changed on the plate between two versions of a ticket.
 *
 * The kitchen is cooking from the first ticket. When the manager changes it,
 * a second full ticket would have them cook the pizza twice; a ticket with no
 * item changes at all — a discount added, a delivery charge corrected — is
 * nothing the kitchen needs to see. So the update reports the difference in
 * dishes and quantities, and the till prints only that, or nothing.
 */
function itemChanges(before, after) {
  const key = (i) => `${i.id}|${i.variant_id || ''}|${i.name}`;
  const tally = (items) => {
    const m = new Map();
    (items || []).forEach((i) => {
      const k = key(i);
      const cur = m.get(k) || { name: i.name, quantity: 0, id: i.id, is_deal: i.is_deal };
      cur.quantity += Number(i.quantity) || 0;
      m.set(k, cur);
    });
    return m;
  };
  const was = tally(before), now = tally(after);
  const added = [], removed = [];
  for (const [k, v] of now) {
    const delta = v.quantity - ((was.get(k) || {}).quantity || 0);
    if (delta > 0) added.push({ name: v.name, quantity: delta, id: v.id, is_deal: v.is_deal });
  }
  for (const [k, v] of was) {
    const delta = v.quantity - ((now.get(k) || {}).quantity || 0);
    if (delta > 0) removed.push({ name: v.name, quantity: delta, id: v.id, is_deal: v.is_deal });
  }
  // The kitchen makes what is inside a deal, so an added deal says what that is.
  return { added: withDealContents(added), removed: withDealContents(removed) };
}

router.put('/held/:id', (req, res) => {
  const row = getHeld().get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That ticket is no longer held.' });
  try {
    const before = JSON.parse(row.payload);
    storeHeld(req.body, req, row.id);
    const changes = itemChanges(before.items, req.body && req.body.items);
    res.json({ ...describeHeld(getHeld().get(row.id)), changes });
  } catch (err) {
    sendOrderError(res, err, 'updating held order');
  }
});

/**
 * Confirm a ticket: it becomes a sale.
 *
 * Priced again now rather than trusting the figure stored at hold time, so a
 * tax or discount rate changed in between is applied to what is actually paid.
 * Committed through the same function as a direct sale, and the ticket is
 * removed in the same transaction — a crash between the two would otherwise
 * leave a paid ticket still on the board to be confirmed twice.
 */
router.post('/held/:id/confirm', (req, res) => {
  const row = getHeld().get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That ticket is no longer held.' });

  try {
    const body = JSON.parse(row.payload);
    // Payment is decided at confirmation, not when the ticket was taken.
    if (req.body && req.body.payment_method) body.payment_method = req.body.payment_method;

    const p = priceOrder(body);
    const branchId = resolveBranchId(req);

    const confirm = db.transaction(() => {
      const orderId = commitOrder(body, req, p, branchId);
      db.prepare('DELETE FROM held_orders WHERE id = ?').run(row.id);
      return orderId;
    });
    const orderId = confirm();

    res.status(201).json(describeOrder(body, p, branchId, {
      id: orderId,
      order_no: formatOrderNo(branchCode(branchId), orderId),
      ticket_no: ticketNo(row.id),
    }));
  } catch (err) {
    sendOrderError(res, err, 'confirming held order');
  }
});

// Cancel a ticket. Nothing was sold, so nothing to void — the row simply goes.
router.delete('/held/:id', (req, res) => {
  const info = db.prepare('DELETE FROM held_orders WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'That ticket is no longer held.' });
  res.json({ success: true });
});

// Get all orders (for Orders screen)
router.get('/', (req, res) => {
  const { from, to, status, payment_method } = req.query;
  
  let conditions = [];
  let params = [];

  if (from && to) {
    conditions.push(`DATE(o.created_at) BETWEEN DATE(?) AND DATE(?)`);
    params.push(from, to);
  } else if (from) {
    conditions.push(`DATE(o.created_at) >= DATE(?)`);
    params.push(from);
  } else if (to) {
    conditions.push(`DATE(o.created_at) <= DATE(?)`);
    params.push(to);
  }

  if (status && status !== 'all' && status !== 'All') {
    conditions.push(`LOWER(o.status) = LOWER(?)`);
    params.push(status);
  }

  if (payment_method && payment_method !== 'all' && payment_method !== 'All') {
    conditions.push(`LOWER(o.payment_method) = LOWER(?)`);
    params.push(payment_method);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const orders = db.prepare(
      `SELECT o.* FROM orders o ${whereClause} ORDER BY o.created_at DESC` 
    ).all(...params);

    if (orders.length === 0) return res.json([]);

    const orderIds = orders.map(o => o.id);
    const placeholders = orderIds.map(() => '?').join(',');
    const allItems = db.prepare(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders})` 
    ).all(...orderIds);

    const formatted = orders.map(o => ({
      ...o,
      order_no: formatOrderNo(branchCode(o.branch_id), o.id),
      items: withDealContents(allItems.filter(i => i.order_id === o.id))
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get single order with its items
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = withDealContents(db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id));
  res.json({ ...order, order_no: formatOrderNo(branchCode(order.branch_id), order.id), items });
});

/**
 * Void an order.
 *
 * This used to run `SET status = 'voided', total = 0, discount = 0`, which
 * destroyed the evidence: once voided, nothing recorded what the order had
 * been worth, so a void could never be audited and a manager could not see
 * how much was being written off or by whom. Every report already filters on
 * `status != 'voided'`, so zeroing the figures bought nothing.
 *
 * The amounts are now preserved and only the status changes. Stock consumed
 * by the sale is returned to inventory, which the previous version never did —
 * voiding a mis-rung order silently lost its ingredients.
 */
const voidOrder = (req, res) => {
  try {
    const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'voided') {
      // Without this guard a second void would restock the ingredients again.
      return res.status(409).json({ error: 'Order is already voided' });
    }

    const doVoid = db.transaction(() => {
      const items = db.prepare(
        'SELECT menu_item_id, quantity, is_deal, variant_id FROM order_items WHERE order_id = ?'
      ).all(order.id);

      // Same lookup the sale used, so the restore mirrors the deduction
      // exactly — including variant-specific recipes.
      const getRecipe = db.prepare(
        'SELECT id FROM recipes WHERE menu_item_id = ? AND (variant_id = ? OR variant_id IS NULL)'
      );
      const getRecipeIngredients = db.prepare(
        'SELECT ingredient_id, quantity_required FROM recipe_ingredients WHERE recipe_id = ?'
      );
      const restoreStock = db.prepare(
        'UPDATE ingredients SET stock = stock + ? WHERE id = ?'
      );

      items.forEach(item => {
        // Deals never deducted stock on the way in, so they must not add it back.
        if (item.is_deal) return;
        const recipeRow = getRecipe.get(item.menu_item_id, item.variant_id || null);
        if (!recipeRow) return;
        getRecipeIngredients.all(recipeRow.id).forEach(ing => {
          restoreStock.run(ing.quantity_required * item.quantity, ing.ingredient_id);
        });
      });

      // Record who voided it. The name comes from the session, not the
      // request body, so it cannot be spoofed by the caller.
      db.prepare(
        `UPDATE orders
            SET status = 'voided',
                voided_at = datetime('now', 'localtime'),
                voided_by = ?,
                voided_by_id = ?,
                -- Back to pending: the cloud may already hold this order as a
                -- completed sale, and a void that never goes up would leave
                -- the dashboard reporting revenue the shop did not take.
                sync_state = 'pending'
          WHERE id = ?`
      ).run(
        (req.user && req.user.name) || 'Unknown',
        (req.user && req.user.staffId) || null,
        order.id
      );
    });

    doVoid();
    res.json({ success: true, id: order.id, status: 'voided' });
  } catch (err) {
    console.error('Error voiding order:', err);
    res.status(500).json({ error: err.message });
  }
};

router.put('/:id/void', voidOrder);
router.patch('/:id/void', voidOrder);

module.exports = router;
