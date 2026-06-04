import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import Guard from './Guard.jsx';

// Mock AuthContext so tests control the user value without a real fetch
vi.mock('./AuthContext', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from './AuthContext';

function renderGuard(user, guardPath, childText = 'protected content') {
  useAuth.mockReturnValue({ user, status: user ? 'ready' : 'anonymous' });
  return render(
    <MemoryRouter initialEntries={[guardPath]}>
      <Routes>
        <Route
          path={guardPath}
          element={<Guard path={guardPath}><div>{childText}</div></Guard>}
        />
        <Route path="/"          element={<div>home page</div>} />
        <Route path="/my-hauler" element={<div>my-hauler page</div>} />
        <Route path="*"          element={<div>catch-all</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const adminUser    = { id: 'u1', role: 'axis_admin' };
const opsUser      = { id: 'u2', role: 'axis_ops' };
const haulerUser   = { id: 'u3', role: 'hauler_admin' };
const lenderUser   = { id: 'u4', role: 'lender' };

describe('Guard — no user', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing (null) when user is null', () => {
    const { container } = renderGuard(null, '/trips');
    expect(container.firstChild).toBeNull();
  });
});

describe('Guard — hauler_admin on /', () => {
  afterEach(() => vi.restoreAllMocks());

  it('redirects hauler_admin to /my-hauler when path is /', () => {
    renderGuard(haulerUser, '/');
    expect(screen.getByText('my-hauler page')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('does not redirect axis_admin away from /', () => {
    renderGuard(adminUser, '/');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('does not redirect axis_ops away from /', () => {
    renderGuard(opsUser, '/');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

describe('Guard — /settings and /audit are axis_admin-only', () => {
  afterEach(() => vi.restoreAllMocks());

  it('axis_admin can access /settings', () => {
    renderGuard(adminUser, '/settings');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('axis_ops is redirected away from /settings', () => {
    renderGuard(opsUser, '/settings');
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('hauler_admin is redirected away from /settings', () => {
    renderGuard(haulerUser, '/settings');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('lender is redirected away from /settings', () => {
    renderGuard(lenderUser, '/settings');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('axis_admin can access /audit', () => {
    renderGuard(adminUser, '/audit');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('axis_ops is redirected away from /audit', () => {
    renderGuard(opsUser, '/audit');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});

describe('Guard — canAccess enforcement', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lender is redirected from /convoys (not in lender page list)', () => {
    renderGuard(lenderUser, '/convoys');
    expect(screen.getByText('home page')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('lender can access /financials', () => {
    renderGuard(lenderUser, '/financials');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('hauler_admin is redirected from /risks', () => {
    renderGuard(haulerUser, '/risks');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('hauler_admin can access /trips', () => {
    renderGuard(haulerUser, '/trips');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('axis_ops can access /corridor', () => {
    renderGuard(opsUser, '/corridor');
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});
