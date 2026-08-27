const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Create a new completed order
router.post('/', (req, res) => {
  const {
    items, total, discount, payment_method, cashier_id, cashier_name,
    order_type, delivery_charge, table_number,
  } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  // FIX (Bug 6): discount and payment_method were always sent as 0/'Cash'
  // from the UI. Now that the client sends real values, validate them here
  // so a bad payload can't write a negative or nonsensical order.
  const VALID_PAYMENTS = ['Cash', 'Card', 'Online'];
  const paymentMethod = VALID_PAYMENTS.includes(payment_method) ? payment_method : 'Cash';

  const safeDiscount = Math.max(0, Number(discount) || 0);
  const safeDelivery = Math.max(0, Number(delivery_charge) || 0);

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
  const isEmployee = req.body.is_employee === true || req.body.is_employee === 1;
  const empRateRow = db.prepare("SELECT value FROM settings WHERE key = 'employee_discount_rate'").get();
  const employeeRate = Math.max(0, Math.min(100, Number(empRateRow && empRateRow.value) || 0));
  const employeeDiscount = isEmployee
    ? Math.round(itemsSubtotal * employeeRate) / 100
    : 0;

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
  if (Number(total) !== computedTotal) {
    console.warn(`Order total mismatch — client sent ${total}, server computed ${computedTotal}. Using server value.`);
  }

  // Insert order in a transaction so it is atomic
  const createOrder = db.transaction(() => {
    // FIX (Bug 5): attach the order to the open shift so shift totals are
    // derived from real sales instead of hardcoded demo numbers.
    const openShift = db.prepare(
      "SELECT id FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1"
    ).get();

    const orderResult = db.prepare(
      // created_at is set explicitly to local wall-clock time. The column
      // default is CURRENT_TIMESTAMP, which SQLite evaluates in UTC — at
      // UTC+5 that filed every sale rung up between midnight and 5am under
      // the previous trading day in reports, shift totals and receipts.
      `INSERT INTO orders
         (total, discount, payment_method, status, cashier_id, cashier_name,
          order_type, delivery_charge, table_number, shift_id, created_at,
          tax_rate, tax_amount, is_employee, employee_discount, employee_discount_rate)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), ?, ?, ?, ?, ?)`
    ).run(
      computedTotal,
      cappedDiscount,
      paymentMethod,
      // Attribution comes from the signed-in session, not the request body.
      // Taking it from the body let a caller credit a sale to somebody else,
      // and it is what the manager report scoping keys on — so it has to be
      // something the client cannot choose. The body values are used only as a
      // fallback for a request with no session, which the route guard prevents.
      (req.user && req.user.staffId) || cashier_id || null,
      (req.user && req.user.name) || cashier_name || 'Unknown',
      order_type || 'Dine-in',
      safeDelivery,
      table_number || null,
      openShift ? openShift.id : null,
      taxRate,
      taxAmount,
      isEmployee ? 1 : 0,
      employeeDiscount,
      isEmployee ? employeeRate : 0
    );

    const orderId = orderResult.lastInsertRowid;

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
    const deductStock = db.prepare(
      'UPDATE ingredients SET stock = stock - ? WHERE id = ?'
    );

    items.forEach(item => {
      insertItem.run(orderId, item.id, item.name, item.price, item.quantity, item.is_deal ? 1 : 0, item.variant_id || null);

      // --- INVENTORY DEDUCTION ---
      // NOTE: Deal deduction is intentionally deferred for now. Do not attempt to explode deals
      // into their component items for stock purposes in this stage. Treat them exactly like
      // items with no recipes (like pizzas).
      if (item.is_deal) {
        return; // Skip deduction
      }

      const recipeRow = getRecipe.get(item.id, item.variant_id || null);
      if (recipeRow) {
        const ingredients = getRecipeIngredients.all(recipeRow.id);
        ingredients.forEach(ing => {
          const totalQty = ing.quantity_required * item.quantity;
          deductStock.run(totalQty, ing.ingredient_id);
        });
      }
    });

    return orderId;
  });

  try {
    const orderId = createOrder();
    res.status(201).json({
      success: true,
      id: orderId,
      total: computedTotal,
      discount: cappedDiscount,
      // Returned so the receipt prints the figures the server actually stored
      // rather than the client's own arithmetic.
      subtotal: itemsSubtotal,
      tax_rate: taxRate,
      tax_amount: taxAmount,
      delivery_charge: safeDelivery,
      is_employee: isEmployee ? 1 : 0,
      employee_discount: employeeDiscount,
      employee_discount_rate: employeeRate,
      manual_discount: manualDiscount,
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ error: err.message });
  }
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
      items: allItems.filter(i => i.order_id === o.id)
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
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ ...order, items });
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
                voided_by_id = ?
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
