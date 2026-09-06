/**
 * Branches.
 *
 * Read-only to every signed-in account: the till needs the list to label its
 * own site, and the Staff screen needs it to place a new manager. Creating and
 * renaming branches is deliberately not exposed — the shop has two, and an
 * accidental third would silently split a day's reporting in half.
 */
const express = require('express');
const router = express.Router();
const db = require('../db/database');

router.get('/', (req, res) => {
  try {
    res.json(db.prepare(
      'SELECT id, name, active FROM branches WHERE active = 1 ORDER BY id'
    ).all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
