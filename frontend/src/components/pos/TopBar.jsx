import React from 'react';
import { Search, RefreshCw, Wifi, LayoutGrid } from 'lucide-react';

export default function TopBar({ search, onSearchChange }) {
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
          Restro POS
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
            onFocus={e => { e.currentTarget.style.borderColor = '#F97316'; e.currentTarget.style.background = '#FFFFFF'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#EBEBEB'; e.currentTarget.style.background = '#F5F5F0'; }}
          />
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {[RefreshCw, Wifi].map((Icon, i) => (
          <button
            key={i}
            style={{
              width: 34, height: 34, borderRadius: 8,
              background: '#FFFFFF', border: '1.5px solid #EBEBEB',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 140ms',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F5F5F0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#FFFFFF'; }}
          >
            <Icon size={17} style={{ color: '#A3A39A' }} />
          </button>
        ))}
        <button
          style={{
            height: 34, padding: '0 14px', gap: 6,
            background: '#F97316', color: '#FFFFFF',
            border: 'none', borderRadius: 8,
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
            display: 'flex', alignItems: 'center',
            boxShadow: '0 2px 8px rgba(249,115,22,0.28)',
            transition: 'background 140ms',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#EA6C0A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#F97316'; }}
        >
          <LayoutGrid size={15} color="#FFFFFF" />
          Select Table
        </button>
      </div>
    </div>
  );
}