/**
 * Dashboard sign-in.
 *
 * Unlike the till's PIN pad, this endpoint faces the open internet, so it is
 * rate limited and says as little as possible about why a sign-in failed.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const db = require('../db/pg');
const { COOKIE, createSession, destroySession, requireUser } = require('../middleware/session');

/*
 * Rate limiting.
 *
 * In memory, and therefore reset by a restart — which is an acceptable
 * weakness for a lockout but not for a session, hence sessions being on disk
 * and this not being. Keyed on IP *and* email together so that one attacker
 * cannot lock a real owner out of their own dashboard by failing against their
 * address from elsewhere.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map(); // key -> { count, first }

function attemptKey(req, email) {
  return `${req.ip}|${String(email || '').toLowerCase()}`;
}

function isLockedOut(key) {
  const rec = attempts.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return false; }
  return rec.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const key = attemptKey(req, email);

  if (isLockedOut(key)) {
    return res.status(429).json({
      error: 'Too many attempts. Try again in a few minutes.',
      code: 'RATE_LIMITED',
    });
  }

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await db.one(
      'SELECT id, email, password_hash, name, role, branch_id, active FROM users WHERE email = $1',
      [String(email).trim().toLowerCase()]
    );

    /*
     * Always run a bcrypt comparison, even when the account does not exist.
     * Returning early would make a missing account measurably faster than a
     * wrong password, which is enough to enumerate who has an account.
     */
    const hash = (user && user.password_hash) || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const passwordOk = await bcrypt.compare(String(password), hash);

    if (!user || !user.active || !passwordOk) {
      recordFailure(key);
      // One message for every failure: wrong address, wrong password and
      // disabled account are indistinguishable from outside.
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    attempts.delete(key);
    await createSession(res, user);

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branch_id: user.branch_id,
    });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(500).json({ error: 'Sign-in failed' });
  }
});

router.post('/logout', async (req, res) => {
  await destroySession(req, res);
  res.json({ success: true });
});

/** Who am I — lets the dashboard restore a session on page load. */
router.get('/me', requireUser, (req, res) => res.json(req.user));

/**
 * Change your own password.
 *
 * Exists because the alternative is the client using, forever, a password we
 * chose for them at handover and typed into a terminal. The current password
 * is required again rather than trusting the cookie: a session proves somebody
 * signed in at some point, not that the person at the keyboard now is the one
 * who may lock everybody else out.
 *
 * Every other session for this account is ended. That is what a password
 * change is for — if it is being changed because somebody else may have it,
 * their open tab has to stop working too. The session making the change stays.
 */
router.put('/password', requireUser, async (req, res) => {
  const current = String((req.body && req.body.current_password) || '');
  const next = String((req.body && req.body.new_password) || '');
  const key = `pw|${req.user.id}`;

  if (isLockedOut(key)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' });
  }
  if (next.length < 10) {
    return res.status(400).json({ error: 'Use at least ten characters.' });
  }
  if (next === current) {
    return res.status(400).json({ error: 'That is the password you already have.' });
  }

  try {
    const user = await db.one('SELECT password_hash FROM users WHERE id = $1 AND active = 1', [req.user.id]);
    const hash = (user && user.password_hash) || '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    if (!(await bcrypt.compare(current, hash))) {
      recordFailure(key);
      return res.status(403).json({ error: 'That is not your current password.', code: 'BAD_PASSWORD' });
    }
    attempts.delete(key);

    const newHash = await bcrypt.hash(next, 10);
    const mine = req.cookies && req.cookies[COOKIE];
    await db.tx(async (client) => {
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
      // Everyone else signed in as this account is signed out.
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND token <> $2', [req.user.id, mine || '']);
    });

    res.json({ success: true, note: 'Your password is changed. Any other browser signed in as you has been signed out.' });
  } catch (err) {
    console.error('Password change failed:', err.message);
    res.status(500).json({ error: 'Could not change the password' });
  }
});

module.exports = router;
