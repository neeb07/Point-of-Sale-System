/**
 * Pushing sales to the cloud.
 *
 * The opposite contract to sync/heartbeat.js next door, and the difference is
 * the whole reason they are separate files:
 *
 *   heartbeat  small, frequent, lossy      — a missed beat is superseded
 *   push       batched, durable, retried   — a missed sale is money lost
 *
 * Keeping them apart is what lets the dashboard stay live while a sales backlog
 * is still draining: a 200-byte heartbeat gets through on a link that cannot
 * move a day's orders.
 *
 * **Idempotency instead of careful delivery.** On a fluctuating connection the
 * till often cannot tell whether a batch arrived — the reply may have been lost,
 * or sent after it gave up waiting. Rather than trying to resolve that, the
 * cloud keys every row on `(branch_id, local_id)` so re-sending is harmless.
 * A row is marked `synced` only on a confirmed 200; anything ambiguous stays
 * pending and goes again. Sending twice is free, losing a sale is not.
 *
 * As with the heartbeat, nothing here may ever run in the sale path.
 */

const db = require('../db/database');
const { syncConfig, isSyncEnabled } = require('../db/till-identity');

/** Comfortably under the cloud's 200-row cap, and small enough to get through a bad patch. */
const BATCH_SIZE = 100;

/** Longer than a heartbeat's: a batch is bigger and worth waiting for. */
const TIMEOUT_MS = 30 * 1000;

/**
 * How often to push, in the background.
 *
 * Matched to the heartbeat's 30s so the dashboard's reports move roughly in
 * step with its live cards, rather than the owner watching revenue tick up on
 * one tab while Reports insists nothing has happened for five minutes.
 *
 * Affordable because a pass with nothing pending is a single indexed query
 * against a partial index and no network call at all — see the early return in
 * syncOnce. Only a shop that is actually selling pays for the frequency.
 */
const INTERVAL_MS = 30 * 1000;

const state = {
  lastAttemptMs: null,
  lastSuccessMs: null,
  lastError: null,
  consecutiveFailures: 0,
  running: false,
};

/*
 * Pending rows, oldest first.
 *
 * Oldest first matters: if the backlog is bigger than one batch, the shop's
 * history fills in chronologically rather than in scattered fragments, so a
 * partially-synced day is a shorter day rather than a full of holes.
 */
const pendingOrdersStmt = db.prepare(`
  SELECT * FROM orders WHERE sync_state = 'pending' ORDER BY id ASC LIMIT ?
`);

/*
 * Line items, with the category resolved here.
 *
 * The cloud cannot do this join itself: menu item ids are assigned per machine,
 * so id 97 is not the same product at both branches even though the menu is
 * identical. Resolving it at push time is also more correct historically — it
 * records what the item was when it sold, so a later menu change cannot rewrite
 * past reports. The CASE mirrors backend/routes/reports.js exactly.
 */
const itemsStmt = db.prepare(`
  SELECT
    oi.id, oi.menu_item_id, oi.name, oi.price, oi.quantity, oi.is_deal, oi.variant_id,
    CASE
      WHEN oi.is_deal = 1 THEN 'Deals'
      ELSE COALESCE(m.category, 'Removed Item')
    END AS category
  FROM order_items oi
  LEFT JOIN menu_items m ON oi.menu_item_id = m.id AND oi.is_deal = 0
  WHERE oi.order_id = ?
  ORDER BY oi.id ASC
`);

const pendingShiftsStmt = db.prepare(`
  SELECT * FROM shifts WHERE sync_state = 'pending' ORDER BY id ASC LIMIT ?
`);
const pendingExpensesStmt = db.prepare(`
  SELECT * FROM expenses WHERE sync_state = 'pending' ORDER BY id ASC LIMIT ?
`);

const countPending = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM orders   WHERE sync_state = 'pending') AS orders,
    (SELECT COUNT(*) FROM shifts   WHERE sync_state = 'pending') AS shifts,
    (SELECT COUNT(*) FROM expenses WHERE sync_state = 'pending') AS expenses
`);

function markSynced(table, ids) {
  if (!ids.length) return;
  // Built from a checked integer list rather than interpolated text: these ids
  // come back from the network, and better-sqlite3 has no array binding.
  const safe = ids.map(Number).filter(Number.isInteger);
  if (!safe.length) return;
  db.prepare(
    `UPDATE ${table} SET sync_state = 'synced' WHERE id IN (${safe.map(() => '?').join(',')})`
  ).run(...safe);
}

async function postBatch(config, table, rows) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.cloudUrl}/api/ingest/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ table, rows }),
      signal: abort.signal,
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: res.status === 401
        ? 'Cloud rejected this branch key'
        : `Cloud replied ${res.status}` };
    }
    return { ok: true, body: await res.json().catch(() => ({})) };
  } catch (err) {
    return {
      ok: false,
      error: err.name === 'AbortError' ? 'Timed out sending to the cloud' : (err.message || 'Could not reach the cloud'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One pass over everything pending.
 *
 * Shifts go before orders so a shift an order refers to already exists, and
 * expenses last for the same reason. Nothing depends on this — the cloud stores
 * the till's shift id as a plain value rather than a foreign key, precisely so
 * that a batch can never be rejected for arriving out of order — but it keeps
 * the cloud coherent at every moment in between.
 */
async function syncOnce() {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };
  if (state.running) return { skipped: 'already running' };

  /*
   * Nothing pending: return before touching the network.
   *
   * At a 30s cadence a closed shop would otherwise open a connection twice a
   * minute all night to say nothing. This makes an idle pass three indexed
   * counts against the partial sync indexes.
   */
  const pending = countPending.get();
  if (pending.orders + pending.shifts + pending.expenses === 0) {
    return { ok: true, sent: { orders: 0, shifts: 0, expenses: 0 }, idle: true };
  }

  state.running = true;
  state.lastAttemptMs = Date.now();

  const sent = { orders: 0, shifts: 0, expenses: 0 };

  try {
    for (const [table, stmt] of [
      ['shifts', pendingShiftsStmt],
      ['orders', pendingOrdersStmt],
      ['expenses', pendingExpensesStmt],
    ]) {
      // Loop so a large backlog drains over several batches in one pass rather
      // than waiting five minutes per hundred rows.
      for (;;) {
        const rows = stmt.all(BATCH_SIZE);
        if (!rows.length) break;

        const payload = table === 'orders'
          ? rows.map(o => ({ ...o, items: itemsStmt.all(o.id) }))
          : rows;

        const result = await postBatch(config, table, payload);
        if (!result.ok) {
          state.consecutiveFailures += 1;
          state.lastError = result.error;
          return { ok: false, error: result.error, sent };
        }

        // Only now, on a confirmed 200. If the reply were lost the rows stay
        // pending and go again — which the cloud absorbs without duplicating.
        markSynced(table, rows.map(r => r.id));
        sent[table] += rows.length;

        if (rows.length < BATCH_SIZE) break;
      }
    }

    state.lastSuccessMs = Date.now();
    state.consecutiveFailures = 0;
    state.lastError = null;
    return { ok: true, sent };
  } finally {
    state.running = false;
  }
}

/*
 * Staff and stock, pushed whole rather than incrementally.
 *
 * Neither carries a `sync_state`, deliberately. They are small — a handful of
 * accounts, a few dozen ingredients — and they change rarely, so tracking
 * per-row dirtiness would mean touching every write path in staff.js and
 * inventory.js to earn nothing. Sending the lot is a few kilobytes, and the
 * cloud's upsert makes a resend free.
 *
 * The PIN is not selected. It is of no use to the dashboard, and every copy of
 * a credential is another place it can leak from.
 */
const allStaffStmt = db.prepare(
  'SELECT id, name, role, color, active FROM staff'
);
const allIngredientsStmt = db.prepare(
  'SELECT id, name, unit, stock, low_stock_threshold, cost_per_unit FROM ingredients'
);
const allCustomersStmt = db.prepare(`
  SELECT id, name, phone, address, order_count, total_spent, first_order_at, last_order_at
    FROM customers
`);

/** Longer than the sales cadence: these barely change, and a stale stock figure costs nothing. */
const REFERENCE_INTERVAL_MS = 5 * 60 * 1000;

async function pushReference() {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  for (const [table, stmt] of [
    ['staff', allStaffStmt],
    ['ingredients', allIngredientsStmt],
    ['customers', allCustomersStmt],
  ]) {
    const rows = stmt.all();
    if (!rows.length) continue;

    // Chunked to the same cap as everything else, so a long ingredient list
    // cannot produce a request the cloud refuses.
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const result = await postBatch(config, table, rows.slice(i, i + BATCH_SIZE));
      if (!result.ok) {
        state.lastError = result.error;
        return { ok: false, error: result.error };
      }
    }
  }
  return { ok: true };
}

/*
 * Started at most once, and startable later.
 *
 * A till that boots unpaired skips this entirely, so when a pairing code is
 * claimed there are no timers running — the identity file is correct and
 * nothing is using it. That was a real hole: dropping the file in place was
 * documented as needing no restart, and re-reading it does happen, but nothing
 * was reading it because nothing had been scheduled. routes/sync.js calls
 * start() again after pairing, and this guard is what makes that safe.
 */
let started = null;

function start() {
  if (started) return started;
  if (!isSyncEnabled()) return null;

  // On app start: catch up whatever accumulated while the shop was closed or
  // offline. Deliberately not awaited — the backend must finish booting.
  syncOnce().catch(err => { state.lastError = err.message; });

  pushReference().catch(err => { state.lastError = err.message; });

  const timer = setInterval(() => {
    syncOnce().catch(err => { state.lastError = err.message; });
  }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  // Separate timer, and deliberately not gated on the idle short-circuit:
  // staff and stock change without any sale happening, so they would otherwise
  // never reach a quiet shop's dashboard.
  const refTimer = setInterval(() => {
    pushReference().catch(err => { state.lastError = err.message; });
  }, REFERENCE_INTERVAL_MS);
  if (typeof refTimer.unref === 'function') refTimer.unref();

  started = timer;
  return timer;
}

function status() {
  const pending = countPending.get();
  return {
    queue_depth: pending.orders + pending.shifts + pending.expenses,
    pending: pending,
    push_last_success_at: state.lastSuccessMs ? new Date(state.lastSuccessMs).toISOString() : null,
    push_last_error: state.lastError,
    push_consecutive_failures: state.consecutiveFailures,
  };
}

/**
 * Everything, now — sales and reference data.
 *
 * What the "Sync now" button calls. The background timers keep the two on
 * different cadences because their costs differ, but somebody pressing a button
 * means "make the dashboard match this till", and half of that would be a
 * puzzling thing to deliver.
 */
async function syncAll() {
  const sales = await syncOnce();
  if (sales.skipped) return sales;
  const reference = await pushReference();
  if (!reference.ok && sales.ok) return { ...sales, ok: false, error: reference.error };
  return sales;
}

module.exports = { start, syncOnce, syncAll, pushReference, status, BATCH_SIZE };
