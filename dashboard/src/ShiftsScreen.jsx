import React, { useEffect, useState } from 'react';
import BranchFilter from './BranchFilter';

/**
 * The drawers, across both branches.
 *
 * The till's own Shifts screen is built around one drawer — the one in front
 * of the person using it — and the dashboard reused it, which meant that with
 * a shift open at E-18 and another at Lehtrar Road only the newer one showed.
 * Here every open drawer gets a card, side by side, and the closed ones a
 * table underneath; the filter at the top narrows both to one branch.
 *
 * Read-only, like everything recorded at a till. Closing a drawer is done
 * at the drawer.
 */

const money = (v) =>
  v == null ? '—' : 'Rs ' + Number(v).toLocaleString('en-PK', { maximumFractionDigits: 0 });

const when = (stamp) => {
  if (!stamp) return '—';
  const d = new Date(String(stamp).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(stamp);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const since = (stamp, now) => {
  const d = new Date(String(stamp || '').replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.max(0, Math.floor((now - d.getTime()) / 60000));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
};

const card = { background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14, padding: 20 };

const Stat = ({ label, value, strong }) => (
  <div>
    <div style={{ fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: strong ? 20 : 15, fontWeight: strong ? 800 : 600, color: '#111827', marginTop: 2 }}>{value}</div>
  </div>
);

export default function ShiftsScreen() {
  const [branchId, setBranchId] = useState('');
  const [open, setOpen] = useState([]);
  const [closed, setClosed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = branchId ? `?branch=${encodeURIComponent(branchId)}` : '';
    const get = (p) => fetch(p, { credentials: 'include' }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load shifts');
      return d;
    });
    Promise.all([get(`/api/shifts/open${qs}`), get(`/api/shifts/history?limit=30${qs ? '&' + qs.slice(1) : ''}`)])
      .then(([o, c]) => {
        if (cancelled) return;
        setOpen(Array.isArray(o) ? o : []);
        setClosed(Array.isArray(c) ? c : []);
        setError(null);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, now]);

  // The running durations, and a fresh look at the drawers, every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <BranchFilter value={branchId} onChange={setBranchId} />
        <span style={{ fontSize: 13, color: '#6B7280' }}>
          {open.length === 0 ? 'No drawer is open' : `${open.length} ${open.length === 1 ? 'drawer' : 'drawers'} open`}
          {loading ? ' · refreshing…' : ''}
        </span>
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#FCA5A5', background: '#FEF2F2', color: '#991B1B', marginBottom: 16 }}>{error}</div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>Open now</h3>
      {open.length === 0 ? (
        <div style={{ ...card, color: '#6B7280', fontSize: 14, marginBottom: 24 }}>
          {loading ? 'Loading…' : 'No shift is open' + (branchId ? ' at this branch.' : ' at either branch.')}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16, marginBottom: 24 }}>
          {open.map((s) => (
            <div key={`${s.branch_id}-${s.id}`} style={{ ...card, borderTop: '4px solid #16A34A' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>{s.branch_name || `Branch ${s.branch_id}`}</div>
                  <div style={{ fontSize: 13, color: '#6B7280' }}>{s.staff_name || '—'} · opened {when(s.opened_at)}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', background: '#F0FDF4', border: '1px solid #DCFCE7', borderRadius: 999, padding: '3px 10px' }}>
                  {since(s.opened_at, now)}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <Stat label="Expected in drawer" value={money(s.expected_cash)} strong />
                <Stat label="Sales" value={money(s.total_revenue)} />
                <Stat label="Orders" value={s.total_orders ?? 0} />
                <Stat label="Opening cash" value={money(s.opening_cash)} />
                <Stat label="Cash sales" value={money(s.cash_revenue)} />
                <Stat label="Paid out of drawer" value={money(s.drawer_expenses)} />
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>Closed</h3>
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', color: '#6B7280', textAlign: 'left' }}>
              {['Branch', 'Staff', 'Opened', 'Closed', 'Orders', 'Sales', 'Expected', 'Counted', 'Variance'].map(h => (
                <th key={h} style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {closed.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, color: '#6B7280' }}>{loading ? 'Loading…' : 'No closed shifts yet.'}</td></tr>
            )}
            {closed.map((s) => {
              const v = Number(s.variance || 0);
              return (
                <tr key={`${s.branch_id}-${s.id}`} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{s.branch_name || s.branch_id}</td>
                  <td style={{ padding: '10px 12px' }}>{s.staff_name || '—'}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{when(s.opened_at)}</td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{when(s.closed_at)}</td>
                  <td style={{ padding: '10px 12px' }}>{s.total_orders ?? 0}</td>
                  <td style={{ padding: '10px 12px' }}>{money(s.total_revenue)}</td>
                  <td style={{ padding: '10px 12px' }}>{money(s.expected_cash)}</td>
                  <td style={{ padding: '10px 12px' }}>{money(s.closing_cash)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: v === 0 ? '#16A34A' : v > 0 ? '#2563EB' : '#DC2626' }}>
                    {v === 0 ? 'Exact' : (v > 0 ? '+' : '−') + money(Math.abs(v)).replace('Rs ', 'Rs ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
