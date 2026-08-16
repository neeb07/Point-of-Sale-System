const express = require('express');
const router = express.Router();
const db = require('../db/database');

/**
 * Shared item query.
 *
 * FIX (Bug 1): this previously did not select `di.variant_id`, so a deal
 * containing "Chicken Tikka Pizza (Small)" rendered as just "Chicken Tikka
 * Pizza" everywhere. It now joins item_variants to return the label and the
 * variant's own price.
 */
const DEAL_ITEMS_SQL = `
  SELECT
    di.quantity,
    di.description,
    di.variant_id,
    mi.id           AS menu_item_id,
    mi.name,
    mi.price,
    mi.category,
    mi.has_variants,
    iv.label        AS variant_label,
    iv.price        AS variant_price
  FROM deal_items di
  LEFT JOIN menu_items    mi ON di.menu_item_id = mi.id
  LEFT JOIN item_variants iv ON di.variant_id   = iv.id
  WHERE di.deal_id = ?
`;

const getDealItems = (dealId) => db.prepare(DEAL_ITEMS_SQL).all(dealId);

const variantOwnerStmt = db.prepare(
  'SELECT menu_item_id FROM item_variants WHERE id = ?'
);

/**
 * Normalise an incoming items array from the client.
 *
 * Also drops a variant_id that does not belong to the menu item it was sent
 * with. Without this the LEFT JOIN in DEAL_ITEMS_SQL happily pairs an item
 * with a stranger's variant and the deal renders a size and price from a
 * completely different product.
 */
function normaliseItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map((item) => {
    const menuItemId = item.menu_item_id ?? null;
    let variantId = item.variant_id ?? null;

    if (variantId != null) {
      const owner = variantOwnerStmt.get(variantId);
      if (!owner || owner.menu_item_id !== menuItemId) {
        console.warn(
          `Dropping variant ${variantId}: it does not belong to menu item ${menuItemId}`
        );
        variantId = null;
      }
    }

    return {
      menu_item_id: menuItemId,
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      variant_id: variantId,
      description: item.description ?? null,
    };
  });
}

// GET all active deals with their items
router.get('/', (req, res) => {
  try {
    // FIX: was ORDER BY created_at DESC, which scrambled sub-tab ordering.
    const deals = db.prepare(`
      SELECT * FROM deals
      WHERE active = 1
      ORDER BY deal_group IS NULL, deal_group, name
    `).all();

    const result = deals.map((deal) => ({ ...deal, items: getDealItems(deal.id) }));
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
    res.json({ ...deal, items: getDealItems(deal.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create deal
router.post('/', (req, res) => {
  const { name, description, price, image_url, items, deal_group } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price required' });
  }

  const rows = normaliseItems(items);

  const createDeal = db.transaction(() => {
    // FIX (Bug 1): deal_group was never written, so every deal created from
    // the Deals screen was born ungrouped and invisible in the sub-tabs.
    const result = db.prepare(
      'INSERT INTO deals (name, description, price, image_url, deal_group) VALUES (?, ?, ?, ?, ?)'
    ).run(name, description || '', Number(price), image_url || null, deal_group || null);

    const dealId = result.lastInsertRowid;

    if (rows.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id, description) VALUES (?, ?, ?, ?, ?)'
      );
      rows.forEach((item) => {
        insertItem.run(dealId, item.menu_item_id, item.quantity, item.variant_id, item.description);
      });
    }

    return dealId;
  });

  try {
    const dealId = createDeal();
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    res.status(201).json({ ...deal, items: getDealItems(dealId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update deal
router.put('/:id', (req, res) => {
  const { name, description, price, image_url, items, deal_group } = req.body;

  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price required' });
  }

  const existing = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Deal not found' });

  const rows = normaliseItems(items);

  const updateDeal = db.transaction(() => {
    // FIX (Bug 1): deal_group was omitted from this UPDATE entirely. Because
    // the frontend never sent it either, editing any seeded deal silently
    // dropped it out of its group. We fall back to the stored value so a
    // client that omits the field can't wipe it.
    const nextGroup = deal_group !== undefined ? (deal_group || null) : existing.deal_group;

    db.prepare(
      'UPDATE deals SET name = ?, description = ?, price = ?, image_url = ?, deal_group = ? WHERE id = ?'
    ).run(name, description || '', Number(price), image_url || null, nextGroup, req.params.id);

    db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(req.params.id);

    if (rows.length > 0) {
      const insertItem = db.prepare(
        'INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id, description) VALUES (?, ?, ?, ?, ?)'
      );
      rows.forEach((item) => {
        insertItem.run(req.params.id, item.menu_item_id, item.quantity, item.variant_id, item.description);
      });
    }
  });

  try {
    updateDeal();
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
    res.json({ ...deal, items: getDealItems(req.params.id) });
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
