import React from 'react';
import { Home as HomeIcon, User, ClipboardList, BarChart2, Settings, LogOut, Utensils, Tag } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface NavItem {
  id: string;
  icon: React.ElementType;
  label: string;
  alwaysShow?: boolean;
  adminOnly?: boolean;
}

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

const allNavItems: NavItem[] = [
  { id: 'sale',     icon: HomeIcon,      label: 'Home',    alwaysShow: true },
  { id: 'menu',     icon: Utensils,      label: 'Menu',    alwaysShow: true },
  { id: 'deals',    icon: Tag,           label: 'Deals',   alwaysShow: true },
  { id: 'cashier',  icon: User,          label: 'Cashier', adminOnly: true },
  { id: 'orders',   icon: ClipboardList, label: 'Orders',  alwaysShow: true },
  { id: 'reports',  icon: BarChart2,     label: 'Reports', alwaysShow: true },
  { id: 'settings', icon: Settings,      label: 'Settings',alwaysShow: true },
];

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const { isAdmin, logout } = useAuth();
  const navItems = allNavItems.filter(item => item.alwaysShow || isAdmin);

  return (
    <div
      style={{
        width: 68,
        minWidth: 68,
        height: '100vh',
        background: '#FFFFFF',
        borderRight: '1px solid #EBEBEB',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 16,
        paddingBottom: 0,
        flexShrink: 0,
      }}
    >
      {/* Logo dot */}
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: '#F97316',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(249,115,22,0.28)',
      }}>
        <Utensils size={17} color="#FFFFFF" />
      </div>

      {/* Divider */}
      <div style={{ width: 32, height: 1, background: '#EBEBEB', marginBottom: 12 }} />

      {/* Nav items */}
      <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {navItems.map(({ id, icon: Icon, label }) => {
          const isActive = activePage === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              style={{
                width: '100%',
                padding: '9px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                background: isActive ? '#FFF7ED' : 'transparent',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 140ms',
              }}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.background = '#F5F5F0';
              }}
              onMouseLeave={e => {
                if (!isActive) e.currentTarget.style.background = 'transparent';
              }}
            >
              {/* Active left bar */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  left: -8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3,
                  height: 20,
                  borderRadius: '0 3px 3px 0',
                  background: '#F97316',
                }} />
              )}
              <Icon
                size={20}
                style={{ color: isActive ? '#F97316' : '#BCBCB4' }}
              />
              <span style={{
                fontSize: 10,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#F97316' : '#BCBCB4',
                letterSpacing: '0.1px',
              }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Separator before logout */}
      <div style={{ width: 32, height: 1, background: '#EBEBEB', marginBottom: 10 }} />

      {/* Logout */}
      <div style={{ width: '100%', padding: '0 8px 16px' }}>
        <button
          onClick={logout}
          style={{
            width: '100%',
            padding: '9px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            transition: 'background 140ms',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#FEF2F2';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <LogOut size={20} style={{ color: '#EF4444' }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: '#EF4444' }}>
            Logout
          </span>
        </button>
      </div>
    </div>
  );
}
