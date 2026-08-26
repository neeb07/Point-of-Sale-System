const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3001;

// SECURITY: bind to the loopback interface only.
//
// This used to be a bare `app.listen(PORT)`, which binds 0.0.0.0 — every
// interface on the machine. On a shop's wifi that meant any phone or laptop
// on the same network could reach the API, and since none of these routes
// carry authentication, that is a full remote takeover: void orders, read
// the staff table, or POST /api/settings/restore to replace the database.
// The frontend always runs on this same machine, so loopback is sufficient.
const HOST = process.env.POS_BIND_HOST || '127.0.0.1';

// SECURITY: the previous CORS config called back(null, true) for every origin,
// including the two "checks" above it, which made it a no-op allow-all.
// The renderer is either a file:// page (origin `null`, sent as undefined by
// some Chromium versions) in the packaged build, or the Vite dev server.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

app.use(cors({
  origin: function (origin, callback) {
    // No Origin header: same-origin, curl, or a file:// page. Because we are
    // bound to loopback, these can only come from this machine.
    if (!origin || origin === 'null') return callback(null, true);
    if (origin.startsWith('file://')) return callback(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    return callback(new Error(`Origin not allowed: ${origin}`));
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
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/shifts', require('./routes/shifts'));

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

// Rejected CORS preflights arrive here as errors; answer them cleanly instead
// of leaking a stack trace.
app.use((err, req, res, next) => {
  if (err && /Origin not allowed/.test(err.message)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Port conflict handling
const server = app.listen(PORT, HOST, () => {
  console.log(`POS Backend running on http://${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`ERROR: Port ${PORT} is already in use. Close the other application and restart Blaze POS.`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});
