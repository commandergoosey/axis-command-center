'use strict';

/*
 * Tests for state/convoyState.js —
 *   dispatch, depart, updatePhase, arrive, listActive, listAll, findById,
 *   todayTonnage, todayTonnageByHauler, monthTonnage
 *
 * Uses in-memory SQLite. convoyState.js creates its own convoy_dispatches
 * table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - dispatch: hauler_id required; truck_count must be ≥ 1; invalid direction
 *     throws; returns shaped row with id: 'live-N', _db_id, phase: 'loading',
 *     is_live: true; convoy_ref matches CVY-MMDD-NNN pattern
 *   - depart: phase becomes laden; actual_departure_iso is set to recent ISO;
 *     idempotent — second call does not change departure time
 *   - updatePhase: throws for invalid phase; sets phase to any valid phase
 *   - arrive: phase becomes complete; arrived_at_iso is recent ISO;
 *     stores delivered_tonnes; idempotent
 *   - listActive: includes loading/laden/offload; excludes complete
 *   - listAll: includes complete
 *   - findById: null for unknown _db_id; shaped row for known
 *   - todayTonnage: returns {total_tonnes, convoy_count}; southbound adds to total;
 *     northbound is excluded
 *   - todayTonnageByHauler: returns array grouped by hauler_id
 *   - monthTonnage: returns {total_tonnes, convoy_count}; southbound adds to total
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/convoyState')];
const cv = require('../state/convoyState');

let _seq = 0;
function hid() { return `haul-cv-${String(++_seq).padStart(3, '0')}`; }

function baseDispatch(overrides = {}) {
  return {
    hauler_id:          hid(),
    truck_count:        3,
    direction:          'southbound',
    cargo_tonnes:       120,
    dispatched_by_id:   'u-ops-01',
    dispatched_by_name: 'Dispatch Ops',
    ...overrides,
  };
}

// ── dispatch ──────────────────────────────────────────────────────

describe('convoyState — dispatch', () => {
  it('throws when hauler_id is missing', () => {
    assert.throws(() => cv.dispatch({ ...baseDispatch(), hauler_id: null }), /hauler_id required/i);
  });

  it('throws when truck_count is 0', () => {
    assert.throws(() => cv.dispatch({ ...baseDispatch(), truck_count: 0 }), /truck_count must be/i);
  });

  it('throws when truck_count is negative', () => {
    assert.throws(() => cv.dispatch({ ...baseDispatch(), truck_count: -1 }), /truck_count must be/i);
  });

  it('throws for invalid direction', () => {
    assert.throws(() => cv.dispatch({ ...baseDispatch(), direction: 'eastbound' }), /direction must be/i);
  });

  it('returns a shaped row', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(row !== null && typeof row === 'object');
  });

  it('id is prefixed with live-', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(row.id.startsWith('live-'));
  });

  it('_db_id is a positive integer', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(Number.isInteger(row._db_id) && row._db_id > 0);
  });

  it('initial phase is loading', () => {
    const row = cv.dispatch(baseDispatch());
    assert.equal(row.phase, 'loading');
  });

  it('is_live is true', () => {
    const row = cv.dispatch(baseDispatch());
    assert.equal(row.is_live, true);
  });

  it('stores hauler_id', () => {
    const h = hid();
    const row = cv.dispatch(baseDispatch({ hauler_id: h }));
    assert.equal(row.hauler_id, h);
  });

  it('stores truck_count as trucks', () => {
    const row = cv.dispatch(baseDispatch({ truck_count: 5 }));
    assert.equal(row.trucks, 5);
  });

  it('stores cargo_tonnes', () => {
    const row = cv.dispatch(baseDispatch({ cargo_tonnes: 150 }));
    assert.equal(row.cargo_tonnes, 150);
  });

  it('convoy_ref matches CVY-MMDD-NNN format', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(/^CVY-\d{4}-\d{3}$/.test(row.convoy_ref));
  });

  it('accepts northbound direction', () => {
    assert.doesNotThrow(() => cv.dispatch(baseDispatch({ direction: 'northbound' })));
  });

  it('actual_departure_iso is null on dispatch', () => {
    const row = cv.dispatch(baseDispatch());
    assert.equal(row.actual_departure_iso, null);
  });

  it('arrived_at_iso is null on dispatch', () => {
    const row = cv.dispatch(baseDispatch());
    assert.equal(row.arrived_at_iso, null);
  });
});

// ── depart ────────────────────────────────────────────────────────

describe('convoyState — depart', () => {
  it('sets phase to laden', () => {
    const row = cv.dispatch(baseDispatch());
    const departed = cv.depart(row._db_id);
    assert.equal(departed.phase, 'laden');
  });

  it('actual_departure_iso is set to a recent ISO', () => {
    const before = Date.now();
    const row = cv.dispatch(baseDispatch());
    const departed = cv.depart(row._db_id);
    const after = Date.now();
    assert.ok(departed.actual_departure_iso !== null);
    const ts = new Date(departed.actual_departure_iso).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('depart is idempotent — second call does not change departure time', () => {
    const row = cv.dispatch(baseDispatch());
    const d1 = cv.depart(row._db_id);
    const d2 = cv.depart(row._db_id);
    assert.equal(d1.actual_departure_iso, d2.actual_departure_iso);
  });
});

// ── updatePhase ───────────────────────────────────────────────────

describe('convoyState — updatePhase', () => {
  it('throws for invalid phase', () => {
    const row = cv.dispatch(baseDispatch());
    assert.throws(() => cv.updatePhase(row._db_id, 'flying'), /phase must be/i);
  });

  it('sets phase to laden', () => {
    const row = cv.dispatch(baseDispatch());
    const updated = cv.updatePhase(row._db_id, 'laden');
    assert.equal(updated.phase, 'laden');
  });

  it('sets phase to offload', () => {
    const row = cv.dispatch(baseDispatch());
    const updated = cv.updatePhase(row._db_id, 'offload');
    assert.equal(updated.phase, 'offload');
  });

  it('sets phase to complete', () => {
    const row = cv.dispatch(baseDispatch());
    const updated = cv.updatePhase(row._db_id, 'complete');
    assert.equal(updated.phase, 'complete');
  });
});

// ── arrive ────────────────────────────────────────────────────────

describe('convoyState — arrive', () => {
  it('sets phase to complete', () => {
    const row = cv.dispatch(baseDispatch());
    const arrived = cv.arrive(row._db_id);
    assert.equal(arrived.phase, 'complete');
  });

  it('arrived_at_iso is set to a recent ISO', () => {
    const before = Date.now();
    const row = cv.dispatch(baseDispatch());
    const arrived = cv.arrive(row._db_id);
    const after = Date.now();
    const ts = new Date(arrived.arrived_at_iso).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('stores delivered_tonnes when provided', () => {
    const row = cv.dispatch(baseDispatch());
    const arrived = cv.arrive(row._db_id, { delivered_tonnes: 115.5 });
    assert.equal(arrived.delivered_tonnes, 115.5);
  });

  it('delivered_tonnes is null when not provided', () => {
    const row = cv.dispatch(baseDispatch());
    const arrived = cv.arrive(row._db_id);
    assert.equal(arrived.delivered_tonnes, null);
  });

  it('arrive is idempotent — second call does not change arrived_at_iso', () => {
    const row = cv.dispatch(baseDispatch());
    const a1 = cv.arrive(row._db_id);
    const a2 = cv.arrive(row._db_id);
    assert.equal(a1.arrived_at_iso, a2.arrived_at_iso);
  });
});

// ── listActive ────────────────────────────────────────────────────

describe('convoyState — listActive', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(cv.listActive()));
  });

  it('includes loading-phase convoys', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(cv.listActive().some((c) => c.id === row.id));
  });

  it('includes laden-phase convoys', () => {
    const row = cv.dispatch(baseDispatch());
    cv.depart(row._db_id);
    assert.ok(cv.listActive().some((c) => c.id === row.id));
  });

  it('excludes complete convoys', () => {
    const row = cv.dispatch(baseDispatch());
    cv.arrive(row._db_id);
    assert.ok(!cv.listActive().some((c) => c.id === row.id));
  });
});

// ── listAll ───────────────────────────────────────────────────────

describe('convoyState — listAll', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(cv.listAll()));
  });

  it('includes completed convoys', () => {
    const row = cv.dispatch(baseDispatch());
    cv.arrive(row._db_id);
    assert.ok(cv.listAll().some((c) => c.id === row.id));
  });

  it('includes active convoys', () => {
    const row = cv.dispatch(baseDispatch());
    assert.ok(cv.listAll().some((c) => c.id === row.id));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('convoyState — findById', () => {
  it('returns null for unknown _db_id', () => {
    assert.equal(cv.findById(999999), null);
  });

  it('returns shaped row for known _db_id', () => {
    const row = cv.dispatch(baseDispatch({ cargo_tonnes: 88 }));
    const found = cv.findById(row._db_id);
    assert.ok(found !== null);
    assert.equal(found.cargo_tonnes, 88);
  });

  it('found row has id prefixed with live-', () => {
    const row = cv.dispatch(baseDispatch());
    const found = cv.findById(row._db_id);
    assert.ok(found.id.startsWith('live-'));
  });
});

// ── todayTonnage ──────────────────────────────────────────────────

describe('convoyState — todayTonnage', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('returns an object with total_tonnes and convoy_count', () => {
    const result = cv.todayTonnage(today);
    assert.ok('total_tonnes' in result);
    assert.ok('convoy_count' in result);
  });

  it('total_tonnes is a number', () => {
    assert.ok(typeof cv.todayTonnage(today).total_tonnes === 'number');
  });

  it('total_tonnes increases after a southbound dispatch', () => {
    const before = cv.todayTonnage(today).total_tonnes;
    cv.dispatch(baseDispatch({ direction: 'southbound', cargo_tonnes: 100 }));
    const after = cv.todayTonnage(today).total_tonnes;
    assert.ok(after >= before + 100);
  });

  it('convoy_count increases after a southbound dispatch', () => {
    const before = cv.todayTonnage(today).convoy_count;
    cv.dispatch(baseDispatch({ direction: 'southbound', cargo_tonnes: 50 }));
    const after = cv.todayTonnage(today).convoy_count;
    assert.ok(after >= before + 1);
  });

  it('northbound dispatches are excluded from todayTonnage', () => {
    const before = cv.todayTonnage(today).convoy_count;
    cv.dispatch(baseDispatch({ direction: 'northbound', cargo_tonnes: 50 }));
    const after = cv.todayTonnage(today).convoy_count;
    assert.equal(after, before); // northbound not counted
  });
});

// ── todayTonnageByHauler ──────────────────────────────────────────

describe('convoyState — todayTonnageByHauler', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('returns an array', () => {
    assert.ok(Array.isArray(cv.todayTonnageByHauler(today)));
  });

  it('includes entry for hauler after southbound dispatch', () => {
    const h = hid();
    cv.dispatch(baseDispatch({ hauler_id: h, direction: 'southbound', cargo_tonnes: 75 }));
    const rows = cv.todayTonnageByHauler(today);
    const entry = rows.find((r) => r.hauler_id === h);
    assert.ok(entry !== undefined);
    assert.ok(entry.total_tonnes >= 75);
  });

  it('each row has hauler_id, total_tonnes, convoy_count', () => {
    const h = hid();
    cv.dispatch(baseDispatch({ hauler_id: h, direction: 'southbound', cargo_tonnes: 60 }));
    const rows = cv.todayTonnageByHauler(today);
    const entry = rows.find((r) => r.hauler_id === h);
    assert.ok('hauler_id' in entry && 'total_tonnes' in entry && 'convoy_count' in entry);
  });
});

// ── monthTonnage ──────────────────────────────────────────────────

describe('convoyState — monthTonnage', () => {
  const month = new Date().toISOString().slice(0, 7);

  it('returns an object with total_tonnes and convoy_count', () => {
    const result = cv.monthTonnage(month);
    assert.ok('total_tonnes' in result && 'convoy_count' in result);
  });

  it('total_tonnes increases after a southbound dispatch', () => {
    const before = cv.monthTonnage(month).total_tonnes;
    cv.dispatch(baseDispatch({ direction: 'southbound', cargo_tonnes: 200 }));
    const after = cv.monthTonnage(month).total_tonnes;
    assert.ok(after >= before + 200);
  });
});
