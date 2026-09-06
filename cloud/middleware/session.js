/**
 * Dashboard sessions.
 *
 * An httpOnly cookie rather than a token in JavaScript's reach: the dashboard is
 * a public URL showing the shop's whole trading history, so a session that
 * cannot be read by page script is worth the small extra plumbing.
 *
 * Sessions live in SQLite rather than in memory. The till gets away with an
 * in-memory Map (`backend/middleware/auth.js`) because its backend restarts
 * only when the app is closed; this process is restarted by systemd on every
 * crash and every deploy, and signing the owner out each time would be both
 * baffling and, mid-deploy, relentless.
 */

const crypto = require('crypto');
const db = require('../db/database');

const COOKIE = 'blaze_session';

/** Twelve hours, refreshed on use. Long enough for a trading day, short enough that a forgotten laptop expires. */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Refreshing on every single request would mean a write per request; once an hour is enough to keep an active session alive. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

const insertStmt = db.prepare(
  'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const findStmt = db.prepare(`
  SELECT s.token, s.expires_at, u.id, u.email, u.name, u.role, u.branch_id, u.active
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.token = ?
`);
const touchStmt = db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?');
const deleteStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const pruneStmt = db.prepare('DELETE FROM sessions WHERE expires_at < ?');

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  insertStmt.run(token, user.id, now, now + TTL_MS);

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Set behind the reverse proxy in production, where the connection is
    // HTTPS. Left off in local development, where it is not, because a Secure
    // cookie over http is simply never stored and the symptom — "login appears
    // to succeed but I am immediately signed out" — is hard to read.
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_MS,
    path: '/',
  });

  return token;
}

function destroySession(req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) deleteStmt.run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/**
 * Attach `req.user` when the cookie names a live session. Never rejects —
 * routes decide what they require, the same shape as the till's `attachUser`.
 */
function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next();

  const row = findStmt.get(token);
  if (!row || !row.active) return next();

  const now = Date.now();
  if (row.expires_at < now) {
    deleteStmt.run(token);
    return next();
  }

  // Sliding expiry, written at most once an hour.
  if (row.expires_at - now < TTL_MS - REFRESH_AFTER_MS) {
    touchStmt.run(now + TTL_MS, token);
  }

  req.user = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    // NULL means every branch. Set on a future manager account to scope them
    // to one site without touching this code again.
    branchId: row.branch_id,
  };
  next();
}

function requireUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
  }
  next();
}

/** Clear out expired rows periodically; unref'd so it never holds the process open. */
function startSessionCleanup() {
  const prune = () => {
    try { pruneStmt.run(Date.now()); } catch (err) { console.error('Session prune failed:', err.message); }
  };
  prune();
  const timer = setInterval(prune, 60 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { COOKIE, createSession, destroySession, attachUser, requireUser, startSessionCleanup };
