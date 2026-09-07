/**
 * The cloud schema, in Postgres.
 *
 * Applied on boot and idempotent, so a deploy is just a restart. Supabase also
 * offers migration files; this stays in code because the till's own schema
 * (`backend/db/database.js`) works the same way, and one convention across both
 * halves is worth more than following each platform's house style.
 *
 * Deliberate shape decisions, all inherited from the sync design:
 *
 * **Every synced row is keyed on `(branch_id, local_id)`.** Each till assigns
 * its own ids, so E-18's order #12 and CBR Town's order #12 are different sales
 * wearing the same number. The cloud keeps a `id` of its own for joins,
 * and the unique constraint on the pair is what makes a re-sent batch harmless
 * — which matters because on a flaky link a till often cannot tell whether a
 * batch landed and must be free to send it again.
 *
 * **Integer flags stay integers.** Postgres has a real boolean, but the tills
 * send 0 and 1 and the reporting SQL compares against them. Converting here
 * would mean translating in both directions forever, for nothing.
 *
 * **Timestamps are text, not `timestamptz`.** The tills record local wall-clock
 * time as `'2026-09-07 14:32:11'`, with no zone. Storing that as `timestamptz`
 * would make Postgres attach the *server's* zone to it, so the same sale would
 * read differently depending on where the server happened to be. Keeping the
 * till's own string and comparing with `::date` preserves exactly what the shop
 * recorded. The `_ms` columns, which are epoch integers, carry anything that
 * genuinely needs to be compared across machines.
 */

const DDL = `
-- ---------------------------------------------------------------- branches --
CREATE TABLE IF NOT EXISTS branches (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------- dashboard accounts --
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'owner',
  branch_id     INTEGER REFERENCES branches(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ------------------------------------------------------------ live status --
-- One row per branch, overwritten on every heartbeat. No history: the live
-- view is deliberately not reconstructable, and historical questions belong to
-- the synced tables below, which arrive with completely different guarantees.
CREATE TABLE IF NOT EXISTS live_status (
  branch_id            INTEGER PRIMARY KEY REFERENCES branches(id),
  state                TEXT NOT NULL,
  shift_local_id       INTEGER,
  staff_name           TEXT,
  opened_at            TEXT,
  opening_cash         DOUBLE PRECISION,
  total_orders         INTEGER,
  total_revenue        DOUBLE PRECISION,
  cash_revenue         DOUBLE PRECISION,
  non_cash_revenue     DOUBLE PRECISION,
  drawer_expenses      DOUBLE PRECISION,
  expense_count        INTEGER,
  expected_cash        DOUBLE PRECISION,
  expenses_today_total DOUBLE PRECISION,
  expenses_today_count INTEGER,
  menu_version         INTEGER,
  payload              JSONB,
  till_sent_ms         BIGINT,
  server_received_ms   BIGINT NOT NULL,
  clock_skew_ms        BIGINT,
  agent_started_ms     BIGINT
);

-- ---------------------------------------------------------------- orders --
CREATE TABLE IF NOT EXISTS orders (
  id                     SERIAL PRIMARY KEY,
  branch_id              INTEGER NOT NULL,
  local_id               INTEGER NOT NULL,
  total                  DOUBLE PRECISION,
  discount               DOUBLE PRECISION,
  payment_method         TEXT,
  status                 TEXT,
  cashier_name           TEXT,
  cashier_id             INTEGER,
  created_at             TEXT,
  order_type             TEXT,
  delivery_charge        DOUBLE PRECISION,
  local_shift_id         INTEGER,
  table_number           TEXT,
  voided_at              TEXT,
  tax_rate               DOUBLE PRECISION,
  tax_amount             DOUBLE PRECISION,
  is_employee            INTEGER,
  employee_discount      DOUBLE PRECISION,
  employee_discount_rate DOUBLE PRECISION,
  voided_by              TEXT,
  voided_by_id           INTEGER,
  customer_name          TEXT,
  customer_phone         TEXT,
  customer_address       TEXT,
  received_at            BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_branch     ON orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id           SERIAL PRIMARY KEY,
  branch_id    INTEGER NOT NULL,
  local_id     INTEGER NOT NULL,
  -- The CLOUD's orders.id, remapped at ingest. The till's own order id is only
  -- unique within its branch, so storing it here would join one shop's food
  -- onto the other shop's sale of the same number.
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id INTEGER,
  name         TEXT,
  price        DOUBLE PRECISION,
  quantity     INTEGER,
  is_deal      INTEGER,
  variant_id   INTEGER,
  -- Resolved by the till at push time: menu item ids are per-machine, so the
  -- join to menu_items cannot be done here.
  category     TEXT,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS shifts (
  id            SERIAL PRIMARY KEY,
  branch_id     INTEGER NOT NULL,
  local_id      INTEGER NOT NULL,
  staff_id      INTEGER,
  staff_name    TEXT,
  opening_cash  DOUBLE PRECISION,
  closing_cash  DOUBLE PRECISION,
  expected_cash DOUBLE PRECISION,
  variance      DOUBLE PRECISION,
  opened_at     TEXT,
  closed_at     TEXT,
  status        TEXT,
  received_at   BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);

CREATE TABLE IF NOT EXISTS expenses (
  id             SERIAL PRIMARY KEY,
  branch_id      INTEGER NOT NULL,
  local_id       INTEGER NOT NULL,
  local_shift_id INTEGER,
  staff_id       INTEGER,
  staff_name     TEXT,
  category       TEXT,
  description    TEXT,
  amount         DOUBLE PRECISION,
  from_drawer    INTEGER,
  created_at     TEXT,
  received_at    BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_expenses_branch     ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);

-- ------------------------------------------------------- staff & inventory --
-- Both are read-only on the dashboard: the branch owns them, and a stock count
-- or a PIN edited in two places at once has no safe resolution.
CREATE TABLE IF NOT EXISTS staff (
  id         SERIAL PRIMARY KEY,
  branch_id  INTEGER NOT NULL,
  local_id   INTEGER NOT NULL,
  name       TEXT,
  role       TEXT,
  color      TEXT,
  active     INTEGER,
  -- No PIN, hashed or otherwise. It is of no use to the dashboard and every
  -- copy of a credential is another place it can leak from.
  received_at BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);

/*
 * Delivery customers, for demographics.
 *
 * Keyed per branch like everything else that syncs, because each till maintains
 * its own book. The same household ordering from both shops therefore arrives
 * as two rows; the read route sums them by phone number, so "how many times has
 * this customer ordered" answers across the whole business rather than one
 * branch's view of them.
 */
CREATE TABLE IF NOT EXISTS customers (
  id             SERIAL PRIMARY KEY,
  branch_id      INTEGER NOT NULL,
  local_id       INTEGER NOT NULL,
  name           TEXT,
  phone          TEXT,
  address        TEXT,
  order_count    INTEGER DEFAULT 0,
  total_spent    DOUBLE PRECISION DEFAULT 0,
  first_order_at TEXT,
  last_order_at  TEXT,
  received_at    BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

CREATE TABLE IF NOT EXISTS ingredients (
  id          SERIAL PRIMARY KEY,
  branch_id   INTEGER NOT NULL,
  local_id    INTEGER NOT NULL,
  name        TEXT,
  unit        TEXT,
  stock       DOUBLE PRECISION,
  low_stock_threshold DOUBLE PRECISION,
  cost_per_unit DOUBLE PRECISION,
  received_at BIGINT NOT NULL,
  UNIQUE (branch_id, local_id)
);
CREATE INDEX IF NOT EXISTS idx_ingredients_branch ON ingredients(branch_id);

-- ------------------------------------------------------------ sync cursor --
-- Read by the dashboard, not by the sync. A report that silently omits the
-- last three hours of a disconnected branch is worse than no report, so the
-- reports screen shows how complete its data actually is.
CREATE TABLE IF NOT EXISTS sync_cursor (
  branch_id      INTEGER NOT NULL,
  table_name     TEXT NOT NULL,
  rows_received  INTEGER NOT NULL DEFAULT 0,
  last_synced_ms BIGINT,
  PRIMARY KEY (branch_id, table_name)
);

-- ------------------------------------------------------------------- menu --
-- The cloud is the single writer for the menu (see routes/menu.js). Tills pull
-- a whole snapshot and never push one back, which removes conflict resolution
-- by design rather than solving it.
CREATE TABLE IF NOT EXISTS menu_items (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT,
  price        DOUBLE PRECISION DEFAULT 0,
  image_url    TEXT,
  has_variants INTEGER DEFAULT 0,
  active       INTEGER DEFAULT 1,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_variants (
  id           SERIAL PRIMARY KEY,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  label        TEXT,
  price        DOUBLE PRECISION DEFAULT 0,
  sort_order   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deals (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price       DOUBLE PRECISION DEFAULT 0,
  image_url   TEXT,
  active      INTEGER DEFAULT 1,
  deal_group  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_items (
  id           SERIAL PRIMARY KEY,
  deal_id      INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  quantity     INTEGER DEFAULT 1,
  variant_id   INTEGER REFERENCES item_variants(id) ON DELETE SET NULL,
  description  TEXT
);

/*
 * One integer the tills can check cheaply.
 *
 * A till asks "what version is the menu?" on every heartbeat -- a few bytes,
 * which succeeds on a link far too weak to download a menu. Only when the
 * number differs does it fetch the whole snapshot. That is what makes the
 * downlink survivable on a bad connection: the common case costs nothing.
 */
/*
 * Shop-wide settings, and their own version counter.
 *
 * Separate from menu_version on purpose: changing the tax rate should not make
 * every till re-download and re-apply the whole menu, which retires and
 * reinserts every item.
 */
CREATE TABLE IF NOT EXISTS cloud_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings_version (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_version_single_row CHECK (id = 1)
);
INSERT INTO settings_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS menu_version (
  id         INTEGER PRIMARY KEY DEFAULT 1,
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT menu_version_single_row CHECK (id = 1)
);
INSERT INTO menu_version (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
`;

/**
 * Settings every connection needs, applied to the role rather than per session.
 *
 * See db/pg.js for why each matters. Doing it here means one statement at boot
 * instead of a query on every connection that races the pool.
 *
 * Non-fatal: a role without ALTER privileges still gets a working server, just
 * one whose floats are truncated on the wire — worth a loud warning, not a
 * refusal to start.
 */
async function applyRoleSettings(db) {
  try {
    const { rows } = await db.pool.query('SELECT current_user AS role');
    const role = rows[0].role;
    // The role name comes from the server, not from input, but quote it anyway
    // — ALTER ROLE takes an identifier, which cannot be parameterised.
    const quoted = '"' + String(role).replace(/"/g, '""') + '"';
    await db.pool.query(`ALTER ROLE ${quoted} SET extra_float_digits = 3`);
    await db.pool.query(`ALTER ROLE ${quoted} SET idle_in_transaction_session_timeout = '30s'`);
  } catch (err) {
    console.warn('Could not set role defaults (floats may lose precision):', err.message);
  }
}

async function createSchema(db) {
  await db.pool.query(DDL);
  await applyRoleSettings(db);
}

module.exports = { createSchema, applyRoleSettings, DDL };
