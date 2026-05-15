/*
 * AuthContext — single source of truth for { user, status, login, logout }.
 * Children call useAuth() to read the current user and invoke auth actions.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authFetch, getToken, setToken, API_BASE } from './auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,   setUser]   = useState(null);
  const [status, setStatus] = useState(getToken() ? 'loading' : 'anonymous');
  const [error,  setError]  = useState(null);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setStatus('anonymous'); return; }
    try {
      const res = await authFetch('/api/auth/me');
      if (res.status === 401) { setToken(null); setUser(null); setStatus('anonymous'); return; }
      if (!res.ok) throw new Error(`auth/me ${res.status}`);
      const body = await res.json();
      setUser(body.user);
      setStatus('ready');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email, password) => {
    setError(null);
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Login failed (${res.status})`);
    }
    const body = await res.json();
    setToken(body.token);
    setUser(body.user);
    setStatus('ready');
    return body.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authFetch('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
    setToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, error, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
