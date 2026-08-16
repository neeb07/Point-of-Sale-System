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
import LoginScreen from '@/pages/LoginScreen';
import AccessDenied from '@/components/AccessDenied';
import { POSProvider } from '@/lib/POSContext';
import { useAuth } from '@/context/AuthContext';

const screens: Record<string, React.ComponentType> = {
  sale: SaleScreen,
  menu: MenuManagement,
  deals: Deals,
  cashier: Cashier,
  orders: Orders,
  reports: Reports,
  settings: Settings,
  inventory: InventoryScreen,
};

export default function Home() {
  const [activePage, setActivePage] = useState('sale');
  const { isLocked, isAdmin } = useAuth();

  if (isLocked) {
    return <LoginScreen />;
  }

  const ActiveScreen = screens[activePage];

  if ((activePage === 'cashier' || activePage === 'inventory') && !isAdmin) {
    return (
      <POSProvider>
        <div
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
          <Sidebar
            activePage={activePage}
            onNavigate={setActivePage}
          />
          <AccessDenied message="Only managers can access this page." />
        </div>
      </POSProvider>
    );
  }

  return (
    <POSProvider>
      <div
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
        <Sidebar
          activePage={activePage}
          onNavigate={setActivePage}
        />
        <ActiveScreen onNavigate={setActivePage} />
      </div>
    </POSProvider>
  );
}
