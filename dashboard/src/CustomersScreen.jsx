import React, { useEffect, useState } from 'react';
import BranchFilter from './BranchFilter';

/**
 * Delivery customers.
 *
 * Built up automatically from delivery orders — nobody types a customer in.
 * The till files them as the address is taken and matches a returning caller on
 * their phone number, so the same household ordering a week later increments
 * their count rather than appearing twice.
 *
 * Aggregated by phone across branches, so "how many times has this customer
 * ordered" answers for the whole business. A household that has used both shops
 * is one row here, not two.
 */

const money = (v) =>
  v == null ? '—' : 'Rs ' + Number(v).toLocaleString('en-PK', { maximumFractionDigits: 0 });

const card = {
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14, padding: 20,
};

function Stat({ label, value, tone }) {
  return (
    <div style={{ flex: '1 1 140px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#6B7280' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone || '#111827', marginTop: 2 }}>{value}</div>
    </div>
  );
}

export default function CustomersScreen() {
  const [branchId, setBranchId] = useState('');
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ customers: 0, orders: 0, spent: 0, returning: 0 });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = branchId ? `?branch=${branchId}` : '';
    fetch(`/api/customers${qs}`, { credentials: 'include' })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Could not load customers');
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setRows(data.customers || []);
        setTotals(data.totals || {});
        setError(null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branchId]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter(r =>
        String(r.name || '').toLowerCase().includes(term) ||
        String(r.phone || '').replace(/\D/g, '').includes(term.replace(/\D/g, '')) ||
        String(r.address || '').toLowerCase().includes(term))
    : rows;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <BranchFilter value={branchId} onChange={setBranchId} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone or address"
          style={{
            flex: '1 1 260px', height: 36, borderRadius: 8, border: '1px solid #D1D5DB',
            padding: '0 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {error && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 14,
        }}>
          {error}
        </div>
      )}

      <div style={{ ...card, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Customers" value={totals.customers ?? 0} />
          <Stat label="Delivery orders" value={totals.orders ?? 0} />
          <Stat label="Total spent" value={money(totals.spent)} />
          {/*
            The figure worth watching. A list of one-off orders looks exactly
            like a healthy delivery business until you count how many people
            came back.
          */}
          <Stat label="Ordered more than once" value={totals.returning ?? 0} tone="#059669" />
        </div>
        <p style={{ margin: '12px 0 0', fontSize: 12, color: '#9CA3AF' }}>
          Recorded automatically when a delivery address is taken. Matched on
          phone number, so a returning customer adds to their own count rather
          than appearing twice.
        </p>
      </div>

      <section style={card}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>
          Customers <span style={{ color: '#9CA3AF', fontWeight: 500 }}>({visible.length})</span>
        </h3>

        {loading ? (
          <p style={{ color: '#9CA3AF', fontSize: 14, margin: 0 }}>Loading…</p>
        ) : !visible.length ? (
          <p style={{ color: '#9CA3AF', fontSize: 14, margin: 0 }}>
            {rows.length
              ? 'Nobody matches that search.'
              : 'No delivery customers yet. They are recorded as delivery orders are taken.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                  {['Name', 'Phone', 'Address', 'Orders', 'Total spent', 'First order', 'Last order', 'Branches']
                    .map((h, i) => (
                      <th key={h} style={{
                        textAlign: i >= 3 && i <= 4 ? 'right' : 'left', padding: '8px 10px',
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: '#6B7280',
                        whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(c => (
                  <tr key={c.group_key} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: '#111827' }}>
                      {c.name || 'Unnamed'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#374151', whiteSpace: 'nowrap' }}>
                      {c.phone || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#6B7280', maxWidth: 320 }}>
                      {c.address || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>
                      {c.order_count}
                      {c.order_count > 1 && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#166534',
                          background: '#F0FDF4', border: '1px solid #BBF7D0',
                          borderRadius: 999, padding: '1px 6px',
                        }}>
                          returning
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: '#374151' }}>
                      {money(c.total_spent)}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                      {String(c.first_order_at || '').slice(0, 10) || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                      {String(c.last_order_at || '').slice(0, 10) || '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#6B7280' }}>
                      {c.branches || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
