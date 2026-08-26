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

const STORAGE_KEY = 'pos_current_user';
const TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Don't hammer localStorage — mousemove fires continuously. */
const PERSIST_THROTTLE_MS = 30 * 1000;

interface StoredSession {
  user: Staff;
  lastActivity: number;
}

/**
 * Read the saved session, returning null if it is missing, malformed, or
 * older than the inactivity window.
 *
 * SECURITY FIX: the session used to be saved with no timestamp at all. The
 * 2-hour inactivity timer lived only in memory, so closing the app destroyed
 * the timer but left the saved session on disk — and the next launch restored
 * it unconditionally and skipped the PIN screen. Once anyone logged in on a
 * machine, the till stayed unlocked permanently, including after a reboot.
 */
function readStoredSession(): Staff | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);

    // Reject the old shape (a bare staff object with no timestamp). Anyone
    // upgrading from a previous build is asked to sign in once more.
    if (!parsed || typeof parsed !== 'object' || !parsed.user || !parsed.lastActivity) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const session = parsed as StoredSession;
    const age = Date.now() - session.lastActivity;

    // A clock moved backwards, or the window has passed.
    if (age < 0 || age > TIMEOUT_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return session.user;
  } catch (e) {
    console.error('Failed to parse saved session:', e);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: AuthProviderProps) {
  // Resolve the session before first paint so the POS never flashes into
  // view for an unauthenticated user.
  const [currentUser, setCurrentUser] = useState<Staff | null>(() => readStoredSession());
  const [isLocked, setIsLocked] = useState<boolean>(() => readStoredSession() === null);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersist = useRef<number>(0);
  const userRef = useRef<Staff | null>(currentUser);

  useEffect(() => {
    userRef.current = currentUser;
  }, [currentUser]);

  const persistSession = (user: Staff) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user, lastActivity: Date.now() } satisfies StoredSession)
    );
    lastPersist.current = Date.now();
  };

  const logout = () => {
    setCurrentUser(null);
    setIsLocked(true);
    localStorage.removeItem(STORAGE_KEY);
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
  };

  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(logout, TIMEOUT_MS);

    // Refresh the stored timestamp, throttled so mousemove doesn't cause
    // a localStorage write on every frame.
    const user = userRef.current;
    if (user && Date.now() - lastPersist.current > PERSIST_THROTTLE_MS) {
      persistSession(user);
    }
  };

  const login = (staffObj: Staff) => {
    setCurrentUser(staffObj);
    setIsLocked(false);
    userRef.current = staffObj;
    persistSession(staffObj);
    resetTimer();
  };

  // Start the inactivity countdown for a session restored from disk.
  useEffect(() => {
    if (currentUser && !isLocked) resetTimer();
    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset the timer on any user activity.
  useEffect(() => {
    if (!isLocked) {
      const events = ['mousedown', 'mousemove', 'keypress', 'touchstart', 'click'];
      events.forEach(e => window.addEventListener(e, resetTimer));
      return () => events.forEach(e => window.removeEventListener(e, resetTimer));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  // Re-check expiry when the window regains focus. Without this, an app left
  // open overnight stays unlocked until the next mouse move fires the timer.
  useEffect(() => {
    const onFocus = () => {
      if (!isLocked && readStoredSession() === null) logout();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
