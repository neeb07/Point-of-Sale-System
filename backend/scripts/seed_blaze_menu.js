/**
 * Blaze Pizza House — full menu seed.
 *
 * Transcribed from the printed menu (both branches share this menu).
 *
 *   node scripts/seed_blaze_menu.js            # add/refresh menu, keep orders
 *   node scripts/seed_blaze_menu.js --replace  # wipe existing menu first
 *
 * Orders, staff and settings are never touched.
 */

const db = require('../db/database.js');

const REPLACE = process.argv.includes('--replace');

// ── Menu items ───────────────────────────────────────────────────────────────
// `variants` sets has_variants = 1 and the base price is ignored.
// `price` alone means a single fixed price.

const MENU = [
  // ══ BLAZE SPECIAL PIZZA ═══════════════════════════════════════════════════
  { c: 'Blaze Special', n: 'Donner Special',
    d: 'Mix Cheese, Chicken Tikka, Pizza Sauce, Capsicum, Tomato, Onion, Black Olives',
    v: [['Medium', 1450], ['Large', 2050], ['X-Large', 2950]] },
  { c: 'Blaze Special', n: 'Bihari Kabab',
    d: 'Mix Cheese, Chicken Tikka, Seekh Kabab, Capsicum, Tomato, Sweet Corn, Black Olives, Mushrooms, Special Pizza Sauce',
    v: [['Medium', 1450], ['Large', 2050], ['X-Large', 2950]] },
  { c: 'Blaze Special', n: 'Butter Chicken Pizza',
    d: 'Mix Cheese, Malai Chicken, Butter, Capsicum, Sweet Corn, Black Olives, Pizza Sauce',
    v: [['Medium', 1450], ['Large', 2050], ['X-Large', 2950]] },
  { c: 'Blaze Special', n: 'Crunchy Pizza',
    d: 'Chicken Tikka, Mix Cheese, Thai Sauce, Special Sauce, Capsicum, Tomato, Crunchy Crumbs',
    v: [['Medium', 1450], ['Large', 2050], ['X-Large', 2950]] },
  { c: 'Blaze Special', n: 'Four Seasons Pizza',
    d: 'Mix Cheese, 04 Flavored Chicken, Tomato, Capsicum, Onion, Black Olives, Sweet Corn, Mushrooms',
    v: [['Medium', 1450], ['Large', 2050], ['X-Large', 2950]] },

  // ══ STUFF CRUST ═══════════════════════════════════════════════════════════
  { c: 'Stuff Crust', n: 'Kabab Crust',
    d: 'Mix Cheese, Seekh Kabab, Capsicum, Onion, Sweet Corn, Special Sauce',
    v: [['Medium', 1550], ['Large', 2150], ['X-Large', 3200]] },
  { c: 'Stuff Crust', n: 'Royal Crust Pizza',
    d: 'Mix Cheese, Chicken Tikka, Pizza Sauce, Capsicum, Sweet Corn, Black Olives',
    v: [['Medium', 1550], ['Large', 2150], ['X-Large', 3200]] },
  { c: 'Stuff Crust', n: 'Crown Crust Pizza',
    d: 'Chicken Tikka, Mix Cheese, Black Olives, Tomato, Capsicum, Special Pizza Sauce',
    v: [['Medium', 1550], ['Large', 2150], ['X-Large', 3200]] },

  // ══ REGULAR PIZZA ═════════════════════════════════════════════════════════
  { c: 'Regular Pizza', n: 'Fajita',
    d: 'Fajita Chicken, Mix Cheese, Pizza Sauce, Capsicum, Tomato',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Vegetable Pizza',
    d: 'Mix Cheese, Pizza Sauce White, Loaded with Mix Vegetables, Onion, Tomato, Capsicum, Cabbage, Mushrooms',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Tikka',
    d: 'Chicken Tikka, Mix Cheese, Tomato, Onion, Pizza Sauce, Jalapeno',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Chicken Smoked',
    d: 'Chicken Smoked, Special Sauces, Black Olives, Tomato, Mustard Paste',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Malai Boti',
    d: 'Mix Cheese, Malai Chicken, Capsicum, Sweet Corn, Black Olives, Pizza Sauce Special',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Chicken Tandoori',
    d: 'Mix Cheese, Chicken Tikka, Pizza Sauce Special, Tomato, Onion',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },
  { c: 'Regular Pizza', n: 'Chicken Supreme',
    d: 'Mix Cheese, Chicken Tikka, Tomato, Onion, Capsicum, Black Olives, Special Pizza Sauces',
    v: [['Small', 650], ['Medium', 1250], ['Large', 1850], ['X-Large', 2750]] },

  // ══ BURGERS ═══════════════════════════════════════════════════════════════
  { c: 'Burgers', n: 'Tikka Patty Burger', p: 450 },
  { c: 'Burgers', n: 'Crunchy Burger', p: 450 },
  { c: 'Burgers', n: 'Jalapeno Spicy Burger', p: 500 },
  { c: 'Burgers', n: 'Zinger Burger', p: 500 },
  { c: 'Burgers', n: 'Chicken Patty Burger', p: 450 },
  { c: 'Burgers', n: 'Chicken Grilled Burger', p: 550 },
  { c: 'Burgers', n: 'Mighty Burger', p: 700 },
  { c: 'Burgers', n: 'Tower Burger', p: 750 },
  { c: 'Burgers', n: 'Beef Patty Burger',
    v: [['Single Patty', 700], ['Double Patty', 1100]] },

  // ══ WRAPS ═════════════════════════════════════════════════════════════════
  { c: 'Wraps', n: 'Shawarma Roll', p: 300 },
  { c: 'Wraps', n: 'Afghani Roll', p: 400 },
  { c: 'Wraps', n: 'Zinger Cheese Roll', p: 500 },
  { c: 'Wraps', n: 'Tikka Paratha Roll', p: 450 },
  { c: 'Wraps', n: 'Chicken Cheese Paratha', p: 500 },
  { c: 'Wraps', n: 'Achari Paratha', p: 450 },
  { c: 'Wraps', n: 'Zinger Paratha Roll', p: 500 },
  { c: 'Wraps', n: 'Zinger Shawarma Roll', p: 500 },

  // ══ CHINESE ═══════════════════════════════════════════════════════════════
  { c: 'Chinese', n: 'Vegetable Fried Rice', p: 450 },
  { c: 'Chinese', n: 'Egg Fried Rice', p: 500 },
  { c: 'Chinese', n: 'Chicken Fried Rice', p: 550 },
  { c: 'Chinese', n: 'Chicken Chowmain', p: 750 },
  { c: 'Chinese', n: 'Chicken Menchorian With Rice', p: 850 },
  { c: 'Chinese', n: 'Chicken Black Paper Fried Rice', p: 600 },
  { c: 'Chinese', n: 'Chicken Shashlik With Rice', p: 850 },

  // ══ PASTA ═════════════════════════════════════════════════════════════════
  { c: 'Pasta', n: 'Creamy Baked Pasta', v: [['F1', 500], ['F2', 900]] },
  { c: 'Pasta', n: 'Alfredo Pasta', v: [['F1', 500], ['F2', 900]] },
  { c: 'Pasta', n: 'Crunchy Pasta', v: [['F1', 550], ['F2', 950]] },

  // ══ FRIES ═════════════════════════════════════════════════════════════════
  { c: 'Fries', n: 'Plain Fries', p: 240 },
  { c: 'Fries', n: 'Masala Fries', p: 250 },
  { c: 'Fries', n: 'Garlic Mayo Fries', p: 270 },
  { c: 'Fries', n: 'Malai Boti Fries', v: [['F1', 450], ['F2', 850]] },
  { c: 'Fries', n: 'Loaded Fries', v: [['F1', 450], ['F2', 850]] },
  { c: 'Fries', n: 'Fries Bucket', p: 400 },

  // ══ APPETIZERS ════════════════════════════════════════════════════════════
  { c: 'Appetizers', n: 'Nuggets', v: [['6 Pieces', 350], ['12 Pieces', 650]] },
  { c: 'Appetizers', n: 'Grilled Wings', v: [['6 Pieces', 450], ['12 Pieces', 900]] },
  { c: 'Appetizers', n: 'Crispy Wings', v: [['6 Pieces', 450], ['12 Pieces', 900]] },
  { c: 'Appetizers', n: 'Hot Wings', v: [['6 Pieces', 450], ['12 Pieces', 900]] },

  // ══ SANDWICH ══════════════════════════════════════════════════════════════
  { c: 'Sandwich', n: 'Grilled Sandwich', p: 600 },
  { c: 'Sandwich', n: 'Club Sandwich', p: 450 },
  { c: 'Sandwich', n: 'Cold Sandwich', p: 350 },

  // ══ SOUP ══════════════════════════════════════════════════════════════════
  { c: 'Soup', n: 'Chicken Corn Soup', v: [['Single', 500], ['Family', 1000]] },
  { c: 'Soup', n: 'Hot & Sour Soup', v: [['Single', 500], ['Family', 1000]] },

  // ══ DRINKS ════════════════════════════════════════════════════════════════
  // The printed menu lists two prices for the bottled sizes (e.g. "80/100").
  // Entered as two variants; confirm with the client which is which.
  { c: 'Drinks', n: 'Fresh Lime', p: 200 },
  { c: 'Drinks', n: 'Mint Margarita', p: 250 },
  { c: 'Drinks', n: 'Regular Drink', v: [['Option A', 80], ['Option B', 100]] },
  { c: 'Drinks', n: '500ml Drink', v: [['Option A', 100], ['Option B', 120]] },
  { c: 'Drinks', n: '1 Liter Drink', v: [['Option A', 150], ['Option B', 180]] },
  { c: 'Drinks', n: '1.5 Liter Drink', v: [['Option A', 180], ['Option B', 220]] },
  { c: 'Drinks', n: '2.25 Liter Drink', v: [['Option A', 250], ['Option B', 280]] },
  { c: 'Drinks', n: 'Mineral Water', v: [['500ml', 70], ['1.5 Litre', 140]] },

  // ══ TEA ═══════════════════════════════════════════════════════════════════
  { c: 'Tea', n: 'Kashmiri Tea', p: 250 },
  { c: 'Tea', n: 'Mix Tea', p: 140 },
  { c: 'Tea', n: 'Cappuccino Coffee', p: 300 },

  // ══ EXTRAS ════════════════════════════════════════════════════════════════
  { c: 'Extras', n: 'Extra Topping',
    v: [['Medium', 100], ['Large', 150], ['X-Large', 200]] },
];

// ── Deals ────────────────────────────────────────────────────────────────────
// `items` reference menu items by name, with an optional variant label.
// [name, quantity, variantLabel]

const DEALS = [
  // ══ PIZZA DEALS — regular pizza only ══════════════════════════════════════
  { g: 'Pizza Deals', n: 'Pizza Deal 1', p: 850,
    d: 'Shawarma Roll + Small Pizza + Regular Drink',
    items: [['Shawarma Roll', 1], ['Tikka', 1, 'Small'], ['Regular Drink', 1, 'Option A']] },
  { g: 'Pizza Deals', n: 'Pizza Deal 2', p: 1599,
    d: 'Large Pizza + 1 Liter Drink',
    items: [['Tikka', 1, 'Large'], ['1 Liter Drink', 1, 'Option A']] },
  { g: 'Pizza Deals', n: 'Pizza Deal 3', p: 999,
    d: '2 Small Pizza + 2 Regular Drink',
    items: [['Tikka', 2, 'Small'], ['Regular Drink', 2, 'Option A']] },
  { g: 'Pizza Deals', n: 'Pizza Deal 4', p: 1999,
    d: '2 Medium Pizza + 500 ml Drink',
    items: [['Tikka', 2, 'Medium'], ['500ml Drink', 1, 'Option A']] },
  { g: 'Pizza Deals', n: 'Family Deal 5', p: 2999,
    d: '2 Large Pizza + 1.5 Liter Drink',
    items: [['Tikka', 2, 'Large'], ['1.5 Liter Drink', 1, 'Option A']] },

  // ══ ZINGER DEALS ══════════════════════════════════════════════════════════
  { g: 'Zinger Deals', n: 'Zinger Deal 1', p: 600,
    d: 'Zinger Burger + Regular Drink + Regular Fries',
    items: [['Zinger Burger', 1], ['Regular Drink', 1, 'Option A'], ['Plain Fries', 1]] },
  { g: 'Zinger Deals', n: 'Zinger Deal 2', p: 1200,
    d: '2 Zinger Burgers + 2 Regular Drinks + Masala Fries',
    items: [['Zinger Burger', 2], ['Regular Drink', 2, 'Option A'], ['Masala Fries', 1]] },
  { g: 'Zinger Deals', n: 'Zinger Deal 3', p: 1900,
    d: '3 Zinger Burgers + 3 Crispy Wings + Masala Fries + 1 Liter Drink',
    items: [['Zinger Burger', 3], ['Crispy Wings', 1, '6 Pieces'], ['Masala Fries', 1], ['1 Liter Drink', 1, 'Option A']] },
  { g: 'Zinger Deals', n: 'Zinger Deal 4', p: 880,
    d: 'Tower Burger + 500ml Drink + Regular Fries',
    items: [['Tower Burger', 1], ['500ml Drink', 1, 'Option A'], ['Plain Fries', 1]] },
  { g: 'Zinger Deals', n: 'Zinger Family Deal 5', p: 3000,
    d: '5 Zinger Burgers + Masala Fries + 1.5 Liter Drink + 5 Crispy Wings',
    items: [['Zinger Burger', 5], ['Masala Fries', 1], ['1.5 Liter Drink', 1, 'Option A'], ['Crispy Wings', 1, '6 Pieces']] },

  // ══ PLATTER DEALS ═════════════════════════════════════════════════════════
  { g: 'Platter Deals', n: 'Platter Deal 1', p: 3500,
    d: '2 Zinger Cheese Roll + 1 Chicken Tikka Medium + 1 Loaded Fries + 6 Hot Wings + 1.5 Drink',
    items: [['Zinger Cheese Roll', 2], ['Tikka', 1, 'Medium'], ['Loaded Fries', 1, 'F1'], ['Hot Wings', 1, '6 Pieces'], ['1.5 Liter Drink', 1, 'Option A']] },
  { g: 'Platter Deals', n: 'Platter Deal 2', p: 3500,
    d: 'Large Pizza + Zinger Burger + Tower Burger + Garlic Mayo Fries + 6 Crispy Wings + 1.5 Liter Drink',
    items: [['Tikka', 1, 'Large'], ['Zinger Burger', 1], ['Tower Burger', 1], ['Garlic Mayo Fries', 1], ['Crispy Wings', 1, '6 Pieces'], ['1.5 Liter Drink', 1, 'Option A']] },
  { g: 'Platter Deals', n: 'Platter Deal 3', p: 3500,
    d: '1 Medium Pizza + 1 Creamy Baked Pasta + 1 Chowmein + 6 Crispy Wings + 6 Nuggets + 1.5 Drink',
    items: [['Tikka', 1, 'Medium'], ['Creamy Baked Pasta', 1, 'F1'], ['Chicken Chowmain', 1], ['Crispy Wings', 1, '6 Pieces'], ['Nuggets', 1, '6 Pieces'], ['1.5 Liter Drink', 1, 'Option A']] },

  // ══ BIRTHDAY DEAL ═════════════════════════════════════════════════════════
  { g: 'Birthday Deal', n: 'Birthday Deal', p: 4350,
    d: '1 Chicken Tikka Pizza (X-Large) + 3 Zinger Burger + 1 Regular Fries + 1.5 Litre Cold Drink',
    items: [['Tikka', 1, 'X-Large'], ['Zinger Burger', 3], ['Plain Fries', 1], ['1.5 Liter Drink', 1, 'Option A']] },
];

// ── Seed ─────────────────────────────────────────────────────────────────────

const run = db.transaction(() => {
  if (REPLACE) {
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare('DELETE FROM item_variants').run();
    db.prepare('DELETE FROM menu_items').run();
    console.log('Cleared existing menu and deals.');
  }

  const insertItem = db.prepare(
    'INSERT INTO menu_items (name, category, price, has_variants) VALUES (?, ?, ?, ?)'
  );
  const insertVariant = db.prepare(
    'INSERT INTO item_variants (menu_item_id, label, price, sort_order) VALUES (?, ?, ?, ?)'
  );
  const findItem = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const findVariant = db.prepare(
    'SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?'
  );

  let added = 0, skipped = 0;

  for (const m of MENU) {
    if (findItem.get(m.n)) { skipped++; continue; }

    const hasVariants = Array.isArray(m.v) && m.v.length > 0;
    const basePrice = hasVariants ? 0 : (m.p || 0);
    const id = insertItem.run(m.n, m.c, basePrice, hasVariants ? 1 : 0).lastInsertRowid;

    if (hasVariants) {
      m.v.forEach(([label, price], i) => insertVariant.run(id, label, price, i));
    }
    added++;
  }

  console.log(`Menu items: ${added} added, ${skipped} already present.`);

  // Deals
  const insertDeal = db.prepare(
    'INSERT INTO deals (name, description, price, deal_group, active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertDealItem = db.prepare(
    'INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)'
  );
  const findDeal = db.prepare('SELECT id FROM deals WHERE name = ?');

  let dealsAdded = 0, dealsSkipped = 0;
  const warnings = [];

  for (const d of DEALS) {
    if (findDeal.get(d.n)) { dealsSkipped++; continue; }

    const dealId = insertDeal.run(d.n, d.d, d.p, d.g).lastInsertRowid;

    for (const [itemName, qty, variantLabel] of d.items) {
      const item = findItem.get(itemName);
      if (!item) {
        warnings.push(`${d.n}: menu item "${itemName}" not found — skipped`);
        continue;
      }

      let variantId = null;
      if (variantLabel) {
        const v = findVariant.get(item.id, variantLabel);
        if (v) variantId = v.id;
        else warnings.push(`${d.n}: "${itemName}" has no variant "${variantLabel}"`);
      }

      insertDealItem.run(dealId, item.id, qty, variantId);
    }
    dealsAdded++;
  }

  console.log(`Deals: ${dealsAdded} added, ${dealsSkipped} already present.`);
  if (warnings.length) {
    console.log('\nWarnings:');
    warnings.forEach(w => console.log('  - ' + w));
  }
});

run();

// Update the restaurant identity to match the printed menu.
const upsert = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
upsert.run('restaurant_name', 'Blaze Pizza House');

console.log('\nDone.');
