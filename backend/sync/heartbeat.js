/**
 * The heartbeat: this till telling the cloud how it is doing.
 *
 * A small snapshot of every open drawer, pushed every 30 seconds. Three rules
 * govern this file, and all three exist because the branches' internet is bad.
 *
 * **1. Never touch the sale path.** No order, shift or expense may ever wait on
 * this. The agent reads the database on its own timer, in its own callback, and
 * swallows every failure into a log line. A shop with no internet sells exactly
 * as it does today.
 *
 * **2. Lossy on purpose.** A failed push is dropped, never queued. By the time
 * it could be redelivered a fresher snapshot exists, and delivering a stale
 * drawer figure late is worse than delivering nothing. This is the opposite
 * contract to the sales sync, which must never lose a row — and keeping the two
 * apart is what lets the dashboard stay live while a sales backlog drains.
 *
 * **3. Small enough to get through.** The payload is a few hundred bytes, so it
 * succeeds on a link far too weak to move a day's orders.
 *
 * The figures come from db/shift-totals.js — the same code that draws the local
 * Shift screen. If the agent did its own arithmetic the two would eventually
 * disagree, and the owner would be right to trust neither.
 */

const db = require('../db/database');
const { allOpenShifts } = require('../db/shift-totals');
const { syncConfig, isSyncEnabled } = require('../db/till-identity');
const { localToday } = require('../db/local-date');
const menuPull = require('./menu-pull');
const settingsPull = require('./settings-pull');
const staffPull = require('./staff-pull');

/** Matches the cloud's freshness bands, which assume three beats of slack. */
const INTERVAL_MS = 30 * 1000;

/**
 * How long to wait before giving up on a push.
 *
 * Shorter than the interval, deliberately: a request still hanging when the
 * next tick arrives is already worthless, and without a timeout a connection
 * that is accepted but never answered would hang forever. That is the failure
 * mode that quietly kills naive clients on a flaky link.
 */
const TIMEOUT_MS = 8 * 1000;

/** Reported through /api/sync/status so pairing is diagnosable without a phone call. */
const state = {
  startedMs: Date.now(),
  lastAttemptMs: null,
  lastSuccessMs: null,
  lastError: null,
  consecutiveFailures: 0,
  clockSkewMs: null,
};

const expensesTodayStmt = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total,
         COUNT(*)                 AS count,
         COALESCE(SUM(CASE WHEN from_drawer = 1 THEN amount ELSE 0 END), 0) AS from_drawer_total
    FROM expenses
   WHERE DATE(created_at) = DATE(?)
`);

/**
 * What this till looks like right now.
 *
 * Several drawers can be open at once — the shifts are per person, and two
 * managers can be trading together — so the totals are summed across all of
 * them and every name is listed. In practice there is one; getting the plural
 * case wrong would silently under-report a branch's takings.
 */
function buildSnapshot() {
  const open = allOpenShifts();
  const expenses = expensesTodayStmt.get(localToday());
  const nowMs = Date.now();

  const base = {
    // Local wall-clock for display ("as of 14:32"), epoch for arithmetic.
    // Only the epoch is ever used to decide freshness.
    sent_at: new Date(nowMs - new Date().getTimezoneOffset() * 60000)
      .toISOString().replace('T', ' ').slice(0, 19),
    sent_at_ms: nowMs,
    agent_started_ms: state.startedMs,
    // Tells the cloud which menu this till is selling from, so a branch running
    // an old one is visible on the dashboard rather than a silent surprise.
    menu_version: menuPull.localVersion(),
    settings_version: settingsPull.localVersion(),
    staff_version: staffPull.localVersion(),
    expenses_today: {
      total: Number(expenses.total) || 0,
      count: Number(expenses.count) || 0,
      from_drawer_total: Number(expenses.from_drawer_total) || 0,
    },
  };

  if (!open.length) {
    // Distinct from "offline": the till is running and reporting, there is
    // simply nobody on the drawer. The dashboard must show these differently.
    return { ...base, state: 'no_open_shift', shift: null };
  }

  const sum = (field) => open.reduce((t, s) => t + (Number(s[field]) || 0), 0);
  const primary = open[0]; // earliest opened — the main drawer

  return {
    ...base,
    state: 'shift_open',
    open_shift_count: open.length,
    shift: {
      local_id: primary.id,
      staff_name: open.map(s => s.staff_name).filter(Boolean).join(', ') || 'Unknown',
      opened_at: primary.opened_at,
      opening_cash: sum('opening_cash'),
      total_orders: sum('total_orders'),
      total_revenue: sum('total_revenue'),
      cash_revenue: sum('cash_revenue'),
      non_cash_revenue: sum('non_cash_revenue'),
      drawer_expenses: sum('drawer_expenses'),
      expense_count: sum('expense_count'),
      expected_cash: sum('expected_cash'),
    },
  };
}

async function pushOnce() {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  state.lastAttemptMs = Date.now();

  // AbortController rather than a bare fetch: a connection that is accepted and
  // then never answered is the mode that hangs a client indefinitely, and on a
  // fluctuating link it is common rather than exotic.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const snapshot = buildSnapshot();
    const res = await fetch(`${config.cloudUrl}/api/live/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(snapshot),
      signal: abort.signal,
    });

    if (!res.ok) {
      // A 401 means the key is wrong or revoked. Worth distinguishing, because
      // it is the one failure that retrying will never fix.
      state.consecutiveFailures += 1;
      state.lastError = res.status === 401
        ? 'Cloud rejected this branch key'
        : `Cloud replied ${res.status}`;
      return { ok: false, status: res.status };
    }

    const body = await res.json().catch(() => ({}));
    state.lastSuccessMs = Date.now();
    state.consecutiveFailures = 0;
    state.lastError = null;
    if (typeof body.server_time_ms === 'number') {
      state.clockSkewMs = body.server_time_ms - snapshot.sent_at_ms;
    }

    /*
     * The heartbeat response doubles as the menu downlink.
     *
     * The cloud returns its menu version on every beat, so the ordinary
     * "nothing has changed" case costs no request at all — the answer is
     * already in a reply the till was making anyway. Only a difference triggers
     * a download.
     *
     * Not awaited: a menu download must never delay the next heartbeat, and it
     * has its own error handling. Failing here simply leaves the till on the
     * menu it has.
     */
    if (typeof body.menu_version === 'number') {
      menuPull.pullIfNewer(body.menu_version).catch(() => { /* reported in its own status */ });
    }
    if (typeof body.settings_version === 'number') {
      settingsPull.pullIfNewer(body.settings_version).catch(() => { /* likewise */ });
    }
    if (typeof body.staff_version === 'number') {
      staffPull.pullIfNewer(body.staff_version).catch(() => { /* likewise */ });
    }

    return { ok: true, superseded: Boolean(body.superseded) };
  } catch (err) {
    state.consecutiveFailures += 1;
    state.lastError = err.name === 'AbortError'
      ? 'Timed out reaching the cloud'
      : (err.message || 'Could not reach the cloud');
    return { ok: false, error: state.lastError };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the timer.
 *
 * `.unref()`'d, following db/database.js: the server is held open by its
 * listening socket, and a maintenance script that happens to require this
 * module must still be able to exit.
 */
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
  if (!isSyncEnabled()) {
    console.log('Cloud sync: not paired (no cloud-sync.json) — running offline.');
    return null;
  }

  const config = syncConfig();
  console.log(`Cloud sync: reporting as branch ${config.branchId} to ${config.cloudUrl}`);

  const tick = () => {
    pushOnce().catch(err => {
      // Belt and braces: pushOnce already swallows everything, but an unhandled
      // rejection here would take the whole till's backend down with it.
      state.lastError = err.message;
    });
  };

  tick();
  const timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  started = timer;
  return timer;
}

/** For /api/sync/status. Never returns anything derived from the key. */
function status() {
  return {
    last_success_at: state.lastSuccessMs ? new Date(state.lastSuccessMs).toISOString() : null,
    last_attempt_at: state.lastAttemptMs ? new Date(state.lastAttemptMs).toISOString() : null,
    last_error: state.lastError,
    consecutive_failures: state.consecutiveFailures,
    clock_skew_ms: state.clockSkewMs,
    interval_ms: INTERVAL_MS,
    ...menuPull.status(),
    ...settingsPull.status(),
    ...staffPull.status(),
  };
}

module.exports = { start, pushOnce, buildSnapshot, status, INTERVAL_MS };
