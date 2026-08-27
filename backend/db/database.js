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

/**
 * better-sqlite3 is a native module: its compiled binary loads only on the
 * Node ABI it was built for. Plain Node 24 is NODE_MODULE_VERSION 137 and
 * Electron 42 is 146, and there is a single binary on disk, so running the
 * backend on the "wrong" runtime fails here with a stack trace that does not
 * say what to do about it. Translate it into instructions.
 */
let db;
try {
  db = new Database(DB_PATH);
} catch (err) {
  if (err.code === 'ERR_DLOPEN_FAILED' || /NODE_MODULE_VERSION/.test(err.message)) {
    const wanted = process.versions.modules;
    console.error(
      `\nbetter-sqlite3 was built for a different Node ABI than this runtime ` +
      `(this process needs NODE_MODULE_VERSION ${wanted}).\n\n` +
      `The backend is meant to run on Electron's Node, which is how the app\n` +
      `spawns it in production. Start it with:\n\n` +
      `  npm start          (from the backend folder)\n` +
      `  npm run dev        (same, with restart-on-change)\n\n` +
      `Running "node server.js" directly uses plain Node instead and will not\n` +
      `load the module. If you have run "npm rebuild better-sqlite3", that\n` +
      `rebuilt it for plain Node and the desktop app will no longer start —\n` +
      `restore it with:\n\n` +
      `  npm run rebuild:electron\n`
    );
    process.exit(1);
  }
  throw err;
}

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
// Tax is stored per order: both the rate that applied at the time and the
// amount it produced. Keeping the rate means an old receipt still reprints
// with the tax it was actually charged after the owner changes the rate, and
// keeping the amount means reports never have to re-derive it.
try { db.exec("ALTER TABLE orders ADD COLUMN tax_rate REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN tax_amount REAL DEFAULT 0;"); } catch(e) {}

// Staff discount. `discount` continues to hold the *combined* discount so
// every existing report, export and reconciliation keeps working untouched;
// these two columns record how much of it was the staff portion and flag the
// order as a staff purchase so it can be identified in reporting.
try { db.exec("ALTER TABLE orders ADD COLUMN is_employee INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN employee_discount REAL DEFAULT 0;"); } catch(e) {}
// The rate too, so a reprint shows the discount actually given even after
// the owner changes the percentage — same reasoning as tax_rate.
try { db.exec("ALTER TABLE orders ADD COLUMN employee_discount_rate REAL DEFAULT 0;"); } catch(e) {}

// The printed menu lists an ingredient line under each pizza. Storing it
// keeps the card and the till in step, and gives staff something to read
// out when a customer asks what is on a pizza.
try { db.exec("ALTER TABLE menu_items ADD COLUMN description TEXT DEFAULT NULL;"); } catch(e) {}

// ─── Roles ──────────────────────────────────────────────────────────────────
// The shop runs on two roles: an administrator with full access and a manager
// who works the till. 'Cashier' was the old name for the till role and carried
// no meaningful restrictions, so those accounts become Managers. 'Owner' is
// left alone — it is the existing admin account and is honoured as an admin
// everywhere, renaming it would risk locking the shop out on upgrade.
try { db.exec("UPDATE staff SET role = 'Manager' WHERE role = 'Cashier';"); } catch(e) {}

// Who voided an order. Managers are allowed to void, so a void needs a name
// against it — otherwise "ring up, take cash, void" leaves no trace.
try { db.exec("ALTER TABLE orders ADD COLUMN voided_by TEXT DEFAULT NULL;"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN voided_by_id INTEGER DEFAULT NULL;"); } catch(e) {}

// Menu items are retired rather than deleted. A hard DELETE failed outright
// with "FOREIGN KEY constraint failed" whenever the item belonged to a deal,
// and when it did succeed it broke sales-by-category for every past order
// containing that item, because the reporting join had nothing left to match.
try { db.exec("ALTER TABLE menu_items ADD COLUMN active INTEGER DEFAULT 1;"); } catch(e) {}

// Voiding an order now preserves its amounts and records when it happened,
// instead of zeroing total/discount and destroying the audit trail.
try { db.exec("ALTER TABLE orders ADD COLUMN voided_at DATETIME DEFAULT NULL;"); } catch(e) {}

// FIX: a deal was written into order_items.menu_item_id using the *deal's* id,
// which collides with menu_items ids. Sales-by-category then joined that id to
// whatever unrelated menu item happened to share it, so deal revenue was
// reported against the wrong category. This flag lets reports tell the two
// apart. Historical rows cannot be recovered — nothing recorded which they
// were — so they stay as they are and only new orders are attributed correctly.
try { db.exec("ALTER TABLE order_items ADD COLUMN is_deal INTEGER DEFAULT 0;"); } catch(e) {}

// The sale deducts stock using the *variant's* recipe (a 12-piece wings order
// consumes twice a 6-piece one), but the variant was never recorded on the
// line, so a void had no way to restore the right quantity. Recording it makes
// the void exactly mirror the sale.
try { db.exec("ALTER TABLE order_items ADD COLUMN variant_id INTEGER DEFAULT NULL;"); } catch(e) {}

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

// Seed menu items — the printed Blaze Pizza House menu.
// Defined once in db/menu-data.js and shared with scripts/seed_blaze_menu.js,
// so a fresh install and a re-seed can never produce different menus.
const { MENU: SEED_MENU } = require('./menu-data.js');

const count = db.prepare('SELECT COUNT(*) as count FROM menu_items').get();
if (count.count === 0) {
  const insertItem = db.prepare(
    'INSERT INTO menu_items (name, category, price, has_variants, description) VALUES (?, ?, ?, ?, ?)'
  );
  const insertVariant = db.prepare(
    'INSERT INTO item_variants (menu_item_id, label, price, sort_order) VALUES (?, ?, ?, ?)'
  );

  db.transaction(() => {
    SEED_MENU.forEach(m => {
      const hasV = Array.isArray(m.v) && m.v.length > 0;
      const id = insertItem.run(m.n, m.c, hasV ? 0 : (m.p || 0), hasV ? 1 : 0, m.d || null).lastInsertRowid;
      if (hasV) m.v.forEach(([label, price], i) => insertVariant.run(id, label, price, i));
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
  ['delivery_price', '0'],
  // Percentage taken off a staff purchase when the cashier flags one.
  ['employee_discount_rate', '20']
].forEach(([k, v]) => upsertSetting.run(k, v));

// Safety net: delivery_price for existing installs
const deliveryPriceRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('delivery_price');
if (!deliveryPriceRow) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('delivery_price', '0');
}

// Seed deals — shared with scripts/seed_blaze_menu.js via db/menu-data.js.
const { DEALS: SEED_DEALS } = require('./menu-data.js');

const dealsCount = db.prepare('SELECT COUNT(*) as count FROM deals').get();
if (dealsCount.count === 0) {
  const insertDeal = db.prepare(
    'INSERT INTO deals (name, price, description, deal_group, active) VALUES (?, ?, ?, ?, 1)'
  );
  const insertDealItem = db.prepare(
    'INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)'
  );
  const getItemId = db.prepare('SELECT id FROM menu_items WHERE name = ? AND active = 1');
  const getVariantId = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?');

  db.transaction(() => {
    SEED_DEALS.forEach(d => {
      const dealId = insertDeal.run(d.n, d.p, d.d, d.g).lastInsertRowid;
      d.items.forEach(([name, qty, variantLabel]) => {
        const itemRow = getItemId.get(name);
        if (!itemRow) {
          console.warn(`Menu item not found for deal ${d.n}: ${name}`);
          return;
        }
        let vId = null;
        if (variantLabel) {
          const vRow = getVariantId.get(itemRow.id, variantLabel);
          if (vRow) vId = vRow.id;
        }
        insertDealItem.run(dealId, itemRow.id, qty, vId);
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
// unref'd so the timer never holds the process open by itself. The server is
// kept alive by its listening socket; a one-off maintenance script that
// requires this module can now exit when it finishes instead of hanging on a
// 24-hour timer that will never fire.
const backupTimer = setInterval(doAutoBackup, 24 * 60 * 60 * 1000); // every 24h
if (typeof backupTimer.unref === 'function') backupTimer.unref();

module.exports = db;