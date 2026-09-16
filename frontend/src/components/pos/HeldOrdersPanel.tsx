// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Pencil, Printer, Trash2, CreditCard, X, RefreshCw } from 'lucide-react';
import { ordersAPI } from '@/api/index';
import { useSettings } from '@/lib/SettingsContext';
import { PAYMENT_METHODS } from '@/lib/constants';
import useConfirm from '@/components/pos/useConfirm';

/**
 * The board of tickets that have gone to the kitchen and not been paid for.
 *
 * Everything a manager does with a ticket happens here: confirm it and take
 * payment, change it, print any copy of it again, or cancel it. The sale screen
 * only ever sends tickets in; this is where they leave.
 *
 * Nothing on this board is a sale yet. That is not a display choice — the
 * backend keeps held tickets in a table of their own, so a ticket cannot leak
 * into a report or a shift total by any path. Confirming is the one and only
 * way a ticket becomes a sale, and it goes through the same code a direct sale
 * does.
 */

const ago = (value) => {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
};

const btn = (kind) => ({
  height: 36, padding: '0 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
  whiteSpace: 'nowrap',
  background: kind === 'primary' ? '#111111' : '#FFFFFF',
  color: kind === 'primary' ? '#FFFFFF' : kind === 'danger' ? '#B91C1C' : '#374151',
  border: `1px solid ${kind === 'primary' ? '#111111' : kind === 'danger' ? '#FECACA' : '#D1D5DB'}`,
});

export default function HeldOrdersPanel({ open, onClose, onEdit, onConfirmed, onPrint, onCountChange }) {
  const { formatMoney } = useSettings();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [paying, setPaying] = useState(null);      // ticket being confirmed
  /**
   * Which bill copies print once the ticket is a sale. Both by default; a
   * phone order collected later may want only the restaurant's, a customer
   * standing at the counter only theirs.
   */
  const PRINT_CHOICES = [
    { value: 'both', label: 'Both copies', copies: ['customer', 'restaurant'] },
    { value: 'customer', label: 'Customer only', copies: ['customer'] },
    { value: 'restaurant', label: 'Restaurant only', copies: ['restaurant'] },
  ];
  const [printChoice, setPrintChoice] = useState('both');
  const [payment, setPayment] = useState('Cash');
  const [busy, setBusy] = useState(false);
  const [printMenu, setPrintMenu] = useState(null); // ticket id with the print menu open

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await ordersAPI.held();
      setTickets(Array.isArray(rows) ? rows : []);
      setError(null);
      onCountChange?.(Array.isArray(rows) ? rows.length : 0);
    } catch (e) {
      setError(e.message || 'Could not load the held orders');
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  // Refreshed whenever the board is opened, and kept fresh in the background
  // so the badge on the sale screen is right without anybody opening it.
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [open, load]);

  const cancel = async (t) => {
    const sure = await confirm({
      title: `Cancel ticket ${t.ticket_no}?`,
      message: 'Nothing was sold, so nothing is voided — the ticket simply goes. The kitchen has already been sent it, so tell them.',
      detail: `${t.items.length} ${t.items.length === 1 ? 'line' : 'lines'} · ${formatMoney(t.total)}${t.table_number ? ` · table ${t.table_number}` : ''}`,
      confirmLabel: 'Cancel the ticket',
      tone: 'danger',
    });
    if (!sure) return;
    try {
      await ordersAPI.cancelHeld(t.id);
      await load();
    } catch (e) {
      setError(e.message || 'Could not cancel that ticket');
    }
  };

  const confirmTicket = async () => {
    if (!paying) return;
    setBusy(true);
    try {
      const order = await ordersAPI.confirmHeld(paying.id, { payment_method: payment });
      const copies = (PRINT_CHOICES.find(c => c.value === printChoice) || PRINT_CHOICES[0]).copies;
      setPaying(null);
      await load();
      onConfirmed?.(order, copies);
    } catch (e) {
      setError(e.message || 'Could not confirm that ticket');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(17,24,39,0.55)',
        backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
        fontFamily: "'Inter', sans-serif",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => { e.stopPropagation(); setPrintMenu(null); }}
        style={{
          width: 'min(560px, 100%)', background: '#F9FAFB', display: 'flex', flexDirection: 'column',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{
          padding: '18px 20px', background: '#FFFFFF', borderBottom: '1px solid #E5E7EB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111827' }}>Held orders</div>
            <div style={{ fontSize: 12.5, color: '#6B7280', marginTop: 2 }}>
              Sent to the kitchen, not yet paid. Confirm to record the sale.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn()} onClick={load} title="Refresh"><RefreshCw size={15} /></button>
            <button style={btn()} onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {error && (
          <div style={{
            margin: '12px 20px 0', padding: '10px 14px', borderRadius: 10,
            background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {loading && !tickets.length ? (
            <div style={{ color: '#9CA3AF', fontSize: 14 }}>Loading…</div>
          ) : !tickets.length ? (
            <div style={{
              color: '#6B7280', fontSize: 14, textAlign: 'center', padding: '48px 20px',
              background: '#FFFFFF', border: '1px dashed #D1D5DB', borderRadius: 12,
            }}>
              Nothing on hold. Charging an order sends it here first.
            </div>
          ) : tickets.map((t) => (
            <div key={t.id} style={{
              background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>{t.ticket_no}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E',
                    }}>
                      {t.order_type}{t.table_number ? ` · Table ${t.table_number}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Clock size={12} /> {ago(t.updated_at || t.held_at)}
                    {t.staff_name ? ` · ${t.staff_name}` : ''}
                    {t.customer_name ? ` · ${t.customer_name}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', whiteSpace: 'nowrap' }}>
                  {formatMoney(t.total)}
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 13, color: '#374151', lineHeight: 1.6 }}>
                {t.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{it.name}</span>
                    <span style={{ color: '#6B7280' }}>×{it.quantity}</span>
                  </div>
                ))}
              </div>

              {paying?.id === t.id ? (
                <div style={{
                  marginTop: 12, padding: 12, background: '#F9FAFB', borderRadius: 10,
                  border: '1px solid #E5E7EB',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                    Paid by
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        onClick={() => setPayment(m)}
                        style={{
                          ...btn(payment === m ? 'primary' : undefined), flex: 1, justifyContent: 'center',
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                    Print
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {PRINT_CHOICES.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setPrintChoice(c.value)}
                        style={{
                          ...btn(printChoice === c.value ? 'primary' : undefined), flex: 1, justifyContent: 'center',
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button style={btn()} onClick={() => setPaying(null)} disabled={busy}>Back</button>
                    <button style={btn('primary')} onClick={confirmTicket} disabled={busy}>
                      <CreditCard size={15} /> {busy ? 'Recording…' : `Confirm ${formatMoney(t.total)}`}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
                  <button style={btn('primary')} onClick={() => { setPaying(t); setPayment(t.payment_method || 'Cash'); setPrintChoice('both'); }}>
                    <CreditCard size={15} /> Confirm &amp; pay
                  </button>
                  <button style={btn()} onClick={() => onEdit?.(t)}>
                    <Pencil size={15} /> Edit
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button
                      style={btn()}
                      onClick={(e) => { e.stopPropagation(); setPrintMenu(printMenu === t.id ? null : t.id); }}
                    >
                      <Printer size={15} /> Print
                    </button>
                    {printMenu === t.id && (
                      <div style={{
                        position: 'absolute', top: 40, left: 0, zIndex: 5, background: '#FFFFFF',
                        border: '1px solid #E5E7EB', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                        padding: 4, minWidth: 180,
                      }}>
                        {[['kitchen', 'Kitchen copy'], ['customer', 'Customer copy'], ['restaurant', 'Restaurant copy']].map(([c, label]) => (
                          <button
                            key={c}
                            onClick={() => { setPrintMenu(null); onPrint?.(t, [c]); }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                              fontSize: 13, background: 'transparent', border: 'none', cursor: 'pointer',
                              fontFamily: 'inherit', color: '#374151', borderRadius: 6,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#F3F4F6'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1 }} />
                  <button style={btn('danger')} onClick={() => cancel(t)}>
                    <Trash2 size={15} /> Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
