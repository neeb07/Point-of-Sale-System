/**
 * The synced sales tables.
 *
 * These mirror the till's schema closely enough that `backend/routes/reports.js`
 * runs against them almost unchanged — which is the whole reason the cloud runs
 * SQLite. Two deliberate differences:
 *
 * **1. Every row is keyed on `(branch_id, local_id)`, not on `id`.**
 * Every table on a till is `INTEGER PRIMARY KEY AUTOINCREMENT`, so E-18's order
 * #12 and CBR Town's order #12 are different sales wearing the same number.
 * Merging on `id` would silently overwrite one with the other. The cloud keeps
 * its own `id` for joins, and the unique constraint on `(branch_id, local_id)`
 * is what makes a re-sent batch harmless — which matters more than usual here,
 * because on a flaky link the till often cannot tell whether a batch landed and
 * must be able to simply send it again.
 *
 * **2. `order_items.category` is stored rather than joined.**
 * The till resolves a category by joining `menu_items`, but menu item ids are
 * assigned per machine, so id 97 is not the same product at both branches even
 * though the menu is identical. Denormalising the category at sale time is both
 * the correct fix and a better answer historically: it records what the item
 * *was* when it sold, so a later menu change cannot rewrite past reports.
 */

function createSalesTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id               INTEGER NOT NULL,
      local_id                INTEGER NOT NULL,
      total                   REAL,
      discount                REAL,
      payment_method          TEXT,
      status                  TEXT,
      cashier_name            TEXT,
      cashier_id              INTEGER,
      created_at              DATETIME,
      order_type              TEXT,
      delivery_charge         REAL,
      local_shift_id          INTEGER,
      table_number            TEXT,
      voided_at               DATETIME,
      tax_rate                REAL,
      tax_amount              REAL,
      is_employee             INTEGER,
      employee_discount       REAL,
      employee_discount_rate  REAL,
      voided_by               TEXT,
      voided_by_id            INTEGER,
      customer_name           TEXT,
      customer_phone          TEXT,
      customer_address        TEXT,
      received_at             INTEGER NOT NULL,
      UNIQUE(branch_id, local_id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_branch     ON orders(branch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id    INTEGER NOT NULL,
      local_id     INTEGER NOT NULL,
      -- The CLOUD's orders.id, remapped at ingest. Storing the till's own
      -- order id here would join rows across branches into each other.
      order_id     INTEGER NOT NULL,
      menu_item_id INTEGER,
      name         TEXT,
      price        REAL,
      quantity     INTEGER,
      is_deal      INTEGER,
      variant_id   INTEGER,
      -- Resolved by the till at push time; see the note above.
      category     TEXT,
      UNIQUE(branch_id, local_id)
    );
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id     INTEGER NOT NULL,
      local_id      INTEGER NOT NULL,
      staff_id      INTEGER,
      staff_name    TEXT,
      opening_cash  REAL,
      closing_cash  REAL,
      expected_cash REAL,
      variance      REAL,
      opened_at     DATETIME,
      closed_at     DATETIME,
      status        TEXT,
      received_at   INTEGER NOT NULL,
      UNIQUE(branch_id, local_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branch_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id      INTEGER NOT NULL,
      local_id       INTEGER NOT NULL,
      local_shift_id INTEGER,
      staff_id       INTEGER,
      staff_name     TEXT,
      category       TEXT,
      description    TEXT,
      amount         REAL,
      from_drawer    INTEGER,
      created_at     DATETIME,
      received_at    INTEGER NOT NULL,
      UNIQUE(branch_id, local_id)
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_branch     ON expenses(branch_id);
    CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses(created_at);
  `);

  /*
   * How far each branch has got.
   *
   * Read by the dashboard, not by the sync: a report that silently omits the
   * last three hours of a disconnected branch is more dangerous than no report,
   * so the reports screen shows how complete its data actually is.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_cursor (
      branch_id      INTEGER NOT NULL,
      table_name     TEXT NOT NULL,
      rows_received  INTEGER NOT NULL DEFAULT 0,
      last_synced_ms INTEGER,
      PRIMARY KEY (branch_id, table_name)
    );
  `);
}

module.exports = { createSalesTables };
