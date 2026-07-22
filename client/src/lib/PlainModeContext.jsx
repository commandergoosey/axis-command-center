/*
 * PlainModeContext — the global "read this in plain language" switch.
 *
 * Two reading levels for one platform:
 *   off (default) — the expert view exactly as built. The explainer layer
 *                   (Term info affordances, plain intros) is still available
 *                   on demand, but the UI stays terse.
 *   on            — acronyms expand inline, plain-language intros surface, and
 *                   dense figures gain their plain gloss without a click.
 *
 * The preference is per-user and sticky (localStorage), so someone who needs
 * the plain view keeps it across sessions.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'axis.plainMode';

const PlainModeContext = createContext({ plain: false, setPlain: () => {}, toggle: () => {} });

function readInitial() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function PlainModeProvider({ children }) {
  const [plain, setPlain] = useState(readInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, plain ? '1' : '0');
    } catch {
      /* storage unavailable (private mode) — fall back to in-memory only */
    }
  }, [plain]);

  const value = useMemo(
    () => ({ plain, setPlain, toggle: () => setPlain((v) => !v) }),
    [plain],
  );

  return <PlainModeContext.Provider value={value}>{children}</PlainModeContext.Provider>;
}

export function usePlainMode() {
  return useContext(PlainModeContext);
}
