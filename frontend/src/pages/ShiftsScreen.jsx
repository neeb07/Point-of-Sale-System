// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Clock } from 'lucide-react';
import { shiftsAPI } from '@/api/index';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/lib/SettingsContext';
import PageHeader from '@/components/pos-ui/PageHeader';
import Modal from '@/components/pos-ui/Modal';
import Toast from '@/components/pos-ui/Toast';

/**
 * Shift management.
 *
 * Opening the drawer with a float and closing it with a count is the till
 * user's job, but this lived inside Settings — which is now administrator-only.
 * A manager could not have started or reconciled their own shift.
 *
 * This is the single implementation; the Settings tab was removed rather than
 * left behind as a second copy to drift out of step.
 */

const INPUT_STYLE = {
  width: '100%', height: 44,
  background: '#FFFFFF',
  border: '1.5px solid #E5E7EB',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 14,
  color: '#111827',
  outline: 'none',
  fontFamily: 'Inter, sans-serif',
};

/** Backend timestamps are local wall-clock strings, not UTC. */
const parseStamp = (value) => (value ? new Date(String(value).replace(' ', 'T')) : null);
const fmtTime = (d) => (d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—');

export default function ShiftsScreen() {
  const { currentUser } = useAuth();
  const { formatMoney, currencySymbol } = useSettings();

  const [currentShift, setCurrentShift] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [actualCash, setActualCash] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cur, hist] = await Promise.all([shiftsAPI.current(), shiftsAPI.history(10)]);
      setCurrentShift(cur);
      setHistory(hist || []);
    } catch (err) {
      setToast({ message: err.message || 'Could not load shifts', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keeps the running duration honest without refetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const shiftOpen = !!currentShift;
  const openedAt = parseStamp(currentShift?.opened_at);
  const cashRevenue = Number(currentShift?.cash_revenue || 0);

  /**
   * Expected drawer = opening float + cash sales only. Card and online sales
   * never touch the till, so including them would guarantee a variance.
   * The server computes this too; this is the live preview.
   */
  const expectedCash = shiftOpen
    ? Number(currentShift?.opening_cash || 0) + cashRevenue
    : 0;
  const cashDiff = (Number(actualCash) || 0) - expectedCash;

  const duration = (() => {
    if (!openedAt) return '—';
    const mins = Math.max(0, Math.floor((now - openedAt.getTime()) / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  })();

  const startShift = async () => {
    setBusy(true);
    try {
      await shiftsAPI.open({
        opening_cash: Number(openingCash) || 0,
        staff_id: currentUser?.id || null,
        staff_name: currentUser?.name || 'Unknown',
      });
      await load();
      setOpenModal(false);
      setOpeningCash('');
      setToast({ message: 'Shift started', type: 'success' });
    } catch (err) {
      setToast({ message: err.message || 'Could not start shift', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const closeShift = async () => {
    setBusy(true);
    try {
      const closed = await shiftsAPI.close({ closing_cash: Number(actualCash) || 0 });
      await load();
      setCloseModal(false);
      setActualCash('');
      const variance = Number(closed?.variance || 0);
      setToast({
        message: variance === 0
          ? 'Shift closed — drawer balanced'
          : `Shift closed — drawer ${variance > 0 ? 'over' : 'short'} by ${formatMoney(Math.abs(variance))}`,
        type: variance === 0 ? 'success' : 'error',
      });
    } catch (err) {
      setToast({ message: err.message || 'Could not close shift', type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, value, muted }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
      <span style={{ fontSize: 13, color: '#6B7280' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: muted ? 500 : 700, color: muted ? '#6B7280' : '#111827' }}>{value}</span>
    </div>
  );

  return (
    <div className="flex-1 h-full overflow-y-auto" style={{ padding: 32, background: '#F5F2EA' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <PageHeader title="Shifts" subtitle="Open the drawer with a float, close it with a count" />

        {loading && <div style={{ fontSize: 13, color: '#9CA3AF' }}>Loading shifts…</div>}

        {!loading && !shiftOpen && (
          <div style={{
            border: '2px dashed #E5E7EB', borderRadius: 12, padding: 40,
            textAlign: 'center', marginBottom: 24, background: '#FFFFFF',
          }}>
            <Clock size={40} color="#9CA3AF" style={{ margin: '0 auto 12px' }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#374151', marginBottom: 16 }}>No active shift</div>
            <button
              onClick={() => setOpenModal(true)}
              style={{
                background: '#DC2626', color: '#FFFFFF', height: 40, borderRadius: 8,
                fontWeight: 600, fontSize: 14, padding: '0 20px', border: 'none', cursor: 'pointer',
              }}
            >
              Open Shift
            </button>
          </div>
        )}

        {!loading && shiftOpen && (
          <div style={{
            border: '2px solid #22C55E', borderRadius: 12, padding: 24,
            marginBottom: 24, background: '#FFFFFF',
          }}>
            <Row label="Started" value={fmtTime(openedAt)} />
            <Row label="Duration" value={duration} />
            <Row label="Opened by" value={currentShift?.staff_name || '—'} />
            <Row label="Opening float" value={formatMoney(currentShift?.opening_cash || 0)} />
            <Row label="Orders so far" value={Number(currentShift?.total_orders || 0)} />
            <Row label="Revenue so far" value={formatMoney(currentShift?.total_revenue || 0)} />
            <Row muted label="Cash" value={formatMoney(cashRevenue)} />
            <Row muted label="Card / Online" value={formatMoney(currentShift?.non_cash_revenue || 0)} />
            <div style={{ borderTop: '1px solid #F3F4F6', margin: '12px 0' }} />
            <Row label="Expected in drawer" value={formatMoney(expectedCash)} />
            <button
              onClick={() => setCloseModal(true)}
              disabled={busy}
              style={{
                marginTop: 12,
                background: '#FFFFFF', border: '1px solid #EF4444', color: '#EF4444',
                height: 40, borderRadius: 8, fontWeight: 600, fontSize: 14,
                padding: '0 20px', cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Closing…' : 'Close Shift'}
            </button>
          </div>
        )}

        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Recent Shifts</div>
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: '4px 16px', border: '1px solid #EBEBEB' }}>
          {!loading && history.length === 0 && (
            <div style={{ fontSize: 13, color: '#9CA3AF', padding: '14px 0' }}>No closed shifts yet.</div>
          )}
          {history.map((sh) => {
            const opened = parseStamp(sh.opened_at);
            const closed = parseStamp(sh.closed_at);
            const variance = Number(sh.variance || 0);
            return (
              <div
                key={sh.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 0', borderBottom: '1px solid #F3F4F6',
                }}
              >
                <div style={{ fontSize: 13, color: '#374151' }}>
                  {opened ? opened.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  {' · '}{fmtTime(opened)}–{fmtTime(closed)}
                  {' · '}{sh.total_orders} orders
                  {' · '}{formatMoney(sh.total_revenue || 0)}
                  {' · '}{sh.staff_name || '—'}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: variance === 0 ? '#16A34A' : '#DC2626' }}>
                  {variance === 0 ? 'Balanced' : `${variance > 0 ? '+' : '−'}${formatMoney(Math.abs(variance))}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal isOpen={openModal} onClose={() => setOpenModal(false)} title="Open Shift" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Opening cash amount ({currencySymbol})
            </label>
            <input
              style={INPUT_STYLE}
              type="number"
              min="0"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              placeholder="0"
            />
          </div>
          <button
            onClick={startShift}
            disabled={busy}
            style={{
              height: 44, borderRadius: 8, border: 'none', background: '#111111',
              color: '#FFFFFF', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Starting…' : 'Start Shift'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={closeModal} onClose={() => setCloseModal(false)} title="Close Shift" width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label="Total revenue" value={formatMoney(currentShift?.total_revenue || 0)} />
          <Row label="Discounts given" value={formatMoney(currentShift?.total_discounts || 0)} />
          <Row muted label="Opening float" value={formatMoney(currentShift?.opening_cash || 0)} />
          <Row muted label="Cash sales" value={formatMoney(cashRevenue)} />
          <Row label="Expected in drawer" value={formatMoney(expectedCash)} />

          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Counted cash in drawer ({currencySymbol})
            </label>
            <input
              style={INPUT_STYLE}
              type="number"
              min="0"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              placeholder="0"
            />
          </div>

          {actualCash !== '' && (
            <div style={{
              fontSize: 13, fontWeight: 700,
              color: cashDiff === 0 ? '#16A34A' : '#DC2626',
            }}>
              Difference: {cashDiff >= 0 ? '+' : '−'}{formatMoney(Math.abs(cashDiff))}
              {cashDiff === 0 ? ' (balanced)' : cashDiff > 0 ? ' (over)' : ' (short)'}
            </div>
          )}

          <button
            onClick={closeShift}
            disabled={busy}
            style={{
              height: 44, borderRadius: 8, border: 'none', background: '#DC2626',
              color: '#FFFFFF', fontSize: 14, fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Closing…' : 'Close Shift'}
          </button>
        </div>
      </Modal>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
