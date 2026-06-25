const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Get all menu items
router.get('/', (req, res) => {
  const items = db.prepare('SELECT * FROM menu_items ORDER BY category, name').all();
  res.json(items);
});

// Add new item
router.post('/', (req, res) => {
  const { name, category, price, image_url } = req.body;
  if (!name || !category || !price) {
    return res.status(400).json({ error: 'name, category, and price are required' });
  }
  const result = db.prepare('INSERT INTO menu_items (name, category, price, image_url) VALUES (?, ?, ?, ?)').run(name, category, Number(price), image_url || null);
  const newItem = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(newItem);
});

// Update item
router.put('/:id', (req, res) => {
  const { name, category, price, image_url } = req.body;
  const { id } = req.params;
  db.prepare('UPDATE menu_items SET name = ?, category = ?, price = ?, image_url = ? WHERE id = ?').run(name, category, Number(price), image_url || null, id);
  const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  res.json(updated);
});

// Delete item
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
