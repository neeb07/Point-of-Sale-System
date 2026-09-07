import React, { useState } from 'react';
import { CloudUpload, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { syncAPI } from '@/api/index';

/**
 * "Sync now" — send this branch's sales to the cloud immediately.
 *
 * The till already pushes every 30 seconds on its own, so this button is not
 * how data normally travels. It exists for the moment the internet comes back
 * after an outage and somebody wants to *know* the day's takings have gone up,
 * rather than trust that they will. That reassurance is worth a button.
 *
 * Available to managers, not just the owner: when the connection returns it is
 * the manager standing at the till, and making them phone the owner to press it
 * is how a feature gets quietly abandoned.
 *
 * Safe to press repeatedly — the push is idempotent, so the worst a second
 * press can do is nothing.
 *
 * Hidden entirely on an unpaired till, where it would be a button that can only
 * ever fail.
 */

type Status = 'idle' | 'syncing' | 'done' | 'error';

export default function SyncNowButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(true);

  const run = async () => {
    if (status === 'syncing') return;
    setStatus('syncing');
    setMessage('');

    try {
      const res = await syncAPI.now();

      if (res.skipped === 'not paired') {
        // This till has no cloud configured, so the button is meaningless here.
        setVisible(false);
        return;
      }

      if (res.ok === false) {
        setStatus('error');
        setMessage(res.error || 'Could not reach the cloud');
      } else {
        const sent = res.sent || {};
        const total = (sent.orders || 0) + (sent.shifts || 0) + (sent.expenses || 0);
        setStatus('done');
        setMessage(total > 0 ? `Sent ${total}` : 'Up to date');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.message || 'Sync failed');
    } finally {
      // Settle back to the neutral state; the outcome is a moment's
      // reassurance, not something to leave sitting on the sale screen.
      setTimeout(() => { setStatus('idle'); setMessage(''); }, 4000);
    }
  };

  if (!visible) return null;

  const tone =
    status === 'error' ? { bg: '#FEF2F2', border: '#FECACA', fg: '#B91C1C' }
    : status === 'done' ? { bg: '#F0FDF4', border: '#BBF7D0', fg: '#15803D' }
    : { bg: '#FFFFFF', border: '#EBEBEB', fg: '#6B6B63' };

  const Icon =
    status === 'syncing' ? Loader2
    : status === 'done' ? Check
    : status === 'error' ? AlertTriangle
    : CloudUpload;

  return (
    <button
      onClick={run}
      disabled={status === 'syncing'}
      title={
        status === 'error'
          ? message
          : 'Send this branch’s sales to the head-office dashboard now'
      }
      style={{
        height: 34,
        padding: message ? '0 12px' : '0 10px',
        borderRadius: 8,
        background: tone.bg,
        border: `1.5px solid ${tone.border}`,
        color: tone.fg,
        cursor: status === 'syncing' ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 13, fontWeight: 600,
        transition: 'background 140ms',
      }}
    >
      <Icon
        size={16}
        style={status === 'syncing' ? { animation: 'spin 1s linear infinite' } : undefined}
      />
      {message && <span>{message}</span>}
    </button>
  );
}
