const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pos_database.db');
const db = new Database(DB_PATH);

console.log('Seeding dummy orders for analytics...');

const menuItems = db.prepare('SELECT * FROM menu_items').all();
if (menuItems.length === 0) {
  console.log('No menu items found. Run menu seeder first.');
  process.exit(1);
}

// Generate random orders over the last 30 days
const now = new Date();
const insertOrder = db.prepare('INSERT INTO orders (total, discount, payment_method, status, cashier_id, cashier_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
const insertOrderItem = db.prepare('INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');

// Get staff members for cashier assignment
const staff = db.prepare('SELECT * FROM staff WHERE active = 1').all();
const cashiers = staff.length > 0 ? staff : [{ id: 1, name: 'Admin' }];

console.log(`Found ${cashiers.length} cashiers for seeding:`, cashiers.map(c => c.name));

let orderCount = 0;

db.transaction(() => {
  for (let i = 0; i < 30; i++) {
    const targetDate = new Date();
    targetDate.setDate(now.getDate() - i);
    
    // Random number of orders per day (10 to 40)
    const ordersToday = Math.floor(Math.random() * 30) + 10;
    
    for (let j = 0; j < ordersToday; j++) {
      // Random hour between 9am and 11pm (23)
      const hour = Math.floor(Math.random() * 14) + 9;
      const minute = Math.floor(Math.random() * 60);
      const second = Math.floor(Math.random() * 60);
      
      const orderDate = new Date(targetDate);
      orderDate.setHours(hour, minute, second);
      
      // Select 1 to 4 random menu items
      const numItems = Math.floor(Math.random() * 4) + 1;
      const orderItems = [];
      let total = 0;
      
      for (let k = 0; k < numItems; k++) {
        const item = menuItems[Math.floor(Math.random() * menuItems.length)];
        const quantity = Math.floor(Math.random() * 3) + 1;
        orderItems.push({ item, quantity });
        total += item.price * quantity;
      }
      
      // Occasional discount
      let discount = 0;
      if (Math.random() > 0.8) {
        discount = Math.floor(Math.random() * 200) + 50;
      }
      
      const netTotal = total - discount;
      const paymentMethod = Math.random() > 0.3 ? 'Cash' : 'Card';
      
      // Assign random cashier
      const cashier = cashiers[Math.floor(Math.random() * cashiers.length)];
      
      // SQLite expects YYYY-MM-DD HH:MM:SS format
      const createdAt = orderDate.toISOString().replace('T', ' ').substring(0, 19);
      
      const result = insertOrder.run(netTotal, discount, paymentMethod, 'completed', cashier.id, cashier.name, createdAt);
      const orderId = result.lastInsertRowid;
      
      for (const { item, quantity } of orderItems) {
        insertOrderItem.run(orderId, item.id, item.name, item.price, quantity);
      }
      
      orderCount++;
    }
  }
})();

console.log(`Successfully seeded ${orderCount} dummy orders.`);
