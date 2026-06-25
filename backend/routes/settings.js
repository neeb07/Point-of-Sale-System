const express = require('express');
const router = express.Router();
const db = require('../db/database');
const fs = require('fs');
const path = require('path');

// GET all settings
router.get('/', (req, res) => {
  const data = db.prepare('SELECT * FROM settings').all();
  const settingsObj = {};
  data.forEach(row => {
    settingsObj[row.key] = row.value;
  });
  res.json(settingsObj);
});

// PUT update multiple settings
router.put('/', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const upsert = db.prepare(`
    INSERT INTO settings (key, value) 
    VALUES (?, ?) 
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);

  try {
    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        upsert.run(key, value.toString());
      }
    })();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET backup
router.get('/backup', (req, res) => {
  const dbPath = path.join(__dirname, '../pos_database.db');
  res.download(dbPath, `pos_backup_${new Date().toISOString().split('T')[0]}.db`);
});

module.exports = router;
