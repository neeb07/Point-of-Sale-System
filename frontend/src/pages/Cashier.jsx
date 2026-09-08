// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Plus, MoreVertical } from 'lucide-react';
import PageHeader from '@/components/pos-ui/PageHeader';
import DataTable from '@/components/pos-ui/DataTable';
import Modal from '@/components/pos-ui/Modal';
import Toast from '@/components/pos-ui/Toast';
import { staffAPI, branchesAPI } from '@/api/index';
import { useSettings } from '@/lib/SettingsContext';

const AVATAR_COLORS = ['#DC2626', '#8B5CF6', '#3B82F6', '#10B981', '#EF4444', '#F59E0B'];

const CARD_STYLE = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 12,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const INPUT_STYLE = {
  height: 40, border: '1px solid #E5E7EB', borderRadius: 8, padding: '0 12px',
  fontSize: 14, width: '100%', outline: 'none', fontFamily: "'Inter', sans-serif",
};

function getInitials(name) {
  const parts = name.split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}

function PinInput({ value, onChange, length = 4 }) {
  const refs = useRef([]);

  const handleChange = (idx, char) => {
    if (!/^\d?$/.test(char)) return;
    const arr = value.split('');
    arr[idx] = char;
    const next = arr.join('').slice(0, length);
    onChange(next);
    if (char && idx < length - 1) refs.current[idx + 1]?.focus();
  };

  const handleKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !value[idx] && idx > 0) refs.current[idx - 1]?.focus();
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="password"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          style={{
            width: 48, height: 52, textAlign: 'center', fontSize: 20, fontWeight: 700,
            border: '2px solid #E5E7EB', borderRadius: 10, outline: 'none',
          }}
          onFocus={(e) => { e.target.style.borderColor = '#DC2626'; }}
          onBlur={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
        />
      ))}
    </div>
  );
}

function StaffCard({ staff, onEdit, onResetPin, onToggleActive, onDelete, menuOpen, onMenuToggle }) {
  const { formatMoney } = useSettings();
  const isActive = staff.status === 'Active' || staff.active === 1;
  const color = staff.color || '#DC2626';

  return (
    <div style={{ ...CARD_STYLE, padding: 20, position: 'relative' }}>
      <button
        onClick={() => onMenuToggle(staff.id)}
        style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <MoreVertical size={18} color="#9CA3AF" />
      </button>

      {menuOpen === staff.id && (
        <div style={{
          position: 'absolute', top: 36, right: 12, background: '#FFFFFF',
          border: '1px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          padding: 4, zIndex: 10,
        }}>
          {['Edit', 'Reset PIN', isActive ? 'Deactivate' : 'Activate', 'Delete'].map((action) => (
            <button
              key={action}
              onClick={() => {
                if (action === 'Edit') onEdit(staff);
                else if (action === 'Reset PIN') onResetPin(staff);
                else if (action === 'Delete') onDelete(staff);
                else onToggleActive(staff);
                onMenuToggle(null);
              }}
              style={{
                display: 'block', width: '100%', padding: '8px 12px', fontSize: 13,
                color: action === 'Deactivate' || action === 'Delete' ? '#EF4444' : '#374151',
                background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                // Set apart, because it is the one that cannot be undone.
                borderTop: action === 'Delete' ? '1px solid #F3F4F6' : 'none',
                marginTop: action === 'Delete' ? 4 : 0,
                paddingTop: action === 'Delete' ? 10 : 8,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F9FAFB'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {action}
            </button>
          ))}
        </div>
      )}

      <div style={{
        width: 64, height: 64, borderRadius: 9999, background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto', color: '#FFFFFF', fontWeight: 700, fontSize: 22,
      }}>
        {getInitials(staff.name)}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#111827', textAlign: 'center', marginTop: 12 }}>{staff.name}</div>
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <span style={{ background: '#F3F4F6', color: '#374151', fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 9999 }}>
          {staff.role}
        </span>
        {/* Which site they run — an admin covers both and shows nothing. */}
        {staff.branch_name && (
          <span style={{ background: '#FEF2F2', color: '#B91C1C', fontSize: 12, fontWeight: 600, padding: '3px 12px', borderRadius: 9999, marginLeft: 6 }}>
            {staff.branch_name}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: 9999, background: isActive ? '#22C55E' : '#D1D5DB' }} />
        <span style={{ fontSize: 13, color: isActive ? '#22C55E' : '#D1D5DB' }}>{isActive ? 'Active' : 'Inactive'}</span>
      </div>
      <div style={{ marginTop: 12, borderTop: '1px solid #F3F4F6', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>Today</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>{staff.todayOrders || 0}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#9CA3AF' }}>Revenue</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{formatMoney(staff.todayRevenue || 0)}</div>
        </div>
      </div>
    </div>
  );
}

export default function Cashier() {
  const { formatMoney } = useSettings();
  const [activeTab, setActiveTab] = useState('staff');
  const [staff, setStaff] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);
  const [toast, setToast] = useState(null);
  const [perfDate, setPerfDate] = useState('today');
  const [performance, setPerformance] = useState([]);
  const [form, setForm] = useState({ name: '', role: 'Manager', color: '#DC2626', pin: '', confirmPin: '', branch_id: '' });
  const [branches, setBranches] = useState([]);

  /*
   * Manager is the only role that can be handed out.
   *
   * Administrator used to be offered here, and its powers were the menu,
   * settings, staff and backups. All four now live on the head-office
   * dashboard, so an admin account's only remaining distinction would be the
   * ability to undo, at a till, the things that dashboard exists to control.
   * Running the till is a manager's job.
   *
   * An account that is *already* an administrator still shows its own role, so
   * editing that person's name does not quietly demote them.
   */
  const ASSIGNABLE_ROLES = ['Manager'];
  const roleOptions = editingStaff && editingStaff.role && !ASSIGNABLE_ROLES.includes(editingStaff.role)
    ? [...ASSIGNABLE_ROLES, editingStaff.role]
    : ASSIGNABLE_ROLES;
  const [errors, setErrors] = useState({});

  useEffect(() => {
    // Without the list the branch picker simply does not appear and accounts
    // are created unassigned, which is what happened before branches existed.
    branchesAPI.getAll()
      .then(rows => setBranches(Array.isArray(rows) ? rows : []))
      .catch(() => setBranches([]));
  }, []);

  const loadStaff = async () => {
    try {
      const data = await staffAPI.getAll();
      setStaff(data.map((s) => ({
        ...s,
        status: s.active ? 'Active' : 'Inactive',
        color: s.color || '#DC2626',
      })));
    } catch {
      setStaff([]);
    }
  };

  const loadPerformance = async () => {
    try {
      const params = {};
      if (perfDate === 'today') {
        const today = new Date().toISOString().split('T')[0];
        params.from = today;
        params.to = today;
      } else if (perfDate === 'week') {
        params.from = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
        params.to = new Date().toISOString().split('T')[0];
      } else if (perfDate === 'month') {
        params.from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
        params.to = new Date().toISOString().split('T')[0];
      }
      const raw = await staffAPI.performance(params);

      /**
       * The endpoint returns total_orders / total_revenue / avg_order_value /
       * total_discounts, but the table below reads orders / revenue /
       * avg_order / discounts. None of those existed on the response, so every
       * figure in the Performance tab rendered as 0 regardless of the data.
       * Normalised here, the same way the reports screen does it.
       */
      const data = (raw || []).map(p => ({
        ...p,
        orders: Number(p.total_orders) || 0,
        revenue: Number(p.total_revenue) || 0,
        avg_order: Number(p.avg_order_value) || 0,
        discounts: Number(p.total_discounts) || 0,
      }));
      // Map backend field names to frontend expectations
      const mappedData = data.map(d => ({
        ...d,
        orders: d.total_orders || 0,
        revenue: d.total_revenue || 0,
        avg_order: d.avg_order_value || 0,
        discounts: d.total_discounts || 0,
      }));
      setPerformance(mappedData);
    } catch {
      setPerformance([]);
    }
  };

  useEffect(() => { loadStaff(); }, []);
  useEffect(() => { if (activeTab === 'performance') loadPerformance(); }, [activeTab, perfDate]);

  const openAdd = () => {
    setEditingStaff(null);
    setForm({ name: '', role: 'Manager', color: '#DC2626', pin: '', confirmPin: '', branch_id: '' });
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (s) => {
    setEditingStaff(s);
    setForm({ name: s.name, role: s.role, color: s.color || '#DC2626', pin: '', confirmPin: '', branch_id: s.branch_id ? String(s.branch_id) : '' });
    setErrors({});
    setModalOpen(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!editingStaff) {
      if (form.pin.length !== 4) e.pin = 'PIN must be 4 digits';
      if (form.pin !== form.confirmPin) e.confirmPin = 'PINs do not match';
      // A manager runs one shop. Without a branch their sales and expenses are
      // filed under none, and neither branch's figures include them.
      if (!form.branch_id) e.branch_id = 'Choose which branch this person works at';
    }
    // A PIN left blank on an edit means "leave it alone". One that is typed
    // must be four digits and must be confirmed — a mistyped PIN locks somebody
    // out of the till they are standing at, and nobody finds out until then.
    if (editingStaff && form.pin) {
      if (form.pin.length !== 4) e.pin = 'PIN must be 4 digits';
      else if (form.pin !== form.confirmPin) e.confirmPin = 'PINs do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      if (editingStaff) {
        // The role is sent only when it changed. An existing administrator
        // edited from the dashboard would otherwise re-submit 'Admin', which
        // the cloud refuses to assign — turning a name change into an error.
        await staffAPI.update(editingStaff.id, {
          name: form.name,
          ...(form.role !== editingStaff.role ? { role: form.role } : {}),
          color: form.color,
          pin: form.pin || undefined,
          branch_id: form.branch_id ? Number(form.branch_id) : null,
        });
      } else {
        await staffAPI.create({ name: form.name, role: form.role, pin: form.pin, color: form.color, branch_id: form.branch_id ? Number(form.branch_id) : null });
      }
      setModalOpen(false);
      loadStaff();
      setToast({ message: editingStaff ? 'Staff updated' : 'Staff added', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Failed to save', type: 'error' });
    }
  };

  const handleToggleActive = async (s) => {
    const isActive = s.status === 'Active' || s.active === 1;
    try {
      await staffAPI.update(s.id, { active: !isActive });
      loadStaff();
      setToast({ message: `${s.name} ${isActive ? 'deactivated' : 'reactivated'}`, type: 'success' });
    } catch (err) {
      // Previously unhandled, which is exactly what "nothing happens when I
      // deactivate staff" looked like: the call was refused, the rejection went
      // nowhere, and the row simply stayed as it was with no explanation.
      setToast({ message: err.message || 'Could not change that account', type: 'error' });
    }
  };

  /*
   * Remove somebody for good.
   *
   * Deactivating is the right answer for a person who has left, so the wording
   * points there first: this is for accounts that should not exist at all — a
   * test row, a duplicate, a name typed wrong.
   *
   * It is safe for the records. Every order, shift and expense stores the name
   * of whoever recorded it at the time, so deleting the account takes away the
   * ability to sign in and leaves last month's reports reading exactly as they
   * did.
   */
  const handleDelete = async (s) => {
    const sure = window.confirm([
      `Delete ${s.name} permanently?`,
      '',
      'They will not be able to sign in at any till. Orders and shifts they',
      'already recorded keep their name, so your reports are unchanged.',
      '',
      'If they have simply left, use Deactivate instead — that can be undone.',
    ].join('\n'));
    if (!sure) return;
    try {
      await staffAPI.delete(s.id);
      loadStaff();
      setToast({ message: `${s.name} deleted`, type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Could not delete that account', type: 'error' });
    }
  };

  const maxRevenue = Math.max(...performance.map((p) => p.revenue || 0), 1);

  const perfColumns = [
    {
      key: 'name',
      label: 'Cashier',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9999, background: '#DC2626',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFFFFF', fontWeight: 700, fontSize: 12,
          }}>
            {getInitials(row.name)}
          </div>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{row.name}</span>
        </div>
      ),
    },
    { key: 'orders', label: 'Orders', align: 'center', render: (row) => row.orders || 0 },
    { key: 'revenue', label: 'Revenue', render: (row) => <span style={{ fontWeight: 700 }}>{formatMoney(row.revenue || 0)}</span> },
    { key: 'avg_order', label: 'Avg Order', render: (row) => formatMoney(row.avg_order || 0) },
    {
      key: 'discounts',
      label: 'Discounts Given',
      render: (row) => (
        <span style={{ color: row.discounts > 0 ? '#EF4444' : '#9CA3AF' }}>
          {formatMoney(row.discounts || 0)}
        </span>
      ),
    },
    { key: 'busiest_hour', label: 'Busiest Hour', render: (row) => row.busiest_hour || '—' },
  ];

  const isFormValid = form.name.trim() && (editingStaff || (form.pin.length === 4 && form.pin === form.confirmPin));

  return (
    <div style={{ flex: 1, height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ padding: 24, flex: 1, overflow: 'auto' }}>
        <PageHeader
          title="Cashier"
          subtitle="Manage staff accounts and performance"
          actionLabel="Add Staff"
          actionIcon={Plus}
          onAction={openAdd}
        />

        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #E5E7EB', marginBottom: 24 }}>
          {[{ id: 'staff', label: 'Staff Accounts' }, { id: 'performance', label: 'Performance' }].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                border: 'none', background: 'transparent',
                color: activeTab === tab.id ? '#DC2626' : '#6B7280',
                borderBottom: activeTab === tab.id ? '2px solid #DC2626' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'staff' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {staff.map((s) => (
              <StaffCard
                key={s.id}
                staff={s}
                onEdit={openEdit}
                onResetPin={() => openEdit(s)}
                onToggleActive={handleToggleActive}
                onDelete={handleDelete}
                menuOpen={menuOpen}
                onMenuToggle={setMenuOpen}
              />
            ))}
          </div>
        )}

        {activeTab === 'performance' && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[{ id: 'today', label: 'Today' }, { id: 'week', label: 'This Week' }, { id: 'month', label: 'This Month' }].map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setPerfDate(chip.id)}
                  style={{
                    padding: '6px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    background: perfDate === chip.id ? '#DC2626' : '#FFFFFF',
                    color: perfDate === chip.id ? '#FFFFFF' : '#6B7280',
                    border: perfDate === chip.id ? 'none' : '1px solid #E5E7EB',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
              <DataTable columns={perfColumns} data={performance} emptyTitle="No performance data" />
            </div>

            <div style={{ ...CARD_STYLE, padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Revenue by Cashier</div>
              {performance.map((p) => {
                const pct = Math.round(((p.revenue || 0) / maxRevenue) * 100);
                return (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 100, fontSize: 13, color: '#374151' }}>{p.name.split(' ')[0]}</div>
                    <div style={{ flex: 1, height: 28, background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${pct}%`,
                        background: 'linear-gradient(90deg, #DC2626, #FB923C)',
                        borderRadius: 6, transition: 'width 600ms ease',
                      }} />
                    </div>
                    <div style={{ width: 100, fontSize: 13, fontWeight: 700, color: '#111827', textAlign: 'right' }}>
                      {formatMoney(p.revenue || 0)} ({pct}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editingStaff ? 'Edit Staff Member' : 'Add New Staff'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Full Name</label>
            <input style={{ ...INPUT_STYLE, marginTop: 6 }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            {errors.name && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.name}</div>}
          </div>

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Role</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {roleOptions.map((r) => (
                <button
                  key={r}
                  onClick={() => setForm({ ...form, role: r })}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                    background: form.role === r ? '#DC2626' : '#FFFFFF',
                    color: form.role === r ? '#FFFFFF' : '#374151',
                    border: form.role === r ? '1px solid #DC2626' : '1px solid #E5E7EB',
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/*
            Which branch this person runs.

            Offered only for a manager: an admin oversees both sites, so tying
            them to one would stamp their own sales and expenses with a single
            branch and skew that branch's figures.
          */}
          {form.role === 'Manager' && branches.length > 0 && (
            <div>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Branch</label>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {branches.map((b) => {
                  const picked = String(form.branch_id) === String(b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => setForm({ ...form, branch_id: picked ? '' : String(b.id) })}
                      style={{
                        padding: '8px 16px', borderRadius: 8, fontSize: 14, cursor: 'pointer',
                        background: picked ? '#DC2626' : '#FFFFFF',
                        color: picked ? '#FFFFFF' : '#374151',
                        border: picked ? '1px solid #DC2626' : '1px solid #E5E7EB',
                      }}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
              {errors.branch_id && (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.branch_id}</div>
              )}
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>
                Every sale and expense they record is filed under this branch.
                {editingStaff ? ' Changing it does not move sales they have already rung up.' : ''}
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Avatar Color</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  style={{
                    width: 32, height: 32, borderRadius: 9999, background: c, cursor: 'pointer',
                    border: form.color === c ? '3px solid #FFFFFF' : 'none',
                    outline: form.color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>4-Digit PIN</label>
            <div style={{ marginTop: 8 }}>
              <PinInput value={form.pin} onChange={(v) => setForm({ ...form, pin: v })} />
            </div>
            {errors.pin && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.pin}</div>}
            {editingStaff && !form.pin && (
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
                Leave blank to keep their current PIN.
              </div>
            )}
          </div>

          {/*
            Shown when adding, and when editing as soon as a new PIN is typed.
            It used to be hidden on edit while the validation still demanded it
            match, so changing somebody's PIN always failed — with the error
            attached to a field that was not on screen, which is why it looked
            like the button did nothing at all.
          */}
          {(!editingStaff || form.pin) && (
            <div>
              <label style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Confirm PIN</label>
              <div style={{ marginTop: 8 }}>
                <PinInput value={form.confirmPin} onChange={(v) => setForm({ ...form, confirmPin: v })} />
              </div>
              {errors.confirmPin && <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{errors.confirmPin}</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => setModalOpen(false)} style={{ flex: 1, height: 40, borderRadius: 8, border: '1px solid #E5E7EB', background: '#FFFFFF', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
            <button
              disabled={!isFormValid}
              onClick={handleSave}
              style={{
                flex: 1, height: 40, borderRadius: 8, border: 'none', fontWeight: 600,
                background: isFormValid ? '#DC2626' : '#E5E7EB',
                color: isFormValid ? '#FFFFFF' : '#9CA3AF',
                cursor: isFormValid ? 'pointer' : 'not-allowed',
              }}
            >
              Save Staff
            </button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
