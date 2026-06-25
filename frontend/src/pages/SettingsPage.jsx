import React from 'react';
import { Settings } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center gap-4">
        <div
          className="flex items-center justify-center"
          style={{
            width: 72, height: 72, borderRadius: 16,
            background: 'rgba(124,58,237,0.2)',
            border: '1px solid rgba(124,58,237,0.3)',
          }}
        >
          <Settings size={32} style={{ color: '#A78BFA' }} />
        </div>
        <h2 style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 22 }}>Settings</h2>
        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
          Restaurant settings and configuration will appear here. This feature is coming soon.
        </p>
      </div>
    </div>
  );
}