import { describe, it, expect } from 'vitest';
import { visibleFor } from './Sidebar.jsx';

// Helper: flatten all visible item paths for a role
function paths(role) {
  return visibleFor(role).flatMap((s) => s.items.map((i) => i.path));
}

// Helper: names of visible sections for a role
function sections(role) {
  return visibleFor(role).map((s) => s.heading);
}

// ── axis_admin ────────────────────────────────────────────────────────

describe('visibleFor — axis_admin', () => {
  it('sees all six sections', () => {
    expect(sections('axis_admin')).toEqual(
      ['Corridor', 'Operations', 'Fleet', 'Contract', 'Capital', 'Platform'],
    );
  });

  it('sees /settings (requires can() not canAccess)', () => {
    expect(paths('axis_admin')).toContain('/settings');
  });

  it('sees /audit (hardcoded role === axis_admin check)', () => {
    expect(paths('axis_admin')).toContain('/audit');
  });
});

// ── axis_ops ──────────────────────────────────────────────────────────

describe('visibleFor — axis_ops', () => {
  it('does NOT see /settings', () => {
    expect(paths('axis_ops')).not.toContain('/settings');
  });

  it('does NOT see /audit', () => {
    expect(paths('axis_ops')).not.toContain('/audit');
  });

  it('retains a Platform section (alerts + reports remain)', () => {
    expect(sections('axis_ops')).toContain('Platform');
    const platform = visibleFor('axis_ops').find((s) => s.heading === 'Platform');
    const platformPaths = platform.items.map((i) => i.path);
    expect(platformPaths).toContain('/alerts');
    expect(platformPaths).toContain('/reports');
  });

  it('sees all six sections despite missing two Platform items', () => {
    expect(sections('axis_ops')).toHaveLength(6);
  });
});

// ── hauler_admin ──────────────────────────────────────────────────────

describe('visibleFor — hauler_admin', () => {
  it('does NOT see /settings', () => {
    expect(paths('hauler_admin')).not.toContain('/settings');
  });

  it('does NOT see /audit', () => {
    expect(paths('hauler_admin')).not.toContain('/audit');
  });

  it('does NOT see /risks or /financials (capital items outside scope)', () => {
    expect(paths('hauler_admin')).not.toContain('/risks');
    expect(paths('hauler_admin')).not.toContain('/financials');
  });

  it('DOES see /settlements and /claims', () => {
    expect(paths('hauler_admin')).toContain('/settlements');
    expect(paths('hauler_admin')).toContain('/claims');
  });

  it('does NOT see /devices in Fleet', () => {
    expect(paths('hauler_admin')).not.toContain('/devices');
  });
});

// ── lender ────────────────────────────────────────────────────────────

describe('visibleFor — lender', () => {
  it('Fleet section is removed entirely (all items inaccessible)', () => {
    expect(sections('lender')).not.toContain('Fleet');
  });

  it('does NOT see /settings or /audit', () => {
    expect(paths('lender')).not.toContain('/settings');
    expect(paths('lender')).not.toContain('/audit');
  });

  it('sees /compliance in the Operations section', () => {
    expect(paths('lender')).toContain('/compliance');
  });

  it('sees all six Capital items', () => {
    const capital = visibleFor('lender').find((s) => s.heading === 'Capital');
    expect(capital).toBeDefined();
    const capitalPaths = capital.items.map((i) => i.path);
    expect(capitalPaths).toEqual(
      ['/tranches', '/financials', '/risks', '/sensitivity', '/settlements', '/claims'],
    );
  });

  it('does NOT see /convoys, /trips, or /drivers', () => {
    const p = paths('lender');
    expect(p).not.toContain('/convoys');
    expect(p).not.toContain('/trips');
    expect(p).not.toContain('/drivers');
  });
});

// ── Empty-section pruning ─────────────────────────────────────────────

describe('visibleFor — section pruning', () => {
  it('returns no section with zero items for any role', () => {
    for (const role of ['axis_admin', 'axis_ops', 'hauler_admin', 'lender']) {
      const empty = visibleFor(role).filter((s) => s.items.length === 0);
      expect(empty, `${role} has empty section`).toHaveLength(0);
    }
  });
});
