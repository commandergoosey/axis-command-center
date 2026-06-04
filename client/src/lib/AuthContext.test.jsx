import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { AuthProvider, useAuth } from './AuthContext.jsx';

function makeLocalStorageStub() {
  let store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
  };
}

const TOKEN_KEY = 'axis.auth.token';

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider — initial state', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('starts anonymous when no token stored', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe('anonymous');
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('starts loading when a token is stored', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', role: 'axis_admin' } }), { status: 200 }),
    );
    localStorage.setItem(TOKEN_KEY, 'existing-token');

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe('loading');
  });

  it('resolves to ready after /me succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', email: 'admin@axis.test', role: 'axis_admin' } }), { status: 200 }),
    );
    localStorage.setItem(TOKEN_KEY, 'valid-token');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(result.current.user).toMatchObject({ id: 'u1', email: 'admin@axis.test', role: 'axis_admin' });
  });

  it('goes anonymous and clears token when /me returns 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 401 }),
    );
    localStorage.setItem(TOKEN_KEY, 'stale-token');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('anonymous'));

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('sets status error when /me network fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 500 }),
    );
    localStorage.setItem(TOKEN_KEY, 'bad-server');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error).toMatch(/500/);
  });
});

describe('AuthProvider — login()', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('stores token and sets user on successful login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: 'new-jwt', user: { id: 'u2', role: 'axis_ops' } }), { status: 200 }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('ops@axis.test', 'password123');
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.user).toMatchObject({ id: 'u2', role: 'axis_ops' });
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-jwt');
  });

  it('throws with server error message on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => { await result.current.login('bad@test.com', 'wrong'); }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('throws generic message when server returns no error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('not json', { status: 403 }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      act(async () => { await result.current.login('x@test.com', 'y'); }),
    ).rejects.toThrow(/403/);
  });

  it('does not modify status on failed login attempt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Bad creds' }), { status: 401 }),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    const initialStatus = result.current.status;

    await expect(act(async () => { await result.current.login('x@test.com', 'y'); })).rejects.toThrow();
    expect(result.current.status).toBe(initialStatus);
  });
});

describe('AuthProvider — logout()', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function renderLoggedIn(fetchMock) {
    localStorage.setItem(TOKEN_KEY, 'logged-in-token');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'u1', role: 'axis_admin' } }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(hook.result.current.status).toBe('ready'));
    return hook;
  }

  it('clears user, token, and status after logout', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = await renderLoggedIn(fetchMock);

    await act(async () => { await result.current.logout(); });

    expect(result.current.status).toBe('anonymous');
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('clears auth state even if logout endpoint throws', async () => {
    localStorage.setItem(TOKEN_KEY, 'logged-in-token');
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ user: { id: 'u1', role: 'axis_admin' } }), { status: 200 }),
      )
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.logout(); });

    expect(result.current.status).toBe('anonymous');
    expect(result.current.user).toBeNull();
  });
});

describe('useAuth outside provider', () => {
  it('throws an error when used outside <AuthProvider>', () => {
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within <AuthProvider>');
  });
});
