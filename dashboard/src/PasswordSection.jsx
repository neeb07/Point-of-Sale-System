import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';

/**
 * Change your own dashboard password.
 *
 * Here because the client's first password is one we set for them at handover
 * and read out. That is fine for a first sign-in and unacceptable as a
 * permanent state. The current password is asked for again — see the route
 * for why — and every other browser signed in as this account is signed out.
 */

const card = {
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14, padding: 20,
};

const field = {
  height: 40, width: '100%', maxWidth: 320, borderRadius: 9, border: '1px solid #D1D5DB',
  padding: '0 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', display: 'block',
};

export default function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const mismatch = again.length > 0 && next !== again;
  const canSubmit = current && next.length >= 10 && next === again && !busy;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not change the password');
      setDone(data.note || 'Your password is changed.');
      setCurrent(''); setNext(''); setAgain('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: '#F3F4F6', color: '#374151',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <KeyRound size={20} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Your password</h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280', lineHeight: 1.5 }}>
            Changing it signs out every other browser that is signed in as you.
          </p>
        </div>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: '#374151' }}>
          Current password
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
                 autoComplete="current-password" style={{ ...field, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: '#374151' }}>
          New password <span style={{ color: '#9CA3AF', fontWeight: 500 }}>(at least ten characters)</span>
          <input type="password" value={next} onChange={e => setNext(e.target.value)}
                 autoComplete="new-password" style={{ ...field, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: '#374151' }}>
          New password again
          <input type="password" value={again} onChange={e => setAgain(e.target.value)}
                 autoComplete="new-password"
                 style={{ ...field, marginTop: 4, borderColor: mismatch ? '#FCA5A5' : '#D1D5DB' }} />
          {mismatch && <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>These do not match.</div>}
        </label>

        {error && <div style={{ fontSize: 13, color: '#B91C1C' }}>{error}</div>}
        {done && <div style={{ fontSize: 13, color: '#166534' }}>{done}</div>}

        <button type="submit" disabled={!canSubmit} style={{
          alignSelf: 'flex-start', height: 40, padding: '0 16px', borderRadius: 9,
          background: '#111827', color: '#FFFFFF', border: 'none', fontSize: 14, fontWeight: 600,
          cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.5, fontFamily: 'inherit',
        }}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
