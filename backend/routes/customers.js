/**
 * The delivery customer book.
 *
 * Built up automatically from delivery orders (see db/branch.js). The till
 * reads it to autocomplete a repeat customer; the owner reads it for
 * demographics — who orders, how often, and how much they are worth.
 */
const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAdminRole } = require('../middleware/auth');

/**
 * Look a customer up while the cashier types.
 *
 * Matches on name or phone so either will do — a caller who gives their number
 * is found just as readily as one who gives their name. Digits are stripped
 * from the phone side of the comparison so a search for "03001234567" still
 * finds a record stored as "0300-1234567".
 */
router.get('/', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limit) || 8, 50);

    if (!q) {
      // No search term: the most recent customers, which is what a fresh
      // dropdown should offer.
      return res.json(db.prepare(`
        SELECT * FROM customers
         ORDER BY last_order_at DESC, id DESC
         LIMIT ?
      `).all(limit));
    }

    const like = `%${q.toLowerCase()}%`;
    const digits = q.replace(/\D/g, '');
    const phoneLike = digits ? `%${digits}%` : '\u0000nomatch';

    res.json(db.prepare(`
      SELECT * FROM customers
       WHERE LOWER(name) LIKE ?
          OR REPLACE(REPLACE(REPLACE(COALESCE(phone,''), '-', ''), ' ', ''), '+', '') LIKE ?
       ORDER BY
         -- A name that starts with what was typed is the likelier match, so
         -- it outranks one that merely contains it.
         CASE WHEN LOWER(COALESCE(name,'')) LIKE ? THEN 0 ELSE 1 END,
         order_count DESC,
         last_order_at DESC
       LIMIT ?
    `).all(like, phoneLike, `${q.toLowerCase()}%`, limit));
  } catch (err) {
    console.error('Error searching customers:', err);
    res.status(500).json({ error: err.message });
  }
});

/** The whole book, for the owner's demographics view. Admin only. */
router.get('/all', (req, res) => {
  if (!isAdminRole(req.user && req.user.role)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  try {
    res.json(db.prepare(`
      SELECT * FROM customers
       ORDER BY order_count DESC, total_spent DESC
    `).all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  res.json(row);
});

module.exports = router;
