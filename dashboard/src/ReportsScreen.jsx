import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { reports, branches as branchesApi } from './api';
import { money, count, ago } from './format';
import { downloadCsv } from './csv';

/**
 * Both branches' reports.
 *
 * Every panel loads independently with `allSettled`, the same decision as the
 * till's Reports screen: these are ten separate questions, and one failing
 * endpoint should cost one panel rather than blanking the page and reading as
 * "no sales".
 *
 * The completeness banner is the part specific to a cloud report. On the till,
 * the data is simply there. Here it arrives over a link that fails, so a report
 * can quietly be missing the last three hours of a branch — a plausible number
 * the owner would act on. That has to be visible, not inferred.
 */

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeDates(key, customFrom, customTo) {
  const now = new Date();
  const days = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
  switch (key) {
    case 'today': return { from: iso(now), to: iso(now) };
    case 'yesterday': return { from: iso(days(1)), to: iso(days(1)) };
    case 'last7': return { from: iso(days(6)), to: iso(now) };
    case 'last30': return { from: iso(days(29)), to: iso(now) };
    case 'month': return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    default: return { from: customFrom, to: customTo };
  }
}

const chip = (active) => ({
  padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap',
  background: active ? '#111827' : '#FFFFFF',
  color: active ? '#FFFFFF' : '#374151',
  border: `1px solid ${active ? '#111827' : '#D1D5DB'}`,
});

const card = {
  background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 14, padding: 20,
};

function Kpi({ label, value, tone }) {
  return (
    <div style={{ flex: '1 1 150px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#6B7280' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone || '#111827', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Table({ columns, rows, empty }) {
  if (!rows.length) return <p style={{ color: '#9CA3AF', fontSize: 14, margin: 0 }}>{empty}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
            {columns.map(c => (
              <th key={c.header} style={{
                textAlign: c.align || 'left', padding: '8px 10px',
                fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, color: '#6B7280',
              }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #F3F4F6' }}>
              {columns.map(c => (
                <td key={c.header} style={{ textAlign: c.align || 'left', padding: '8px 10px', color: '#374151' }}>
                  {c.value(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsScreen() {
  const [rangeKey, setRangeKey] = useState('today');
  const [customFrom, setCustomFrom] = useState(iso(new Date()));
  const [customTo, setCustomTo] = useState(iso(new Date()));
  const [branchId, setBranchId] = useState('');
  const [branchList, setBranchList] = useState([]);

  const [data, setData] = useState({});
  const [failed, setFailed] = useState([]);
  const [completeness, setCompleteness] = useState(null);
  const [loading, setLoading] = useState(true);

  const { from, to } = useMemo(
    () => rangeDates(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo]
  );

  useEffect(() => {
    branchesApi.list().then(setBranchList).catch(() => setBranchList([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = branchId ? { from, to, branch: branchId } : { from, to };

    const NAMES = ['Summary', 'Sales by category', 'Top items', 'Staff performance',
      'Order details', 'Expenses by category', 'Expense details'];
    const settled = await Promise.allSettled([
      reports.kpi(params),
      reports.byCategory(params),
      reports.topItems(params),
      reports.cashierPerformance(params),
      reports.detailed(params),
      reports.expensesByCategory(params),
      reports.expensesDetail(params),
    ]);

    const broken = [];
    settled.forEach((r, i) => { if (r.status === 'rejected') broken.push(NAMES[i]); });
    setFailed(broken);

    const val = (i, fallback) => {
      if (settled[i].status !== 'fulfilled' || settled[i].value == null) return fallback;
      if (Array.isArray(fallback) && !Array.isArray(settled[i].value)) return fallback;
      return settled[i].value;
    };

    setData({
      kpi: val(0, {}),
      categories: val(1, []),
      topItems: val(2, []),
      staff: val(3, []),
      orders: val(4, []),
      expenseCats: val(5, []),
      expenses: val(6, []),
    });
    setLoading(false);
  }, [from, to, branchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    branchesApi.completeness().then(setCompleteness).catch(() => setCompleteness(null));
  }, [from, to, branchId]);

  const k = data.kpi || {};

  const exportOrders = () => {
    const header = ['Order #', 'Date', 'Time', 'Branch', 'Cashier', 'Type', 'Payment',
      'Status', 'Customer', 'Phone', 'Address', 'Items', 'Qty', 'Subtotal',
      'Discount', 'Delivery', 'Total'];
    const rows = (data.orders || []).map(o => [
      o.id,
      String(o.created_at || '').slice(0, 10),
      String(o.created_at || '').slice(11, 16),
      o.branch_name || 'Unassigned',
      o.cashier_name, o.order_type, o.payment_method, o.status,
      o.customer_name || '', o.customer_phone || '', o.customer_address || '',
      o.items || '', o.total_qty, o.subtotal, o.discount, o.delivery_charge, o.total,
    ]);
    downloadCsv(`blaze-orders-${from}-to-${to}.csv`, [header, ...rows]);
  };

  const exportExpenses = () => {
    const header = ['Date', 'Time', 'Branch', 'Category', 'Description', 'Recorded by', 'From drawer', 'Amount'];
    const rows = (data.expenses || []).map(e => [
      String(e.created_at || '').slice(0, 10),
      String(e.created_at || '').slice(11, 16),
      e.branch_name || 'Unassigned',
      e.category, e.description || '', e.staff_name,
      e.from_drawer ? 'Yes' : 'No', e.amount,
    ]);
    downloadCsv(`blaze-expenses-${from}-to-${to}.csv`, [header, ...rows]);
  };

  // A branch whose sales have not arrived recently makes every total below an
  // understatement, so it is named rather than merely flagged.
  const behind = (completeness?.branches || []).filter(
    b => b.last_sync_age_ms == null || b.last_sync_age_ms > 30 * 60 * 1000
  );

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {branchList.length > 1 && (
          <>
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              style={{ ...chip(!!branchId), appearance: 'auto' }}
            >
              <option value="">All branches</option>
              {branchList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span style={{ width: 1, height: 22, background: '#D1D5DB', margin: '0 4px' }} />
          </>
        )}
        {RANGES.map(r => (
          <button key={r.key} onClick={() => setRangeKey(r.key)} style={chip(rangeKey === r.key)}>
            {r.label}
          </button>
        ))}
        <button onClick={() => setRangeKey('custom')} style={chip(rangeKey === 'custom')}>Custom</button>
        {rangeKey === 'custom' && (
          <>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                   style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13 }} />
            <span style={{ color: '#9CA3AF', fontSize: 13 }}>to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                   style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: 13 }} />
          </>
        )}
      </div>

      {behind.length > 0 && (
        <div style={{
          background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 14,
        }}>
          <strong>These figures may be incomplete.</strong>{' '}
          {behind.map(b => (
            <span key={b.branch_id}>
              {b.branch_name} last delivered sales{' '}
              {b.last_sync_age_ms == null ? 'never' : ago(b.last_sync_age_ms)}.{' '}
            </span>
          ))}
          Anything rung up since then is still on that till and is not counted below.
        </div>
      )}

      {failed.length > 0 && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 14,
        }}>
          <strong>Some sections could not be loaded:</strong> {failed.join(', ')}.
          The figures shown exclude them.
        </div>
      )}

      <div style={{ ...card, marginBottom: 20, opacity: loading ? 0.5 : 1 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Kpi label="Revenue" value={money(k.total_revenue)} />
          <Kpi label="Orders" value={count(k.total_orders)} />
          <Kpi label="Avg order" value={money(k.avg_order_value)} />
          <Kpi label="Discounts" value={money(k.total_discounts)} tone="#B45309" />
          <Kpi label="Expenses" value={money(k.total_expenses)} tone="#B45309" />
          <Kpi label="Net revenue" value={money(k.net_revenue)} tone={k.net_revenue < 0 ? '#DC2626' : '#059669'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        <section style={card}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Sales by category</h3>
          <Table
            empty="No sales in this period."
            rows={data.categories || []}
            columns={[
              { header: 'Category', value: r => r.category },
              { header: 'Qty', align: 'right', value: r => count(r.total_qty) },
              { header: 'Revenue', align: 'right', value: r => money(r.total_revenue) },
            ]}
          />
        </section>

        <section style={card}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Top items</h3>
          <Table
            empty="No items sold in this period."
            rows={data.topItems || []}
            columns={[
              { header: 'Item', value: r => r.name },
              { header: 'Qty', align: 'right', value: r => count(r.total_qty) },
              { header: 'Revenue', align: 'right', value: r => money(r.total_revenue) },
            ]}
          />
        </section>

        <section style={card}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Staff performance</h3>
          <Table
            empty="Nobody rang up a sale in this period."
            rows={data.staff || []}
            columns={[
              { header: 'Name', value: r => r.cashier_name },
              { header: 'Orders', align: 'right', value: r => count(r.total_orders) },
              { header: 'Revenue', align: 'right', value: r => money(r.total_revenue) },
            ]}
          />
        </section>

        <section style={card}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700 }}>Where the money went</h3>
          <Table
            empty="No expenses recorded in this period."
            rows={data.expenseCats || []}
            columns={[
              { header: 'Category', value: r => r.category },
              { header: 'Entries', align: 'right', value: r => count(r.entries) },
              { header: 'Total', align: 'right', value: r => money(r.total) },
            ]}
          />
        </section>
      </div>

      <section style={{ ...card, marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            Orders <span style={{ color: '#9CA3AF', fontWeight: 500 }}>({(data.orders || []).length})</span>
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportOrders} disabled={!(data.orders || []).length} style={chip(false)}>
              Export orders CSV
            </button>
            <button onClick={exportExpenses} disabled={!(data.expenses || []).length} style={chip(false)}>
              Export expenses CSV
            </button>
          </div>
        </div>
        <Table
          empty="No orders in this period."
          rows={(data.orders || []).slice(0, 100)}
          columns={[
            { header: '#', value: r => r.id },
            { header: 'Time', value: r => String(r.created_at || '').slice(5, 16) },
            { header: 'Branch', value: r => r.branch_name || '—' },
            { header: 'Cashier', value: r => r.cashier_name },
            { header: 'Payment', value: r => r.payment_method },
            { header: 'Status', value: r => (r.status === 'voided'
                ? <span style={{ color: '#DC2626', fontWeight: 600 }}>voided</span> : r.status) },
            { header: 'Total', align: 'right', value: r => money(r.total) },
          ]}
        />
        {(data.orders || []).length > 100 && (
          <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 12 }}>
            Showing the first 100. The CSV export contains all {(data.orders || []).length}.
          </p>
        )}
      </section>
    </div>
  );
}
