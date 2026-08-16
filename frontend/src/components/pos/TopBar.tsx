import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, LayoutGrid, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { inventoryAPI } from '@/api/index';

interface TopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  onNavigate?: (page: string) => void;
  /** FIX (Bug 6): "Select Table" was a button that did nothing at all. */
  tableNumber?: string;
  onTableNumberChange?: (value: string) => void;
}

export default function TopBar({
  search,
  onSearchChange,
  onNavigate,
  tableNumber = '',
  onTableNumberChange,
}: TopBarProps) {
  const [lowStockCount, setLowStockCount] = useState(0);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableDraft, setTableDraft] = useState('');
  const { isAdmin } = useAuth();

  const openTableModal = () => {
    setTableDraft(tableNumber);
    setTableModalOpen(true);
  };

  const commitTable = () => {
    onTableNumberChange?.(tableDraft.trim());
    setTableModalOpen(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    const fetchLowStock = async () => {
      try {
        // FIX (Bug 3): was fetch('/api/...'), which fails under file:// in
        // the packaged Electron build. Now uses the absolute BASE_URL client.
        const data = await inventoryAPI.lowStock();
        if (data?.count !== undefined) {
          setLowStockCount(data.count);
        }
      } catch (err) {
        console.error('Failed to fetch low stock count:', err);
      }
    };
    
    fetchLowStock();
    // Poll every 60 seconds
    const interval = setInterval(fetchLowStock, 60000);
    // Also add event listener to update after a sale if desired, or let polling handle it
    return () => clearInterval(interval);
  }, [isAdmin]);
  return (
    <div
      style={{
        width: '100%',
        height: 56,
        background: '#FFFFFF',
        borderBottom: '1px solid #EBEBEB',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}
    >
      {/* Left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: '#111110', letterSpacing: '-0.4px' }}>
          Blaze
        </span>
        <div style={{ position: 'relative', width: 220 }}>
          <Search
            size={15}
            style={{ color: '#BCBCB4', position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search products...."
            style={{
              width: '100%',
              height: 34,
              background: '#F5F5F0',
              border: '1.5px solid #EBEBEB',
              borderRadius: 8,
              padding: '0 12px 0 34px',
              fontSize: 13,
              color: '#111110',
              outline: 'none',
              fontFamily: 'Inter, sans-serif',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#DC2626'; e.currentTarget.style.background = '#FFFFFF'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#EBEBEB'; e.currentTarget.style.background = '#F5F5F0'; }}
          />
        </div>
      </div>

      {/* Middle / Warning */}
      {lowStockCount > 0 && isAdmin && (
        <button
          onClick={() => onNavigate?.('inventory')}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#FEF2F2', border: '1px solid #FECACA',
            padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
            transition: 'background 140ms'
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
          onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}
        >
          <AlertTriangle size={15} color="#EF4444" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#DC2626' }}>
            {lowStockCount} {lowStockCount === 1 ? 'item' : 'items'} low on stock
          </span>
        </button>
      )}

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* The old Wifi icon was decorative and reported nothing real, so it
            has been dropped. Refresh actually reloads the app now. */}
        <button
          onClick={() => window.location.reload()}
          title="Refresh"
          style={{
            width: 34, height: 34, borderRadius: 8,
            background: '#FFFFFF', border: '1.5px solid #EBEBEB',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 140ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F5F2EA'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
        >
          <RefreshCw size={17} style={{ color: '#A3A39A' }} />
        </button>

        {tableNumber && (
          <button
            onClick={() => onTableNumberChange?.('')}
            title="Clear table"
            style={{
              height: 34, padding: '0 10px', gap: 6,
              background: '#FEEFD0', color: '#B91C1C',
              border: '1.5px solid #F2D9A0', borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Table {tableNumber}
            <X size={13} />
          </button>
        )}

        <button
          onClick={openTableModal}
          style={{
            height: 34, padding: '0 14px', gap: 6,
            background: '#111111', color: '#FFFFFF',
            border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex', alignItems: 'center',
            boxShadow: '0 2px 8px rgba(17,17,17,0.22)',
            transition: 'background 140ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#000000'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#111111'; }}
        >
          <LayoutGrid size={15} color="#FFFFFF" />
          {tableNumber ? 'Change Table' : 'Select Table'}
        </button>
      </div>

      {/* Table / token number capture. Deliberately a free-text field rather
          than a floor plan — this POS has no table-management schema, and a
          token number is what a fast-food counter actually needs. */}
      {tableModalOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.5)',
            zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setTableModalOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#FFFFFF', borderRadius: 16, padding: 24,
              width: '90%', maxWidth: 360,
              boxShadow: '0 10px 25px rgba(17,17,17,0.20)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111110', margin: 0 }}>
              Table / Token Number
            </h3>

            <input
              autoFocus
              value={tableDraft}
              onChange={e => setTableDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTable();
                if (e.key === 'Escape') setTableModalOpen(false);
              }}
              placeholder="e.g. 12 or T4"
              maxLength={12}
              style={{
                height: 46, borderRadius: 10,
                border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                padding: '0 14px', fontSize: 16, fontWeight: 600,
                color: '#111110', outline: 'none', fontFamily: 'Inter, sans-serif',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#DC2626'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#EBEBEB'; }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setTableModalOpen(false)}
                style={{
                  flex: 1, height: 42, borderRadius: 8,
                  border: '1.5px solid #EBEBEB', background: '#FFFFFF',
                  color: '#6B6B63', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={commitTable}
                style={{
                  flex: 1, height: 42, borderRadius: 8, border: 'none',
                  background: '#111111', color: '#FFFFFF',
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Set Table
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
