const http = require('http');

const orderData = {
  items: [
    { id: 1, name: 'Test Item', price: 100, quantity: 2 }
  ],
  total: 200,
  discount: 0,
  payment_method: 'Cash'
};

const postData = JSON.stringify(orderData);

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/orders',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    console.log(`Response: ${chunk}`);
  });
});

req.on('error', (error) => {
  console.error(`Error: ${error.message}`);
});

req.write(postData);
req.end();
