const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname, '..');

if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const DB_PATH = path.join(userDataDir, 'pos_database.db');
console.log('Using database at:', DB_PATH);

// FIX (Bug 5): apply a pending restore before opening the database. The
// restore endpoint stages the verified file here rather than swapping it
// underneath a live connection, which would corrupt open handles.
const PENDING_RESTORE = path.join(userDataDir, 'pending_restore.db');
if (fs.existsSync(PENDING_RESTORE)) {
  try {
    ['-wal', '-shm'].forEach((suffix) => {
      const sidecar = DB_PATH + suffix;
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    });
    fs.copyFileSync(PENDING_RESTORE, DB_PATH);
    fs.unlinkSync(PENDING_RESTORE);
    console.log('Restore applied from pending_restore.db');
  } catch (e) {
    console.error('Restore failed, keeping existing database:', e.message);
  }
}

const db = new Database(DB_PATH);

// Crash protection + performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('wal_checkpoint(TRUNCATE)');

// Create all tables
db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    discount REAL DEFAULT 0,
    payment_method TEXT DEFAULT 'Cash',
    status TEXT DEFAULT 'completed',
    cashier_name TEXT DEFAULT 'Admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'Cashier',
    pin TEXT NOT NULL UNIQUE,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_url TEXT,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deal_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS item_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    price REAL NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL,
    stock REAL DEFAULT 0,
    low_stock_threshold REAL DEFAULT 0,
    cost_per_unit REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    menu_item_id INTEGER NOT NULL,
    variant_id INTEGER DEFAULT NULL,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES item_variants(id) ON DELETE CASCADE
  );

  -- FIX (Bug 5): Shift Management in Settings was entirely client-side fake
  -- data (hardcoded 23 orders / Rs. 12,400 and three invented history rows).
  -- This table makes it real and auditable.
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER,
    staff_name TEXT,
    opening_cash REAL DEFAULT 0,
    closing_cash REAL DEFAULT NULL,
    expected_cash REAL DEFAULT NULL,
    variance REAL DEFAULT NULL,
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME DEFAULT NULL,
    status TEXT DEFAULT 'open'
  );

  CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity_required REAL NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
  );
`);

// Migrations
try { db.exec("ALTER TABLE orders ADD COLUMN cashier_name TEXT DEFAULT 'Admin';"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN cashier_id INTEGER DEFAULT NULL;"); } catch(e) {}
try { db.exec("ALTER TABLE staff ADD COLUMN color TEXT DEFAULT '#DC2626';"); } catch(e) {}
try { db.exec("ALTER TABLE staff ADD COLUMN avatar_initials TEXT DEFAULT '';"); } catch(e) {}
try { db.exec("UPDATE staff SET active = 1 WHERE role = 'Owner';"); } catch(e) {}
try { db.exec("UPDATE staff SET color = '#7C3AED' WHERE color IS NULL OR color = '';"); } catch(e) {}
try { db.exec("ALTER TABLE menu_items ADD COLUMN has_variants INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("UPDATE menu_items SET category = 'Pizza' WHERE category IN ('Standard Pizza', 'Classic Pizza', 'Premium Pizza', 'Special Pizza', 'Deep Dish', 'New Addition');"); } catch(e) {}
try { db.exec("UPDATE menu_items SET category = 'Sides' WHERE category IN ('Wrap', 'Hot Wings', 'Broast Chicken', 'Fries', 'Special Meal');"); } catch(e) {}
try { db.exec("ALTER TABLE deal_items ADD COLUMN variant_id INTEGER DEFAULT NULL;"); } catch(e) {}

// --- NEW MIGRATIONS (Deals sub-groups + Delivery) ---
// FIX: routes/deals.js reads/writes di.description but this column never existed on
// deal_items — every deal request would have thrown an SQL error. Adding it here.
try { db.exec("ALTER TABLE deal_items ADD COLUMN description TEXT DEFAULT NULL;"); } catch(e) {}
// Lets deals be grouped into "1 Person Deals", "Student Deal", etc. for the Deals sub-bar
try { db.exec("ALTER TABLE deals ADD COLUMN deal_group TEXT DEFAULT NULL;"); } catch(e) {}
// Dine-in vs Delivery on each order, and the exact delivery amount charged at the time
try { db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'Dine-in';"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_charge REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE ingredients ADD COLUMN low_stock_threshold REAL DEFAULT 0;"); } catch(e) {}

// FIX (Bug 5): stamp every order with the shift it belongs to, so shift
// totals are derived from real sales instead of hardcoded numbers.
try { db.exec("ALTER TABLE orders ADD COLUMN shift_id INTEGER DEFAULT NULL;"); } catch(e) {}
// FIX (Bug 6): the Sale screen collected no table/token number even though
// receipts displayed a placeholder for it.
try { db.exec("ALTER TABLE orders ADD COLUMN table_number TEXT DEFAULT NULL;"); } catch(e) {}
// Helpful indexes for the reporting queries.
try { db.exec("CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);"); } catch(e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_orders_shift ON orders(shift_id);"); } catch(e) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);"); } catch(e) {}

// Rebrand: move an existing install off the old default restaurant name.
// Runs once; never overwrites a name the owner has customised themselves.
try {
  db.prepare("UPDATE settings SET value = 'Blaze' WHERE key = 'restaurant_name' AND value = 'Al-Madina Fast Food'").run();
} catch(e) {}
// Rebrand: retire the old orange staff colour.
try { db.exec("UPDATE staff SET color = '#DC2626' WHERE color = '#F97316';"); } catch(e) {}

// Seed menu items
const count = db.prepare('SELECT COUNT(*) as count FROM menu_items').get();
if (count.count === 0) {
  const insertItem = db.prepare('INSERT INTO menu_items (name, category, price, has_variants) VALUES (?, ?, ?, ?)');
  const insertVariant = db.prepare('INSERT INTO item_variants (menu_item_id, label, price, sort_order) VALUES (?, ?, ?, ?)');

  db.transaction(() => {
    // Single price items
    const singleItems = [
      ['Zinger Burger', 'Burger', 350],
      ['Chicken Burger', 'Burger', 300],
      ['Mighty Burger', 'Burger', 600],
      ['Pizza Burger', 'Burger', 550],
      ['Jalapeno Burger', 'Burger', 400],
      ['Tikka Burger', 'Burger', 300],
      ['Double Decker Burger', 'Burger', 550],
      ['Double Patty Burger', 'Burger', 550],
      ['Tasty Bites 20-20 Burger', 'Burger', 450],
      ['Special Beef Burger', 'Burger', 450],
      ['Special Tasty Bite Red Zinger', 'Burger', 450],
      ['Tasty Bites Special Malai Boti Roll', 'Chicken Rolls', 300],
      ['Shawarma Roll', 'Chicken Rolls', 220],
      ['Cheese Shawarma Roll', 'Chicken Rolls', 270],
      ['Pratha Roll', 'Chicken Rolls', 270],
      ['Zinger Pratha Roll', 'Chicken Rolls', 400],
      ['Zinger Shawarma Roll', 'Chicken Rolls', 400],
      ['Kabab Roll', 'Chicken Rolls', 300],
      ['Arabian Shamoli', 'Chicken Rolls', 300],
      ['Tortilla Wrap', 'Sides', 500],
      ['Crispy Wrap', 'Sides', 450],
      ['Kababish Wrap', 'Sides', 500],
      ['10 Pc Oven Baked Wings', 'Sides', 600],
      ['10 Pc Honey Wings', 'Sides', 600],
      ['Leg Broast', 'Sides', 350],
      ['Chest Broast', 'Sides', 380],
      ['Grill Leg', 'Sides', 350],
      ['Grill Chest', 'Sides', 380],
      ['Loaded Fries Half', 'Sides', 450],
      ['Pizza Fries Large', 'Sides', 650],
      ['Tikka Sandwich', 'Sides', 500],
      ['Mexican Sandwich', 'Sides', 550],
      ['Behari Roll', 'Sides', 500],
      ['Donor', 'Sides', 500],
      ['Malai Botti Matka Pizza', 'Pizza', 900],
      ['Tikka Boti Matka Pizza', 'Pizza', 900],
      ['Kabab Matka Pizza', 'Pizza', 900],
      ['Deep Dish Pizza', 'Pizza', 2200],
      ['250ml Drink', 'Drinks', 100],
      ['500ml Drink', 'Drinks', 200],
      ['Tin Pack', 'Drinks', 120],
      ['Sting 500ml', 'Drinks', 200],
      ['Sting 350ml', 'Drinks', 150],
      ['1000ml Drink', 'Drinks', 280],
      ['1500ml Drink', 'Drinks', 320],
      ['2.25 Liter Drink', 'Drinks', 450],
      ['500ml Mineral Water', 'Drinks', 80],
      ['1500ml Mineral Water', 'Drinks', 150],
      ['Fresh Lime', 'Drinks', 180],
      ['350ml Drink', 'Drinks', 70]
    ];

    singleItems.forEach(([name, cat, price]) => insertItem.run(name, cat, price, 0));

    // Variant items
    const variantItems = [
      { name: 'French Fries', cat: 'Sides', variants: [['Small', 250], ['Large', 300], ['Family', 400]] },
      { name: 'Loaded Cheesy Fries', cat: 'Sides', variants: [['Large', 550], ['Family', 650]] },
      { name: 'Hot Wings/Nuggets', cat: 'Sides', variants: [['6 Pc', 320], ['12 Pc', 600]] },
      { name: 'Flaming Pasta', cat: 'Sides', variants: [['Half', 400], ['Full', 600]] },
      { name: 'Crunchy Pasta', cat: 'Sides', variants: [['Half', 500], ['Full', 700]] },
      { name: 'Tasty Bites 20-20 Pasta', cat: 'Sides', variants: [['Half', 450], ['Full', 650]] },
      ...['Vege Lover Pizza', 'Cheese Lover Pizza', 'Chicken Tikka Pizza', 'Chicken Fajita Pizza', 'Ch. Fajita Sicilian Pizza', 'Euro Delight Pizza', 'Jalapeno Pizza', 'Supreme Pizza', 'Shawarma Pizza', 'Shahi Pizza', 'Achari Pizza', 'Bonfire Pizza'].map(name => ({
        name, cat: 'Pizza', variants: [['Small', 550], ['Medium', 1000], ['Large', 1300]]
      })),
      ...['Tasty Bites Special Pizza', 'Special Malai Boti Pizza', 'Paratha Pizza'].map(name => ({
        name, cat: 'Pizza', variants: [['Small', 600], ['Medium', 1100], ['Large', 1400]]
      })),
      ...['Crunchy Pizza', 'Behari Kabab Pizza', 'Seekh Kabab Pizza', 'Extreme Pizza', 'Cheese Crust Pizza', 'Multani Pizza', 'Crown Crust Pizza'].map(name => ({
        name, cat: 'Pizza', variants: [['Small', 650], ['Medium', 1250], ['Large', 1600]]
      })),
      ...['Double Seekh Kabab Pizza', 'Royal Crust Pizza', 'Special Multan Sultan Pizza', 'Crispy Crust Pizza', 'Mughlai Pizza', 'Crush Kabab Pizza', 'Lasagnia Malai Boti Pizza'].map(name => ({
        name, cat: 'Pizza', variants: [['Small', 800], ['Medium', 1450], ['Large', 1700]]
      })),
      { name: '4 XL Pizza', cat: 'Pizza', variants: [['Medium', 1500], ['Large', 2000]] },
      { name: 'Double Extreme', cat: 'Pizza', variants: [['Medium', 1600], ['Large', 2200]] },
      { name: 'Ice Cream', cat: 'Ice Cream', variants: [['1 Scoop', 100], ['2 Scoop', 180], ['3 Scoop', 250]] }
    ];

    variantItems.forEach(item => {
      const res = insertItem.run(item.name, item.cat, 0, 1);
      const itemId = res.lastInsertRowid;
      item.variants.forEach(([label, price], index) => {
        insertVariant.run(itemId, label, price, index + 1);
      });
    });
  })();
}

// Seed admin — always with bcrypt hashed PIN
const staffCount = db.prepare('SELECT COUNT(*) as count FROM staff').get();
if (staffCount.count === 0) {
  const hashedPin = bcrypt.hashSync('1234', 10);
  db.prepare("INSERT INTO staff (name, role, pin, color, active) VALUES ('Admin', 'Owner', ?, '#DC2626', 1)").run(hashedPin);
}

// Seed settings
const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
if (settingsCount.count === 0) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  [
    ['restaurant_name', 'Blaze'],
    ['restaurant_address', '123 Main Street, Food Avenue'],
    ['restaurant_phone', '0300-1234567'],
    ['tax_rate', '0'],
    ['currency_symbol', 'Rs.'],
    ['receipt_footer', 'Thank you for visiting!'],
    ['auto_print', 'true'],
    ['delivery_price', '0']
  ].forEach(([k, v]) => insertSetting.run(k, v));
}

// Safety net: if settings already existed before this update (an already-running
// install), the block above won't have run, so delivery_price would be missing.
// This makes sure it exists either way, without ever overwriting a value you set.
const deliveryPriceRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('delivery_price');
if (!deliveryPriceRow) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('delivery_price', '0');
}

// Seed deals
const dealsCount = db.prepare('SELECT COUNT(*) as count FROM deals').get();
if (dealsCount.count === 0) {
  const insertDeal = db.prepare('INSERT INTO deals (name, price, description, deal_group) VALUES (?, ?, ?, ?)');
  const insertDealItem = db.prepare('INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)');
  const getItemId = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const getVariantId = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?');

  const seedDeals = [
    // 1 Person Deals
    { name: '1 Person Deal 1', group: '1 Person Deals', price: 350, desc: '', items: [{ n: 'Chicken Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 2', group: '1 Person Deals', price: 350, desc: '', items: [{ n: 'Tikka Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 3', group: '1 Person Deals', price: 400, desc: '', items: [{ n: 'Zinger Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 4', group: '1 Person Deals', price: 400, desc: '', items: [{ n: 'Jalapeno Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 5', group: '1 Person Deals', price: 500, desc: '', items: [{ n: 'Chicken Burger', q: 1 }, { n: '350ml Drink', q: 1 }, { n: 'French Fries', v: 'Small', q: 1 }] },
    { name: '1 Person Deal 6', group: '1 Person Deals', price: 600, desc: '', items: [{ n: 'Zinger Burger', q: 1 }, { n: 'French Fries', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },

    // 2 Person Deals
    { name: '2 Person Deal 1', group: '2 Person Deals', price: 500, desc: '', items: [{ n: 'Shawarma Roll', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 2', group: '2 Person Deals', price: 600, desc: '', items: [{ n: 'Chicken Burger', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 3', group: '2 Person Deals', price: 600, desc: '', items: [{ n: 'Pratha Roll', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 4', group: '2 Person Deals', price: 670, desc: '', items: [{ n: 'Flaming Pasta', v: 'Full', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 5', group: '2 Person Deals', price: 600, desc: '', items: [{ n: 'Behari Roll', q: 4 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 6', group: '2 Person Deals', price: 700, desc: '', items: [{ n: 'Zinger Burger', q: 2 }, { n: '350ml Drink', q: 1 }] },

    // Student Deal
    { name: 'Student Deal 1', group: 'Student Deal', price: 1000, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Small', q: 1 }, { n: 'Hot Wings/Nuggets', v: '6 Pc', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Student Deal 2', group: 'Student Deal', price: 1350, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Medium', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Student Deal 3', group: 'Student Deal', price: 1450, desc: '', items: [{ n: 'Special Malai Boti Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },

    // Special Pizza Deal
    { name: 'Special Pizza Deal 1', group: 'Special Pizza Deal', price: 900, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 2', group: 'Special Pizza Deal', price: 1100, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Small', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 3', group: 'Special Pizza Deal', price: 1700, desc: "Includes: 1 Medium Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Chicken Fajita Pizza', v: 'Small', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 4', group: 'Special Pizza Deal', price: 2300, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Large', q: 1 }, { n: 'Hot Wings/Nuggets', v: '12 Pc', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 5', group: 'Special Pizza Deal', price: 2100, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Medium', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Medium', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 6', group: 'Special Pizza Deal', price: 2700, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Large', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },

    // Family Deal
    { name: 'Family Deal 1', group: 'Family Deal', price: 1900, desc: '', items: [{ n: 'Zinger Burger', q: 5 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Family Deal 2', group: 'Family Deal', price: 2900, desc: "Includes: 2x Small Pizza — any flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 4 }, { n: 'French Fries', v: 'Large', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Family Deal 3', group: 'Family Deal', price: 3000, desc: "Includes: 1 Large Pizza — any flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 2 }, { n: 'Chicken Burger', q: 2 }, { n: 'French Fries', v: 'Large', q: 1 }, { n: '2.25 Liter Drink', q: 1 }] },

    // Lunch & Midnight Deal
    { name: 'Lunch & Midnight Deal 1', group: 'Lunch & Midnight Deal', price: 1100, desc: '', items: [{ n: 'Zinger Burger', q: 3 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 2', group: 'Lunch & Midnight Deal', price: 1100, desc: "Includes: 1 Medium Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: '350ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 3', group: 'Lunch & Midnight Deal', price: 1400, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 4', group: 'Lunch & Midnight Deal', price: 1500, desc: '', items: [{ n: 'Zinger Burger', q: 4 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 5', group: 'Lunch & Midnight Deal', price: 2000, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 6', group: 'Lunch & Midnight Deal', price: 4500, desc: "Includes: 1 Large Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Lasagnia Malai Boti Pizza', v: 'Large', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '2.25 Liter Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 7', group: 'Lunch & Midnight Deal', price: 1250, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Hot Wings/Nuggets', v: '6 Pc', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 8', group: 'Lunch & Midnight Deal', price: 2400, desc: '', items: [{ n: 'Shahi Pizza', v: 'Large', q: 1 }, { n: 'Bonfire Pizza', v: 'Medium', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 9', group: 'Lunch & Midnight Deal', price: 850, desc: '', items: [{ n: 'Lasagnia Malai Boti Pizza', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 10', group: 'Lunch & Midnight Deal', price: 1150, desc: '', items: [{ n: 'Pratha Roll', q: 1 }, { n: 'Tasty Bites Special Malai Boti Roll', q: 1 }, { n: 'Shawarma Roll', q: 1 }, { n: 'Zinger Pratha Roll', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    
    // Broast Deals
    { name: 'Broast Deal 1', group: 'Broast Deal', price: 850, desc: '1 Leg, 1 Thigh, 1 Bun, Fries, 1 Garlic Dip', items: [] },
    { name: 'Broast Deal 2', group: 'Broast Deal', price: 1100, desc: '1 Leg, 1 Thigh, 1 Wing, 1 Breast, 1 Bun, Fries, 1 Garlic Dip', items: [] },
    { name: 'Broast Deal 3', group: 'Broast Deal', price: 2100, desc: '2 Legs, 1 Thigh, 2 Wings, 2 Breasts, 2 Buns, Fries, 1 Garlic Dip', items: [] }
  ];

  db.transaction(() => {
    seedDeals.forEach(d => {
      const res = insertDeal.run(d.name, d.price, d.desc, d.group);
      const dealId = res.lastInsertRowid;
      d.items.forEach(i => {
        const itemRow = getItemId.get(i.n);
        if (itemRow) {
          let vId = null;
          if (i.v) {
            const vRow = getVariantId.get(itemRow.id, i.v);
            if (vRow) vId = vRow.id;
          }
          insertDealItem.run(dealId, itemRow.id, i.q, vId);
        } else {
          console.warn(`Menu item not found for deal ${d.name}: ${i.n}`);
        }
      });
    });
  })();
}

// Normalize deal_group names that were incorrectly pluralized by an earlier backfill
const dealGroupFixes = [
  ['Special Pizza Deals', 'Special Pizza Deal'],
  ['Family Deals', 'Family Deal'],
  ['Lunch & Midnight Deals', 'Lunch & Midnight Deal'],
];
const fixDealGroup = db.prepare('UPDATE deals SET deal_group = ? WHERE deal_group = ?');
db.transaction(() => {
  dealGroupFixes.forEach(([from, to]) => fixDealGroup.run(to, from));
})();

// If deals already existed before this update (deal_group column added via migration
// but the seed block above was skipped since dealsCount > 0), backfill deal_group
// for any deal whose name matches one of the known prefixes, so old data doesn't
// end up permanently ungrouped.
const ungroupedDeals = db.prepare("SELECT id, name FROM deals WHERE deal_group IS NULL").all();
if (ungroupedDeals.length > 0) {
  const groupPrefixes = [
    { prefix: '1 Person Deal', group: '1 Person Deals' },
    { prefix: '2 Person Deal', group: '2 Person Deals' },
    { prefix: 'Student Deal', group: 'Student Deal' },
    { prefix: 'Special Pizza Deal', group: 'Special Pizza Deal' },
    { prefix: 'Family Deal', group: 'Family Deal' },
    { prefix: 'Lunch & Midnight Deal', group: 'Lunch & Midnight Deal' },
    { prefix: 'Broast Deal', group: 'Broast Deal' },
  ];
  const updateGroup = db.prepare('UPDATE deals SET deal_group = ? WHERE id = ?');
  db.transaction(() => {
    ungroupedDeals.forEach(row => {
      const match = groupPrefixes
        .filter(p => row.name.startsWith(p.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (match) updateGroup.run(match.group, row.id);
    });
  })();
}

// --- Seed Ingredients and Recipes ---
const ingCount = db.prepare('SELECT COUNT(*) as count FROM ingredients').get();
if (ingCount.count === 0) {
  const insertIng = db.prepare('INSERT INTO ingredients (name, unit, stock, cost_per_unit, low_stock_threshold) VALUES (?, ?, ?, ?, ?)');
  const insertRecipe = db.prepare('INSERT INTO recipes (menu_item_id, variant_id) VALUES (?, ?)');
  const insertRecipeIng = db.prepare('INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_required) VALUES (?, ?, ?)');

  const getItemId = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const getVariantId = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?');

  db.transaction(() => {
    // 1. Insert Ingredients
    const ings = [
      { name: 'Burger Bun', unit: 'pcs', stock: 100, threshold: 20 },
      { name: 'Chicken Patty', unit: 'pcs', stock: 100, threshold: 20 },
      { name: 'Beef Patty', unit: 'pcs', stock: 100, threshold: 20 },
      { name: 'Zinger Fillet', unit: 'pcs', stock: 100, threshold: 20 },
      { name: 'Cheese Slice', unit: 'pcs', stock: 100, threshold: 20 },
      { name: 'Lettuce', unit: 'grams', stock: 5000, threshold: 500 },
      { name: 'Mayo', unit: 'ml', stock: 5000, threshold: 500 },
      { name: 'Wings', unit: 'pcs', stock: 200, threshold: 40 }
    ];
    const ingMap = {};
    for (const ing of ings) {
      const res = insertIng.run(ing.name, ing.unit, ing.stock, 0, ing.threshold);
      ingMap[ing.name] = res.lastInsertRowid;
    }

    // 2. Define Recipes
    const recipes = [
      {
        item: 'Zinger Burger',
        ingredients: [
          { name: 'Burger Bun', qty: 1 },
          { name: 'Zinger Fillet', qty: 1 },
          { name: 'Lettuce', qty: 20 },
          { name: 'Mayo', qty: 15 }
        ]
      },
      {
        item: 'Chicken Burger',
        ingredients: [
          { name: 'Burger Bun', qty: 1 },
          { name: 'Chicken Patty', qty: 1 },
          { name: 'Lettuce', qty: 15 },
          { name: 'Mayo', qty: 10 }
        ]
      },
      {
        item: 'Mighty Burger',
        ingredients: [
          { name: 'Burger Bun', qty: 1 },
          { name: 'Zinger Fillet', qty: 2 },
          { name: 'Cheese Slice', qty: 1 },
          { name: 'Lettuce', qty: 30 },
          { name: 'Mayo', qty: 20 }
        ]
      },
      {
        item: 'Special Beef Burger',
        ingredients: [
          { name: 'Burger Bun', qty: 1 },
          { name: 'Beef Patty', qty: 1 },
          { name: 'Cheese Slice', qty: 1 },
          { name: 'Lettuce', qty: 20 },
          { name: 'Mayo', qty: 15 }
        ]
      },
      {
        item: '10 Pc Oven Baked Wings',
        ingredients: [
          { name: 'Wings', qty: 10 }
        ]
      },
      {
        item: '10 Pc Honey Wings',
        ingredients: [
          { name: 'Wings', qty: 10 }
        ]
      },
      {
        item: 'Hot Wings/Nuggets',
        variant: '6 Pc',
        ingredients: [
          { name: 'Wings', qty: 6 }
        ]
      },
      {
        item: 'Hot Wings/Nuggets',
        variant: '12 Pc',
        ingredients: [
          { name: 'Wings', qty: 12 }
        ]
      }
    ];

    for (const r of recipes) {
      const itemRow = getItemId.get(r.item);
      if (itemRow) {
        let vId = null;
        if (r.variant) {
          const vRow = getVariantId.get(itemRow.id, r.variant);
          if (vRow) vId = vRow.id;
        }
        const res = insertRecipe.run(itemRow.id, vId);
        const recipeId = res.lastInsertRowid;
        
        for (const i of r.ingredients) {
          const ingId = ingMap[i.name];
          if (ingId) {
            insertRecipeIng.run(recipeId, ingId, i.qty);
          }
        }
      }
    }
  })();
}

// ─── Auto Backup ────────────────────────────────────────────────────────────
const backupDir = path.join(userDataDir, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

function doAutoBackup() {
  const date = new Date().toISOString().split('T')[0];
  const backupPath = path.join(backupDir, `pos_backup_${date}.db`);

  if (!fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(DB_PATH, backupPath);
      console.log('Auto backup created:', backupPath);

      // Keep only last 7 daily backups
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('pos_backup_'))
        .sort();
      if (backups.length > 7) {
        backups.slice(0, backups.length - 7)
          .forEach(f => fs.unlinkSync(path.join(backupDir, f)));
      }
    } catch(e) {
      console.error('Auto backup failed:', e.message);
    }
  }
}

doAutoBackup(); // on startup
setInterval(doAutoBackup, 24 * 60 * 60 * 1000); // every 24h

module.exports = db;