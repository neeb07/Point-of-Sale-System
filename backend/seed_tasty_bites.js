const db = require('./db/database.js');

// 1. Schema Migrations
console.log('Running schema migrations...');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS item_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    size_label TEXT NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );
`);

try { db.exec("ALTER TABLE menu_items ADD COLUMN has_variants INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE deals ADD COLUMN deal_group TEXT;"); } catch(e) {}

// Check if deal_items needs recreation (if description column doesn't exist)
const dealItemsInfo = db.prepare("PRAGMA table_info(deal_items)").all();
if (!dealItemsInfo.some(col => col.name === 'description')) {
  console.log('Recreating deal_items to support description and nullable menu_item_id...');
  db.transaction(() => {
    db.exec(`PRAGMA foreign_keys=off;`);
    db.exec(`
      CREATE TABLE new_deal_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id INTEGER NOT NULL,
        menu_item_id INTEGER,
        quantity INTEGER DEFAULT 1,
        description TEXT,
        FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      );
    `);
    db.exec(`
      INSERT INTO new_deal_items (id, deal_id, menu_item_id, quantity)
      SELECT id, deal_id, menu_item_id, quantity FROM deal_items;
    `);
    db.exec(`DROP TABLE deal_items;`);
    db.exec(`ALTER TABLE new_deal_items RENAME TO deal_items;`);
    db.exec(`PRAGMA foreign_keys=on;`);
  })();
}

// 2. Data Preparation
const menuData = [
  // Pizzas
  { category: 'Standard Pizza', hasVariants: true, items: [
    { name: 'Vege Lover', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Cheese Lover', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Chicken Tikka', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Chicken Fajita', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Ch. Fajita Sicilian', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Euro Delight', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Jalapeno', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Supreme', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Shawarma', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Shahi', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Achari', variants: { Small: 550, Medium: 1000, Large: 1300 } },
    { name: 'Bonfire', variants: { Small: 550, Medium: 1000, Large: 1300 } }
  ]},
  { category: 'Classic Pizza', hasVariants: true, items: [
    { name: 'Tasty Bites Special Pizza', variants: { Small: 600, Medium: 1100, Large: 1400 } },
    { name: 'Special Malai Boti Pizza', variants: { Small: 600, Medium: 1100, Large: 1400 } },
    { name: 'Paratha Pizza', variants: { Small: 600, Medium: 1100, Large: 1400 } }
  ]},
  { category: 'Premium Pizza', hasVariants: true, items: [
    { name: 'Crunchy', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Behari Kabab', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Seekh Kabab', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Extreme', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Cheese Crust', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Multani', variants: { Small: 650, Medium: 1250, Large: 1600 } },
    { name: 'Crown Crust', variants: { Small: 650, Medium: 1250, Large: 1600 } }
  ]},
  { category: 'Special Pizza', hasVariants: true, items: [
    { name: 'Double Seekh Kabab', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Royal Crust', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Special Multan Sultan', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Crispy Crust', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Mughlai', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Crush Kabab', variants: { Small: 800, Medium: 1450, Large: 1700 } },
    { name: 'Lasagnia Malai Boti', variants: { Small: 800, Medium: 1450, Large: 1700 } }
  ]},
  { category: '4 XL Pizza', hasVariants: true, items: [
    { name: '4 XL Pizza', variants: { Medium: 1500, Large: 2000 } }
  ]},
  { category: 'Double Extreme', hasVariants: true, items: [
    { name: 'Double Extreme', variants: { Medium: 1600, Large: 2200 } }
  ]},
  { category: 'Deep Dish', hasVariants: true, items: [
    { name: 'Deep Dish', variants: { Large: 2200 } }
  ]},
  { category: 'Matka Pizza', hasVariants: false, items: [
    { name: 'Malai Botti Matka Pizza', price: 900 },
    { name: 'Tikka Boti Matka Pizza', price: 900 },
    { name: 'Kabab Matka Pizza', price: 900 }
  ]},
  { category: 'Extras', hasVariants: true, items: [
    { name: 'Extra Topping', variants: { Small: 100, Medium: 150, Large: 200 } }
  ]},

  // Burgers
  { category: 'Burgers', hasVariants: false, items: [
    { name: 'Zinger Burger', price: 350 },
    { name: 'Chicken Burger', price: 300 },
    { name: 'Mighty Burger', price: 600 },
    { name: 'Pizza Burger', price: 550 },
    { name: 'Jalapeno Burger', price: 400 },
    { name: 'Tikka Burger', price: 300 },
    { name: 'Double Decker Burger', price: 550 },
    { name: 'Double Patty Burger', price: 550 },
    { name: 'Tasty Bites 20-20 Burger', price: 450 },
    { name: 'Special Beef Burger', price: 450 },
    { name: 'Special Tasty Bite Red Zinger', price: 450 }
  ]},

  // Fries
  { category: 'French Fries', hasVariants: false, items: [
    { name: 'French Fries Small', price: 250 },
    { name: 'French Fries Large', price: 300 },
    { name: 'French Fries Family', price: 400 },
    { name: 'Loaded Fries Half', price: 450 },
    { name: 'Loaded Cheesy Fries Large', price: 550 },
    { name: 'Loaded Cheesy Fries Family', price: 650 },
    { name: 'Pizza Fries Large', price: 650 }
  ]},

  // Chicken Rolls
  { category: 'Chicken Rolls', hasVariants: false, items: [
    { name: 'Tasty Bites Special Malai Boti Roll', price: 300 },
    { name: 'Shawarma Roll', price: 220 },
    { name: 'Cheese Shawarma Roll', price: 270 },
    { name: 'Pratha Roll', price: 270 },
    { name: 'Zinger Pratha Roll', price: 400 },
    { name: 'Zinger Shawarma Roll', price: 400 },
    { name: 'Kabab Roll', price: 300 },
    { name: 'Arabian Shamoli', price: 300 }
  ]},

  // Wrap
  { category: 'Wrap', hasVariants: false, items: [
    { name: 'Tortilla Wrap', price: 500 },
    { name: 'Crispy Wrap', price: 450 },
    { name: 'Kababish Wrap', price: 500 }
  ]},

  // Hot Wings
  { category: 'Hot Wings', hasVariants: false, items: [
    { name: '6 Pc Hot Wings/Nuggets', price: 320 },
    { name: '12 Pc Hot Wings/Nuggets', price: 600 },
    { name: '10 Pc Oven Baked Wings', price: 600 },
    { name: '10 Pc Honey Wings', price: 600 }
  ]},

  // Broast Chicken
  { category: 'Broast Chicken', hasVariants: false, items: [
    { name: 'Leg Broast', price: 350 },
    { name: 'Chest Broast', price: 380 },
    { name: 'Grill Leg', price: 350 },
    { name: 'Grill Chest', price: 380 }
  ]},

  // Special Meal
  { category: 'Special Meal', hasVariants: false, items: [
    { name: 'Tikka Sandwich', price: 500 },
    { name: 'Mexican Sandwich', price: 550 },
    { name: 'Behari Roll', price: 500 },
    { name: 'Donor', price: 500 }
  ]},
  { category: 'Special Meal', hasVariants: true, items: [
    { name: 'Tasty Bites 20-20 Pasta', variants: { Half: 450, Full: 650 } },
    { name: 'Flaming Pasta', variants: { Half: 400, Full: 600 } },
    { name: 'Crunchy Pasta', variants: { Half: 500, Full: 700 } }
  ]},

  // Ice Cream
  { category: 'Ice Cream', hasVariants: false, items: [
    { name: 'One Scoop', price: 100 },
    { name: 'Two Scoop', price: 180 },
    { name: 'Three Scoop', price: 250 }
  ]},

  // Drinks (Null/0 price)
  { category: 'Drinks', hasVariants: false, items: [
    { name: '250ml Drink', price: 0 },
    { name: '500ml Drink', price: 0 },
    { name: 'Tin Pack', price: 0 },
    { name: 'Sting 500ml', price: 0 },
    { name: 'Sting 350ml', price: 0 },
    { name: '1000ml Drink', price: 0 },
    { name: '1500ml Drink', price: 0 },
    { name: '2.25 Liter Drink', price: 0 },
    { name: '500ml Mineral Water', price: 0 },
    { name: '1500ml Mineral Water', price: 0 },
    { name: 'Fresh Lime', price: 0 }
  ]},

  // Dip Sauce
  { category: 'Dip Sauce', hasVariants: false, items: [
    { name: 'Dip Sauce', price: 50 }
  ]}
];

const dealsData = [
  { deal_group: '1 Person Deals', name: '1 Person Deal #1', price: 350, items: ['1 Chicken Burger', '1 350ml Drink'] },
  { deal_group: '1 Person Deals', name: '1 Person Deal #2', price: 350, items: ['1 Tikka Burger', '1 350ml Drink'] },
  { deal_group: '1 Person Deals', name: '1 Person Deal #3', price: 400, items: ['1 Zinger Burger', '1 350ml Drink'] },
  { deal_group: '1 Person Deals', name: '1 Person Deal #4', price: 400, items: ['1 Jalapeno Burger', '1 350ml Drink'] },
  { deal_group: '1 Person Deals', name: '1 Person Deal #5', price: 500, items: ['1 Chicken Burger', '1 350ml Drink', '1 Small Fries'] },
  { deal_group: '1 Person Deals', name: '1 Person Deal #6', price: 600, items: ['1 Zinger Burger', '1 Small Fries', '1 350ml Drink'] },

  { deal_group: '2 Person Deals', name: '2 Person Deal #1', price: 500, items: ['2 Shawarma Roll', '1 350ml Drink'] },
  { deal_group: '2 Person Deals', name: '2 Person Deal #2', price: 600, items: ['2 Chicken Burger', '1 350ml Drink'] },
  { deal_group: '2 Person Deals', name: '2 Person Deal #3', price: 600, items: ['2 Pratha Roll', '1 350ml Drink'] },
  { deal_group: '2 Person Deals', name: '2 Person Deal #4', price: 670, items: ['1 Flaming Pasta Full', '1 350ml Drink'] },
  { deal_group: '2 Person Deals', name: '2 Person Deal #5', price: 600, items: ['4 Pc Behari Roll', '1 350ml Drink'] },
  { deal_group: '2 Person Deals', name: '2 Person Deal #6', price: 700, items: ['2 Zinger Burger', '1 350ml Drink'] },

  { deal_group: 'Student Deal', name: 'Student Deal #1', price: 1000, items: ['1 Small Pizza Kabab', '6 Pc Wings', '1 350ml Drink'] },
  { deal_group: 'Student Deal', name: 'Student Deal #2', price: 1350, items: ['1 Medium Pizza Kabab', '1 Liter Drink'] },
  { deal_group: 'Student Deal', name: 'Student Deal #3', price: 1450, items: ['1 Large Pizza Special Malai Boti', '1 Liter Drink'] },

  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #1', price: 900, items: ['1 Special Pizza Small', '1 Zinger Burger', '1 350ml Drink'] },
  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #2', price: 1100, items: ['1 Tikka Pizza Small', '1 Fajita Pizza Small', '1 350ml Drink'] },
  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #3', price: 1700, items: ['1 Special Pizza Medium', '1 Fajita Pizza Small', '1 Ltr Drink'] },
  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #4', price: 2300, items: ['1 Seekh Kabab Pizza Large', '12 Pc Hot Wings', '1.5 Ltr Drink'] },
  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #5', price: 2100, items: ['1 Tikka Pizza Medium', '1 Fajita Pizza Medium', '1 Ltr Drink'] },
  { deal_group: 'Special Pizza Deal', name: 'Special Pizza Deal #6', price: 2700, items: ['1 Tikka Pizza Large', '1 Fajita Pizza Large', '1 Liter Drink'] },

  { deal_group: 'Family Deal', name: 'Family Deal #1', price: 1900, items: ['5 Zinger Burger', '1.5 Ltr Drink'] },
  { deal_group: 'Family Deal', name: 'Family Deal #2', price: 2900, items: ['2 Small Pizza', '4 Zinger Burger', '1 Large Fries', '1.5 Ltr Drink'] },
  { deal_group: 'Family Deal', name: 'Family Deal #3', price: 3000, items: ['1 Large Pizza', '2 Zinger Burgers', '2 Chicken Burgers', '1 Large Fries', '1 Drink 2.25 Liter'] },

  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #1', price: 1100, items: ['3 Zinger Burger', '1 Ltr Drink'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #2', price: 1100, items: ['1 Medium Special Pizza', '1 350ml Drink'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #3', price: 1400, items: ['1 Large Tikka Pizza', '1 Liter Drink'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #4', price: 1500, items: ['4 Zinger Burger', '1.5 Liter Coke'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #5', price: 2000, items: ['1 Large Fajita Pizza', '1 Special Small Pizza', '1.5 Liter Coke'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #6', price: 4500, items: ['1 Large Lazania Pizza', '1 Large Special Pizza', '1 Large Fajita Pizza', '2.25 Liter Coke'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #7', price: 1250, items: ['6 Wings', '6 Nuggets', '1 Small Pizza', '1 Liter Drink'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #8', price: 2400, items: ['1 Shahi Pizza Large', '1 Bonefire Pizza Medium', '1 Drink 1.5 Liter'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #9', price: 850, items: ['1 Lazania Pizza Small', '1 350ml Drink'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #10', price: 850, items: ['1 Paratha Roll', '1 Malai Boti Roti', '1 Shawarma Roll', '1 Zinger Paratha Roll', '1 Liter Drink'] },
  // TODO: Prices for Deal #11 and #12 are unclear (Rs.850/1150 and Rs.1100/1150). Using the lower estimate for now.
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #11', price: 850, items: ['1 Leg', '1 Thigh', '1 Bun', 'Fries', '1 Garlic Dip'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #12', price: 1100, items: ['1 Leg', '1 Thigh', '1 Wing', '1 Breast', '1 Bun', 'Fries', '1 Garlic Dip'] },
  { deal_group: 'Lunch & Midnight Deal', name: 'Lunch & Midnight Deal #13', price: 2100, items: ['2 Legs', '1 Thigh', '2 Wings', '2 Breasts', '2 Buns', 'Fries', '1 Garlic Dip'] },
];

console.log('Inserting data...');
db.transaction(() => {
  // Insert Categories
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  const distinctCategories = new Set(menuData.map(d => d.category));
  distinctCategories.forEach(cat => insertCategory.run(cat));

  // Insert Menu Items
  const checkMenu = db.prepare('SELECT id FROM menu_items WHERE name = ? AND category = ?');
  const insertVariant = db.prepare('INSERT INTO item_variants (menu_item_id, size_label, price) VALUES (?, ?, ?)');
  const checkVariant = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND size_label = ?');

  let stats = {};

  menuData.forEach(catData => {
    if (!stats[catData.category]) stats[catData.category] = 0;
    
    catData.items.forEach(item => {
      let menuItemId;
      const existing = checkMenu.get(item.name, catData.category);
      if (existing) {
        menuItemId = existing.id;
        db.prepare('UPDATE menu_items SET has_variants = ?, price = ? WHERE id = ?')
          .run(catData.hasVariants ? 1 : 0, item.price || 0, menuItemId);
      } else {
        const result = db.prepare('INSERT INTO menu_items (name, category, price, has_variants) VALUES (?, ?, ?, ?)')
          .run(item.name, catData.category, item.price || 0, catData.hasVariants ? 1 : 0);
        menuItemId = result.lastInsertRowid;
        stats[catData.category]++;
      }

      if (catData.hasVariants && item.variants) {
        for (const [size, price] of Object.entries(item.variants)) {
          const existingVar = checkVariant.get(menuItemId, size);
          if (existingVar) {
            db.prepare('UPDATE item_variants SET price = ? WHERE id = ?').run(price, existingVar.id);
          } else {
            insertVariant.run(menuItemId, size, price);
          }
        }
      }
    });
  });

  // Insert Deals
  const checkDeal = db.prepare('SELECT id FROM deals WHERE name = ?');
  const insertDeal = db.prepare('INSERT INTO deals (name, deal_group, price) VALUES (?, ?, ?)');
  const updateDeal = db.prepare('UPDATE deals SET price = ?, deal_group = ? WHERE id = ?');
  
  const insertDealItem = db.prepare('INSERT INTO deal_items (deal_id, description) VALUES (?, ?)');
  const clearDealItems = db.prepare('DELETE FROM deal_items WHERE deal_id = ?');

  if (!stats['Deals']) stats['Deals'] = 0;

  dealsData.forEach(deal => {
    let dealId;
    const existing = checkDeal.get(deal.name);
    if (existing) {
      dealId = existing.id;
      updateDeal.run(deal.price, deal.deal_group, dealId);
      clearDealItems.run(dealId); // Clear existing items to re-seed
    } else {
      const result = insertDeal.run(deal.name, deal.deal_group, deal.price);
      dealId = result.lastInsertRowid;
      stats['Deals']++;
    }

    deal.items.forEach(desc => {
      insertDealItem.run(dealId, desc);
    });
  });

  console.log('\n--- Seed Summary ---');
  for (const [cat, count] of Object.entries(stats)) {
    console.log(`${cat}: ${count} new items added.`);
  }

})();

console.log('\n--- WARNING ---');
console.log('The following items were inserted with Rs. 0 price (e.g. Drinks). Please confirm prices and update them:');
const zeroPrice = db.prepare("SELECT name, category FROM menu_items WHERE price = 0 AND has_variants = 0").all();
zeroPrice.forEach(z => console.log(`- ${z.name} (${z.category})`));

console.log('\nTODO: Deals "Lunch & Midnight Deal #11" and "#12" were inserted with Rs.850 and Rs.1100. Confirm if it should be 1150.');
