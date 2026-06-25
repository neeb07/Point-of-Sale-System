const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pos_database.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create all tables if they don't exist
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

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Safe migration for existing DB
try {
  db.exec("ALTER TABLE orders ADD COLUMN cashier_name TEXT DEFAULT 'Admin';");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE orders ADD COLUMN cashier_id INTEGER DEFAULT NULL;");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE staff ADD COLUMN color TEXT DEFAULT '#F97316';");
} catch (e) {
  // Ignore if column already exists
}

try {
  db.exec("ALTER TABLE staff ADD COLUMN avatar_initials TEXT DEFAULT '';");
} catch (e) {
  // Ignore if column already exists
}

// Ensure all Owner role staff are active
try {
  db.exec("UPDATE staff SET active = 1 WHERE role = 'Owner';");
} catch (e) {
  // Ignore error
}

// Ensure all staff have a color value
try {
  db.exec("UPDATE staff SET color = '#7C3AED' WHERE color IS NULL OR color = '';");
} catch (e) {
  // Ignore error
}

// Seed menu items only if table is empty
const count = db.prepare('SELECT COUNT(*) as count FROM menu_items').get();
if (count.count === 0) {
  const insert = db.prepare('INSERT INTO menu_items (name, category, price) VALUES (?, ?, ?)');
  const seedItems = [
    ['Margherita Pizza', 'Pizza', 850],
    ['BBQ Chicken Pizza', 'Pizza', 1100],
    ['Beef Burger', 'Burger', 450],
    ['Zinger Burger', 'Burger', 550],
    ['Double Patty Burger', 'Burger', 650],
    ['Coca Cola', 'Drinks', 120],
    ['7UP', 'Drinks', 120],
    ['Fresh Juice', 'Drinks', 200],
    ['Garlic Bread', 'Extras', 220],
    ['Coleslaw', 'Extras', 150],
  ];
  seedItems.forEach(([name, category, price]) => insert.run(name, category, price));
}

// Seed admin staff if none exist
const staffCount = db.prepare('SELECT COUNT(*) as count FROM staff').get();
if (staffCount.count === 0) {
  db.prepare("INSERT INTO staff (name, role, pin, active) VALUES ('Admin', 'Owner', '1234', 1)").run();
}

// Seed default settings if none exist
const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
if (settingsCount.count === 0) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const defaultSettings = [
    ['restaurant_name', 'Al-Madina Fast Food'],
    ['restaurant_address', '123 Main Street, Food Avenue'],
    ['restaurant_phone', '0300-1234567'],
    ['tax_rate', '0'],
    ['currency_symbol', 'Rs.'],
    ['receipt_footer', 'Thank you for visiting!'],
    ['auto_print', 'true']
  ];
  defaultSettings.forEach(([k, v]) => insertSetting.run(k, v));
}

module.exports = db;
