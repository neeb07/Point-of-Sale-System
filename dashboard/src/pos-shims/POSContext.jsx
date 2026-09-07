import React, { createContext, useContext, useEffect, useState } from 'react';
import { menuAPI } from './api';

/**
 * `usePOS`, for the reused POS screens.
 *
 * On the till this holds the menu in memory so the sale screen can render it
 * without a round trip per keystroke. Here it exists only because Menu and
 * Deals import it; the dashboard has no sale screen.
 *
 * The mutators are no-ops rather than errors. The screens call them straight
 * after a successful save to keep their local copy in step, and since the
 * cloud refuses those saves (see api.js) the call never gets this far — but a
 * throw here would turn a clear "recorded at the branch" message into a crash.
 */

const POSContext = createContext(null);

export function POSProvider({ children }) {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    menuAPI.getAll()
      .then(rows => setMenuItems(Array.isArray(rows) ? rows : []))
      // No menu on the cloud yet: the screens should render empty rather than
      // fail to mount at all.
      .catch(() => setMenuItems([]))
      .finally(() => setLoading(false));
  }, []);

  const value = {
    menuItems,
    loading,
    addMenuItem: () => {},
    updateMenuItem: () => {},
    deleteMenuItem: () => {},
  };

  return <POSContext.Provider value={value}>{children}</POSContext.Provider>;
}

export function usePOS() {
  const ctx = useContext(POSContext);
  if (!ctx) throw new Error('usePOS must be used inside the dashboard POSProvider');
  return ctx;
}

export default POSContext;
