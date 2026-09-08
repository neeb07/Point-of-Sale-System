/**
 * Cloud pairing status.
 *
 * The till talks to the cloud from a background agent, which by design says
 * nothing to anyone while it works. That is fine until it stops working, at
 * which point "is this branch reporting?" becomes a phone call unless the owner
 * can see the answer on screen. This route is that answer.
 *
 * It deliberately never returns the API key. `publicStatus()` in
 * db/till-identity.js builds its result from named fields rather than spreading
 * the identity object, so a key cannot leak here even by accident.
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { publicStatus, writeIdentity, syncConfig } = require('../db/till-identity');
const heartbeat = require('../sync/heartbeat');
const { isAdminRole } = require('../middleware/auth');
const push = require('../sync/push');

/**
 * Pair this machine to a branch, with a code from the dashboard.
 *
 * The alternative was telling a restaurant manager to open AppData and hand-
 * write a JSON file containing a 64-character key. This does the same thing
 * from a form: the till exchanges a short code for the real credential over
 * HTTPS and writes the file itself, so nobody on site ever sees the key or
 * learns that the file exists.
 *
 * Administrator only. A freshly installed till has exactly one account — the
 * seeded Admin — so whoever is setting the machine up can reach this, and a
 * manager at a working till cannot quietly move it to another branch.
 */
router.post('/pair', async (req, res) => {
  if (!isAdminRole(req.user && req.user.role)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  const cloudUrl = String((req.body && req.body.cloud_url) || '').trim().replace(/\/+$/, '');
  const code = String((req.body && req.body.code) || '').trim();

  if (!/^https?:\/\//i.test(cloudUrl)) {
    return res.status(400).json({ error: 'The cloud address should start with https://' });
  }
  if (!code) return res.status(400).json({ error: 'Enter the pairing code from the dashboard.' });

  /*
   * Refuse to move a till that is still holding sales.
   *
   * Orders are stamped with their branch when they are rung up and pushed
   * under whatever key the till holds at the time. Re-pairing to a *different*
   * branch in between would send this branch's unsent sales up under the other
   * branch's key, and the cloud files a batch under the key that presented it —
   * so the takings would land in the wrong shop, silently and irreversibly.
   *
   * Pairing to the same branch again is fine, and so is a till with nothing
   * pending, which is every fresh install.
   */
  const pending = db.prepare(`
    SELECT (SELECT COUNT(*) FROM orders   WHERE sync_state = 'pending')
         + (SELECT COUNT(*) FROM shifts   WHERE sync_state = 'pending')
         + (SELECT COUNT(*) FROM expenses WHERE sync_state = 'pending') AS n
  `).get().n;

  const current = syncConfig();

  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30000);
    let response;
    try {
      response = await fetch(`${cloudUrl}/api/pairing/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Passed through as the cloud worded it — "already used" and "too many
      // attempts" are both things the person at the till needs to read.
      return res.status(response.status).json({
        error: body.error || `The cloud replied ${response.status}.`,
        code: body.code || null,
      });
    }

    if (pending > 0 && current && Number(current.branchId) !== Number(body.branch_id)) {
      /*
       * The code is already spent by this point, which is unfortunate but the
       * safe order: the alternative is asking the cloud which branch a code is
       * for before claiming it, which would let anyone enumerate codes. The
       * owner issues another one; nothing is lost but a minute.
       */
      return res.status(409).json({
        error:
          `This till still has ${pending} unsent ${pending === 1 ? 'record' : 'records'} for ` +
          `${current.branchName || 'its current branch'}. Sync them first — they would be filed ` +
          `under ${body.branch_name} otherwise. Use Sync now, then pair again with a fresh code.`,
        code: 'UNSYNCED_RECORDS',
      });
    }

    const status = writeIdentity({
      enabled: true,
      cloud_url: cloudUrl,
      branch_id: body.branch_id,
      branch_name: body.branch_name,
      api_key: body.api_key,
    });

    /*
     * Start the agents now.
     *
     * The reason this line exists: on a till that booted unpaired, none of
     * these were ever scheduled — each start() returns early when there is no
     * identity file. Re-reading the file on change was already handled, but
     * nothing was reading it. They are idempotent, so calling them again on an
     * already-running till is a no-op.
     */
    require('../sync/heartbeat').start();
    require('../sync/push').start();
    require('../sync/backup-upload').start();

    console.log(`Paired: this till now reports as ${body.branch_name} (branch ${body.branch_id}).`);
    res.json({ success: true, ...status });
  } catch (err) {
    const unreachable = err.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONNREFUSED/i.test(err.message);
    res.status(unreachable ? 502 : 500).json({
      error: unreachable
        ? `Could not reach ${cloudUrl}. Check this machine is online and the address is right.`
        : err.message,
    });
  }
});

/**
 * Where this till thinks it is and whether it is paired.
 *
 * Admin-only (enforced at the mount in server.js). A manager has no use for it
 * and it names the branch this machine reports as, which is configuration
 * rather than till work.
 */
router.get('/status', (req, res) => {
  // The full picture — cloud URL, branch identity, pairing — is configuration,
  // so it stays with the administrator.
  if (!isAdminRole(req.user && req.user.role)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  try {
    res.json({
      ...publicStatus(),
      ...heartbeat.status(),
      ...push.status(),
      // When this till last managed to get a copy of itself off the machine.
      // A backup nobody checks is a guess, so it is reported beside the sync
      // state rather than left to be discovered on the day it is needed.
      ...require('../sync/backup-upload').status(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Push everything pending, now.
 *
 * The "Sync now" button, and open to both roles on purpose: when the internet
 * comes back it is the manager standing at the till, not the owner, and making
 * them wait up to thirty seconds for the timer — or telephone the owner — is
 * the kind of friction that gets a feature quietly abandoned.
 *
 * Safe to expose: it sends this branch's own already-recorded data to the
 * cloud, reads nothing back, and is idempotent, so the worst a manager can do
 * by pressing it repeatedly is nothing at all.
 *
 * Awaited, so the caller learns what actually happened rather than "started".
 */
router.post('/now', async (req, res) => {
  try {
    const result = await push.syncAll();
    const s = push.status();
    res.json({
      ...result,
      queue_depth: s.queue_depth,
      pending: s.pending,
      last_error: s.push_last_error,
      // Enough for the button to say something true, without handing a manager
      // the branch key or the cloud address.
      synced_at: s.push_last_success_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
