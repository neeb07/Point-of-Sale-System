import React, { useState } from 'react';
import { auth } from './api';

/**
 * Owner sign-in.
 *
 * Email and password, not the till's four-digit PIN — this page is on the open
 * internet and shows the shop's entire takings. The server answers every kind of
 * failure identically, so this form deliberately does not try to be more helpful
 * than that: telling someone "no such account" tells an attacker the same thing.
 */
export default function LoginScreen({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.login(email, password));
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  const field = {
    width: '100%', height: 44, borderRadius: 8, border: '1.5px solid #E5E7EB',
    padding: '0 12px', fontSize: 15, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#F5F5F0',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <form onSubmit={submit} style={{
        background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 16,
        padding: 32, width: '100%', maxWidth: 380,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Blaze</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6B7280' }}>Owner dashboard</p>
        </div>

        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
            required
            style={{ ...field, marginTop: 6 }}
          />
        </label>

        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{ ...field, marginTop: 6 }}
          />
        </label>

        {error && (
          <div style={{
            background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
            borderRadius: 8, padding: '10px 12px', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={busy} style={{
          height: 46, borderRadius: 8, border: 'none',
          background: busy ? '#9CA3AF' : '#111827', color: '#FFFFFF',
          fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
        }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
