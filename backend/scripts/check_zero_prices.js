const db = require('../db/database.js');
const zeroPriceItems = db.prepare(`
  SELECT 
    m.id, 
    m.name, 
    m.category, 
    m.price, 
    m.has_variants,
    (SELECT COUNT(*) FROM item_variants v WHERE v.menu_item_id = m.id) as variant_count
  FROM menu_items m
  WHERE m.price = 0
`).all();

console.log(JSON.stringify(zeroPriceItems, null, 2));
