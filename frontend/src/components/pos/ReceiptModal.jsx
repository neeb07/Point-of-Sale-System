// @ts-nocheck
import React from 'react';
import { X, Printer } from 'lucide-react';
import Receipt from './Receipt';

export default function ReceiptModal({ open, onClose, orderData }) {
  if (!open || !orderData) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        className="flex flex-col items-center"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 400 }}
      >
        <div className="w-full flex justify-end mb-4 pr-4">
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 18,
              background: '#FFFFFF', color: '#111827',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Printable Area - We assign the ID here so CSS @media print targets it */}
        <div id="printable-area" style={{ marginBottom: 24 }}>
          <Receipt {...orderData} />
        </div>

        <button
          onClick={handlePrint}
          className="flex items-center gap-2 transition-all duration-150"
          style={{
            height: 48, padding: '0 32px', borderRadius: 24,
            background: '#F97316',
            boxShadow: '0 4px 20px rgba(249, 115, 22, 0.4)',
            color: '#FFFFFF', fontSize: 16, fontWeight: 700,
            border: 'none', cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <Printer size={20} />
          Print Receipt
        </button>
      </div>
    </div>
  );
}
