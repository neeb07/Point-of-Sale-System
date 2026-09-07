/**
 * Pulling the menu down from the cloud.
 *
 * The only thing in this system that travels downward. It works because the
 * cloud is the menu's single writer — the owner edits there, tills only read —
 * so there are no conflicting versions to reconcile.
 *
 * Three properties make this survivable on a link that fails:
 *
 * **The check is nearly free.** A till asks for one integer, and only downloads
 * a menu when that integer has moved. The common case costs a few bytes, so it
 * can be asked constantly even on a bad connection.
 *
 * **Whole snapshots, never diffs.** Diffs must arrive in order and in full; a
 * snapshot either applies or it does not, and missing three of them is exactly
 * the same as missing one. On a link that drops mid-download that difference is
 * the whole game.
 *
 * **All or nothing.** `applyMenu()` runs in a single transaction, so a
 * half-downloaded menu — deals pointing at items that were never inserted — can
 * never reach a till. If the download fails the shop keeps selling from the
 * menu it already has, which is the correct behaviour and needs no special case.
 */

const db = require('../db/database');
const { applyMenu } = require('../db/apply-menu');
const { syncConfig } = require('../db/till-identity');

/** Longer than the sales timeout: a menu is bigger, and worth waiting for. */
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

/**
 * The version this till last applied.
 *
 * Kept in settings rather than in memory so it survives a restart — otherwise
 * every launch would re-download and re-apply a menu that has not changed,
 * retiring and re-inserting every item for nothing.
 */
function localVersion() {
  const row = getSetting.get('cloud_menu_version');
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
    if (!res.ok) throw new Error(res.status === 401 ? 'Cloud rejected this branch key' : `Cloud replied ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull and apply, if the cloud has something newer.
 *
 * `cloudVersion` may be supplied by the caller — the heartbeat response already
 * carries it, so the ordinary path costs no extra request at all.
 */
async function pullIfNewer(cloudVersion = null) {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  try {
    let remote = cloudVersion;
    if (remote == null) {
      const v = await fetchJson(`${config.cloudUrl}/api/menu/version`, config.apiKey);
      remote = Number(v.version);
    }

    const local = localVersion();
    if (!Number.isFinite(remote) || remote <= local) {
      return { ok: true, upToDate: true, version: local };
    }

    const snapshot = await fetchJson(`${config.cloudUrl}/api/menu/snapshot`, config.apiKey);
    if (!Array.isArray(snapshot.MENU) || !snapshot.MENU.length) {
      // An empty menu would retire everything the shop sells. Refuse it: far
      // likelier to be a mistake upstream than a shop with nothing on the menu.
      throw new Error('Cloud returned an empty menu — refusing to apply it');
    }

    // One transaction, inside applyMenu: retire the outgoing items and deals
    // rather than deleting them, so past orders keep their categories.
    const result = applyMenu(db, snapshot.MENU, snapshot.DEALS || [], { replace: true });

    // Recorded only after the apply committed. If the process died mid-way the
    // transaction rolled back and this still holds the old version, so the next
    // attempt downloads again rather than believing a menu it never installed.
    setSetting.run('cloud_menu_version', String(snapshot.version ?? remote));
    state.localVersion = Number(snapshot.version ?? remote);
    state.lastAppliedAt = Date.now();
    state.lastError = null;

    console.log(
      `Menu updated from the cloud: version ${state.localVersion}, ` +
      `${result.itemsAdded} items and ${result.dealsAdded} deals ` +
      `(retired ${result.retiredItems} and ${result.retiredDeals}).`
    );
    if (result.warnings.length) {
      result.warnings.forEach(w => console.warn('  menu warning: ' + w));
    }

    return { ok: true, applied: true, version: state.localVersion, ...result };
  } catch (err) {
    state.lastError = err.message;
    // Never fatal. A till that cannot reach the cloud keeps selling from the
    // menu it has, which is the entire point of being offline-first.
    return { ok: false, error: err.message };
  }
}

function status() {
  return {
    menu_version: localVersion(),
    menu_last_applied_at: state.lastAppliedAt ? new Date(state.lastAppliedAt).toISOString() : null,
    menu_last_error: state.lastError,
  };
}

module.exports = { pullIfNewer, localVersion, status };
