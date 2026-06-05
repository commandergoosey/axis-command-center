'use strict';

/*
 * Tests for state/incidentState.js —
 *   create, close, findById, all, since
 *
 * Uses in-memory SQLite. incidentState.js creates its own hse_incidents
 * table idempotently — no stubs or migrations required.
 *
 * Key note: functions return raw DB rows (no shape wrapper).
 *
 * Covers:
 *   - create: hauler_id required; type required; category must be A or B;
 *     returns raw row with id/status='OPEN'/occurred_at/hauler_id;
 *     id is a string; defaults occurred_at to now when not provided;
 *     stores truck/driver/km_marker/note when provided
 *   - close: corrective_action required; throws if incident not found;
 *     throws if already closed; sets status to CLOSED; stores
 *     corrective_action and closed_by_display
 *   - findById: returns null for unknown; raw row for known
 *   - all: returns array; includes all incidents
 *   - since: only returns incidents within days window
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/incidentState')];
const inc = require('../state/incidentState');

let _seq = 0;
function hid() { return `haul-inc-${String(++_seq).padStart(3, '0')}`; }

function base(overrides = {}) {
  return {
    hauler_id: hid(),
    type:      'Tyre burst',
    category:  'B',
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ── create ────────────────────────────────────────────────────────

describe('incidentState — create', () => {
  it('throws when hauler_id is missing', () => {
    assert.throws(() => inc.create({ ...base(), hauler_id: null }), /hauler_id required/i);
  });

  it('throws when type is missing', () => {
    assert.throws(() => inc.create({ ...base(), type: '' }), /type required/i);
  });

  it('throws when category is not A or B', () => {
    assert.throws(() => inc.create({ ...base(), category: 'C' }), /category must be A or B/i);
  });

  it('accepts category A', () => {
    assert.doesNotThrow(() => inc.create(base({ category: 'A' })));
  });

  it('accepts category B', () => {
    assert.doesNotThrow(() => inc.create(base({ category: 'B' })));
  });

  it('returns a row with an id string', () => {
    const row = inc.create(base());
    assert.ok(typeof row.id === 'string' && row.id.length > 0);
  });

  it('initial status is OPEN', () => {
    const row = inc.create(base());
    assert.equal(row.status, 'OPEN');
  });

  it('occurred_at defaults to now when not provided', () => {
    const before = Date.now();
    const row = inc.create(base());
    const after = Date.now();
    const ts = new Date(row.occurred_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('stores occurred_at when provided', () => {
    const row = inc.create(base({ occurred_at: '2026-01-15T08:00:00.000Z' }));
    assert.equal(row.occurred_at, '2026-01-15T08:00:00.000Z');
  });

  it('stores truck when provided', () => {
    const row = inc.create(base({ truck: 'GR-1234-AB' }));
    assert.equal(row.truck, 'GR-1234-AB');
  });

  it('stores km_marker when provided', () => {
    const row = inc.create(base({ km_marker: 142 }));
    assert.equal(row.km_marker, 142);
  });

  it('corrective_action and closed_at are null on creation', () => {
    const row = inc.create(base());
    assert.equal(row.corrective_action, null);
    assert.equal(row.closed_at, null);
  });
});

// ── close ─────────────────────────────────────────────────────────

describe('incidentState — close', () => {
  it('throws when corrective_action is empty', () => {
    const row = inc.create(base());
    assert.throws(
      () => inc.close(row.id, { corrective_action: '  ', closed_by_display: 'Ops' }),
      /corrective_action required/i,
    );
  });

  it('throws when incident not found', () => {
    assert.throws(
      () => inc.close('hse-nonexistent', { corrective_action: 'Remedied' }),
      /not found/i,
    );
  });

  it('throws when incident is already closed', () => {
    const row = inc.create(base());
    inc.close(row.id, { corrective_action: 'First close' });
    assert.throws(
      () => inc.close(row.id, { corrective_action: 'Second close' }),
      /already closed/i,
    );
  });

  it('sets status to CLOSED', () => {
    const row = inc.create(base());
    inc.close(row.id, { corrective_action: 'Driver retrained' });
    assert.equal(inc.findById(row.id).status, 'CLOSED');
  });

  it('stores corrective_action', () => {
    const row = inc.create(base());
    inc.close(row.id, { corrective_action: 'Fleet-wide tyre inspection ordered' });
    assert.equal(inc.findById(row.id).corrective_action, 'Fleet-wide tyre inspection ordered');
  });

  it('stores closed_by_display when provided', () => {
    const row = inc.create(base());
    inc.close(row.id, { corrective_action: 'Done', closed_by_display: 'HSE Manager' });
    assert.equal(inc.findById(row.id).closed_by_display, 'HSE Manager');
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('incidentState — findById', () => {
  it('returns null for an unknown id', () => {
    // byIdStmt.get() returns undefined (not null) for missing rows
    assert.ok(!inc.findById('hse-never'));
  });

  it('returns raw row for known id', () => {
    const row = inc.create(base({ type: 'Near miss' }));
    const found = inc.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.id, row.id);
    assert.equal(found.type, 'Near miss');
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('incidentState — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(inc.all()));
  });

  it('includes all created incidents', () => {
    const r = inc.create(base());
    assert.ok(inc.all().some((x) => x.id === r.id));
  });
});

// ── since ─────────────────────────────────────────────────────────

describe('incidentState — since', () => {
  it('includes incidents that occurred recently', () => {
    const row = inc.create(base());  // occurred_at defaults to now
    const rows = inc.since(7, Date.now() + 1000);
    assert.ok(rows.some((x) => x.id === row.id));
  });

  it('excludes incidents older than the days window', () => {
    const oldAt = new Date(Date.now() - 100 * DAY_MS).toISOString();
    const row = inc.create(base({ occurred_at: oldAt }));
    const rows = inc.since(7, Date.now());
    assert.ok(!rows.some((x) => x.id === row.id));
  });
});
