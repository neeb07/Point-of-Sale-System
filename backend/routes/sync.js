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
const { publicStatus } = require('../db/till-identity');
const heartbeat = require('../sync/heartbeat');
const { isAdminRole } = require('../middleware/auth');
const push = require('../sync/push');

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
    const result = await push.syncOnce();
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
