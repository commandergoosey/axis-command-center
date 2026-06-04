'use strict';

/*
 * Tests for state/haulerStore.js —
 *   list, findById, create, update, deactivate, reactivate, nextId
 *   + deserialise shape (exercised through the above)
 *
 * Uses an in-memory SQLite DB. mock/haulers is stubbed to return [] so
 * seed() runs a no-op transaction, leaving the table empty and giving
 * each test a clean baseline.
 *
 * Note: webhook_secret and api_token columns are added by migration
 * 001/008 and are NOT present in the base schema executed at boot.
 * Tests that touch those fields are omitted to keep the suite migration-free.
 * In-memory rows return undefined for those columns, which deserialise()
 * maps to null — the behaviour is still verified via the null-fallback checks.
 *
 * Covers:
 *   - deserialise shape: nested integration/fleet/performance; boolean
 *     deactivated; null fallbacks; _persisted sentinel
 *   - list: empty initially; returns active haulers; respects
 *     include_deactivated flag
 *   - findById: null for null/unknown; returns deserialized row
 *   - create: default values; display_name trimmed; nested fields accepted;
 *     deactivated=false; _persisted=true
 *   - update: empty-fields no-op; patches numeric fields (coerce);
 *     patches string fields; patches performance fields
 *   - deactivate: row excluded from list(); deactivated=true; deactivated_at set
 *   - reactivate: row returned to list(); deactivated=false; deactivated_at null
 *   - nextId: 'haul-01' when empty; increments from last numeric suffix
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');   // creates haulers table (base schema)

// ── Stub helper ───────────────────────────────────────────────────
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Stub mock/haulers → empty array so seed() inserts nothing ─────
stub('../mock/haulers', []);

delete require.cache[require.resolve('../state/haulerStore')];
const hs = require('../state/haulerStore');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function newHauler(overrides = {}) {
  _seq += 1;
  return {
    id:           `haul-t${String(_seq).padStart(2, '0')}`,
    display_name: `Test Hauler ${_seq}`,
    onboarded_date: '2026-01-01',
    status:       'active',
    ...overrides,
  };
}

// ── list ──────────────────────────────────────────────────────────

describe('haulerStore — list', () => {
  it('returns an empty array on a fresh in-memory DB', () => {
    const result = hs.list();
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('returns active haulers after creation', () => {
    hs.create(newHauler());
    assert.ok(hs.list().length >= 1);
  });

  it('excludes deactivated haulers by default', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    assert.ok(!hs.list().some((x) => x.id === h.id),
      'deactivated hauler should not appear in default list()');
  });

  it('includes deactivated haulers when include_deactivated=true', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    assert.ok(hs.list({ include_deactivated: true }).some((x) => x.id === h.id),
      'deactivated hauler should appear with include_deactivated:true');
  });

  it('each list item has nested integration, fleet, and performance objects', () => {
    hs.create(newHauler());
    for (const h of hs.list()) {
      assert.ok(typeof h.integration === 'object' && h.integration !== null, 'missing integration');
      assert.ok(typeof h.fleet       === 'object' && h.fleet       !== null, 'missing fleet');
      assert.ok(typeof h.performance === 'object' && h.performance !== null, 'missing performance');
    }
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('haulerStore — findById', () => {
  it('returns null for null id', () => {
    assert.equal(hs.findById(null), null);
  });

  it('returns null for undefined id', () => {
    assert.equal(hs.findById(undefined), null);
  });

  it('returns null for an unknown id', () => {
    assert.equal(hs.findById('haul-does-not-exist'), null);
  });

  it('returns the hauler for a known id', () => {
    const h = hs.create(newHauler());
    const result = hs.findById(h.id);
    assert.ok(result !== null);
    assert.equal(result.id, h.id);
  });
});

// ── deserialise (via create / findById) ───────────────────────────

describe('haulerStore — deserialise shape', () => {
  it('integration.type defaults to "manual"', () => {
    const h = hs.create(newHauler());
    assert.equal(h.integration.type, 'manual');
  });

  it('integration.adapter is null when not provided', () => {
    const h = hs.create(newHauler());
    assert.equal(h.integration.adapter, null);
  });

  it('integration.last_sync is null when not provided', () => {
    const h = hs.create(newHauler());
    assert.equal(h.integration.last_sync, null);
  });

  it('fleet.contracted_trucks defaults to 0', () => {
    const h = hs.create(newHauler());
    assert.equal(h.fleet.contracted_trucks, 0);
  });

  it('fleet.active_trucks defaults to 0', () => {
    const h = hs.create(newHauler());
    assert.equal(h.fleet.active_trucks, 0);
  });

  it('performance.on_time_pct defaults to 0', () => {
    const h = hs.create(newHauler());
    assert.equal(h.performance.on_time_pct, 0);
  });

  it('deactivated is a boolean (false for new hauler)', () => {
    const h = hs.create(newHauler());
    assert.strictEqual(h.deactivated, false);
  });

  it('_persisted sentinel is true', () => {
    const h = hs.create(newHauler());
    assert.strictEqual(h._persisted, true);
  });

  it('webhook_secret falls back to null (column absent in base schema)', () => {
    const h = hs.create(newHauler());
    assert.equal(h.webhook_secret, null);
  });
});

// ── create ────────────────────────────────────────────────────────

describe('haulerStore — create', () => {
  it('returns an object with the correct id', () => {
    const h = hs.create(newHauler());
    assert.ok(typeof h.id === 'string' && h.id.length > 0);
  });

  it('status defaults to "pending" when not provided', () => {
    const h = hs.create(newHauler({ status: undefined }));
    assert.equal(h.status, 'pending');
  });

  it('display_name is stored trimmed', () => {
    const h = hs.create(newHauler({ display_name: '  Padded Name  ' }));
    assert.equal(h.display_name, 'Padded Name');
  });

  it('run_rate defaults to 0', () => {
    const h = hs.create(newHauler());
    assert.equal(h.run_rate, 0);
  });

  it('accepts nested fleet fields', () => {
    const h = hs.create(newHauler({
      fleet: { contracted_trucks: 10, active_trucks: 8 },
    }));
    assert.equal(h.fleet.contracted_trucks, 10);
    assert.equal(h.fleet.active_trucks,     8);
  });

  it('accepts nested performance fields', () => {
    const h = hs.create(newHauler({
      performance: { on_time_pct: 92, sla_attainment_pct: 88, safety_score: 95 },
    }));
    assert.equal(h.performance.on_time_pct,        92);
    assert.equal(h.performance.sla_attainment_pct, 88);
    assert.equal(h.performance.safety_score,       95);
  });

  it('accepts nested integration fields', () => {
    const h = hs.create(newHauler({
      integration: { type: 'loconav', adapter: 'v2', last_sync: '2026-01-01T00:00:00Z' },
    }));
    assert.equal(h.integration.type,      'loconav');
    assert.equal(h.integration.adapter,   'v2');
    assert.equal(h.integration.last_sync, '2026-01-01T00:00:00Z');
  });

  it('created hauler appears in list()', () => {
    const h = hs.create(newHauler({ status: 'active' }));
    assert.ok(hs.list().some((x) => x.id === h.id),
      'newly created active hauler should appear in list()');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('haulerStore — update', () => {
  it('empty fields object returns the current hauler unchanged', () => {
    const h = hs.create(newHauler({ display_name: 'Before' }));
    const result = hs.update(h.id, {});
    assert.equal(result.display_name, 'Before');
  });

  it('patches display_name', () => {
    const h = hs.create(newHauler({ display_name: 'Old Name' }));
    const patched = hs.update(h.id, { display_name: 'New Name' });
    assert.equal(patched.display_name, 'New Name');
  });

  it('patches run_rate (numeric coerce)', () => {
    const h = hs.create(newHauler());
    const patched = hs.update(h.id, { run_rate: 4.5 });
    assert.equal(patched.run_rate, 4.5);
  });

  it('run_rate: coerces string number to number', () => {
    const h = hs.create(newHauler());
    const patched = hs.update(h.id, { run_rate: '3.2' });
    assert.equal(patched.run_rate, 3.2);
  });

  it('patches contracted_trucks', () => {
    const h = hs.create(newHauler());
    const patched = hs.update(h.id, { contracted_trucks: 12 });
    assert.equal(patched.fleet.contracted_trucks, 12);
  });

  it('patches on_time_pct', () => {
    const h = hs.create(newHauler());
    const patched = hs.update(h.id, { on_time_pct: 97 });
    assert.equal(patched.performance.on_time_pct, 97);
  });

  it('patches status', () => {
    const h = hs.create(newHauler({ status: 'pending' }));
    const patched = hs.update(h.id, { status: 'active' });
    assert.equal(patched.status, 'active');
  });

  it('only provided fields are updated; others stay unchanged', () => {
    const h = hs.create(newHauler({ display_name: 'Unchanged', run_rate: 5 }));
    hs.update(h.id, { status: 'active' });
    const result = hs.findById(h.id);
    assert.equal(result.display_name, 'Unchanged');
    assert.equal(result.run_rate,     5);
  });

  it('returns null for an unknown id', () => {
    assert.equal(hs.update('haul-does-not-exist', { run_rate: 1 }), null);
  });
});

// ── deactivate / reactivate ───────────────────────────────────────

describe('haulerStore — deactivate / reactivate', () => {
  it('deactivated hauler is excluded from list()', () => {
    const h = hs.create(newHauler({ status: 'active' }));
    hs.deactivate(h.id);
    assert.ok(!hs.list().some((x) => x.id === h.id),
      'deactivated hauler should not appear in list()');
  });

  it('deactivated hauler has deactivated=true', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    assert.strictEqual(hs.findById(h.id).deactivated, true);
  });

  it('deactivated hauler has a non-null deactivated_at', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    assert.ok(hs.findById(h.id).deactivated_at !== null,
      'deactivated_at should be set after deactivation');
  });

  it('deactivated hauler is still accessible via findById', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    assert.ok(hs.findById(h.id) !== null,
      'findById should still return a deactivated hauler');
  });

  it('reactivated hauler reappears in list()', () => {
    const h = hs.create(newHauler({ status: 'active' }));
    hs.deactivate(h.id);
    hs.reactivate(h.id);
    assert.ok(hs.list().some((x) => x.id === h.id),
      'reactivated hauler should appear in list()');
  });

  it('reactivated hauler has deactivated=false', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    hs.reactivate(h.id);
    assert.strictEqual(hs.findById(h.id).deactivated, false);
  });

  it('reactivated hauler has deactivated_at=null', () => {
    const h = hs.create(newHauler());
    hs.deactivate(h.id);
    hs.reactivate(h.id);
    assert.equal(hs.findById(h.id).deactivated_at, null);
  });
});

// ── nextId ────────────────────────────────────────────────────────

describe('haulerStore — nextId', () => {
  it('returns "haul-01" when no haul-NNN rows exist', () => {
    // All haulers created so far use haul-tNN IDs (not GLOB 'haul-[0-9]*')
    assert.equal(hs.nextId(), 'haul-01');
  });

  it('increments from haul-01 to haul-02 after inserting haul-01', () => {
    hs.create(newHauler({ id: 'haul-01', display_name: 'NextId seed' }));
    assert.equal(hs.nextId(), 'haul-02');
  });

  it('pads single-digit numbers with a leading zero', () => {
    // haul-01 already exists from the previous test; haul-02 will be next
    const next = hs.nextId();
    assert.ok(/^haul-\d{2,}$/.test(next),
      `expected haul-NN format, got: ${next}`);
  });
});
