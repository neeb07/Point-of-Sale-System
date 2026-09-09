import React, { useState, useEffect, useRef } from 'react';
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
import CloseBlockedDialog from '@/components/pos/CloseBlockedDialog';
import ExpensesScreen from '@/pages/ExpensesScreen';
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
  expenses: ExpensesScreen,
};

/**
 * Screens only an administrator may open.
 *
 * Menu, Deals and Inventory are not here: a manager opens them, but Menu and
 * Deals render read-only and every write is refused by the backend anyway.
 *
 * Settings is no longer here either. A manager needs the printer and receipt
 * options — they are the one standing in front of the printer when it jams —
 * so the screen opens for them, shows everything, and lets them change only
 * what is theirs. The server enforces that; see the allow-list in server.js.
 *
 * Staff administration stays closed outright.
 */
/*
 * The staff screen is the owner's.
 *
 * Not because of what a manager could change there — the writes are refused by
 * the backend, and once the till is paired staff belong to the dashboard
 * anyway — but because of what it shows. It is the whole roster: who works at
 * this branch, their role, and whether they are still active. That is the
 * owner's business to see in one place, and a colleague's to be asked about
 * rather than looked up.
 */
const ADMIN_ONLY_SCREENS = new Set(['cashier']);

/**
 * Where each role lands.
 *
 * An owner opens this app to read the day's numbers, so they start on Reports.
 * A manager opens it to serve the next customer, so they start on the till.
 */
const LANDING_SCREEN = { admin: 'reports', manager: 'sale' } as const;

export default function Home() {
  const { isLocked, isAdmin, currentUser } = useAuth();

  const [activePage, setActivePage] = useState<string | null>(null);

  /**
   * Land on the role's own screen at every sign-in.
   *
   * `activePage` outlives a sign-out, so without this the next person to sign
   * in inherited whatever screen the last one left open — a manager signing in
   * after the owner had been reading Reports would land on Reports, not the
   * till. Clearing it whenever the signed-in account changes (including to
   * nobody, on sign-out) makes `page` fall back to the landing screen below.
   */
  const signedInId = currentUser?.id ?? null;
  const lastSignedInId = useRef<number | null>(signedInId);

  useEffect(() => {
    if (lastSignedInId.current !== signedInId) {
      lastSignedInId.current = signedInId;
      setActivePage(null);
    }
  }, [signedInId]);

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
        {/*
          Mounted here rather than inside a screen so it survives whichever one
          is open — somebody presses the X from the sale screen, not from
          Shifts. Renders nothing until the main process refuses a close.
        */}
        <CloseBlockedDialog onGoToShifts={() => setActivePage('shifts')} />
      </div>
    </POSProvider>
  );
}
