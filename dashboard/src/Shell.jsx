import React, { useState } from 'react';
import LiveScreen from './LiveScreen';
import ReportsScreen from './ReportsScreen';

/**
 * The signed-in frame: a header, and the two things the owner came for.
 *
 * Live leads because it answers the question that has no other source — what is
 * happening in the shops right now. Reports answers what already happened, and
 * is authoritative in a way the live view deliberately is not.
 */
export default function Shell({ user, onSignOut }) {
  const [tab, setTab] = useState('live');

  const tabStyle = (active) => ({
    padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? '#111827' : 'transparent',
    color: active ? '#FFFFFF' : '#6B7280',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F0' }}>
      <header style={{
        background: '#FFFFFF', borderBottom: '1px solid #E5E7EB',
        padding: '12px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>Blaze</span>
          <nav style={{ display: 'flex', gap: 4, background: '#F3F4F6', padding: 4, borderRadius: 10 }}>
            <button onClick={() => setTab('live')} style={tabStyle(tab === 'live')}>Live</button>
            <button onClick={() => setTab('reports')} style={tabStyle(tab === 'reports')}>Reports</button>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#6B7280' }}>{user.email}</span>
          <button onClick={onSignOut} style={{
            border: '1px solid #E5E7EB', background: '#FFFFFF', borderRadius: 8,
            padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151',
          }}>
            Sign out
          </button>
        </div>
      </header>

      {tab === 'live'
        ? <LiveScreen user={user} onSignOut={onSignOut} embedded />
        : <ReportsScreen />}
    </div>
  );
}
