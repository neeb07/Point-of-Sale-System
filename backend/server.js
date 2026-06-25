const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = 3001;

app.use(cors({ 
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
  console.log('Headers:', req.headers);
  next();
});

app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/staff', require('./routes/staff'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/backup', (req, res) => {
  const dbPath = path.join(__dirname, 'pos_database.db');
  res.download(dbPath, 'pos_backup.db');
});

app.listen(PORT, () => {
  console.log(`POS Backend running on http://localhost:${PORT}`);
});
