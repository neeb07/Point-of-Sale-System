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
    -- Local wall-clock, not CURRENT_TIMESTAMP's UTC. Routes also pass this
    -- explicitly; the default only matters for a freshly created database.
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
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
    opened_at DATETIME DEFAULT (datetime('now', 'localtime')),
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
// NOTE: this was a one-off consolidation for a previous restaurant's menu,
// but it ran on EVERY startup — so any category named 'Fries' or 'Wrap' was
// silently renamed to 'Sides' each time the app booted, which quietly undid
// menu changes. Guarded so it can only ever apply once.
try {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'migration_sides_consolidated'").get();
  if (!done) {
    db.exec("UPDATE menu_items SET category = 'Sides' WHERE category IN ('Wrap', 'Hot Wings', 'Broast Chicken', 'Special Meal');");
    db.prepare("INSERT INTO settings (key, value) VALUES ('migration_sides_consolidated', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
  }
} catch(e) {}
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

// ─── Timezone correction ────────────────────────────────────────────────────
// SQLite's CURRENT_TIMESTAMP is UTC, but this till serves one shop in one
// timezone and every consumer of these timestamps treats them as local:
//   * reports/shifts filter with DATE(created_at) BETWEEN <local from> AND <to>,
//     where from/to are computed from the browser's local clock;
//   * the UI renders them with moment(created_at), which parses as local.
// At UTC+5 that booked every sale between midnight and 5am to the *previous*
// trading day and displayed every time five hours early.
//
// The fix is to store local time. This one-off migration converts rows written
// under the old UTC behaviour; all inserts now pass an explicit local
// timestamp. Guarded by a settings flag so it can never double-shift.
try {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'migration_timestamps_localtime'").get();
  if (!done) {
    db.transaction(() => {
      // datetime(x, 'localtime') reads x as UTC and returns local wall-clock.
      db.exec("UPDATE orders SET created_at = datetime(created_at, 'localtime') WHERE created_at IS NOT NULL;");
      db.exec("UPDATE shifts SET opened_at = datetime(opened_at, 'localtime') WHERE opened_at IS NOT NULL;");
      db.exec("UPDATE shifts SET closed_at = datetime(closed_at, 'localtime') WHERE closed_at IS NOT NULL;");
      db.prepare("INSERT INTO settings (key, value) VALUES ('migration_timestamps_localtime', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run();
    })();
    console.log('Timestamps converted from UTC to local time.');
  }
} catch (e) {
  console.error('Timestamp localtime migration failed:', e.message);
}

// Rebrand: move an existing install off the old default restaurant name.
// Runs once; never overwrites a name the owner has customised themselves.
try {
  db.prepare("UPDATE settings SET value = 'Blaze' WHERE key = 'restaurant_name' AND value = 'Al-Madina Fast Food'").run();
} catch(e) {}
// Rebrand: retire the old orange staff colour.
try { db.exec("UPDATE staff SET color = '#DC2626' WHERE color = '#F97316';"); } catch(e) {}

// Seed menu items — Blaze Pizza House full menu
const count = db.prepare('SELECT COUNT(*) as count FROM menu_items').get();
if (count.count === 0) {
  const insertItem = db.prepare('INSERT INTO menu_items (name, category, price, has_variants) VALUES (?, ?, ?, ?)');
  const insertVariant = db.prepare('INSERT INTO item_variants (menu_item_id, label, price, sort_order) VALUES (?, ?, ?, ?)');

  db.transaction(() => {
    const menu = [
      // Blaze Special — Med/Lg/XL: 1450/2050/2950
      ...['Donner Special','Bihari Kabab','Butter Chicken Pizza','Crunchy Pizza','Four Seasons Pizza']
        .map(n => ({ n, c: 'Blaze Special', v: [['Medium',1450],['Large',2050],['X-Large',2950]] })),
      // Stuff Crust — Med/Lg/XL: 1550/2150/3200
      ...['Kabab Crust','Royal Crust Pizza','Crown Crust Pizza']
        .map(n => ({ n, c: 'Stuff Crust', v: [['Medium',1550],['Large',2150],['X-Large',3200]] })),
      // Regular Pizza — S/M/L/XL: 650/1250/1850/2750
      ...['Fajita','Vegetable Pizza','Tikka','Chicken Smoked','Malai Boti','Chicken Tandoori','Chicken Supreme']
        .map(n => ({ n, c: 'Regular Pizza', v: [['Small',650],['Medium',1250],['Large',1850],['X-Large',2750]] })),
      // Burgers
      { n:'Tikka Patty Burger',c:'Burgers',p:450 },
      { n:'Crunchy Burger',c:'Burgers',p:450 },
      { n:'Jalapeno Spicy Burger',c:'Burgers',p:500 },
      { n:'Zinger Burger',c:'Burgers',p:500 },
      { n:'Chicken Patty Burger',c:'Burgers',p:450 },
      { n:'Chicken Grilled Burger',c:'Burgers',p:550 },
      { n:'Mighty Burger',c:'Burgers',p:700 },
      { n:'Tower Burger',c:'Burgers',p:750 },
      { n:'Beef Patty Burger',c:'Burgers',v:[['Single Patty',700],['Double Patty',1100]] },
      // Wraps
      { n:'Shawarma Roll',c:'Wraps',p:300 },{ n:'Afghani Roll',c:'Wraps',p:400 },
      { n:'Zinger Cheese Roll',c:'Wraps',p:500 },{ n:'Tikka Paratha Roll',c:'Wraps',p:450 },
      { n:'Chicken Cheese Paratha',c:'Wraps',p:500 },{ n:'Achari Paratha',c:'Wraps',p:450 },
      { n:'Zinger Paratha Roll',c:'Wraps',p:500 },{ n:'Zinger Shawarma Roll',c:'Wraps',p:500 },
      // Chinese
      { n:'Vegetable Fried Rice',c:'Chinese',p:450 },{ n:'Egg Fried Rice',c:'Chinese',p:500 },
      { n:'Chicken Fried Rice',c:'Chinese',p:550 },{ n:'Chicken Chowmain',c:'Chinese',p:750 },
      { n:'Chicken Menchorian With Rice',c:'Chinese',p:850 },
      { n:'Chicken Black Paper Fried Rice',c:'Chinese',p:600 },
      { n:'Chicken Shashlik With Rice',c:'Chinese',p:850 },
      // Pasta
      { n:'Creamy Baked Pasta',c:'Pasta',v:[['F1',500],['F2',900]] },
      { n:'Alfredo Pasta',c:'Pasta',v:[['F1',500],['F2',900]] },
      { n:'Crunchy Pasta',c:'Pasta',v:[['F1',550],['F2',950]] },
      // Fries
      { n:'Plain Fries',c:'Fries',p:240 },{ n:'Masala Fries',c:'Fries',p:250 },
      { n:'Garlic Mayo Fries',c:'Fries',p:270 },
      { n:'Malai Boti Fries',c:'Fries',v:[['F1',450],['F2',850]] },
      { n:'Loaded Fries',c:'Fries',v:[['F1',450],['F2',850]] },
      { n:'Fries Bucket',c:'Fries',p:400 },
      // Appetizers
      { n:'Nuggets',c:'Appetizers',v:[['6 Pieces',350],['12 Pieces',650]] },
      { n:'Grilled Wings',c:'Appetizers',v:[['6 Pieces',450],['12 Pieces',900]] },
      { n:'Crispy Wings',c:'Appetizers',v:[['6 Pieces',450],['12 Pieces',900]] },
      { n:'Hot Wings',c:'Appetizers',v:[['6 Pieces',450],['12 Pieces',900]] },
      // Sandwich
      { n:'Grilled Sandwich',c:'Sandwich',p:600 },{ n:'Club Sandwich',c:'Sandwich',p:450 },
      { n:'Cold Sandwich',c:'Sandwich',p:350 },
      // Soup
      { n:'Chicken Corn Soup',c:'Soup',v:[['Single',500],['Family',1000]] },
      { n:'Hot & Sour Soup',c:'Soup',v:[['Single',500],['Family',1000]] },
      // Drinks
      { n:'Fresh Lime',c:'Drinks',p:200 },{ n:'Mint Margarita',c:'Drinks',p:250 },
      { n:'Regular Drink',c:'Drinks',v:[['Option A',80],['Option B',100]] },
      { n:'500ml Drink',c:'Drinks',v:[['Option A',100],['Option B',120]] },
      { n:'1 Liter Drink',c:'Drinks',v:[['Option A',150],['Option B',180]] },
      { n:'1.5 Liter Drink',c:'Drinks',v:[['Option A',180],['Option B',220]] },
      { n:'2.25 Liter Drink',c:'Drinks',v:[['Option A',250],['Option B',280]] },
      { n:'Mineral Water',c:'Drinks',v:[['500ml',70],['1.5 Litre',140]] },
      // Tea
      { n:'Kashmiri Tea',c:'Tea',p:250 },{ n:'Mix Tea',c:'Tea',p:140 },
      { n:'Cappuccino Coffee',c:'Tea',p:300 },
      // Extras
      { n:'Extra Topping',c:'Extras',v:[['Medium',100],['Large',150],['X-Large',200]] },
    ];

    menu.forEach(m => {
      const hasV = Array.isArray(m.v) && m.v.length > 0;
      const id = insertItem.run(m.n, m.c, hasV ? 0 : (m.p||0), hasV ? 1 : 0).lastInsertRowid;
      if (hasV) m.v.forEach(([label, price], i) => insertVariant.run(id, label, price, i));
    });
  })();
}

// SECURITY: hash any PIN still stored as plain text.
//
// routes/staff.js used to fall back to a plain-text comparison when a PIN did
// not look like a bcrypt hash. That fallback has been removed, so any legacy
// row must be migrated here or its owner would be locked out. Runs on every
// boot and is a no-op once every PIN is hashed.
try {
  const legacy = db.prepare('SELECT id, pin FROM staff').all()
    .filter(s => !/^\$2[aby]\$/.test(s.pin || ''));
  if (legacy.length > 0) {
    const updatePin = db.prepare('UPDATE staff SET pin = ? WHERE id = ?');
    db.transaction(() => {
      legacy.forEach(s => updatePin.run(bcrypt.hashSync(String(s.pin), 10), s.id));
    })();
    console.log(`Hashed ${legacy.length} plain-text staff PIN(s).`);
  }
} catch (e) {
  console.error('PIN hashing migration failed:', e.message);
}

// Seed admin — always with bcrypt hashed PIN
const staffCount = db.prepare('SELECT COUNT(*) as count FROM staff').get();
if (staffCount.count === 0) {
  const hashedPin = bcrypt.hashSync('1234', 10);
  db.prepare("INSERT INTO staff (name, role, pin, color, active) VALUES ('Admin', 'Owner', ?, '#DC2626', 1)").run(hashedPin);
}

// Seed settings
// Use ON CONFLICT so settings seed is idempotent — earlier migrations may
// have already inserted a row (e.g. migration_sides_consolidated), which
// would cause a plain INSERT-if-empty check to skip the entire block.
const upsertSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
);
[
  ['restaurant_name', 'Blaze Pizza House'],
  ['restaurant_address', 'Paris Mall, Ground Floor, Lehtrar, Road Near Burma Bridge Islamabad'],
  ['restaurant_phone', '0313-9999774, 0328-4999974'],
  ['tax_rate', '0'],
  ['currency_symbol', 'Rs.'],
  ['receipt_footer', 'Thank you for visiting! Eat, Heat, Repeat!'],
  ['auto_print', 'true'],
  ['delivery_price', '0']
].forEach(([k, v]) => upsertSetting.run(k, v));

// Safety net: delivery_price for existing installs
const deliveryPriceRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('delivery_price');
if (!deliveryPriceRow) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('delivery_price', '0');
}

// Seed deals — Blaze Pizza House deals from printed menu
const dealsCount = db.prepare('SELECT COUNT(*) as count FROM deals').get();
if (dealsCount.count === 0) {
  const insertDeal = db.prepare('INSERT INTO deals (name, price, description, deal_group) VALUES (?, ?, ?, ?)');
  const insertDealItem = db.prepare('INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)');
  const getItemId = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const getVariantId = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?');

  const seedDeals = [
    { name:'Pizza Deal 1',group:'Pizza Deals',price:850,desc:'Shawarma Roll + Small Pizza + Regular Drink',
      items:[{n:'Shawarma Roll',q:1},{n:'Tikka',v:'Small',q:1},{n:'Regular Drink',v:'Option A',q:1}]},
    { name:'Pizza Deal 2',group:'Pizza Deals',price:1599,desc:'Large Pizza + 1 Liter Drink',
      items:[{n:'Tikka',v:'Large',q:1},{n:'1 Liter Drink',v:'Option A',q:1}]},
    { name:'Pizza Deal 3',group:'Pizza Deals',price:999,desc:'2 Small Pizza + 2 Regular Drink',
      items:[{n:'Tikka',v:'Small',q:2},{n:'Regular Drink',v:'Option A',q:2}]},
    { name:'Pizza Deal 4',group:'Pizza Deals',price:1999,desc:'2 Medium Pizza + 500 ml Drink',
      items:[{n:'Tikka',v:'Medium',q:2},{n:'500ml Drink',v:'Option A',q:1}]},
    { name:'Family Deal 5',group:'Pizza Deals',price:2999,desc:'2 Large Pizza + 1.5 Liter Drink',
      items:[{n:'Tikka',v:'Large',q:2},{n:'1.5 Liter Drink',v:'Option A',q:1}]},
    { name:'Zinger Deal 1',group:'Zinger Deals',price:600,desc:'Zinger Burger + Regular Drink + Regular Fries',
      items:[{n:'Zinger Burger',q:1},{n:'Regular Drink',v:'Option A',q:1},{n:'Plain Fries',q:1}]},
    { name:'Zinger Deal 2',group:'Zinger Deals',price:1200,desc:'2 Zinger Burgers + 2 Regular Drinks + Masala Fries',
      items:[{n:'Zinger Burger',q:2},{n:'Regular Drink',v:'Option A',q:2},{n:'Masala Fries',q:1}]},
    { name:'Zinger Deal 3',group:'Zinger Deals',price:1900,desc:'3 Zinger Burgers + 3 Crispy Wings + Masala Fries + 1 Liter Drink',
      items:[{n:'Zinger Burger',q:3},{n:'Crispy Wings',v:'6 Pieces',q:1},{n:'Masala Fries',q:1},{n:'1 Liter Drink',v:'Option A',q:1}]},
    { name:'Zinger Deal 4',group:'Zinger Deals',price:880,desc:'Tower Burger + 500ml Drink + Regular Fries',
      items:[{n:'Tower Burger',q:1},{n:'500ml Drink',v:'Option A',q:1},{n:'Plain Fries',q:1}]},
    { name:'Zinger Family Deal 5',group:'Zinger Deals',price:3000,desc:'5 Zinger Burgers + Masala Fries + 1.5 Liter Drink + 5 Crispy Wings',
      items:[{n:'Zinger Burger',q:5},{n:'Masala Fries',q:1},{n:'1.5 Liter Drink',v:'Option A',q:1},{n:'Crispy Wings',v:'6 Pieces',q:1}]},
    { name:'Platter Deal 1',group:'Platter Deals',price:3500,desc:'2 Zinger Cheese Roll + 1 Chicken Tikka Medium + Loaded Fries + 6 Hot Wings + 1.5 Drink',
      items:[{n:'Zinger Cheese Roll',q:2},{n:'Tikka',v:'Medium',q:1},{n:'Loaded Fries',v:'F1',q:1},{n:'Hot Wings',v:'6 Pieces',q:1},{n:'1.5 Liter Drink',v:'Option A',q:1}]},
    { name:'Platter Deal 2',group:'Platter Deals',price:3500,desc:'Large Pizza + Zinger Burger + Tower Burger + Garlic Mayo Fries + 6 Crispy Wings + 1.5 Drink',
      items:[{n:'Tikka',v:'Large',q:1},{n:'Zinger Burger',q:1},{n:'Tower Burger',q:1},{n:'Garlic Mayo Fries',q:1},{n:'Crispy Wings',v:'6 Pieces',q:1},{n:'1.5 Liter Drink',v:'Option A',q:1}]},
    { name:'Platter Deal 3',group:'Platter Deals',price:3500,desc:'1 Medium Pizza + 1 Creamy Baked Pasta + 1 Chowmein + 6 Crispy Wings + 6 Nuggets + 1.5 Drink',
      items:[{n:'Tikka',v:'Medium',q:1},{n:'Creamy Baked Pasta',v:'F1',q:1},{n:'Chicken Chowmain',q:1},{n:'Crispy Wings',v:'6 Pieces',q:1},{n:'Nuggets',v:'6 Pieces',q:1},{n:'1.5 Liter Drink',v:'Option A',q:1}]},
    { name:'Birthday Deal',group:'Birthday Deal',price:4350,desc:'1 Chicken Tikka Pizza (XL) + 3 Zinger Burger + 1 Regular Fries + 1.5 Litre Cold Drink',
      items:[{n:'Tikka',v:'X-Large',q:1},{n:'Zinger Burger',q:3},{n:'Plain Fries',q:1},{n:'1.5 Liter Drink',v:'Option A',q:1}]},
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
          console.warn('Menu item not found for deal ' + d.name + ': ' + i.n);
        }
      });
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