/**
 * Blaze cloud API.
 *
 * Sits behind the admin dashboard at blaze.virtiqo.com. Two kinds of caller,
 * with two entirely separate credentials:
 *
 *   - **Tills**, authenticated by a per-branch API key. They only ever push:
 *     live status now, sales later. They never read another branch's data.
 *   - **The owner**, authenticated by an httpOnly session cookie. Reads only.
 *
 * Deployment: Node listens on loopback and Virtualmin's Apache/nginx vhost
 * reverse-proxies blaze.virtiqo.com to it, terminating TLS. This process never
 * faces the internet directly, which is why it binds 127.0.0.1 by default —
 * the same reasoning as the till's backend.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const db = require('./db/database');
const { attachUser, startSessionCleanup } = require('./middleware/session');
const { requireBranch } = require('./middleware/branch-auth');

const app = express();

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.BLAZE_CLOUD_HOST || '127.0.0.1';

/*
 * Behind a reverse proxy, so trust its forwarded address — otherwise every
 * request appears to come from 127.0.0.1 and the login rate limiter would be
 * keyed on a single value for the whole internet.
 */
app.set('trust proxy', 1);

// Bodies here are small: a heartbeat is a few hundred bytes and a sales batch
// is capped by the till. A low limit means a malformed or hostile request is
// rejected before it is parsed rather than after.
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(attachUser);

/** Liveness probe. Open, and deliberately says nothing about the shop. */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'blaze-cloud', time: new Date().toISOString() });
});

// --- Till-facing: branch key ------------------------------------------------
app.use('/api/ping', requireBranch, require('./routes/ping'));

// --- Owner-facing: session cookie -------------------------------------------
app.use('/api/auth', require('./routes/auth'));

// Mixed: the write half takes a branch key, the read half a session cookie, so
// each is guarded inside the router rather than at the mount.
app.use('/api/live', require('./routes/live'));

/*
 * Serve the dashboard build from this same process, and therefore the same
 * origin as the API.
 *
 * That is what lets the session cookie be a plain SameSite=Lax httpOnly cookie
 * with no CORS negotiation and no SameSite=None. Serving the UI from a
 * different host would make the cookie a cross-site one, which modern browsers
 * increasingly refuse outright.
 *
 * Optional: if the build is absent, the API still runs. Useful in development,
 * where Vite serves the UI itself and proxies /api across.
 */
const DASHBOARD_DIST = process.env.BLAZE_DASHBOARD_DIST
  || path.join(__dirname, '..', 'dashboard', 'dist');

if (fs.existsSync(path.join(DASHBOARD_DIST, 'index.html'))) {
  app.use(express.static(DASHBOARD_DIST));
  // Anything not matched above and not under /api is a client-side route, so
  // hand back index.html rather than a 404.
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(DASHBOARD_DIST, 'index.html'));
  });
  console.log(`Serving dashboard from ${DASHBOARD_DIST}`);
} else {
  console.log('No dashboard build found — API only. (Run `npm run build` in dashboard/.)');
}

// 404 as JSON, so a dashboard fetch gets a parseable body rather than HTML.
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Server error' });
});

startSessionCleanup();

const server = app.listen(PORT, HOST, () => {
  console.log(`Blaze cloud API on http://${HOST}:${PORT}`);
  console.log(`Database: ${db.DB_PATH}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw err;
});

// systemd sends SIGTERM on restart and on deploy. Closing the database on the
// way out means WAL is checkpointed rather than left for the next start to
// recover.
function shutdown() {
  server.close(() => {
    try { db.close(); } catch (e) { /* already closed */ }
    process.exit(0);
  });
  // Do not hang forever on a connection that will not close.
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
