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

/** Routine catch-up. The real triggers are app start and shift close; this is the safety net. */
const INTERVAL_MS = 5 * 60 * 1000;

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

function start() {
  if (!isSyncEnabled()) return null;

  // On app start: catch up whatever accumulated while the shop was closed or
  // offline. Deliberately not awaited — the backend must finish booting.
  syncOnce().catch(err => { state.lastError = err.message; });

  const timer = setInterval(() => {
    syncOnce().catch(err => { state.lastError = err.message; });
  }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
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

module.exports = { start, syncOnce, status, BATCH_SIZE };
