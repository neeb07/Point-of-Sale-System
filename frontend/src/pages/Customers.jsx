import React from 'react';
import { Users } from 'lucide-react';

export default function Customers() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <div
          className="flex items-center justify-center"
          style={{ width: 72, height: 72, borderRadius: 16, background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.3)' }}
        >
          <Users size={32} style={{ color: '#60A5FA' }} />
        </div>
        <h2 style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 22 }}>Customers</h2>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
          Customer management will appear here. This feature is coming soon.
        </p>
      </div>
    </div>
  );
}
