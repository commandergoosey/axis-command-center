/*
 * Auth primitives — token storage + authFetch wrapper + role definitions.
 *
 * The token lives in localStorage so a full page reload keeps the operator
 * signed in. Every fetch through authFetch carries the Authorization
 * header; existing `fetch(...)` calls across the app are upgraded by
 * mass-replacing `fetch(` with the exported `authFetch(`.
 *
 * API_BASE — in development this is '' so all calls hit the Vite dev
 * proxy (/api → localhost:3002). In production (Vercel), set the env var
 * VITE_API_URL to the Railway backend URL, e.g.
 *   VITE_API_URL=https://axis-server.up.railway.app
 * and all authFetch + raw fetch calls will prefix it automatically.
 */

const TOKEN_KEY = 'axis.auth.token';

// Resolved once at module load. In dev: ''. In prod: Railway origin.
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || null; }
  catch { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else       localStorage.removeItem(TOKEN_KEY);
  } catch { /* noop */ }
}

export function authFetch(input, init = {}) {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Prefix relative paths with the backend origin so the client works when
  // served from Vercel (different domain from the Railway API server).
  const url = typeof input === 'string' && input.startsWith('/')
    ? `${API_BASE}${input}`
    : input;
  return fetch(url, { ...init, headers });
}

/* ── Role matrix ──────────────────────────────────────────────────
 * The source of truth for "can role X see page Y?". Sidebar filters
 * against this; RequireAuth enforces it for direct URL access.
 */

export const ROLES = {
  axis_admin:   { label: 'AXIS Admin', tone: 'rust'   },
  axis_ops:     { label: 'AXIS Ops',   tone: 'rust'   },
  hauler_admin: { label: 'Hauler',     tone: 'amber'  },
  lender:       { label: 'Lender',     tone: 'green'  },
};

// Paths a role is allowed to reach. Empty value = wildcard (all paths).
export const ROLE_PAGES = {
  axis_admin: null, // wildcard
  axis_ops: [
    '/', '/corridor', '/convoys', '/trips', '/drivers', '/compliance',
    '/haulers', '/fleet', '/maintenance',
    '/contract', '/tariff', '/diesel', '/tranches', '/financials', '/risks', '/calendar', '/sensitivity', '/settlements', '/claims',
    '/alerts', '/reports', '/my-hauler', '/playbooks', '/coaching', '/handovers', '/leaderboard', '/inbox', '/me/activity', '/analytics',
  ],
  hauler_admin: ['/', '/my-hauler', '/trips', '/haulers', '/fleet', '/maintenance', '/drivers', '/alerts', '/reports', '/calendar', '/coaching', '/leaderboard', '/inbox', '/settlements', '/claims', '/diesel', '/me/activity', '/analytics'],
  lender:       ['/', '/contract', '/tariff', '/diesel', '/tranches', '/financials', '/risks', '/calendar', '/sensitivity', '/compliance', '/reports', '/inbox', '/settlements', '/claims', '/me/activity', '/analytics'],
};

export function canAccess(role, path) {
  const allowed = ROLE_PAGES[role];
  if (allowed == null) return true; // wildcard
  return allowed.includes(path);
}

// Write capabilities — used to hide action buttons on the client.
export const CAPABILITIES = {
  axis_admin:   { onboardHauler: true,  generateReport: true,  manageIntegration: true,  settings: true  },
  axis_ops:     { onboardHauler: true,  generateReport: true,  manageIntegration: true,  settings: false },
  hauler_admin: { onboardHauler: false, generateReport: false, manageIntegration: true,  settings: false }, // own hauler only
  lender:       { onboardHauler: false, generateReport: false, manageIntegration: false, settings: false },
};

export function can(role, capability) {
  return !!CAPABILITIES[role]?.[capability];
}
