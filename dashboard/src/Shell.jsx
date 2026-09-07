import React, { useState } from 'react';
import LiveScreen from './LiveScreen';
import { AuthProvider } from './pos-shims/AuthContext';
import { POSProvider } from './pos-shims/POSContext';
import { SettingsProvider } from '@/lib/SettingsContext';

// The POS's own screens, rendered here rather than reimplemented. See
// vite.config.js for how their three environment-specific imports are replaced.
import Reports from '@/pages/Reports';
import ExpensesScreen from '@/pages/ExpensesScreen';
import ShiftsScreen from '@/pages/ShiftsScreen';
import Cashier from '@/pages/Cashier';
import InventoryScreen from '@/pages/InventoryScreen';

/**
 * The signed-in frame.
 *
 * Live leads because it answers the question nothing else can — what is
 * happening in the shops right now. Everything after it is the till's own
 * screen, reading the branches' synced data.
 */
const TABS = [
  { key: 'live', label: 'Live', Screen: null },
  { key: 'reports', label: 'Reports', Screen: Reports },
  { key: 'expenses', label: 'Expenses', Screen: ExpensesScreen },
  { key: 'shifts', label: 'Shifts', Screen: ShiftsScreen },
  { key: 'staff', label: 'Staff', Screen: Cashier },
  { key: 'inventory', label: 'Inventory', Screen: InventoryScreen },
];

/*
 * Menu and Deals are deliberately absent for now.
 *
 * The cloud does not own a menu yet, so those screens would render empty — and
 * an empty Menu tab reads as "this shop has no menu", not as "not built yet".
 * They arrive together with menu editing, which is the point at which the cloud
 * becomes the menu's single writer and the tills start pulling from it.
 */

/**
 * Which tabs show only what the branches have sent, and cannot change it.
 *
 * Said once, plainly, rather than leaving someone to discover it by pressing a
 * button and getting an error. These things are recorded at the till and there
 * is no downlink for them — only the menu travels the other way.
 */
const READ_ONLY = new Set(['expenses', 'shifts', 'staff', 'inventory']);

export default function Shell({ user, onSignOut }) {
  const [tab, setTab] = useState('live');
  const active = TABS.find(t => t.key === tab) || TABS[0];

  const tabStyle = (isActive) => ({
    padding: '7px 14px', borderRadius: 8, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
    background: isActive ? '#111827' : 'transparent',
    color: isActive ? '#FFFFFF' : '#6B7280',
  });

  return (
    <AuthProvider user={user} onSignOut={onSignOut}>
      <SettingsProvider>
        <POSProvider>
          <div style={{ minHeight: '100vh', background: '#F5F5F0' }}>
            <header style={{
              background: '#FFFFFF', borderBottom: '1px solid #E5E7EB',
              padding: '10px 20px', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#111827' }}>Blaze</span>
                <nav style={{
                  display: 'flex', gap: 2, background: '#F3F4F6', padding: 3,
                  borderRadius: 10, overflowX: 'auto',
                }}>
                  {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
                      {t.label}
                    </button>
                  ))}
                </nav>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#6B7280' }}>{user.email}</span>
                <button onClick={onSignOut} style={{
                  border: '1px solid #E5E7EB', background: '#FFFFFF', borderRadius: 8,
                  padding: '6px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#374151',
                }}>
                  Sign out
                </button>
              </div>
            </header>

            {READ_ONLY.has(tab) && (
              <div style={{
                background: '#EFF6FF', borderBottom: '1px solid #BFDBFE',
                color: '#1E40AF', padding: '9px 20px', fontSize: 13,
              }}>
                Showing what the branches have sent up. {active.label} is recorded
                at the till, so it cannot be changed from here.
              </div>
            )}

            {tab === 'live'
              ? <LiveScreen user={user} onSignOut={onSignOut} embedded />
              : <active.Screen />}
          </div>
        </POSProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}
