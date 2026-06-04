import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { canAccess, can, ROLES, ROLE_PAGES, CAPABILITIES } from './auth.js';

// ── canAccess ─────────────────────────────────────────────────────────

describe('canAccess', () => {
  it('axis_admin can access any path (wildcard)', () => {
    expect(canAccess('axis_admin', '/')).toBe(true);
    expect(canAccess('axis_admin', '/admin')).toBe(true);
    expect(canAccess('axis_admin', '/nonexistent')).toBe(true);
  });

  it('axis_ops can access all permitted paths', () => {
    for (const path of ROLE_PAGES.axis_ops) {
      expect(canAccess('axis_ops', path)).toBe(true);
    }
  });

  it('axis_ops cannot access admin-only paths', () => {
    expect(canAccess('axis_ops', '/admin')).toBe(false);
    expect(canAccess('axis_ops', '/audit')).toBe(false);
  });

  it('hauler_admin can access their permitted paths', () => {
    expect(canAccess('hauler_admin', '/')).toBe(true);
    expect(canAccess('hauler_admin', '/my-hauler')).toBe(true);
    expect(canAccess('hauler_admin', '/trips')).toBe(true);
  });

  it('hauler_admin cannot access financials or risks', () => {
    expect(canAccess('hauler_admin', '/financials')).toBe(false);
    expect(canAccess('hauler_admin', '/risks')).toBe(false);
    expect(canAccess('hauler_admin', '/audit')).toBe(false);
  });

  it('lender can access financial and contract paths', () => {
    expect(canAccess('lender', '/financials')).toBe(true);
    expect(canAccess('lender', '/contract')).toBe(true);
    expect(canAccess('lender', '/risks')).toBe(true);
    expect(canAccess('lender', '/tranches')).toBe(true);
  });

  it('lender cannot access operational paths', () => {
    expect(canAccess('lender', '/convoys')).toBe(false);
    expect(canAccess('lender', '/drivers')).toBe(false);
    expect(canAccess('lender', '/my-hauler')).toBe(false);
  });
});

// ── can (capabilities) ────────────────────────────────────────────────

describe('can', () => {
  it('axis_admin has all capabilities', () => {
    expect(can('axis_admin', 'onboardHauler')).toBe(true);
    expect(can('axis_admin', 'generateReport')).toBe(true);
    expect(can('axis_admin', 'manageIntegration')).toBe(true);
    expect(can('axis_admin', 'settings')).toBe(true);
  });

  it('axis_ops can onboard and generate reports but not settings', () => {
    expect(can('axis_ops', 'onboardHauler')).toBe(true);
    expect(can('axis_ops', 'generateReport')).toBe(true);
    expect(can('axis_ops', 'settings')).toBe(false);
  });

  it('hauler_admin can only manage their own integration', () => {
    expect(can('hauler_admin', 'onboardHauler')).toBe(false);
    expect(can('hauler_admin', 'generateReport')).toBe(false);
    expect(can('hauler_admin', 'manageIntegration')).toBe(true);
    expect(can('hauler_admin', 'settings')).toBe(false);
  });

  it('lender has no capabilities', () => {
    expect(can('lender', 'onboardHauler')).toBe(false);
    expect(can('lender', 'generateReport')).toBe(false);
    expect(can('lender', 'manageIntegration')).toBe(false);
    expect(can('lender', 'settings')).toBe(false);
  });

  it('returns false for unknown role', () => {
    expect(can('unknown_role', 'onboardHauler')).toBe(false);
  });

  it('returns false for unknown capability', () => {
    expect(can('axis_admin', 'nonexistentCap')).toBe(false);
  });
});

// ── ROLES constant ────────────────────────────────────────────────────

describe('ROLES', () => {
  it('defines all four roles', () => {
    expect(Object.keys(ROLES)).toEqual(['axis_admin', 'axis_ops', 'hauler_admin', 'lender']);
  });

  it('each role has label and tone', () => {
    for (const role of Object.values(ROLES)) {
      expect(typeof role.label).toBe('string');
      expect(typeof role.tone).toBe('string');
    }
  });
});

// ── getToken / setToken ───────────────────────────────────────────────
// Use vi.stubGlobal so we fully control localStorage regardless of jsdom
// implementation quirks (some environments lack localStorage.clear).

function makeLocalStorageStub() {
  let store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
  };
}

describe('getToken / setToken', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); });

  it('getToken returns null when nothing stored', async () => {
    const { getToken } = await import('./auth.js');
    expect(getToken()).toBeNull();
  });

  it('setToken stores and getToken retrieves it', async () => {
    const { getToken, setToken } = await import('./auth.js');
    setToken('my.jwt.token');
    expect(getToken()).toBe('my.jwt.token');
  });

  it('setToken(null) removes the token', async () => {
    const { getToken, setToken } = await import('./auth.js');
    setToken('to-be-removed');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

// ── authFetch URL prefixing ───────────────────────────────────────────

describe('authFetch URL prefixing', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); });

  it('prefixes relative paths with API_BASE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { authFetch, API_BASE } = await import('./auth.js');

    await authFetch('/api/risks');

    expect(fetchSpy).toHaveBeenCalledWith(
      `${API_BASE}/api/risks`,
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });

  it('does not prefix absolute URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { authFetch } = await import('./auth.js');

    await authFetch('https://other.example.com/data');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://other.example.com/data',
      expect.any(Object),
    );
    fetchSpy.mockRestore();
  });

  it('attaches Authorization header when token is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { authFetch, setToken } = await import('./auth.js');
    setToken('test-bearer-token');

    await authFetch('/api/me');

    const callHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(callHeaders.get('Authorization')).toBe('Bearer test-bearer-token');
    fetchSpy.mockRestore();
  });

  it('does not set Authorization header when no token stored', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { authFetch } = await import('./auth.js');

    await authFetch('/api/public');

    const callHeaders = fetchSpy.mock.calls[0][1].headers;
    expect(callHeaders.get('Authorization')).toBeNull();
    fetchSpy.mockRestore();
  });
});
