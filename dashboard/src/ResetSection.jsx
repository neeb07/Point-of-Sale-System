import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import AlertDialog, { AlertPanel } from '@/components/pos/AlertDialog';

/**
 * Wiping the trading history from the dashboard.
 *
 * The order of events is the point of this component, and it is enforced
 * rather than described: the export is fetched and *fully received* by the
 * browser before the reset is even offered, and the reset carries a token the
 * export handed back, so the server refuses a reset that did not follow one.
 * The password box is the final gate.
 *
 * Fetched as a blob rather than opened as a link, because a link cannot be
 * awaited — the page would have no way of knowing whether the file arrived
 * before it pressed on. A blob is either fully in memory or the fetch failed,
 * and only in the first case does the reset button appear.
 */

const money = (n) => Number(n || 0).toLocaleString('en-PK');

const card = {
  background: '#FFFFFF', border: '1px solid #FECACA', borderRadius: 14, padding: 20,
};

const btn = (kind, disabled) => ({
  height: 40, padding: '0 16px', borderRadius: 9, fontSize: 14, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
  display: 'inline-flex', alignItems: 'center', gap: 8, opacity: disabled ? 0.55 : 1,
  background: kind === 'danger' ? '#DC2626' : '#FFFFFF',
  color: kind === 'danger' ? '#FFFFFF' : '#374151',
  border: `1px solid ${kind === 'danger' ? '#DC2626' : '#D1D5DB'}`,
});

export default function ResetSection() {
  const [preview, setPreview] = useState(null);
  const [exportToken, setExportToken] = useState(null);
  const [exportedAs, setExportedAs] = useState(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(null); // 'export' | 'reset'
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(null);

  const loadPreview = () =>
    fetch('/api/admin/reset/preview', { credentials: 'include' })
      .then(r => r.json()).then(setPreview).catch(() => setPreview(null));

  useEffect(() => { loadPreview(); }, []);

  const total = preview ? Object.values(preview.counts || {}).reduce((a, b) => a + b, 0) : 0;

  /**
   * Step one: the backup. Nothing else is enabled until this has happened.
   */
  const exportFirst = async () => {
    setBusy('export');
    setError(null);
    try {
      const res = await fetch('/api/admin/export', { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'The export failed');
      }
      const token = res.headers.get('X-Export-Token');
      const disposition = res.headers.get('Content-Disposition') || '';
      const name = (disposition.match(/filename="([^"]+)"/) || [])[1] || 'blaze-trading-history.json';

      // Awaited. The whole file is in memory here or this line throws — the
      // reset button below cannot appear otherwise.
      const blob = await res.blob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setExportToken(token);
      setExportedAs(name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Step two: the reset, with the password. Refused by the server unless the
   * export token is fresh and belongs to this session.
   */
  const reset = async () => {
    setAsking(false);
    setBusy('reset');
    setError(null);
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, export_token: exportToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The reset did not run');
      setDone(data);
      setPassword('');
      setExportToken(null);
      setExportedAs(null);
      loadPreview();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const canReset = Boolean(exportToken) && password.length > 0 && !busy;

  return (
    <section style={card}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: '#FEF2F2', color: '#DC2626',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <AlertTriangle size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#991B1B' }}>
            Clear the trading history
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280', lineHeight: 1.55 }}>
            Deletes every order, shift, expense and delivery customer from the
            cloud, across both branches. The menu, stock, staff, settings,
            payroll and the tills' backups are kept. This cannot be undone from
            here — only from the file you download first.
          </p>
        </div>
      </div>

      {preview && (
        <div style={{
          marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
          gap: 8,
        }}>
          {preview.cleared.map((t) => (
            <div key={t} style={{
              padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8,
            }}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4, color: '#991B1B' }}>
                {t.replace(/_/g, ' ')}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#7F1D1D' }}>{money(preview.counts[t])}</div>
            </div>
          ))}
        </div>
      )}

      {done && (
        <div style={{
          marginTop: 16, padding: '12px 14px', background: '#F0FDF4', border: '1px solid #BBF7D0',
          borderRadius: 10, color: '#166534', fontSize: 13,
        }}>
          Cleared. {Object.entries(done.deleted || {}).map(([t, n]) => `${money(n)} ${t.replace(/_/g, ' ')}`).join(', ')}.
          The tills will keep reporting from here on as normal.
        </div>
      )}

      {error && (
        <div style={{
          marginTop: 16, padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA',
          borderRadius: 10, color: '#991B1B', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 20, borderTop: '1px solid #FEE2E2', paddingTop: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#6B7280', marginBottom: 10 }}>
          Step 1 &mdash; download a backup of what will be deleted
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btn(undefined, busy === 'export' || total === 0)} onClick={exportFirst} disabled={busy === 'export' || total === 0}>
            <Download size={16} /> {busy === 'export' ? 'Downloading…' : 'Download backup'}
          </button>
          {exportedAs && (
            <span style={{ fontSize: 13, color: '#166534' }}>
              Saved as <code style={{ fontSize: 12 }}>{exportedAs}</code>
            </span>
          )}
          {total === 0 && !exportedAs && (
            <span style={{ fontSize: 13, color: '#9CA3AF' }}>Nothing to clear.</span>
          )}
        </div>

        <div style={{
          fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
          color: exportToken ? '#6B7280' : '#D1D5DB', margin: '18px 0 10px',
        }}>
          Step 2 &mdash; confirm with your password
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={exportToken ? 'Your dashboard password' : 'Download the backup first'}
            disabled={!exportToken || Boolean(busy)}
            autoComplete="current-password"
            style={{
              height: 40, width: 260, borderRadius: 9, border: '1px solid #D1D5DB', padding: '0 12px',
              fontSize: 14, fontFamily: 'inherit', outline: 'none',
              background: exportToken ? '#FFFFFF' : '#F9FAFB',
            }}
          />
          <button
            style={btn('danger', !canReset)}
            disabled={!canReset}
            onClick={() => setAsking(true)}
          >
            <Trash2 size={16} /> {busy === 'reset' ? 'Clearing…' : 'Clear the trading history'}
          </button>
        </div>
      </div>

      <AlertDialog
        open={asking}
        icon={AlertTriangle}
        tone="danger"
        title="Delete all trading history?"
        message="Every order, shift, expense and delivery customer on the cloud, for both branches, will be deleted. The tills keep their own copies and will not send them again."
        note={`Your backup is ${exportedAs || 'saved'}. That file is the only way back.`}
        confirmLabel="Yes, delete it all"
        onConfirm={reset}
        dismissLabel="Keep everything"
        onDismiss={() => setAsking(false)}
      >
        <AlertPanel label="Being deleted" tone="danger">
          <div style={{ fontSize: 13, color: '#991B1B' }}>
            {preview ? preview.cleared.map(t => `${money(preview.counts[t])} ${t.replace(/_/g, ' ')}`).join(' · ') : ''}
          </div>
        </AlertPanel>
      </AlertDialog>
    </section>
  );
}
