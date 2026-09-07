/**
 * Pulling shop-wide settings down from the cloud.
 *
 * The same shape as the menu pull next door — a version integer read from the
 * heartbeat response, a snapshot fetched only when it moves — and for the same
 * reason: the check has to be affordable on a bad link, and the apply has to be
 * all-or-nothing.
 *
 * **The allow-list is the important part.** The settings table is a flat
 * key/value store shared by shop-wide values and branch-owned ones. Applying a
 * snapshot wholesale would give both branches the same printed address, the
 * same delivery charge and the same receipt footer — quietly, and only
 * noticeably on a printed receipt. So only keys the cloud is known to own are
 * written; everything else on the till is left exactly as it is.
 *
 * The cloud filters too, so this is the second of two locks on the same door.
 * That is deliberate: a mistake upstream should not be able to overwrite a
 * branch's own configuration.
 */

const db = require('../db/database');
const { syncConfig } = require('../db/till-identity');

const TIMEOUT_MS = 20 * 1000;

/**
 * Settings the cloud owns.
 *
 * Must match cloud/routes/settings.js. Kept as an explicit list rather than
 * "everything the cloud sent", so a new branch-owned key added to the till
 * later cannot start being overwritten because somebody forgot.
 */
const CLOUD_OWNED = new Set([
  'restaurant_name',
  'restaurant_tagline',
  'tax_rate',
  'employee_discount_rate',
  'currency_symbol',
  'currency_position',
]);

const state = { lastAppliedAt: null, lastError: null };

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

/** The version this till last applied; kept in settings so it survives a restart. */
function localVersion() {
  const row = getSetting.get('cloud_settings_version');
  const n = row ? Number(row.value) : 0;
  return Number.isFinite(n) ? n : 0;
}

async function pullIfNewer(cloudVersion = null) {
  const config = syncConfig();
  if (!config) return { skipped: 'not paired' };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const local = localVersion();
    if (cloudVersion != null && Number(cloudVersion) <= local) {
      return { ok: true, upToDate: true, version: local };
    }

    const res = await fetch(`${config.cloudUrl}/api/settings/snapshot`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(res.status === 401 ? 'Cloud rejected this branch key' : `Cloud replied ${res.status}`);

    const snapshot = await res.json();
    const remote = Number(snapshot.version);
    if (!Number.isFinite(remote) || remote <= local) {
      return { ok: true, upToDate: true, version: local };
    }

    const incoming = snapshot.settings || {};
    const applied = [];

    // One transaction: a half-applied settings change — a new tax rate without
    // the currency it was priced in — should never be what a till sells on.
    db.transaction(() => {
      for (const [key, value] of Object.entries(incoming)) {
        if (!CLOUD_OWNED.has(key)) continue;   // the branch's own; leave it alone
        setSetting.run(key, String(value));
        applied.push(key);
      }
      setSetting.run('cloud_settings_version', String(remote));
    })();

    state.lastAppliedAt = Date.now();
    state.lastError = null;
    if (applied.length) {
      console.log(`Settings updated from the cloud: version ${remote} (${applied.join(', ')}).`);
    }
    return { ok: true, applied: true, version: remote, keys: applied };
  } catch (err) {
    state.lastError = err.message;
    // Never fatal: a till that cannot reach the cloud keeps its own settings.
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function status() {
  return {
    settings_version: localVersion(),
    settings_last_applied_at: state.lastAppliedAt ? new Date(state.lastAppliedAt).toISOString() : null,
    settings_last_error: state.lastError,
  };
}

module.exports = { pullIfNewer, localVersion, status, CLOUD_OWNED };
