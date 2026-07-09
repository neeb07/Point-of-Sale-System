const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET all deals with their items
router.get('/', (req, res) => {
  try {
    const deals = db.prepare(`
      SELECT * FROM deals WHERE active = 1 ORDER BY created_at DESC
    `).all();

    const result = deals.map(deal => {
      const items = db.prepare(`
        SELECT di.quantity, di.description, mi.id as menu_item_id, mi.name, mi.price, mi.category
        FROM deal_items di
        LEFT JOIN menu_items mi ON di.menu_item_id = mi.id
        WHERE di.deal_id = ?
      `).all(deal.id);
      return { ...deal, items };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single deal
router.get('/:id', (req, res) => {
  try {
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    const items = db.prepare(`
      SELECT di.quantity, di.description, mi.id as menu_item_id, mi.name, mi.price, mi.category
      FROM deal_items di
      LEFT JOIN menu_items mi ON di.menu_item_id = mi.id
      WHERE di.deal_id = ?
    `).all(deal.id);
    res.json({ ...deal, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create deal
router.post('/', (req, res) => {
  const { name, description, price, image_url, items } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });

  const createDeal = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO deals (name, description, price, image_url) VALUES (?, ?, ?, ?)'
    ).run(name, description || '', Number(price), image_url || null);

    const dealId = result.lastInsertRowid;

    if (items && items.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO deal_items (deal_id, menu_item_id, quantity, description) VALUES (?, ?, ?, ?)'
      );
      items.forEach(item => {
        insertItem.run(dealId, item.menu_item_id || null, item.quantity || 1, item.description || null);
      });
    }

    return dealId;
  });

  try {
    const dealId = createDeal();
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    const dealItems = db.prepare(`
      SELECT di.quantity, di.description, mi.id as menu_item_id, mi.name, mi.price, mi.category
      FROM deal_items di
      LEFT JOIN menu_items mi ON di.menu_item_id = mi.id
      WHERE di.deal_id = ?
    `).all(dealId);
    res.status(201).json({ ...deal, items: dealItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update deal
router.put('/:id', (req, res) => {
  const { name, description, price, image_url, items } = req.body;

  const updateDeal = db.transaction(() => {
    db.prepare(
      'UPDATE deals SET name = ?, description = ?, price = ?, image_url = ? WHERE id = ?'
    ).run(name, description || '', Number(price), image_url || null, req.params.id);

    db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(req.params.id);

    if (items && items.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO deal_items (deal_id, menu_item_id, quantity, description) VALUES (?, ?, ?, ?)'
      );
      items.forEach(item => {
        insertItem.run(req.params.id, item.menu_item_id || null, item.quantity || 1, item.description || null);
      });
    }
  });

  try {
    updateDeal();
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    const dealItems = db.prepare(`
      SELECT di.quantity, di.description, mi.id as menu_item_id, mi.name, mi.price, mi.category
      FROM deal_items di
      LEFT JOIN menu_items mi ON di.menu_item_id = mi.id
      WHERE di.deal_id = ?
    `).all(req.params.id);
    res.json({ ...deal, items: dealItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE deal (soft delete)
router.delete('/:id', (req, res) => {
  try {
    db.prepare('UPDATE deals SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
