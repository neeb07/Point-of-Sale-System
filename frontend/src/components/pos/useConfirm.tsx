import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import AlertDialog, { AlertPanel, type AlertTone } from '@/components/pos/AlertDialog';

/**
 * `window.confirm` and `window.alert`, in the till's own clothes.
 *
 * The native ones were scattered across both apps. They are not merely ugly:
 * they are drawn by the operating system rather than the page, so on a
 * full-screen till they arrive as a grey box with the browser's name on it, in
 * a typeface nothing else uses, and staff reasonably read that as the machine
 * having gone wrong. They also block the whole renderer, which on the sale
 * screen means the till stops repainting mid-service.
 *
 * The awkward part of replacing them is that `window.confirm` is *synchronous*
 * — call it in the middle of a handler and carry on with the answer — whereas
 * a React dialog is a render. Rewriting every call site into two halves and a
 * piece of state would have been a lot of churn for a cosmetic change, and
 * churn is where mistakes get in.
 *
 * So this keeps the shape of the original:
 *
 *     if (!(await confirm({ title: 'Delete this item?' }))) return;
 *
 * One `await` is the whole difference. The promise settles when the person
 * presses something, and resolves false if they dismiss — the same answer
 * `window.confirm` gives for Cancel, so a call site that ignores the
 * distinction still behaves correctly.
 */

type Ask = {
  title: string;
  message?: React.ReactNode;
  /** The specifics, in a tinted panel: what is about to be deleted, say. */
  detail?: React.ReactNode;
  /** The caveat somebody would otherwise discover afterwards. */
  note?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AlertTone;
  icon?: LucideIcon;
};

export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  // A ref, not state: the resolver must survive the re-render that opening the
  // dialog causes, and must not itself cause one.
  const resolve = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    setAsk(null);
    const fn = resolve.current;
    resolve.current = null;
    if (fn) fn(answer);
  }, []);

  /** Ask a yes/no question. Resolves false on cancel or dismissal. */
  const confirm = useCallback((options: Ask) => new Promise<boolean>((res) => {
    // If something is already open, the previous caller is answered "no"
    // rather than left waiting on a promise that can never settle.
    if (resolve.current) resolve.current(false);
    resolve.current = res;
    setAsk(options);
  }), []);

  /** Say something that needs no decision. Resolves when it is dismissed. */
  const notify = useCallback((options: Omit<Ask, 'confirmLabel'>) =>
    confirm({ ...options, confirmLabel: undefined, cancelLabel: 'Close' }).then(() => undefined),
    [confirm]);

  const tone: AlertTone = ask?.tone ?? 'danger';
  const dialog = (
    <AlertDialog
      open={ask !== null}
      icon={ask?.icon ?? (ask?.confirmLabel ? HelpCircle : AlertTriangle)}
      tone={tone}
      title={ask?.title ?? ''}
      message={ask?.message ?? ''}
      note={ask?.note}
      confirmLabel={ask?.confirmLabel}
      onConfirm={ask?.confirmLabel ? () => settle(true) : undefined}
      dismissLabel={ask?.cancelLabel ?? 'Cancel'}
      onDismiss={() => settle(false)}
    >
      {ask?.detail ? (
        <AlertPanel label="Details" tone={tone}>
          <div style={{
            fontSize: 13,
            color: tone === 'danger' ? '#991B1B' : '#78350F',
            lineHeight: 1.5,
          }}>
            {ask.detail}
          </div>
        </AlertPanel>
      ) : null}
    </AlertDialog>
  );

  return { confirm, notify, dialog };
}

export default useConfirm;
