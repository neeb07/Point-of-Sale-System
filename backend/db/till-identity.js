/**
 * Which till this machine is, and how it reaches the cloud.
 *
 * Two problems solved by one file.
 *
 * **1. The machine has no identity.** Until now a branch could only be derived
 * from `staff.branch_id` — the branch of whoever happened to be signed in. That
 * is a guess, and a bad one in the two cases that matter: the owner's account
 * belongs to no branch at all, so a shift they open is attributed nowhere; and
 * a manager covering a shift at the other site would file that site's takings
 * under their own branch. A till standing in E-18 is in E-18 regardless of who
 * is holding the PIN.
 *
 * **2. The cloud API key needs somewhere safe.** Not the settings table:
 * `GET /api/settings` is deliberately unauthenticated so the sign-in screen can
 * draw the shop's branding before anyone logs in (see server.js), which would
 * leave the key readable by any unauthenticated caller on this machine.
 *
 * So both live in a JSON file beside the database, in Electron's userData
 * directory, which no route serves:
 *
 *   {
 *     "enabled": true,
 *     "cloud_url": "https://blaze.virtiqosolutions.com",
 *     "branch_id": 1,
 *     "branch_name": "E-18 Branch",
 *     "api_key": "<64 hex chars>"
 *   }
 *
 * Being in userData rather than the app bundle means it survives a POS upgrade
 * or reinstall, so updating the software never silently unpairs a branch.
 *
 * On the threat model: anyone who can read this file can already read
 * `pos_database.db` from the same folder — the shop's entire trading history.
 * Equal protection is the honest answer here; pretending a local file could be
 * meaningfully more secret than the database next to it would be theatre. What
 * this does buy is that the key is not reachable *through the API*, which is
 * the actual exposure.
 */

const fs = require('fs');
const path = require('path');

const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname, '..');
const IDENTITY_PATH = path.join(userDataDir, 'cloud-sync.json');

/*
 * Re-read when the file changes, rather than once at startup.
 *
 * Pairing a till by dropping this file next to the database should not require
 * restarting the POS. In a shop that means closing the app mid-service; during
 * setup it means a confusing loop where the file is plainly correct and the
 * till keeps insisting the key is wrong, because it is still holding the one it
 * read at boot. Re-keying a branch has the same problem.
 *
 * Guarded by the file's modification time, so the common case — an unchanged
 * file, read at most twice a minute — is a single `stat` and no parsing.
 */
let cached = null;
let cachedMtimeMs = -1;

function load() {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(IDENTITY_PATH).mtimeMs;
  } catch (err) {
    // Absent is not an error: an unpaired till is the normal state of a
    // single-shop install, and it must keep selling exactly as before.
    cached = null;
    cachedMtimeMs = -1;
    return null;
  }

  if (mtimeMs === cachedMtimeMs) return cached;

  try {
    const parsed = JSON.parse(fs.readFileSync(IDENTITY_PATH, 'utf8'));
    cached = parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    // Deliberately not fatal, and deliberately does not print the file's
    // contents — everything this backend logs is piped to a file on disk.
    console.error('Could not read cloud-sync.json:', err.message);
    cached = null;
  }

  cachedMtimeMs = mtimeMs;
  return cached;
}

/** This machine's branch, or null when the till has not been paired. */
function tillBranchId() {
  const identity = load();
  const id = identity && Number(identity.branch_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Whether this till should talk to the cloud at all. */
function isSyncEnabled() {
  const identity = load();
  return Boolean(
    identity && identity.enabled && identity.cloud_url && identity.api_key && tillBranchId()
  );
}

/**
 * Everything the sync agent needs, key included.
 *
 * For the agent only. Nothing that answers an HTTP request may call this —
 * use `publicStatus()` instead, which cannot leak the key by accident.
 */
function syncConfig() {
  if (!isSyncEnabled()) return null;
  const identity = load();
  return {
    cloudUrl: String(identity.cloud_url).replace(/\/+$/, ''),
    apiKey: String(identity.api_key),
    branchId: tillBranchId(),
    branchName: identity.branch_name || null,
  };
}

/**
 * What the Settings screen may show about pairing.
 *
 * Shaped so the API key cannot be returned even by mistake: this builds a new
 * object from named fields rather than spreading the identity and deleting.
 */
function publicStatus() {
  const identity = load();
  return {
    paired: Boolean(identity),
    enabled: isSyncEnabled(),
    branch_id: tillBranchId(),
    branch_name: (identity && identity.branch_name) || null,
    cloud_url: (identity && identity.cloud_url) || null,
    key_present: Boolean(identity && identity.api_key),
    identity_path: IDENTITY_PATH,
  };
}

/**
 * Write the identity file — the last step of pairing.
 *
 * Written to a temporary name and renamed into place, because a machine that
 * loses power halfway through must not be left holding half a credential: the
 * old file would be gone and the new one unreadable, and the shop would be
 * unpaired with nothing on screen to say why. A rename within a directory is
 * atomic.
 *
 * The cache is invalidated by mtime, so the next read picks this up on its own
 * — but starting the sync timers is a separate job, because they were never
 * started on a till that booted unpaired. See routes/sync.js.
 */
function writeIdentity(config) {
  const payload = {
    enabled: config.enabled !== false,
    cloud_url: String(config.cloud_url).replace(/\/+$/, ''),
    branch_id: Number(config.branch_id),
    branch_name: config.branch_name || null,
    api_key: String(config.api_key),
  };

  if (!payload.cloud_url || !Number.isFinite(payload.branch_id) || !payload.api_key) {
    throw new Error('Refusing to write an incomplete pairing file');
  }

  const staging = `${IDENTITY_PATH}.writing`;
  fs.writeFileSync(staging, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(staging, IDENTITY_PATH);

  // Force the next read to go to disk rather than trust a cache that predates
  // this write by microseconds — mtime resolution is coarse enough on some
  // filesystems that an immediate re-read could otherwise miss it.
  cachedMtimeMs = -1;
  cached = null;

  return publicStatus();
}

module.exports = {
  tillBranchId, isSyncEnabled, syncConfig, publicStatus, writeIdentity, load, IDENTITY_PATH,
};
