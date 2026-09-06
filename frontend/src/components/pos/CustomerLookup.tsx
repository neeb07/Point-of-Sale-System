import React, { useState, useEffect, useRef } from 'react';
import { customersAPI, type Customer } from '@/api/index';

/**
 * Name field for the delivery prompt, with a look-up of past customers.
 *
 * A regular should not have to dictate their address again. The cashier types
 * a few letters of the name — or the phone number, which is often what the
 * caller leads with — and picks the customer, which fills the phone and
 * address in one go.
 *
 * The list is only ever a suggestion: picking somebody fills the fields and
 * they stay editable, so a customer ordering to a different address tonight is
 * handled by typing over it rather than by starting again.
 */

const FIELD: React.CSSProperties = {
  width: '100%', height: 44, borderRadius: 8,
  border: '1.5px solid #EBEBEB', background: '#FFFFFF',
  padding: '0 12px', fontSize: 14, color: '#111110',
  outline: 'none', fontFamily: 'Inter, sans-serif',
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Fired when a past customer is picked, so the caller can fill the rest. */
  onPick: (c: Customer) => void;
}

export default function CustomerLookup({ value, onChange, onPick }: Props) {
  const [matches, setMatches] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  /*
   * Debounced so a fast typist does not fire a request per keystroke, and
   * guarded with a token so a slow early response cannot overwrite the
   * results of a later, more specific search.
   */
  const requestId = useRef(0);
  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) { setMatches([]); return; }

    const id = ++requestId.current;
    const timer = setTimeout(() => {
      customersAPI.search(term)
        .then(rows => {
          if (id !== requestId.current) return;
          setMatches(Array.isArray(rows) ? rows : []);
          setHighlight(0);
        })
        // A lookup failure must never block the sale — the cashier can still
        // type the details out in full.
        .catch(() => { if (id === requestId.current) setMatches([]); });
    }, 180);

    return () => clearTimeout(timer);
  }, [value]);

  const visible = open && matches.length > 0;

  const choose = (c: Customer) => {
    onPick(c);
    setOpen(false);
    setMatches([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!visible) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(matches[highlight]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div style={{ position: 'relative' }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
        Customer Name
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder="e.g. Ahmed Khan — or a phone number"
        autoComplete="off"
        style={FIELD}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#DC2626'; setOpen(true); }}
        /*
         * Closing on blur is delayed: a click on a suggestion blurs the input
         * before the click registers, so closing immediately would remove the
         * row out from under the pointer and the pick would never fire.
         */
        onBlur={(e) => {
          e.currentTarget.style.borderColor = '#EBEBEB';
          setTimeout(() => setOpen(false), 150);
        }}
      />

      {visible && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 40,
            marginTop: 4, background: '#FFFFFF',
            border: '1.5px solid #EBEBEB', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            maxHeight: 230, overflowY: 'auto',
          }}
        >
          {matches.map((c, i) => (
            <div
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: '9px 12px', cursor: 'pointer',
                background: i === highlight ? '#FEF2F2' : '#FFFFFF',
                borderBottom: i < matches.length - 1 ? '1px solid #F3F3F1' : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#111110' }}>
                  {c.name || 'Unnamed'}
                </span>
                <span style={{ fontSize: 12, color: '#9A9A92', whiteSpace: 'nowrap' }}>
                  {c.order_count} {c.order_count === 1 ? 'order' : 'orders'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#6B6B63', marginTop: 2 }}>
                {[c.phone, c.address].filter(Boolean).join(' · ') || 'No details on file'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
