const express = require('express');
const router = express.Router();
const db = require('../db/database');
const bcrypt = require('bcrypt');
const saltRounds = 10;

// GET all staff
router.get('/', (req, res) => {
  try {
    const staff = db.prepare('SELECT id, name, role, pin, color, active FROM staff ORDER BY role DESC, name ASC').all();
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
    const info = insert.run(name, role || 'Cashier', hashedPin, color || '#F97316');
    res.json({ id: info.lastInsertRowid, name, role, color: color || '#F97316', active: 1 });
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

// POST login via PIN
router.post('/login', async (req, res) => {
  const { pin, staff_id } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });
  if (!staff_id) return res.status(400).json({ error: 'Staff ID required' });

  const staff = db.prepare('SELECT id, name, role, color, pin FROM staff WHERE id = ? AND active = 1').get(staff_id);
  if (!staff) {
    return res.status(401).json({ error: 'Invalid PIN or inactive account' });
  }

  const isValid = await bcrypt.compare(String(pin), staff.pin);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid PIN or inactive account' });
  }
  
  // Return staff data without the hashed PIN
  const { pin: _, ...staffData } = staff;
  res.json(staffData);
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
