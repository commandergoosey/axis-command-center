'use strict';

/*
 * Tests for state/forecastScenarios.js —
 *   add, update, archive, unarchive, remove, findById, listActive
 *
 * Uses in-memory SQLite. forecastScenarios.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: name required; name > 80 chars throws; params required (object);
 *     unknown params are stripped; returns shaped row with id/name/params/author;
 *     archived_at is null on creation; created_at is set
 *   - update: null for unknown id; updates name/description/params
 *   - archive: archived scenario excluded from listActive; archived_at set
 *   - unarchive: re-included in listActive; archived_at null
 *   - remove: findById null after remove
 *   - findById: null for unknown; shaped row for known
 *   - listActive: array; includes active; excludes archived
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/forecastScenarios')];
const fsc = require('../state/forecastScenarios');

function base(overrides = {}) {
  return {
    name:       'Base case',
    description: 'Standard run rate projection',
    params:     { daily_avg_lift_pct: 5 },
    by_user_id: 'u-ops-01',
    by_display: 'Ops Lead',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('forecastScenarios — add', () => {
  it('throws when name is missing', () => {
    assert.throws(() => fsc.add({ ...base(), name: '' }), /name required/i);
  });

  it('throws when name is only whitespace', () => {
    assert.throws(() => fsc.add({ ...base(), name: '   ' }), /name required/i);
  });

  it('throws when name exceeds 80 chars', () => {
    assert.throws(() => fsc.add({ ...base(), name: 'x'.repeat(81) }), /too long/i);
  });

  it('throws when params is null', () => {
    assert.throws(() => fsc.add({ ...base(), params: null }), /params required/i);
  });

  it('throws when params is not an object', () => {
    assert.throws(() => fsc.add({ ...base(), params: 'invalid' }), /params required/i);
  });

  it('returns a shaped row', () => {
    const row = fsc.add(base());
    assert.ok(row !== null && typeof row.id === 'number');
  });

  it('stores name', () => {
    const row = fsc.add(base({ name: 'Stress test — 25% cut' }));
    assert.equal(row.name, 'Stress test — 25% cut');
  });

  it('stores description', () => {
    const row = fsc.add(base({ description: 'Worst-case lender scenario' }));
    assert.equal(row.description, 'Worst-case lender scenario');
  });

  it('description defaults to null when not provided', () => {
    const row = fsc.add({ name: 'No desc', params: { daily_avg_lift_pct: 0 } });
    assert.equal(row.description, null);
  });

  it('params are filtered — unknown keys stripped', () => {
    const row = fsc.add(base({ params: { daily_avg_lift_pct: 10, unknown_key: 99 } }));
    assert.ok('daily_avg_lift_pct' in row.params);
    assert.ok(!('unknown_key' in row.params));
  });

  it('params — daily_avg_lift_pct is stored', () => {
    const row = fsc.add(base({ params: { daily_avg_lift_pct: 15 } }));
    assert.equal(row.params.daily_avg_lift_pct, 15);
  });

  it('params — resolve_workorders is stored', () => {
    const row = fsc.add(base({ params: { resolve_workorders: true } }));
    assert.equal(row.params.resolve_workorders, true);
  });

  it('params — hauler_truck_lifts is stored', () => {
    const row = fsc.add(base({ params: { hauler_truck_lifts: { 'haul-01': 3 } } }));
    assert.deepEqual(row.params.hauler_truck_lifts, { 'haul-01': 3 });
  });

  it('author.user_id is set when by_user_id provided', () => {
    const row = fsc.add(base({ by_user_id: 'u-auth', by_display: 'Auth User', by_role: 'axis_admin' }));
    assert.equal(row.author.user_id, 'u-auth');
  });

  it('author.display_name and role are set', () => {
    const row = fsc.add(base({ by_display: 'Disp', by_role: 'axis_ops' }));
    assert.equal(row.author.display_name, 'Disp');
    assert.equal(row.author.role, 'axis_ops');
  });

  it('archived_at is null on creation', () => {
    const row = fsc.add(base());
    assert.equal(row.archived_at, null);
  });

  it('created_at is a recent ISO string', () => {
    const before = Date.now();
    const row = fsc.add(base());
    const after = Date.now();
    const ts = new Date(row.created_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('forecastScenarios — update', () => {
  it('returns null for unknown id', () => {
    assert.equal(fsc.update(999999, { name: 'Ghost' }), null);
  });

  it('updates name', () => {
    const row = fsc.add(base({ name: 'Original' }));
    const updated = fsc.update(row.id, { name: 'Updated' });
    assert.equal(updated.name, 'Updated');
  });

  it('updates description', () => {
    const row = fsc.add(base());
    const updated = fsc.update(row.id, { description: 'New description' });
    assert.equal(updated.description, 'New description');
  });

  it('updates params', () => {
    const row = fsc.add(base({ params: { daily_avg_lift_pct: 5 } }));
    const updated = fsc.update(row.id, { params: { daily_avg_lift_pct: 20 } });
    assert.equal(updated.params.daily_avg_lift_pct, 20);
  });

  it('preserves unpatched fields', () => {
    const row = fsc.add(base({ name: 'Keep me' }));
    const updated = fsc.update(row.id, { description: 'Only desc changes' });
    assert.equal(updated.name, 'Keep me');
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('forecastScenarios — archive / unarchive', () => {
  it('archived scenario is excluded from listActive', () => {
    const row = fsc.add(base({ name: 'To archive' }));
    fsc.archive(row.id);
    assert.ok(!fsc.listActive().some((s) => s.id === row.id));
  });

  it('archived_at is set after archive', () => {
    const row = fsc.add(base());
    fsc.archive(row.id);
    assert.ok(fsc.findById(row.id).archived_at !== null);
  });

  it('unarchive re-includes scenario in listActive', () => {
    const row = fsc.add(base({ name: 'Unarchive me' }));
    fsc.archive(row.id);
    fsc.unarchive(row.id);
    assert.ok(fsc.listActive().some((s) => s.id === row.id));
  });

  it('archived_at is null after unarchive', () => {
    const row = fsc.add(base());
    fsc.archive(row.id);
    fsc.unarchive(row.id);
    assert.equal(fsc.findById(row.id).archived_at, null);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('forecastScenarios — remove', () => {
  it('findById returns null after remove', () => {
    const row = fsc.add(base({ name: 'Remove me' }));
    fsc.remove(row.id);
    assert.equal(fsc.findById(row.id), null);
  });

  it('no-op on unknown id', () => {
    assert.doesNotThrow(() => fsc.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('forecastScenarios — findById', () => {
  it('returns null for unknown id', () => {
    assert.equal(fsc.findById(999999), null);
  });

  it('returns shaped row for known id', () => {
    const row = fsc.add(base({ name: 'Find me' }));
    const found = fsc.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.name, 'Find me');
  });

  it('params field is an object', () => {
    const row = fsc.add(base({ params: { daily_avg_lift_pct: 8 } }));
    const found = fsc.findById(row.id);
    assert.ok(typeof found.params === 'object');
    assert.equal(found.params.daily_avg_lift_pct, 8);
  });
});

// ── listActive ────────────────────────────────────────────────────

describe('forecastScenarios — listActive', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(fsc.listActive()));
  });

  it('includes active (non-archived) scenarios', () => {
    const row = fsc.add(base({ name: 'Active scenario' }));
    assert.ok(fsc.listActive().some((s) => s.id === row.id));
  });

  it('does not include archived scenarios', () => {
    const row = fsc.add(base({ name: 'Should be hidden' }));
    fsc.archive(row.id);
    assert.ok(!fsc.listActive().some((s) => s.id === row.id));
  });
});
