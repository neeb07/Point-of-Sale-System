import React, { useState } from 'react';
import Sidebar from '@/components/pos/Sidebar';
import SaleScreen from '@/pages/SaleScreen';
import MenuManagement from '@/pages/MenuManagement';
import Cashier from '@/pages/Cashier';
import Orders from '@/pages/Orders';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import Deals from '@/pages/Deals';
import InventoryScreen from '@/pages/InventoryScreen';
import ShiftsScreen from '@/pages/ShiftsScreen';
import LoginScreen from '@/pages/LoginScreen';
import AccessDenied from '@/components/AccessDenied';
import { POSProvider } from '@/lib/POSContext';
import { useAuth } from '@/context/AuthContext';

const screens: Record<string, React.ComponentType<{ onNavigate?: (page: string) => void }>> = {
  sale: SaleScreen,
  menu: MenuManagement,
  deals: Deals,
  cashier: Cashier,
  orders: Orders,
  reports: Reports,
  settings: Settings,
  inventory: InventoryScreen,
  shifts: ShiftsScreen,
};

/**
 * Screens only an administrator may open.
 *
 * Menu, Deals and Inventory are not here: a manager opens them, but Menu and
 * Deals render read-only and every write is refused by the backend anyway.
 * Staff administration and Settings stay closed outright.
 */
const ADMIN_ONLY_SCREENS = new Set(['cashier', 'settings']);

/**
 * Where each role lands.
 *
 * An owner opens this app to read the day's numbers, so they start on Reports.
 * A manager opens it to serve the next customer, so they start on the till.
 */
const LANDING_SCREEN = { admin: 'reports', manager: 'sale' } as const;

export default function Home() {
  const { isLocked, isAdmin, currentUser } = useAuth();

  // Keyed by user so switching accounts re-lands on the right screen rather
  // than leaving the previous user's page showing.
  const [activePage, setActivePage] = useState<string | null>(null);

  if (isLocked) {
    return <LoginScreen />;
  }

  const landing = isAdmin ? LANDING_SCREEN.admin : LANDING_SCREEN.manager;
  const page = activePage ?? landing;

  const denied = ADMIN_ONLY_SCREENS.has(page) && !isAdmin;
  const ActiveScreen = screens[page] ?? screens[landing];

  return (
    <POSProvider>
      <div
        key={currentUser?.id ?? 'anon'}
        style={{
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'row',
          background: '#F5F2EA',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <Sidebar activePage={page} onNavigate={setActivePage} />
        {denied ? (
          <AccessDenied message="This screen is restricted to an administrator." />
        ) : (
          <ActiveScreen onNavigate={setActivePage} />
        )}
      </div>
    </POSProvider>
  );
}
