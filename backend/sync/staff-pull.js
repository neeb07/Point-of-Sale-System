/**
 * Pulling the staff roster down from the cloud.
 *
 * The same shape as menu-pull.js — a version integer that is nearly free to
 * ask about, then a whole snapshot applied in one transaction — for the same
 * reasons, which are set out there and not repeated here.
 *
 * Two things are specific to staff and worth stating.
 *
 * **It upserts and never deletes.** A row missing from the snapshot means the
 * cloud has not heard about that person yet, not that they have been dismissed.
 * Deleting on absence would wipe a till's own accounts every time a push was
 * behind — and would orphan the orders and shifts already recorded in their
 * name. Ending an account is `active = 0`, which the snapshot carries.
 *
 * **A PIN is only ever replaced by a real one.** Rows the cloud is merely
 * mirroring — accounts that were created at this till in the first place —
 * arrive with no hash. Those update the name, role, colour and active flag and
 * leave the credential exactly as it is. Writing a null over it would leave a
 * member of staff unable to sign in at the till they are standing at, which is
 * the worst failure this file could produce.
 */

const db = require('../db/database');
const { syncConfig } = require('../db/till-identity');

/** As generous as the menu's: a roster is small, but the link may be poor. */
const TIMEOUT_MS = 60 * 1000;

const state = {
  localVersion: null,
  lastAppliedAt: null,
  lastError: null,
};

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

/** Kept in settings, so a restart does not re-apply a roster that has not moved. */
function localVersion() {
  const row = getSetting.get('cloud_staff_version');
  const n = row ? Number(row.value) : 0;
  state.localVersion = Number.isFinite(n) ? n : 0;
  return state.localVersion;
}

async function fetchJson(url, apiKey) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: abort.signal,
    });
    if (!res.ok) {
      throw new Error(res.status === 401
        ? 'Cloud rejected this branch key'
        : `Cloud replied ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const selectByLocalId = db.prepare('SELECT id, pin FROM staff WHERE id = ?');
const insertStaff = db.prepare(`
  INSERT INTO staff (id, name, role, pin, color, active, branch_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const updateStaff = db.prepare(`
  UPDATE staff SET name = ?, role = ?, color = ?, active = ?, branch_id = ? WHERE id = ?
`);
const updatePin = db.prepare('UPDATE staff SET pin = ? WHERE id = ?');
const deleteStaff = db.prepare('DELETE FROM staff WHERE id = ?');

/**
 * Apply a roster.
 *
 * Exported so a test can drive it without a server. One transaction: a
 * half-applied roster — a new manager inserted without their PIN, say — must
 * never reach a till.
 */
function applyStaff(rows, branchId, deletions = []) {
  const result = { inserted: 0, updated: 0, pinsSet: 0, deleted: 0, skipped: [] };

  const apply = db.transaction(() => {
    /*
     * Removals first, so an account re-created under the same number cannot be
     * wiped by a stale tombstone later in the same pass.
     *
     * Only ever from an explicit list. An absence is not a deletion: a row this
     * till created and has not pushed yet is absent too, and inferring from
     * that would wipe the shop's own accounts every time a push fell behind.
     *
     * Safe to remove outright because every order, shift and expense holds the
     * person's name inline, recorded at the time. Nothing points at this row,
     * so last month's report still says who took each sale.
     */
    for (const localId of deletions) {
      const id = Number(localId);
      if (!Number.isFinite(id)) continue;
      // A number that is both deleted and present is the cloud contradicting
      // itself. The living row wins; deleting it would lose a real account.
      if (rows.some(r => Number(r.local_id) === id)) continue;
      if (deleteStaff.run(id).changes) result.deleted += 1;
    }

    for (const row of rows) {
      const localId = Number(row.local_id);
      if (!Number.isFinite(localId)) continue;

      const active = row.active ? 1 : 0;
      const existing = selectByLocalId.get(localId);

      if (existing) {
        updateStaff.run(
          row.name || 'Unnamed',
          row.role || 'Manager',
          row.color || '#DC2626',
          active,
          branchId,
          localId,
        );
        result.updated += 1;
        // Only a real hash, and only when it has actually changed — the UNIQUE
        // index on `pin` would otherwise reject rewriting a row's own value on
        // some SQLite builds, and the write is pointless either way.
        if (row.pin_hash && row.pin_hash !== existing.pin) {
          updatePin.run(row.pin_hash, localId);
          result.pinsSet += 1;
        }
      } else if (row.pin_hash) {
        // The id is written explicitly, from the cloud's own band (10000+).
        // SQLite's AUTOINCREMENT will then continue above it, so a till that
        // was later unpaired and started creating its own staff again would
        // number them from the cloud's band too. Harmless while paired — a
        // paired till refuses staff writes outright, see backend/server.js —
        // and noted here rather than worked around, because the workaround
        // (rewinding sqlite_sequence) risks reissuing a retired id, which is
        // the worse failure.
        insertStaff.run(
          localId,
          row.name || 'Unnamed',
          row.role || 'Manager',
          row.pin_hash,
          row.color || '#DC2626',
          active,
          branchId,
        );
        result.inserted += 1;
      } else {
        // A new account with no credential cannot sign in, and the till's own
        // `pin` column will not accept null. Recorded rather than dropped
        // silently, because it means something upstream is wrong.
        result.skipped.push(`${row.name || localId}: no PIN in the snapshot`);
      }
    }
  });

  apply();
  return result;
}

/**
 * Pull and apply, if the cloud has something newer.
 *
 * `cloudVersion` comes free with the heartbeat response, so the ordinary path
 * costs no request at all.
 */
async function pullIfNewer(cloudVersion = null) {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  try {
    let remote = cloudVersion;
    if (remote == null) {
      const v = await fetchJson(`${config.cloudUrl}/api/staff/version`, config.apiKey);
      remote = Number(v.version);
    }

    const local = localVersion();
    if (!Number.isFinite(remote) || remote <= local) {
      return { ok: true, upToDate: true, version: local };
    }

    const snapshot = await fetchJson(`${config.cloudUrl}/api/staff/snapshot`, config.apiKey);
    if (!Array.isArray(snapshot.staff)) {
      throw new Error('Cloud returned no staff list');
    }
    if (!snapshot.staff.length) {
      // An empty roster would be applied as nothing at all — harmless, since
      // this never deletes — but it means the cloud has lost this branch's
      // staff, and recording the version would stop us ever asking again.
      throw new Error('Cloud returned an empty roster — refusing to record it as current');
    }

    // The branch the cloud says these people belong to, not the one this till
    // believes it is: the snapshot is already scoped by the presented key, so
    // this is the authoritative answer to the same question.
    const branchId = Number(snapshot.branch_id) || config.branchId || null;
    const result = applyStaff(
      snapshot.staff, branchId,
      Array.isArray(snapshot.deleted) ? snapshot.deleted : []);

    // Recorded only after the transaction committed, so a crash mid-apply
    // leaves the old version and the next attempt downloads again.
    setSetting.run('cloud_staff_version', String(snapshot.version ?? remote));
    state.localVersion = Number(snapshot.version ?? remote);
    state.lastAppliedAt = Date.now();
    state.lastError = null;

    console.log(
      `Staff updated from the cloud: version ${state.localVersion}, ` +
      `${result.inserted} added, ${result.updated} changed, ` +
      `${result.pinsSet} PIN(s) set, ${result.deleted} removed.`
    );
    result.skipped.forEach(s => console.warn('  staff skipped — ' + s));

    return { ok: true, applied: true, version: state.localVersion, ...result };
  } catch (err) {
    state.lastError = err.message;
    // Never fatal. A till that cannot reach the cloud keeps the roster it has,
    // and everybody who could sign in a minute ago still can.
    return { ok: false, error: err.message };
  }
}

function status() {
  return {
    staff_version: localVersion(),
    staff_last_applied_at: state.lastAppliedAt ? new Date(state.lastAppliedAt).toISOString() : null,
    staff_last_error: state.lastError,
  };
}

module.exports = { pullIfNewer, localVersion, applyStaff, status };
