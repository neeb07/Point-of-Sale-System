const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Create a new completed order
router.post('/', (req, res) => {
  const { items, total, discount, payment_method, cashier_id, cashier_name, order_type, delivery_charge } = req.body;

  console.log('Creating order:', { items, total, discount, payment_method, cashier_id, cashier_name, order_type, delivery_charge });

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Order must have at least one item' });
  }

  // Insert order in a transaction so it is atomic
  const createOrder = db.transaction(() => {
    const orderResult = db.prepare(
      `INSERT INTO orders (total, discount, payment_method, status, cashier_id, cashier_name, order_type, delivery_charge)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`
    ).run(
      total,
      discount || 0,
      payment_method || 'Cash',
      cashier_id || null,
      cashier_name || 'Unknown',
      order_type || 'Dine-in',
      delivery_charge || 0
    );

    const orderId = orderResult.lastInsertRowid;
    console.log('Order created with ID:', orderId);

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)'
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
      insertItem.run(orderId, item.id, item.name, item.price, item.quantity);
      console.log('Item inserted:', item.name);

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
    console.log('Transaction completed, order ID:', orderId);
    res.status(201).json({ success: true, id: orderId });
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

const voidOrder = (req, res) => {
  try {
    db.prepare("UPDATE orders SET status = 'voided', total = 0, discount = 0 WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.put('/:id/void', voidOrder);
router.patch('/:id/void', voidOrder);

module.exports = router;
