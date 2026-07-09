const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');

const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname, '..');

if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const DB_PATH = path.join(userDataDir, 'pos_database.db');
console.log('Using database at:', DB_PATH);

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
`);

// Migrations
try { db.exec("ALTER TABLE orders ADD COLUMN cashier_name TEXT DEFAULT 'Admin';"); } catch(e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN cashier_id INTEGER DEFAULT NULL;"); } catch(e) {}
try { db.exec("ALTER TABLE staff ADD COLUMN color TEXT DEFAULT '#F97316';"); } catch(e) {}
try { db.exec("ALTER TABLE staff ADD COLUMN avatar_initials TEXT DEFAULT '';"); } catch(e) {}
try { db.exec("UPDATE staff SET active = 1 WHERE role = 'Owner';"); } catch(e) {}
try { db.exec("UPDATE staff SET color = '#7C3AED' WHERE color IS NULL OR color = '';"); } catch(e) {}
try { db.exec("ALTER TABLE menu_items ADD COLUMN has_variants INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("UPDATE menu_items SET category = 'Pizza' WHERE category IN ('Standard Pizza', 'Classic Pizza', 'Premium Pizza', 'Special Pizza', 'Deep Dish', 'New Addition');"); } catch(e) {}
try { db.exec("UPDATE menu_items SET category = 'Sides' WHERE category IN ('Wrap', 'Hot Wings', 'Broast Chicken', 'Fries', 'Special Meal');"); } catch(e) {}
try { db.exec("ALTER TABLE deal_items ADD COLUMN variant_id INTEGER DEFAULT NULL;"); } catch(e) {}

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
  db.prepare("INSERT INTO staff (name, role, pin, color, active) VALUES ('Admin', 'Owner', ?, '#F97316', 1)").run(hashedPin);
}

// Seed settings
const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get();
if (settingsCount.count === 0) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  [
    ['restaurant_name', 'Al-Madina Fast Food'],
    ['restaurant_address', '123 Main Street, Food Avenue'],
    ['restaurant_phone', '0300-1234567'],
    ['tax_rate', '0'],
    ['currency_symbol', 'Rs.'],
    ['receipt_footer', 'Thank you for visiting!'],
    ['auto_print', 'true']
  ].forEach(([k, v]) => insertSetting.run(k, v));
}

// Seed deals
const dealsCount = db.prepare('SELECT COUNT(*) as count FROM deals').get();
if (dealsCount.count === 0) {
  const insertDeal = db.prepare('INSERT INTO deals (name, price, description) VALUES (?, ?, ?)');
  const insertDealItem = db.prepare('INSERT INTO deal_items (deal_id, menu_item_id, quantity, variant_id) VALUES (?, ?, ?, ?)');
  const getItemId = db.prepare('SELECT id FROM menu_items WHERE name = ?');
  const getVariantId = db.prepare('SELECT id FROM item_variants WHERE menu_item_id = ? AND label = ?');

  const seedDeals = [
    // 1 Person Deals
    { name: '1 Person Deal 1', price: 350, desc: '', items: [{ n: 'Chicken Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 2', price: 350, desc: '', items: [{ n: 'Tikka Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 3', price: 400, desc: '', items: [{ n: 'Zinger Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 4', price: 400, desc: '', items: [{ n: 'Jalapeno Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '1 Person Deal 5', price: 500, desc: '', items: [{ n: 'Chicken Burger', q: 1 }, { n: '350ml Drink', q: 1 }, { n: 'French Fries', v: 'Small', q: 1 }] },
    { name: '1 Person Deal 6', price: 600, desc: '', items: [{ n: 'Zinger Burger', q: 1 }, { n: 'French Fries', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },

    // 2 Person Deals
    { name: '2 Person Deal 1', price: 500, desc: '', items: [{ n: 'Shawarma Roll', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 2', price: 600, desc: '', items: [{ n: 'Chicken Burger', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 3', price: 600, desc: '', items: [{ n: 'Pratha Roll', q: 2 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 4', price: 670, desc: '', items: [{ n: 'Flaming Pasta', v: 'Full', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 5', price: 600, desc: '', items: [{ n: 'Behari Roll', q: 4 }, { n: '350ml Drink', q: 1 }] },
    { name: '2 Person Deal 6', price: 700, desc: '', items: [{ n: 'Zinger Burger', q: 2 }, { n: '350ml Drink', q: 1 }] },

    // Student Deal
    { name: 'Student Deal 1', price: 1000, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Small', q: 1 }, { n: 'Hot Wings/Nuggets', v: '6 Pc', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Student Deal 2', price: 1350, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Medium', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Student Deal 3', price: 1450, desc: '', items: [{ n: 'Special Malai Boti Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },

    // Special Pizza Deal
    { name: 'Special Pizza Deal 1', price: 900, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 2', price: 1100, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Small', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 3', price: 1700, desc: "Includes: 1 Medium Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Chicken Fajita Pizza', v: 'Small', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 4', price: 2300, desc: '', items: [{ n: 'Seekh Kabab Pizza', v: 'Large', q: 1 }, { n: 'Hot Wings/Nuggets', v: '12 Pc', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 5', price: 2100, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Medium', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Medium', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Special Pizza Deal 6', price: 2700, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Large', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },

    // Family Deal
    { name: 'Family Deal 1', price: 1900, desc: '', items: [{ n: 'Zinger Burger', q: 5 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Family Deal 2', price: 2900, desc: "Includes: 2x Small Pizza — any flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 4 }, { n: 'French Fries', v: 'Large', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Family Deal 3', price: 3000, desc: "Includes: 1 Large Pizza — any flavor, customer's choice", items: [{ n: 'Zinger Burger', q: 2 }, { n: 'Chicken Burger', q: 2 }, { n: 'French Fries', v: 'Large', q: 1 }, { n: '2.25 Liter Drink', q: 1 }] },

    // Lunch & Midnight Deal
    { name: 'Lunch & Midnight Deal 1', price: 1100, desc: '', items: [{ n: 'Zinger Burger', q: 3 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 2', price: 1100, desc: "Includes: 1 Medium Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: '350ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 3', price: 1400, desc: '', items: [{ n: 'Chicken Tikka Pizza', v: 'Large', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 4', price: 1500, desc: '', items: [{ n: 'Zinger Burger', q: 4 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 5', price: 2000, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 6', price: 4500, desc: "Includes: 1 Large Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Lasagnia Malai Boti Pizza', v: 'Large', q: 1 }, { n: 'Chicken Fajita Pizza', v: 'Large', q: 1 }, { n: '2.25 Liter Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 7', price: 1250, desc: "Includes: 1 Small Pizza — any Special Pizza tier flavor, customer's choice", items: [{ n: 'Hot Wings/Nuggets', v: '6 Pc', q: 1 }, { n: '1000ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 8', price: 2400, desc: '', items: [{ n: 'Shahi Pizza', v: 'Large', q: 1 }, { n: 'Bonfire Pizza', v: 'Medium', q: 1 }, { n: '1500ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 9', price: 850, desc: '', items: [{ n: 'Lasagnia Malai Boti Pizza', v: 'Small', q: 1 }, { n: '350ml Drink', q: 1 }] },
    { name: 'Lunch & Midnight Deal 10', price: 1150, desc: '', items: [{ n: 'Pratha Roll', q: 1 }, { n: 'Tasty Bites Special Malai Boti Roll', q: 1 }, { n: 'Shawarma Roll', q: 1 }, { n: 'Zinger Pratha Roll', q: 1 }, { n: '1000ml Drink', q: 1 }] }
  ];

  db.transaction(() => {
    seedDeals.forEach(d => {
      const res = insertDeal.run(d.name, d.price, d.desc);
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