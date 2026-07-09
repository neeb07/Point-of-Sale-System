const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.startsWith('file://')) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/deals', require('./routes/deals'));
app.use('/api/whatsapp', require('./routes/whatsapp'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Backup — reads from correct DB location
app.get('/api/backup', (req, res) => {
  const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname);
  const dbPath = path.join(userDataDir, 'pos_database.db');

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'Database file not found' });
  }

  const date = new Date().toISOString().split('T')[0];
  res.download(dbPath, `pos_backup_${date}.db`);
});

// Port conflict handling
const server = app.listen(PORT, () => {
  console.log(`POS Backend running on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${PORT} is already in use. Close the other application and restart Restro POS.`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});