const express = require('express');
const router = express.Router();
const db = require('../db/database');
const bcrypt = require('bcryptjs');
const saltRounds = 10;

// GET all staff
router.get('/', (req, res) => {
  try {
    // SECURITY: `pin` used to be in this SELECT, so every caller of
    // GET /api/staff received the bcrypt hash of every staff PIN. Nothing in
    // the UI needs it — Settings only renders name/role/colour/active.
    const staff = db.prepare('SELECT id, name, role, color, active FROM staff ORDER BY role DESC, name ASC').all();
    const normalized = staff.map(s => ({
      ...s,
      active: s.active === 1 || s.active === '1' || s.active === true ? 1 : 0
    }));
    res.json(normalized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new staff
router.post('/', async (req, res) => {
  const { name, role, pin, color } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN required' });

  try {
    const hashedPin = await bcrypt.hash(String(pin), saltRounds);
    const insert = db.prepare('INSERT INTO staff (name, role, pin, color, active) VALUES (?, ?, ?, ?, 1)');
    const info = insert.run(name, role || 'Cashier', hashedPin, color || '#DC2626');
    res.json({ id: info.lastInsertRowid, name, role, color: color || '#DC2626', active: 1 });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'PIN already in use by another staff member' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT update staff (toggle active, update role, etc)
router.put('/:id', async (req, res) => {
  const { active, role, pin, name, color } = req.body;
  try {
    if (name !== undefined) {
      db.prepare('UPDATE staff SET name = ? WHERE id = ?').run(name, req.params.id);
    }
    if (active !== undefined) {
      db.prepare('UPDATE staff SET active = ? WHERE id = ?').run(active ? 1 : 0, req.params.id);
    }
    if (role !== undefined) {
      db.prepare('UPDATE staff SET role = ? WHERE id = ?').run(role, req.params.id);
    }
    if (color !== undefined) {
      db.prepare('UPDATE staff SET color = ? WHERE id = ?').run(color, req.params.id);
    }
    if (pin) {
      const hashedPin = await bcrypt.hash(String(pin), saltRounds);
      db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(hashedPin, req.params.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE staff
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * SECURITY: brute-force protection for PIN login.
 *
 * PINs are 4 digits — a 10,000-entry space — and this endpoint previously
 * accepted unlimited attempts with no delay or lockout, so the whole space
 * could be walked in minutes. Because a PIN is the *only* credential (there
 * is no username), the counter is global rather than per-account.
 *
 * State is in-memory on purpose: this is a single-till app, the backend is
 * restarted with the app, and a restart-to-reset still costs an attacker far
 * more than the unthrottled endpoint did.
 */
const MAX_ATTEMPTS = 5;          // failures before the first lockout
const LOCKOUT_MS = 60 * 1000;    // base lockout, doubles each further trip
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // failures older than this decay away

const loginGuard = {
  failures: [],      // timestamps of recent failed attempts
  lockedUntil: 0,
  lockoutCount: 0,   // consecutive lockouts, drives exponential backoff
};

function guardStatus(now = Date.now()) {
  if (now < loginGuard.lockedUntil) {
    return { locked: true, retryAfterMs: loginGuard.lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

function recordFailure(now = Date.now()) {
  loginGuard.failures = loginGuard.failures.filter(t => now - t < ATTEMPT_WINDOW_MS);
  loginGuard.failures.push(now);

  if (loginGuard.failures.length >= MAX_ATTEMPTS) {
    loginGuard.lockoutCount += 1;
    // 1m, 2m, 4m, 8m … capped at 15m.
    const backoff = Math.min(LOCKOUT_MS * 2 ** (loginGuard.lockoutCount - 1), 15 * 60 * 1000);
    loginGuard.lockedUntil = now + backoff;
    loginGuard.failures = [];
  }
}

function recordSuccess() {
  loginGuard.failures = [];
  loginGuard.lockedUntil = 0;
  loginGuard.lockoutCount = 0;
}

// POST login via PIN
router.post('/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const status = guardStatus();
  if (status.locked) {
    const seconds = Math.ceil(status.retryAfterMs / 1000);
    return res.status(429).json({
      error: `Too many incorrect PINs. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      retry_after_seconds: seconds,
    });
  }

  const staff = db.prepare('SELECT id, name, role, color, pin FROM staff WHERE active = 1').all();

  for (const member of staff) {
    // SECURITY: a plain-text comparison branch used to sit here as a fallback
    // for "legacy seeded PINs". It meant an unhashed PIN written directly into
    // the table would still authenticate. All PINs are hashed on insert, and
    // db/database.js migrates any stragglers at startup, so the fallback is
    // gone: a row whose PIN is not a bcrypt hash can no longer log in.
    if (!/^\$2[aby]\$/.test(member.pin || '')) continue;

    if (await bcrypt.compare(String(pin), member.pin)) {
      recordSuccess();
      const { pin: _, ...staffData } = member;
      return res.json(staffData);
    }
  }

  recordFailure();
  const after = guardStatus();
  if (after.locked) {
    const seconds = Math.ceil(after.retryAfterMs / 1000);
    return res.status(429).json({
      error: `Too many incorrect PINs. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      retry_after_seconds: seconds,
    });
  }

  return res.status(401).json({ error: 'Invalid PIN or inactive account' });
});

// Performance per cashier for a date range
router.get('/performance', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const from = req.query.from || today;
  const to = req.query.to || today;

  try {
    const allStaff = db.prepare('SELECT id, name, role, color, active FROM staff').all();

    const performance = allStaff.map(s => {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total_orders,
          COALESCE(SUM(total), 0) as total_revenue,
          COALESCE(AVG(total), 0) as avg_order_value,
          COALESCE(SUM(discount), 0) as total_discounts
        FROM orders
        WHERE cashier_id = ?
        AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        AND status != 'voided'
      `).get(s.id, from, to);

      const busiestHour = db.prepare(`
        SELECT
          CAST(strftime('%H', created_at) AS INTEGER) as hour,
          COUNT(*) as count
        FROM orders
        WHERE cashier_id = ?
        AND DATE(created_at) BETWEEN DATE(?) AND DATE(?)
        AND status != 'voided'
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 1
      `).get(s.id, from, to);

      const hourLabel = busiestHour
        ? `${busiestHour.hour % 12 || 12}${busiestHour.hour < 12 ? 'AM' : 'PM'}` 
        : 'N/A';

      return { ...s, ...stats, busiest_hour: hourLabel };
    });

    res.json(performance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

