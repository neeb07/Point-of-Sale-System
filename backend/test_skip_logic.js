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
      const rows = db.prepare("SELECT name, stock FROM ingredients").all();
      // Just print a few key ones to ensure NO numbers moved
      const subset = rows.filter(r => ['Burger Bun', 'Zinger Fillet', 'Lettuce', 'Mayo', 'Wings'].includes(r.name));
      subset.forEach(r => console.log(`  - ${r.name}: ${r.stock}`));
    };

    console.log('--- INITIAL INVENTORY STOCK ---');
    printRelevantStocks();
    
    // Find item IDs
    const deal = db.prepare("SELECT id, name FROM deals WHERE name = 'Broast Deal 1'").get();
    const pizza = db.prepare("SELECT id, name FROM menu_items WHERE name = 'Chicken Tikka Pizza'").get();
    const pizzaVariant = db.prepare("SELECT id FROM item_variants WHERE menu_item_id = ? AND label = 'Medium'").get(pizza.id);

    console.log(`\n=================================`);
    console.log(`🛒 PLACING ORDER 1: 1x Deal (${deal.name})`);
    console.log(`=================================`);
    const order1 = await fetch(`http://localhost:${port}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: deal.id, name: deal.name, price: 850, quantity: 1, is_deal: true }],
        total: 850
      })
    }).then(r => r.json());
    console.log('Order 1 Response:', order1);
    
    console.log('\n--- STOCK AFTER DEAL ---');
    console.log('Expected: No change');
    printRelevantStocks();

    console.log(`\n=================================`);
    console.log(`🛒 PLACING ORDER 2: 1x Pizza (${pizza.name})`);
    console.log(`=================================`);
    const order2 = await fetch(`http://localhost:${port}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: pizza.id, name: `${pizza.name} (Medium)`, price: 1000, quantity: 1, variant_id: pizzaVariant.id, is_deal: false }],
        total: 1000
      })
    }).then(r => r.json());
    console.log('Order 2 Response:', order2);

    console.log('\n--- STOCK AFTER PIZZA ---');
    console.log('Expected: No change');
    printRelevantStocks();

    console.log('\nTest Complete!');
    server.close();
    process.exit(0);
  });
}

runTest();
