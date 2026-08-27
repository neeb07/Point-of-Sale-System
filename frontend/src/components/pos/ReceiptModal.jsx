// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import Receipt, { COPY_TYPES } from './Receipt';
import { useSettings } from '@/lib/SettingsContext';

const COPY_TABS = [
  { value: 'all', label: 'All 3' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'customer', label: 'Customer' },
  { value: 'restaurant', label: 'Restaurant' },
];

export default function ReceiptModal({ open, onClose, orderData, autoPrintEnabled = true }) {
  /**
   * Which copies go to the printer. Defaults to all three, which is the
   * normal flow — the cashier hits Print once and separates the stack.
   * The individual options exist for reprints, when only one copy was
   * damaged, lost, or the customer asks for another.
   */
  const [selection, setSelection] = useState('all');
  const { autoPrint } = useSettings();

  /**
   * Settings has an "auto print" switch that nothing ever read, so a shop that
   * turned it on still had to click Print on every single sale.
   *
   * The guard matters: this fires once per receipt, not on every render, and
   * the ref is reset when the modal closes so the next sale prints again. A
   * reprint opened from the Orders screen passes autoPrintEnabled={false},
   * because silently firing the printer on a reprint would be a surprise.
   */
  const printedFor = useRef(null);

  useEffect(() => {
    if (!open || !orderData) {
      printedFor.current = null;
      return;
    }
    if (!autoPrint || !autoPrintEnabled) return;

    const key = orderData?.orderInfo?.orderNumber ?? 'current';
    if (printedFor.current === key) return;
    printedFor.current = key;

    // Let the receipts paint before handing off to the print dialog.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [open, orderData, autoPrint, autoPrintEnabled]);

  if (!open || !orderData) return null;

  const copiesToPrint = selection === 'all' ? COPY_TYPES : [selection];

  const handlePrint = () => {
    window.print();
  };

  const printLabel = selection === 'all'
    ? 'Print All 3 Copies'
    : `Print ${COPY_TABS.find(t => t.value === selection)?.label} Copy`;

  return (
    /*
      `flex + items-center` clips the top of the content once it grows
      taller than the viewport — the overflow goes above the scrollable
      area and becomes unreachable. Three receipts always exceed the
      viewport, which is why the first copy was cut off. Block layout with
      auto margins centres short content and scrolls tall content correctly.
    */
    <div
      className="fixed inset-0 print-root"
      style={{
        background: 'rgba(17,17,17,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 50,
        overflowY: 'auto',
        padding: '24px 16px',
      }}
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center print-root"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}
      >
        <div className="w-full flex justify-end mb-4 pr-4 no-print">
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 18,
              background: '#FFFFFF', color: '#111827',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(17,17,17,0.12)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Copy selector — screen only, never printed. */}
        <div
          className="no-print"
          style={{
            display: 'flex', gap: 6, marginBottom: 16,
            background: '#FFFFFF', padding: 6, borderRadius: 12,
            boxShadow: '0 4px 12px rgba(17,17,17,0.10)',
          }}
        >
          {COPY_TABS.map(tab => {
            const active = selection === tab.value;
            return (
              <button
                key={tab.value}
                onClick={() => setSelection(tab.value)}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                  background: active ? '#111111' : 'transparent',
                  color: active ? '#FFFFFF' : '#6B6B63',
                  border: 'none',
                  transition: 'all 140ms',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/*
          Printable area. Every selected copy is rendered here; the print
          stylesheet puts a page break after each one so a single print
          dialog produces the whole stack, cut between tickets.
        */}
        <div
          id="printable-area"
          style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {copiesToPrint.map(copyType => (
            <Receipt key={copyType} {...orderData} copyType={copyType} />
          ))}
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 transition-all duration-150 no-print"
          style={{
            height: 48, padding: '0 32px', borderRadius: 24,
            background: '#111111',
            boxShadow: '0 4px 20px rgba(17,17,17,0.35)',
            color: '#FFFFFF', fontSize: 16, fontWeight: 700,
            border: 'none', cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            marginBottom: 24,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#000000'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#111111'; }}
        >
          <Printer size={20} />
          {printLabel}
        </button>
      </div>
    </div>
  );
}
