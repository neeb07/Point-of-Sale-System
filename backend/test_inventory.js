const express = require('express');
const path = require('path');

const db = require('./db/database.js');

const app = express();
app.use(express.json());
// Mount the actual orders router
app.use('/orders', require('./routes/orders.js'));

async function runTest() {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    console.log(`[TEST] Server temporarily running on port ${port}\n`);

    const printRelevantStocks = () => {
      const rows = db.prepare("SELECT name, stock FROM ingredients WHERE name IN ('Burger Bun', 'Zinger Fillet', 'Lettuce', 'Mayo', 'Wings')").all();
      rows.forEach(r => console.log(`  - ${r.name}: ${r.stock}`));
    };

    console.log('--- INITIAL INVENTORY STOCK ---');
    printRelevantStocks();
    
    const zinger = db.prepare("SELECT id FROM menu_items WHERE name = 'Zinger Burger'").get();
    const wings = db.prepare("SELECT id FROM menu_items WHERE name = 'Hot Wings/Nuggets'").get();
    const wingsVariant = db.prepare("SELECT id FROM item_variants WHERE menu_item_id = ? AND label = '6 Pc'").get(wings.id);

    console.log(`\n=================================`);
    console.log(`🛒 PLACING ORDER 1: 1x Zinger Burger`);
    console.log(`=================================`);
    const order1 = await fetch(`http://localhost:${port}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: zinger.id, name: 'Zinger Burger', price: 350, quantity: 1, is_deal: false }],
        total: 350
      })
    }).then(r => r.json());
    console.log('Order 1 Response:', order1);
    
    console.log('\n--- STOCK AFTER ZINGER BURGER ---');
    console.log('Expected: Bun (-1), Zinger Fillet (-1), Lettuce (-20), Mayo (-15)');
    printRelevantStocks();

    console.log(`\n=================================`);
    console.log(`🛒 PLACING ORDER 2: 1x Hot Wings/Nuggets (6 Pc)`);
    console.log(`=================================`);
    const order2 = await fetch(`http://localhost:${port}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: wings.id, name: 'Hot Wings/Nuggets (6 Pc)', price: 320, quantity: 1, variant_id: wingsVariant.id, is_deal: false }],
        total: 320
      })
    }).then(r => r.json());
    console.log('Order 2 Response:', order2);

    console.log('\n--- STOCK AFTER WINGS ---');
    console.log('Expected: Wings (-6)');
    printRelevantStocks();

    console.log('\nTest Complete!');
    server.close();
    process.exit(0);
  });
}

runTest();
