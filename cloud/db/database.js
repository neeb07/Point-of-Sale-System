/**
 * The cloud database.
 *
 * SQLite, deliberately — the same engine the tills run. `backend/routes/reports.js`
 * is ~600 lines of SQLite-specific SQL (`strftime`, `DATE()`,
 * `datetime('now','localtime')`); on any other engine it would have to be
 * rewritten and then kept correct in two dialects forever, with every rewrite
 * checked against the original because a silently different `GROUP BY` produces
 * plausible wrong numbers rather than an error. Same engine, same schema, so
 * that file is copied rather than ported.
 *
 * At two branches with a single writer (this process) SQLite in WAL mode is
 * comfortably over-specified. The one thing it needs is a real local disk —
 * file locking is unreliable over network storage, so this must not be deployed
 * onto NFS.
 *
 * The file lives outside any web root so no vhost can ever serve it.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.BLAZE_CLOUD_DATA || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'blaze_cloud.db');
const db = new Database(DB_PATH);

// WAL lets the dashboard read while a heartbeat is being written, instead of
// the two blocking each other.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/*
 * Branches.
 *
 * `id` matches the till's own `branch_id` by convention, so the two sides agree
 * without a mapping table. It is NOT autoincrement: the till is provisioned
 * with a branch id, and the cloud must be able to be given the same one.
 *
 * Only the *hash* of the API key is stored. A dump of this database then yields
 * no working till credentials — the key itself exists in exactly one place, the
 * cloud-sync.json on the branch's own machine.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL UNIQUE,
    api_key_hash TEXT NOT NULL UNIQUE,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/*
 * Dashboard accounts.
 *
 * Entirely separate from the tills' 4-digit PINs, which are fine for a keypad
 * behind a counter and completely unfit for a public URL.
 *
 * `role` and `branch_id` exist from the first day even though only one owner
 * account is being created now: adding per-branch manager logins later is then
 * a row, not a migration. A NULL `branch_id` means "every branch".
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT,
    role          TEXT NOT NULL DEFAULT 'owner',
    branch_id     INTEGER DEFAULT NULL REFERENCES branches(id),
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/*
 * Dashboard sessions.
 *
 * On disk rather than in memory, unlike the till's `backend/middleware/auth.js`.
 * A systemd unit restarts this process on crash and on deploy, and an owner
 * being silently signed out every time the server restarts would be both
 * baffling and, during a deploy, constant.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`);

/*
 * Live status — one row per branch, overwritten on every heartbeat.
 *
 * No history. The live view is deliberately not reconstructable after the fact;
 * historical questions belong to the sales tables, which arrive by a different
 * channel with completely different delivery guarantees.
 *
 * Times are stored two ways on purpose:
 *   - `*_ms` are epoch milliseconds, used for every freshness and skew
 *     calculation. Unambiguous, timezone-free, and diffable.
 *   - `opened_at` is the till's local wall-clock string, for display only
 *     ("opened 14:32"). It is what the POS itself stores.
 *
 * Freshness is ALWAYS computed from `server_received_ms`, never from anything
 * the till reported about its own clock — a till with a wrong clock must show
 * as skewed, not as fresh.
 *
 * `payload` keeps the whole snapshot as JSON so a till that starts sending a
 * new field does not require a cloud migration to be deployed first.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS live_status (
    branch_id            INTEGER PRIMARY KEY REFERENCES branches(id),
    state                TEXT NOT NULL,
    shift_local_id       INTEGER,
    staff_name           TEXT,
    opened_at            TEXT,
    opening_cash         REAL,
    total_orders         INTEGER,
    total_revenue        REAL,
    cash_revenue         REAL,
    non_cash_revenue     REAL,
    drawer_expenses      REAL,
    expense_count        INTEGER,
    expected_cash        REAL,
    expenses_today_total REAL,
    expenses_today_count INTEGER,
    menu_version         INTEGER,
    payload              TEXT,
    till_sent_ms         INTEGER,
    server_received_ms   INTEGER NOT NULL,
    clock_skew_ms        INTEGER,
    agent_started_ms     INTEGER
  );
`);

// The synced sales tables live in their own file — they are the bulk of the
// schema and they mirror the till's, so keeping them apart makes the drift
// against backend/db/database.js easy to see.
require('./sales-schema').createSalesTables(db);

module.exports = db;
module.exports.DB_PATH = DB_PATH;
module.exports.DATA_DIR = DATA_DIR;
