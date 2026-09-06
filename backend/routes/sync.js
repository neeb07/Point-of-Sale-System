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

/**
 * Where this till thinks it is and whether it is paired.
 *
 * Admin-only (enforced at the mount in server.js). A manager has no use for it
 * and it names the branch this machine reports as, which is configuration
 * rather than till work.
 */
router.get('/status', (req, res) => {
  try {
    res.json({
      ...publicStatus(),
      // Populated once the sync agent exists; present now so the Settings
      // screen can be built against the final shape.
      last_success_at: null,
      last_error: null,
      queue_depth: 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
