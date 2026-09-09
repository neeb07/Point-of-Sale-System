import React, { useEffect, useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';

/**
 * Shown when somebody tries to close the POS over an open drawer.
 *
 * The refusal happens in the main process, which knows nothing about React —
 * see electron/main.js. It holds the close, then pushes the open shifts here so
 * the message can name them. A native message box was the alternative and is
 * kept as a fallback, but it cannot say *whose* drawer or put the person one
 * press from the screen that fixes it, and at the end of a shift that is the
 * difference between a useful refusal and an obstacle.
 *
 * Nothing renders outside Electron: a browser tab has no close to intercept.
 */

type OpenShift = {
  id: number;
  staff_name?: string | null;
  opened_at?: string | null;
};

/** "opened at 4:12 PM" — the drawer has been sitting since then. */
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

  if (!shifts) return null;

  const dismiss = () => setShifts(null);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-blocked-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(17, 24, 39, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Inter', sans-serif",
      }}
      // Clicking away dismisses. The app stays open either way; this is a
      // message, not a decision, so trapping the person in it buys nothing.
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '24px 24px 0', display: 'flex', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#FEF2F2',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Lock size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <h2
              id="close-blocked-title"
              style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}
            >
              Close the shift first
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: '#4B5563', lineHeight: 1.55 }}>
              Blaze POS will not close while a drawer is open. Closing the app
              does not close the shift — the cash would stay uncounted until
              tomorrow, when whoever took it has gone home.
            </p>
          </div>
        </div>

        <div style={{ padding: '16px 24px 0' }}>
          <div
            style={{
              border: '1px solid #FDE68A',
              background: '#FFFBEB',
              borderRadius: 10,
              padding: '10px 14px',
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                color: '#92400E',
                marginBottom: shifts.length ? 6 : 0,
              }}
            >
              {shifts.length === 1 ? 'Open drawer' : 'Open drawers'}
            </div>
            {shifts.length ? (
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
          </div>
        </div>

        <p style={{ margin: '14px 24px 0', fontSize: 12.5, color: '#6B7280', lineHeight: 1.5 }}>
          {/*
            Said plainly, because otherwise this is where somebody gets stuck:
            a manager can only close their own drawer, so a shift left open by
            somebody who has gone home needs the owner.
          */}
          You can only close your own drawer. If this one is somebody else's, an
          administrator can close it from the Shifts screen.
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: 20,
            marginTop: 12,
            borderTop: '1px solid #F3F4F6',
            background: '#FAFAFA',
          }}
        >
          <button
            onClick={dismiss}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 9,
              border: '1px solid #D1D5DB',
              background: '#FFFFFF',
              color: '#374151',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Stay open
          </button>
          <button
            onClick={() => { dismiss(); onGoToShifts?.(); }}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 9,
              border: 'none',
              background: '#DC2626',
              color: '#FFFFFF',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'inherit',
            }}
          >
            Go to Shifts <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
