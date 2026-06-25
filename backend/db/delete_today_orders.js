const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pos_database.db');
const db = new Database(DB_PATH);

const today = new Date().toISOString().split('T')[0];

console.log(`Deleting orders from ${today}...`);

// Delete order items first (foreign key constraint)
const deleteItems = db.prepare(`
  DELETE FROM order_items 
  WHERE order_id IN (
    SELECT id FROM orders 
    WHERE DATE(created_at) = DATE(?)
  )
`);
const itemsDeleted = deleteItems.run(today);

// Delete orders
const deleteOrders = db.prepare(`
  DELETE FROM orders 
  WHERE DATE(created_at) = DATE(?)
`);
const ordersDeleted = deleteOrders.run(today);

console.log(`Deleted ${ordersDeleted.changes} orders and ${itemsDeleted.changes} order items from ${today}`);
