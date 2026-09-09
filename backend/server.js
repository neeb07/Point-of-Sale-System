const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db/database');
const { isSyncEnabled } = require('./db/till-identity');
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

const {
  attachUser, requireAuth, requireAdmin, adminOnlyWrites, isAdminRole,
} = require('./middleware/auth');

// Resolve the caller's session for every request; individual routes decide
// what they require.
app.use(attachUser);

/**
 * Permission matrix.
 *
 * Reads that the till needs in order to sell — the menu, the deals, the shop's
 * tax and currency settings — are open to any signed-in user. Everything that
 * changes them, plus inventory, staff and backups, is admin-only.
 *
 * These are the real boundary. The React app hides the same things, but that
 * is a convenience: this is what actually stops a manager repricing the menu.
 */
/*
 * The menu, once a cloud owns it.
 *
 * A paired till pulls its menu from the dashboard, so editing it here would be
 * worse than pointless: the change would work, then vanish without explanation
 * at the next snapshot. Refusing outright, with a message saying where the menu
 * actually lives, is the honest version of the same constraint.
 *
 * Only when paired. An unpaired till is a single-shop install with no cloud
 * above it, and its menu is still its own.
 */
function menuOwnedByCloud(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!isSyncEnabled()) return next();
  return res.status(409).json({
    error: 'The menu is managed from the head-office dashboard. Changes made here would be replaced at the next sync.',
    code: 'MENU_OWNED_BY_CLOUD',
  });
}

app.use('/api/menu', adminOnlyWrites, menuOwnedByCloud, require('./routes/menu'));
app.use('/api/deals', adminOnlyWrites, menuOwnedByCloud, require('./routes/deals'));
/**
 * Settings: readable without a token, writable only by an administrator.
 *
 * The sign-in screen draws the shop's name and branding before anyone has
 * signed in, so requiring a token to *read* settings left the PIN screen
 * unable to load — and, because a 401 signs the user out, bouncing in a loop.
 * Nothing in here is secret: it is the tax rate, currency and receipt wording
 * that get printed on every customer's receipt anyway.
 */
/**
 * Settings a manager may change on their own till.
 *
 * How this machine behaves — which printer paper it uses, whether it prints
 * automatically, what appears on the slip. A manager is the person standing in
 * front of the printer when it jams; making them telephone the owner to change
 * the paper size is the kind of friction that gets worked around rather than
 * followed.
 *
 * Everything absent from this list stays with the owner: prices, tax, the
 * shop's identity, backups, and sending the day's figures out of the building.
 * The Settings screen still shows a manager those values, greyed, so they can
 * read what the till is configured with without being able to change it.
 */
const MANAGER_EDITABLE = new Set([
  'paper_size',
  'auto_print',
  'show_tax',
  'show_cashier',
  'show_order_number',
  'show_payment',
]);

app.use('/api/settings', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  // Administrators keep the whole surface, including restore.
  if (req.user && isAdminRole(req.user.role)) return next();
  if (!req.user) return requireAdmin(req, res, next);

  /*
   * Restoring is a manager's job too.
   *
   * It is the one action that can only be done by whoever is standing at the
   * machine, and the machine is in a shop the owner does not sit in. A till
   * that has just been rebuilt is useless until somebody loads the backup into
   * it, and telling the manager to wait for the owner to drive over is not a
   * recovery plan.
   *
   * It is destructive, which is why the route itself keeps a safety copy of
   * what it replaces before it does anything — see routes/settings.js.
   */
  if (req.method === 'POST' && req.path === '/restore') return next();

  // Otherwise a manager may write, but only these keys, and only via the plain
  // update.
  if (req.method !== 'PUT' || req.path !== '/') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  const attempted = Object.keys(req.body || {});
  const refused = attempted.filter(k => !MANAGER_EDITABLE.has(k));
  if (refused.length) {
    return res.status(403).json({
      error: `Only the owner can change: ${refused.join(', ')}.`,
      code: 'NOT_YOURS_TO_CHANGE',
    });
  }
  if (!attempted.length) {
    return res.status(400).json({ error: 'Nothing to change' });
  }
  return next();
}, require('./routes/settings'));

// Stock counts are day-to-day till work, so both roles keep and adjust them.
app.use('/api/inventory', requireAuth, require('./routes/inventory'));

/*
 * Staff, once a cloud owns them.
 *
 * The same rule as the menu above, and for the same reason: a paired till pulls
 * its roster from the dashboard, so an account created or a PIN changed here
 * would work until the next snapshot and then silently revert. Refusing, and
 * saying where staff are actually managed, is the honest form of that
 * constraint.
 *
 * Signing in and out are emphatically not administration — they are how anybody
 * uses this till at all, they must work with the internet down, and they change
 * no roster — so they are exempt. An unpaired till is a single-shop install and
 * keeps managing its own staff, exactly as before.
 */
const STAFF_SESSION_PATHS = new Set(['/login', '/logout']);

function staffOwnedByCloud(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (STAFF_SESSION_PATHS.has(req.path)) return next();
  if (!isSyncEnabled()) return next();
  return res.status(409).json({
    error: 'Staff are managed from the head-office dashboard. Changes made here would be replaced at the next sync.',
    code: 'STAFF_OWNED_BY_CLOUD',
  });
}

// Staff administration. The login route inside is exempt — see routes/staff.js.
app.use('/api/staff', staffOwnedByCloud, require('./routes/staff'));

// The daily WhatsApp report sends the shop's figures out of the building.
app.use('/api/whatsapp', requireAdmin, require('./routes/whatsapp'));

// Cloud sync. Mounted with requireAuth rather than requireAdmin: a manager
// needs the "Sync now" button on the sale screen, because they are the one
// standing there when the internet comes back. The routes inside guard
// themselves — pushing is till work, reading the pairing configuration is not.
app.use('/api/sync', requireAuth, require('./routes/sync'));

// Taking money and running the till: both roles.
app.use('/api/orders', requireAuth, require('./routes/orders'));
// Petty cash out of the drawer is till work, so both roles record it.
app.use('/api/expenses', requireAuth, require('./routes/expenses'));
// The customer book is written only as a side effect of a delivery sale, so
// this route is read-only; the branch list is reference data every till needs.
app.use('/api/customers', requireAuth, require('./routes/customers'));
app.use('/api/branches', requireAuth, require('./routes/branches'));
/*
 * How many shifts are open, whoever opened them.
 *
 * Mounted ahead of the guarded router and left open on purpose: Electron's main
 * process asks this as the app is closing, to warn before a drawer is abandoned
 * uncounted, and it holds no session and has no way to obtain one. It answers a
 * single number, names nobody, and the API is bound to loopback.
 */
app.get('/api/shifts/open-count', (req, res) => {
  try {
    /*
     * Who, as well as how many.
     *
     * Closing the app is now refused while a drawer is open, and a refusal
     * that will not say whose drawer it is leaves somebody guessing at the end
     * of a shift. The names are already listed, unauthenticated, on the
     * sign-in screen of this same machine — this adds no exposure that the PIN
     * pad does not — and the route stays bound to loopback either way.
     *
     * Deliberately no figures: the takings in a drawer are not something an
     * unauthenticated caller needs.
     */
    const shifts = db.prepare(`
      SELECT id, staff_name, opened_at FROM shifts
       WHERE status = 'open' ORDER BY opened_at
    `).all();
    res.json({ open: shifts.length, shifts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/shifts', requireAuth, require('./routes/shifts'));
app.use('/api/reports', requireAuth, require('./routes/reports'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

/*
 * Download the whole database. Still the owner's, and deliberately not moved
 * with the rest.
 *
 * This file is every order, every customer's name, address and telephone
 * number, and every manager's expenses. Handing it to a manager would quietly
 * undo the rule that a manager sees only their own figures — they would simply
 * open the file. And it costs them nothing to keep, because the till now sends
 * a copy to the cloud every half hour on its own and the owner can download any
 * of them from the dashboard. Restoring, which is the part that genuinely needs
 * somebody at the machine, is open to managers above.
 */
app.get('/api/backup', requireAdmin, (req, res) => {
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
/*
 * Cloud heartbeat.
 *
 * Started after the routes are mounted, and only when this till has been paired
 * (see db/till-identity.js). An unpaired till never opens a socket, so a
 * single-shop install behaves exactly as it did before.
 */
require('./sync/heartbeat').start();
// The sales push: batched, retried, and never in the sale path.
require('./sync/push').start();
/*
 * Backups.
 *
 * Two of them, protecting against different things. The local one guards
 * against a bad restore or a deleted record and is useless if the disk dies;
 * the cloud one is the only copy that survives losing this machine, which is
 * the failure the shop actually plans for. Started here rather than from
 * db/database.js so that requiring the database in a script does not write a
 * backup as a side effect.
 */
require('./db/backup').start();
require('./sync/backup-upload').start();

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
