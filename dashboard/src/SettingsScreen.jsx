import ResetSection from './ResetSection';
import React, { useEffect, useState } from 'react';

/**
 * Shop-wide settings.
 *
 * Purpose-built rather than a reuse of the till's Settings screen, and that is
 * the honest choice: most of what that screen contains is genuinely per-branch.
 * A receipt footer, a printed address, a delivery charge and a paper size are
 * different at the two shops, and showing them here — editable, apparently
 * shop-wide — would invite the owner to set one branch's address on both.
 *
 * So this shows only what actually travels down to every till, and names what
 * it does not control rather than leaving that to be discovered.
 */

const card = {
  background: '#FFFFFF', border: '1px solid #E5E7EB',
  borderRadius: 14, padding: 20, marginBottom: 20,
};

const input = {
  width: '100%', height: 42, borderRadius: 8, border: '1.5px solid #E5E7EB',
  padding: '0 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  fontFamily: 'inherit', background: '#FFFFFF',
};

export default function SettingsScreen() {
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [branchOwned, setBranchOwned] = useState([]);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load settings');
      setFields(data.fields || []);
      setValues(data.settings || {});
      setBranchOwned(data.branch_owned || []);
      setVersion(data.version);
      setMessage(null);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      // Only the fields this screen offers — never the whole values object,
      // which would send back anything the server happened to include.
      const payload = {};
      fields.forEach(f => { if (values[f.key] != null) payload[f.key] = values[f.key]; });

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');

      setValues(data.settings || {});
      setVersion(data.version);
      setMessage({
        tone: 'ok',
        text: 'Saved. Every till picks this up on its next sync, within about thirty seconds.',
      });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#6B7280' }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      {message && (
        <div style={{
          borderRadius: 10, padding: '11px 14px', marginBottom: 20, fontSize: 14,
          background: message.tone === 'ok' ? '#F0FDF4' : '#FEF2F2',
          border: `1px solid ${message.tone === 'ok' ? '#BBF7D0' : '#FECACA'}`,
          color: message.tone === 'ok' ? '#166534' : '#991B1B',
        }}>
          {message.text}
        </div>
      )}

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Shop-wide settings</h2>
          {version != null && (
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>version {version}</span>
          )}
        </div>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#6B7280' }}>
          These are the same at both branches. Changing one here changes it on
          every till.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {fields.map(f => (
            <label key={f.key} style={{ display: 'block' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{f.label}</span>
              {f.type === 'select' ? (
                <select
                  value={values[f.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  style={{ ...input, marginTop: 6 }}
                >
                  {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
                  style={{ ...input, marginTop: 6 }}
                />
              )}
              {f.help && (
                <span style={{ display: 'block', fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>
                  {f.help}
                </span>
              )}
            </label>
          ))}
        </div>

        <button
          onClick={save}
          disabled={saving}
          style={{
            marginTop: 22, height: 44, padding: '0 22px', borderRadius: 8, border: 'none',
            background: saving ? '#9CA3AF' : '#111827', color: '#FFFFFF',
            fontSize: 15, fontWeight: 700, cursor: saving ? 'default' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save and send to the tills'}
        </button>
      </section>

      {/*
        Named explicitly. These are the settings an owner will come looking for
        and not find, and "where did the printer settings go" is a much worse
        experience than being told plainly why they are not here.
      */}
      <section style={{ ...card, background: '#F9FAFB' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: '#374151' }}>
          Set on each till, not here
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6B7280' }}>
          These are genuinely different at each shop, so each branch keeps its
          own. Changing them here would give both branches the same printed
          address and the same delivery charge.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {branchOwned.map(k => (
            <span key={k} style={{
              fontSize: 12, color: '#6B7280', background: '#FFFFFF',
              border: '1px solid #E5E7EB', borderRadius: 999, padding: '4px 10px',
            }}>
              {k.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      </section>

      {/* Last, and set apart: the only destructive thing on this page. */}
      <ResetSection />
    </div>
  );
}
