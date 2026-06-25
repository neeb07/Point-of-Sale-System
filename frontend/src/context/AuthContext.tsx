import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';

interface Staff {
  id: number;
  name: string;
  role: string;
  pin?: string;
  color?: string;
  active?: number;
  [key: string]: unknown;
}

interface AuthContextType {
  currentUser: Staff | null;
  isLocked: boolean;
  login: (staffObj: Staff) => void;
  logout: () => void;
  isAdmin: boolean;
  isCashier: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<Staff | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  // Load saved user from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('pos_current_user');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setCurrentUser(parsedUser);
        setIsLocked(false);
        resetTimer();
      } catch (e) {
        console.error('Failed to parse saved user:', e);
        localStorage.removeItem('pos_current_user');
      }
    }
  }, []);

  const login = (staffObj: Staff) => {
    setCurrentUser(staffObj);
    setIsLocked(false);
    localStorage.setItem('pos_current_user', JSON.stringify(staffObj));
    resetTimer();
  };

  const logout = () => {
    setCurrentUser(null);
    setIsLocked(true);
    localStorage.removeItem('pos_current_user');
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
  };

  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      logout();
    }, TIMEOUT_MS);
  };

  // Reset timer on any user activity
  useEffect(() => {
    if (!isLocked) {
      const events = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'click'];
      events.forEach(e => window.addEventListener(e, resetTimer));
      return () => events.forEach(e => window.removeEventListener(e, resetTimer));
    }
  }, [isLocked]);

  // Role checks
  const isAdmin = currentUser?.role === 'Owner' || currentUser?.role === 'Manager';
  const isCashier = currentUser?.role === 'Cashier';

  return (
    <AuthContext.Provider value={{ currentUser, isLocked, login, logout, isAdmin, isCashier }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
