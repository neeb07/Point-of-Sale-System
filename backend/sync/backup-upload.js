/**
 * Sending a backup off the machine.
 *
 * The local backups in db/backup.js sit in the same folder as the database, on
 * the same disk, inside the same PC. They protect against a bad restore or
 * somebody deleting the wrong thing. They protect against nothing that happens
 * to the machine itself — a dead SSD, a theft, a flood, a PSU that takes the
 * drive with it — which is the failure the shop actually asked about.
 *
 * So a copy leaves the building. Gzipped, because a SQLite file is mostly
 * repetitive text and compresses to a fraction of its size, which makes this
 * affordable on a shop connection that is often poor.
 *
 * **Only when it has changed.** The hash of the file is compared against the
 * last one accepted, so a quiet afternoon costs nothing at all. That is what
 * makes a half-hourly schedule reasonable rather than wasteful.
 *
 * **Never in the sale path, never blocking, never fatal.** A till that cannot
 * reach the cloud keeps trading and keeps its local backups; the upload simply
 * catches up when the line returns. Nothing in here can stop a sale.
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const backup = require('../db/backup');
const { syncConfig } = require('../db/till-identity');

/**
 * Half-hourly.
 *
 * This is the number that decides how much of the till's own history a
 * replacement machine would be missing, so it is deliberately short. The
 * sales themselves are a separate channel that goes up every 30 seconds, so
 * no *takings* are at risk either way — this interval only bounds how far
 * behind a restored till's local copy would be.
 */
const INTERVAL_MS = 30 * 60 * 1000;

/** Generous: a backup is the one thing worth waiting on a bad line for. */
const TIMEOUT_MS = 2 * 60 * 1000;

/** Well above a realistic shop database, low enough to catch something wrong. */
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const state = {
  lastUploadedSha: null,
  lastUploadAt: null,
  lastAttemptAt: null,
  lastError: null,
  consecutiveFailures: 0,
  lastSkipped: null,
};

async function uploadOnce({ force = false, reason = 'scheduled' } = {}) {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  state.lastAttemptAt = Date.now();

  try {
    // Take a fresh one rather than shipping whatever is on disk: the whole
    // point is that the copy in the cloud is current.
    const taken = backup.takeBackup(reason);
    if (!taken.ok) throw new Error(taken.error);

    if (!force && taken.sha256 === state.lastUploadedSha) {
      state.lastSkipped = 'unchanged';
      return { ok: true, skipped: 'unchanged', sha256: taken.sha256 };
    }

    const raw = fs.readFileSync(taken.path);
    const gz = zlib.gzipSync(raw, { level: 9 });

    if (gz.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `backup is ${(gz.length / 1048576).toFixed(1)} MB compressed, above the ${MAX_UPLOAD_BYTES / 1048576} MB limit`);
    }

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${config.cloudUrl}/api/backup/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/gzip',
          // Everything the cloud needs to describe this backup without opening
          // it. Sent as headers so the body stays a single clean blob.
          'X-Backup-Sha256': taken.sha256,
          'X-Backup-Raw-Bytes': String(raw.length),
          'X-Backup-Orders': String(taken.orders),
          'X-Backup-Last-Order-At': taken.last_order_at || '',
          'X-Backup-Taken-At': taken.taken_at,
          'X-Backup-Reason': reason,
        },
        body: gz,
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      throw new Error(res.status === 401
        ? 'Cloud rejected this branch key'
        : `Cloud replied ${res.status}`);
    }

    const body = await res.json().catch(() => ({}));

    // Only now. If the cloud did not confirm, the next run must try again
    // rather than believe a backup it never stored — the same rule the sales
    // push follows.
    state.lastUploadedSha = taken.sha256;
    state.lastUploadAt = Date.now();
    state.lastError = null;
    state.consecutiveFailures = 0;
    state.lastSkipped = null;

    console.log(
      `Backup sent to the cloud: ${(gz.length / 1024).toFixed(0)} KB compressed ` +
      `from ${(raw.length / 1024).toFixed(0)} KB, ${taken.orders} orders.`
    );
    return { ok: true, uploaded: true, bytes: gz.length, ...body };
  } catch (err) {
    state.lastError = err.message;
    state.consecutiveFailures += 1;
    // Deliberately not thrown. The shop keeps selling and keeps its local
    // backups; this is reported through /api/sync/status instead.
    return { ok: false, error: err.message };
  }
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
  const config = syncConfig();
  if (!config) return null;

  const tick = () => {
    uploadOnce().catch((err) => { state.lastError = err.message; });
  };

  // Not at startup: db/backup.js has just taken one, and a machine that is
  // restarted repeatedly should not upload each time. First run is one
  // interval in.
  const timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  started = timer;
  return timer;
}

function status() {
  return {
    ...backup.status(),
    cloud_backup_last_at: state.lastUploadAt ? new Date(state.lastUploadAt).toISOString() : null,
    cloud_backup_last_error: state.lastError,
    cloud_backup_failures: state.consecutiveFailures,
    cloud_backup_interval_ms: INTERVAL_MS,
  };
}

module.exports = { uploadOnce, start, status };
