// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import moment from 'moment';
import { expensesAPI, shiftsAPI, branchesAPI } from '@/api/index';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/lib/SettingsContext';
import PageHeader from '@/components/pos-ui/PageHeader';
import Modal from '@/components/pos-ui/Modal';
import Toast from '@/components/pos-ui/Toast';
import SearchBar from '@/components/pos-ui/SearchBar';

/**
 * Money paid out of the shop — rider fuel, staff lunch, a repair.
 *
 * The reason this screen matters is the drawer. Cash handed out is gone from
 * the till but is not a sale, so unless it is recorded the shift closes short
 * by exactly that amount and the person counting gets blamed for it. Marking an
 * expense as paid from the drawer takes it straight off the shift's expected
 * cash; anything paid from a pocket or by card is still recorded but leaves the
 * drawer alone.
 */

const INPUT = {
  width: '100%', height: 44, borderRadius: 8,
  border: '1.5px solid #E5E7EB', background: '#FFFFFF',
  padding: '0 12px', fontSize: 14, color: '#111827',
  outline: 'none', fontFamily: 'Inter, sans-serif',
};

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'last7', label: 'Last 7 Days' },
  { id: 'last30', label: 'Last 30 Days' },
];

function rangeDates(id) {
  const today = moment().format('YYYY-MM-DD');
  if (id === 'yesterday') {
    const y = moment().subtract(1, 'day').format('YYYY-MM-DD');
    return { from: y, to: y };
  }
  if (id === 'last7') return { from: moment().subtract(6, 'days').format('YYYY-MM-DD'), to: today };
  if (id === 'last30') return { from: moment().subtract(29, 'days').format('YYYY-MM-DD'), to: today };
  return { from: today, to: today };
}

export default function ExpensesScreen() {
  const { currentUser, isAdmin } = useAuth();
  const { formatMoney, currencySymbol } = useSettings();

  const [range, setRange] = useState('today');
  /*
   * Branch filter, for an administrator only.
   *
   * A manager already sees just their own entries, so a branch parameter could
   * only ever return their own figures or none — the backend ignores it for
   * them and the control is hidden here, the same as on the reports screen.
   */
  const [branchId, setBranchId] = useState('');
  const [branches, setBranches] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [totals, setTotals] = useState({ total: 0, from_drawer_total: 0, count: 0 });
  const [categories, setCategories] = useState([]);
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ category: '', description: '', amount: '', fromDrawer: true });

  useEffect(() => {
    if (!isAdmin) return;
    branchesAPI.getAll()
      // Without the list the picker simply does not appear; expenses still load.
      .then(rows => setBranches(Array.isArray(rows) ? rows : []))
      .catch(() => setBranches([]));
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { from, to } = rangeDates(range);
      const [data, cats, cur] = await Promise.all([
        expensesAPI.list(branchId ? { from, to, branch: branchId } : { from, to }),
        expensesAPI.categories(),
        shiftsAPI.current(),
      ]);
      setExpenses(data.expenses || []);
      setTotals(data.totals || { total: 0, from_drawer_total: 0, count: 0 });
      setCategories(cats || []);
      setShift(cur);
    } catch (err) {
      setToast({ message: err.message || 'Could not load expenses', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [range, branchId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setForm({ category: categories[0] || '', description: '', amount: '', fromDrawer: true });
    setModalOpen(true);
  };

  const save = async () => {
    const amount = Number(form.amount);
    if (!form.category.trim()) {
      setToast({ message: 'Choose what the money was spent on', type: 'error' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setToast({ message: 'Enter an amount greater than zero', type: 'error' });
      return;
    }

    setBusy(true);
    try {
      const created = await expensesAPI.create({
        category: form.category.trim(),
        description: form.description.trim(),
        amount,
        from_drawer: form.fromDrawer,
      });
      await load();
      setModalOpen(false);
      setToast({
        message: created.affected_shift
          ? `${formatMoney(amount)} recorded and taken off the drawer`
          : form.fromDrawer
            ? `${formatMoney(amount)} recorded — no shift is open, so the drawer was not adjusted`
            : `${formatMoney(amount)} recorded`,
        type: 'success',
      });
    } catch (err) {
      setToast({ message: err.message || 'Could not save the expense', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove this ${formatMoney(row.amount)} expense?`)) return;
    try {
      await expensesAPI.remove(row.id);
      await load();
      setToast({ message: 'Expense removed', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Could not remove it', type: 'error' });
    }
  };

  const q = search.trim().toLowerCase();
  const visible = q
    ? expenses.filter(e =>
        String(e.category || '').toLowerCase().includes(q) ||
        String(e.description || '').toLowerCase().includes(q) ||
        String(e.staff_name || '').toLowerCase().includes(q))
    : expenses;

  const Stat = ({ label, value, hint, accent }) => (
    <div style={{
      flex: 1, background: '#FFFFFF', border: '1px solid #EBEBEB',
      borderRadius: 12, padding: 16,
    }}>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent || '#111827' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{hint}</div>}
    </div>
  );

  return (
    <div className="flex-1 h-full overflow-y-auto" style={{ padding: 32, background: '#F5F2EA' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <PageHeader
          title="Expenses"
          subtitle="Money paid out — fuel, staff meals, supplies"
          actionLabel="Add Expense"
          actionIcon={Plus}
          onAction={openAdd}
        />

        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <Stat label="Total paid out" value={formatMoney(totals.total || 0)}
                hint={`${totals.count || 0} entr${(totals.count || 0) === 1 ? 'y' : 'ies'}`} />
          <Stat label="Taken from the drawer" value={formatMoney(totals.from_drawer_total || 0)}
                accent="#DC2626" hint="Deducted from expected cash" />
          <Stat
            label="Drawer should hold"
            value={shift ? formatMoney(shift.expected_cash || 0) : '—'}
            hint={shift
              ? `Float ${formatMoney(shift.opening_cash || 0)} + cash sales − payouts`
              : 'No shift open'}
          />
        </div>

        {/* The drawer only moves while a shift is open, so say so plainly
            rather than letting someone record a payout that quietly does
            nothing to the count they will do later. */}
        {!shift && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            background: '#FEF3C7', color: '#92400E',
            padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 16,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              No shift is open. Expenses are still recorded, but nothing is deducted from a
              drawer until a shift is started on the Shifts screen.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/*
            Which branch these payouts belong to. Ahead of the date chips, as on
            the reports screen, because it changes what the figures are about
            rather than merely which days they cover.
          */}
          {isAdmin && branches.length > 0 && (
            <>
              <select
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  background: branchId ? '#111111' : '#FFFFFF',
                  color: branchId ? '#FFFFFF' : '#6B7280',
                  border: branchId ? 'none' : '1px solid #E5E7EB',
                }}
              >
                <option value="">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <div style={{ width: 1, height: 22, background: '#E5E7EB', margin: '0 4px' }} />
            </>
          )}
          {RANGES.map(r => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              style={{
                padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                background: range === r.id ? '#111111' : '#FFFFFF',
                color: range === r.id ? '#FFFFFF' : '#6B7280',
                border: range === r.id ? 'none' : '1px solid #E5E7EB',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by type, note or who recorded it..."
            resultCount={visible.length}
            totalCount={expenses.length}
          />
        </div>

        <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #EBEBEB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #EBEBEB' }}>
                {['Time', 'Type', 'Note', 'Recorded by', 'From drawer', 'Amount', ''].map((h, i) => (
                  <th key={h + i} style={{
                    padding: '14px 16px', fontSize: 11, fontWeight: 700, color: '#6B7280',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    textAlign: h === 'Amount' ? 'right' : h === 'From drawer' ? 'center' : 'left',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading…</td></tr>
              )}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>
                  {q ? `Nothing matches "${q}".` : 'No expenses recorded for this period.'}
                </td></tr>
              )}
              {!loading && visible.map(e => {
                const mine = e.staff_id === currentUser?.id;
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B7280' }}>
                      {moment(e.created_at).format('MMM D, hh:mm A')}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#111827' }}>{e.category}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B7280' }}>{e.description || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#6B7280' }}>{e.staff_name || '—'}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      {e.from_drawer ? (
                        <span style={{
                          padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                          background: '#FEE2E2', color: '#B91C1C',
                        }}>DRAWER</span>
                      ) : <span style={{ color: '#D1D5DB' }}>—</span>}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#111827' }}>
                      {formatMoney(e.amount)}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      {(isAdmin || mine) && (
                        <button
                          onClick={() => remove(e)}
                          title={isAdmin ? 'Remove' : 'Remove your entry'}
                          style={{
                            width: 30, height: 30, borderRadius: 8, border: '1px solid #E5E7EB',
                            background: '#FFFFFF', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          <Trash2 size={14} color="#9CA3AF" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Add Expense" width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              What was it for
            </label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setForm(f => ({ ...f, category: c }))}
                  style={{
                    padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer',
                    background: form.category === c ? '#111111' : '#FFFFFF',
                    color: form.category === c ? '#FFFFFF' : '#6B7280',
                    border: form.category === c ? 'none' : '1px solid #E5E7EB',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <input
              style={INPUT}
              value={form.category}
              onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="or type your own"
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Note <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span>
            </label>
            <input
              style={INPUT}
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. petrol for Ali, evening deliveries"
            />
          </div>

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Amount ({currencySymbol})
            </label>
            <input
              style={INPUT}
              type="number"
              min="0"
              step="1"
              value={form.amount}
              onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="0"
            />
          </div>

          {/* The whole point of the screen: cash out of the till has to come
              off the drawer, or the count at close will be short by this. */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', borderRadius: 8,
            background: form.fromDrawer ? '#FEF2F2' : '#F9FAFB',
            border: `1px solid ${form.fromDrawer ? '#FECACA' : '#E5E7EB'}`,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Paid from the drawer</div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                {form.fromDrawer
                  ? 'Comes off the shift’s expected cash'
                  : 'Recorded only — the drawer is not adjusted'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.fromDrawer}
              aria-label="Paid from the drawer"
              onClick={() => setForm(f => ({ ...f, fromDrawer: !f.fromDrawer }))}
              style={{
                width: 44, height: 24, borderRadius: 12, position: 'relative',
                border: 'none', padding: 0, cursor: 'pointer',
                background: form.fromDrawer ? '#DC2626' : '#E5E5E0',
                transition: 'background 140ms', flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: form.fromDrawer ? 23 : 3,
                width: 18, height: 18, borderRadius: 9, background: '#FFFFFF',
                transition: 'left 140ms', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>

          {form.fromDrawer && shift && (
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              Drawer will go from <strong>{formatMoney(shift.expected_cash || 0)}</strong> to{' '}
              <strong>{formatMoney(Math.max(0, (shift.expected_cash || 0) - (Number(form.amount) || 0)))}</strong>
            </div>
          )}

          <button
            onClick={save}
            disabled={busy}
            style={{
              height: 44, borderRadius: 8, border: 'none', background: '#111111',
              color: '#FFFFFF', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4,
            }}
          >
            {busy ? 'Saving…' : 'Record Expense'}
          </button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
