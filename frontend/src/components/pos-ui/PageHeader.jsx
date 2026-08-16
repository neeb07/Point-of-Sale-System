import React from 'react';

export default function PageHeader({ title, subtitle, actionLabel, actionIcon: ActionIcon, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{subtitle}</p>}
      </div>
      {actionLabel && (
        <button
          onClick={onAction}
          className="flex items-center gap-2"
          style={{
            background: '#DC2626',
            color: '#FFFFFF',
            height: 40,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            padding: '0 20px',
            border: 'none',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#EA580C'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#DC2626'; }}
        >
          {ActionIcon && <ActionIcon size={16} />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}
