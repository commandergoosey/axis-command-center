/*
 * SidebarContext — provides expand/collapse state for the sidebar nav.
 * Consumed by Sidebar.jsx (renders differently), App.jsx/Shell (adjusts
 * main content marginLeft), and Topbar.jsx (adjusts left offset).
 *
 * State persisted in localStorage under 'axis.sidebar.expanded'.
 * Default: collapsed (icons only), matching the v1 behaviour.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const SidebarContext = createContext({
  expanded: false,
  toggle: () => {},
});

export const SIDEBAR_COLLAPSED_W = 56;
export const SIDEBAR_EXPANDED_W  = 180;

export function SidebarProvider({ children }) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem('axis.sidebar.expanded') === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('axis.sidebar.expanded', String(next)); } catch {}
      return next;
    });
  }, []);

  // Keep the CSS variable in sync so any element that reads --sidebar-w
  // from CSS gets the updated value automatically.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w',
      expanded ? `${SIDEBAR_EXPANDED_W}px` : `${SIDEBAR_COLLAPSED_W}px`,
    );
  }, [expanded]);

  return (
    <SidebarContext.Provider value={{ expanded, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
