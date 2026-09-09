import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import AlertDialog, { AlertPanel } from '@/components/pos/AlertDialog';

/**
 * Shown when somebody tries to close the POS over an open drawer.
 *
 * The refusal happens in the main process, which knows nothing about React —
 * see electron/main.js. It holds the close, then pushes the open shifts here so
 * the message can name them. A native message box was the alternative and is
 * kept there as a fallback, but it cannot say *whose* drawer or put the person
 * one press from the screen that fixes it, and at the end of a shift that is
 * the difference between a useful refusal and an obstacle.
 *
 * Nothing renders outside Electron: a browser tab has no close to intercept.
 */

type OpenShift = {
  id: number;
  staff_name?: string | null;
  opened_at?: string | null;
};

/** "since 4:12 PM" — how long the drawer has been sitting. */
function openedAt(value?: string | null): string {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CloseBlockedDialog({
  onGoToShifts,
}: {
  onGoToShifts?: () => void;
}) {
  const [shifts, setShifts] = useState<OpenShift[] | null>(null);

  useEffect(() => {
    const api = (window as any).blazePOS;
    if (!api?.onCloseBlocked) return;
    // The unsubscribe matters: without it a remount stacks a second listener
    // and the dialog opens twice over itself.
    return api.onCloseBlocked((payload: { shifts?: OpenShift[] }) => {
      setShifts(Array.isArray(payload?.shifts) ? payload.shifts : []);
    });
  }, []);

  const dismiss = () => setShifts(null);

  return (
    <AlertDialog
      open={shifts !== null}
      icon={Lock}
      tone="danger"
      title="Close the shift first"
      message={
        <>
          Blaze POS will not close while a drawer is open. Closing the app does
          not close the shift — the cash would stay uncounted until tomorrow,
          when whoever took it has gone home.
        </>
      }
      note={
        // Said plainly, because otherwise this is where somebody gets stuck: a
        // manager can only close their own drawer, so one left open by
        // somebody who has gone home needs the owner.
        <>
          You can only close your own drawer. If this one is somebody else&rsquo;s,
          an administrator can close it from the Shifts screen.
        </>
      }
      confirmLabel="Go to Shifts"
      confirmIcon={ArrowRight}
      onConfirm={() => { dismiss(); onGoToShifts?.(); }}
      dismissLabel="Stay open"
      onDismiss={dismiss}
    >
      <AlertPanel label={(shifts?.length ?? 0) === 1 ? 'Open drawer' : 'Open drawers'}>
        {shifts?.length ? (
          shifts.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: 13.5,
                color: '#78350F',
                padding: '2px 0',
              }}
            >
              <span style={{ fontWeight: 700 }}>{s.staff_name || 'Unknown'}</span>
              {openedAt(s.opened_at) && (
                <span style={{ color: '#92400E' }}>since {openedAt(s.opened_at)}</span>
              )}
            </div>
          ))
        ) : (
          <div style={{ fontSize: 13.5, color: '#78350F' }}>A shift is still open.</div>
        )}
      </AlertPanel>
    </AlertDialog>
  );
}
