const http = require('http');

const PORT = process.env.PORT || 3001;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('--- Inserting Test Items ---');
  
  // 1. Pizza (Small/Medium/Large)
  const p1 = await request('POST', '/api/menu', {
    name: 'Chicken Tikka Pizza',
    category: 'Pizza',
    variants: [
      { label: 'Small', price: 550, sort_order: 1 },
      { label: 'Medium', price: 1000, sort_order: 2 },
      { label: 'Large', price: 1300, sort_order: 3 }
    ]
  });
  console.log('Pizza inserted:', p1.status === 201 ? 'OK' : p1.data);
  
  // 2. Drink (literal volumes)
  const p2 = await request('POST', '/api/menu', {
    name: 'Coca-Cola',
    category: 'Drinks',
    variants: [
      { label: '250ml', price: 120, sort_order: 1 },
      { label: '1.5L', price: 250, sort_order: 2 }
    ]
  });
  console.log('Drink inserted:', p2.status === 201 ? 'OK' : p2.data);
  
  // 3. Pasta (Half/Full)
  const p3 = await request('POST', '/api/menu', {
    name: 'Flaming Pasta',
    category: 'Pasta',
    variants: [
      { label: 'Half', price: 400, sort_order: 1 },
      { label: 'Full', price: 600, sort_order: 2 }
    ]
  });
  console.log('Pasta inserted:', p3.status === 201 ? 'OK' : p3.data);
  
  // 4. Ice Cream (Scoops)
  const p4 = await request('POST', '/api/menu', {
    name: 'Vanilla Ice Cream',
    category: 'Ice Cream',
    variants: [
      { label: '1 Scoop', price: 100, sort_order: 1 },
      { label: '2 Scoop', price: 180, sort_order: 2 },
      { label: '3 Scoop', price: 250, sort_order: 3 }
    ]
  });
  console.log('Ice Cream inserted:', p4.status === 201 ? 'OK' : p4.data);
  
  // 5. Burger (Flat price)
  const p5 = await request('POST', '/api/menu', {
    name: 'Zinger Burger',
    category: 'Burger',
    price: 350
  });
  console.log('Burger inserted:', p5.status === 201 ? 'OK' : p5.data);
  
  // 6. Old pre-seeded item check
  // (We'll just insert one and see if it looks right, simulating an old item)
  const p6 = await request('POST', '/api/menu', {
    name: 'Beef Burger (Classic)',
    category: 'Burger',
    price: 450
  });
  console.log('Old style Burger inserted:', p6.status === 201 ? 'OK' : p6.data);

  console.log('\n--- Fetching All Items (GET /api/menu) ---');
  const getRes = await request('GET', '/api/menu');
  if (getRes.status === 200) {
    getRes.data.forEach(item => {
      console.log(`\nID: ${item.id} | Name: ${item.name} | Category: ${item.category} | Price: ${item.price} | has_variants: ${item.has_variants}`);
      console.log(`Variants:`, JSON.stringify(item.variants, null, 2));
    });
  } else {
    console.error('Failed to get menu:', getRes.data);
  }
}

run();
