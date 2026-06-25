const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../pos_database.db');
const db = new Database(DB_PATH);

console.log('Seeding staff members...');

// Clear existing staff
db.exec(`DELETE FROM staff;`);

const insert = db.prepare('INSERT INTO staff (name, role, pin, color, active) VALUES (?, ?, ?, ?, ?)');

const seedStaff = [
  ['Admin', 'Owner', '1234', '#F97316', 1],
  ['Ahmed Khan', 'Manager', '1111', '#3B82F6', 1],
  ['Sara Ali', 'Cashier', '2222', '#10B981', 1],
  ['Usman Malik', 'Cashier', '3333', '#8B5CF6', 1],
  ['Fatima Sheikh', 'Cashier', '4444', '#F43F5E', 1],
];

const insertMany = db.transaction((staff) => {
  for (const s of staff) {
    insert.run(s[0], s[1], s[2], s[3], s[4]);
  }
});

insertMany(seedStaff);

console.log('Successfully seeded ' + seedStaff.length + ' staff members.');
