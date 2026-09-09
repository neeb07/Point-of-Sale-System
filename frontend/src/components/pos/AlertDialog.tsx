import React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The till's way of refusing something.
 *
 * Two places need to say "no, and here is what to do instead": closing the app
 * over an open drawer, and ringing up an order before a shift is open. They are
 * the same sentence in different words, so they are the same component — a
 * second copy would have drifted the first time one of them was adjusted.
 *
 * Built for the counter rather than the desk. Large enough to read at arm's
 * length over a queue, with the action that fixes the problem as the primary
 * button, because the person reading it is mid-service and does not want to
 * work out where to go next.
 *
 * `tone` only moves the colour of the icon and the primary button. A refusal
 * that can be resolved on the spot ("open a shift") is amber; one that means
 * something is actually wrong is red. Nothing else changes, so the two never
 * look like different dialogs.
 */

export type AlertTone = 'warning' | 'danger';

const TONES: Record<AlertTone, { tint: string; ink: string; solid: string }> = {
  warning: { tint: '#FFFBEB', ink: '#B45309', solid: '#B45309' },
  danger: { tint: '#FEF2F2', ink: '#DC2626', solid: '#DC2626' },
};

export default function AlertDialog({
  open,
  icon: Icon,
  tone = 'danger',
  title,
  message,
  children,
  note,
  confirmLabel,
  confirmIcon: ConfirmIcon,
  onConfirm,
  dismissLabel = 'Close',
  onDismiss,
}: {
  open: boolean;
  icon: LucideIcon;
  tone?: AlertTone;
  title: string;
  message: React.ReactNode;
  /** The specifics — a list of open drawers, say. Sits in a tinted panel. */
  children?: React.ReactNode;
  /** A quieter line under the panel, for the caveat somebody will otherwise hit. */
  note?: React.ReactNode;
  confirmLabel?: string;
  confirmIcon?: LucideIcon;
  onConfirm?: () => void;
  dismissLabel?: string;
  onDismiss: () => void;
}) {
  if (!open) return null;
  const t = TONES[tone];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
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
      // Clicking away dismisses. Every use of this is a message rather than a
      // decision — the refusal has already happened — so trapping somebody in
      // it buys nothing and costs them a moment at the counter.
      onClick={onDismiss}
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
              background: t.tint,
              color: t.ink,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111827' }}>
              {title}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13.5, color: '#4B5563', lineHeight: 1.55 }}>
              {message}
            </p>
          </div>
        </div>

        {children && <div style={{ padding: '16px 24px 0' }}>{children}</div>}

        {note && (
          <p style={{ margin: '14px 24px 0', fontSize: 12.5, color: '#6B7280', lineHeight: 1.5 }}>
            {note}
          </p>
        )}

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
            onClick={onDismiss}
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
            {dismissLabel}
          </button>
          {confirmLabel && onConfirm && (
            <button
              onClick={onConfirm}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 9,
                border: 'none',
                background: t.solid,
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
              {confirmLabel}
              {ConfirmIcon && <ConfirmIcon size={16} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The tinted panel inside a dialog, for the specifics.
 *
 * Exported alongside rather than built in, because what goes in it differs —
 * a list of drawers in one case, a single line in the other — while the box
 * around it should not.
 */
export function AlertPanel({
  label,
  tone = 'warning',
  children,
}: {
  label: string;
  tone?: AlertTone;
  children: React.ReactNode;
}) {
  const border = tone === 'danger' ? '#FECACA' : '#FDE68A';
  const ink = tone === 'danger' ? '#991B1B' : '#92400E';
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        background: TONES[tone].tint,
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
          color: ink,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
