/**
 * Install a menu, without destroying the history that refers to the old one.
 *
 * Extracted from scripts/seed_blaze_menu.js so that the seed script and the
 * cloud sync-down path apply a menu through exactly the same code. Two
 * implementations of "replace the live menu" would eventually differ, and the
 * way they would differ is by one of them deleting something.
 *
 * **Retire, never delete.** Sales-by-category joins `order_items` back to
 * `menu_items`, so a hard DELETE takes the category off every past order —
 * rewriting figures that have already been reported and exported. Retired rows
 * (`active = 0`) disappear from the menu and the sale screen but still resolve
 * for reporting. Deals are deactivated for the same reason.
 *
 * Orders, staff, shifts and settings are never touched.
 *
 * The caller supplies `db` rather than this module requiring it, so the same
 * function can be run against a temporary database in a test without touching
 * the shop's own.
 */

/**
 * @param db      an open better-sqlite3 database
 * @param MENU    items, in the shape of db/menu-data.js
 * @param DEALS   deals, in the shape of db/menu-data.js
 * @param options `{ replace }` — retire the current menu first
 * @returns a summary; nothing is printed, so the caller decides what to say
 */
function applyMenu(db, MENU, DEALS, options = {}) {
  const replace = Boolean(options.replace);

  const result = {
    retiredItems: 0,
    retiredDeals: 0,
    itemsAdded: 0,
    itemsSkipped: 0,
    dealsAdded: 0,
    dealsSkipped: 0,
    warnings: [],
  };

  // One transaction: a half-applied menu — new deals pointing at items that
  // were never inserted — must never be reachable, least of all by a till that
  // lost its connection partway through a download.
  const run = db.transaction(() => {
    if (replace) {
      result.retiredItems = db.prepare('UPDATE menu_items SET active = 0 WHERE active = 1').run().changes;
      result.retiredDeals = db.prepare('UPDATE deals SET active = 0 WHERE active = 1').run().changes;
    }

    const insertItem = db.prepare(
      'INSERT INTO menu_items (name, category, price, has_variants, description, active) VALUES (?, ?, ?, ?, ?, 1)'
    );
    const insertVariant = db.prepare(
      'INSERT INTO item_variants (menu_item_id, label, price, sort_order) VALUES (?, ?, ?, ?)'
    );
    const findActiveItem = db.prepare('SELECT id FROM menu_items WHERE name = ? AND active = 1');

    // Names are resolved against the rows this run creates, so a retired item
    // of the same name from the old menu can never be linked into a new deal.
    const itemIds = new Map();
    const variantIds = new Map(); // `${itemName} ${label}` -> variant id

    for (const m of MENU) {
      const existing = findActiveItem.get(m.n);
      if (existing) {
        result.itemsSkipped++;
        itemIds.set(m.n, existing.id);
        db.prepare('SELECT id, label FROM item_variants WHERE menu_item_id = ?')
          .all(existing.id)
          .forEach(r => variantIds.set(`${m.n} ${r.label}`, r.id));
        continue;
      }

      const hasVariants = Array.isArray(m.v) && m.v.length > 0;
      const basePrice = hasVariants ? 0 : (m.p || 0);
      const id = insertItem.run(m.n, m.c, basePrice, hasVariants ? 1 : 0, m.d || null).lastInsertRowid;
      itemIds.set(m.n, id);

      if (hasVariants) {
        m.v.forEach(([label, price], i) => {
          const vid = insertVariant.run(id, label, price, i).lastInsertRowid;
          variantIds.set(`${m.n} ${label}`, vid);
        });
      }
      result.itemsAdded++;
    }

    const insertDeal = db.prepare(
      'INSERT INTO deals (name, description, price, deal_group, active) VALUES (?, ?, ?, ?, 1)'
    );
    const insertDealItem = db.prepare(
      'INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)'
    );
    const findActiveDeal = db.prepare('SELECT id FROM deals WHERE name = ? AND active = 1');

    for (const d of DEALS) {
      if (findActiveDeal.get(d.n)) { result.dealsSkipped++; continue; }

      const dealId = insertDeal.run(d.n, d.d, d.p, d.g).lastInsertRowid;

      for (const [itemName, qty, variantLabel] of d.items) {
        const itemId = itemIds.get(itemName);
        if (!itemId) {
          // Collected rather than thrown: one unresolvable line should not
          // cost the shop its whole menu, but it must be visible.
          result.warnings.push(`${d.n}: menu item "${itemName}" not found — line skipped`);
          continue;
        }

        let variantId = null;
        if (variantLabel) {
          variantId = variantIds.get(`${itemName} ${variantLabel}`) || null;
          if (!variantId) result.warnings.push(`${d.n}: "${itemName}" has no variant "${variantLabel}"`);
        }

        insertDealItem.run(dealId, itemId, qty, variantId);
      }
      result.dealsAdded++;
    }
  });

  run();
  return result;
}

module.exports = { applyMenu };
