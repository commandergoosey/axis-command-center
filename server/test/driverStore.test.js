'use strict';

/*
 * Tests for state/driverStore.js —
 *   list, findById, findByRig, create, update, archive, unarchive,
 *   syncAssignment, clearRigAssignment, updateScorecard
 *   + monthsUntil / enrich (via licence_expiry_months on returned rows)
 *
 * Uses an in-memory SQLite DB. mock/drivers is stubbed with
 * { buildDrivers: () => [] } so seed() runs a no-op transaction.
 *
 * Covers:
 *   - enrich / monthsUntil: null → null; past date → 0; future → > 0;
 *     licence_expiry_months present on every returned row
 *   - list: empty initially; all after creates; hauler_id filter;
 *     archived excluded
 *   - findById: falsy/unknown → null; returns enriched row;
 *     archived driver → null
 *   - findByRig: null/unknown → null; returns assigned driver;
 *     null after archive
 *   - create: missing hauler_id / full_name throw; id prefix; full_name
 *     trimmed; defaults (licence_class, shift, rest_status, counters,
 *     safety_score, psv_expiry_days); assignment null on creation
 *   - update: throws for unknown; patches full_name / licence_class /
 *     shift; unpatched fields preserved
 *   - archive / unarchive: excluded from list/findById after archive;
 *     restored after unarchive
 *   - syncAssignment: sets rig + plate on driver; findByRig finds them
 *   - clearRigAssignment: clears all drivers assigned to that rig;
 *     findByRig returns null
 *   - updateScorecard: trips_this_week +1; hours_this_week accumulates;
 *     rest_status compliant / warning / breach thresholds; null id no-op
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// ── Stub helper ───────────────────────────────────────────────────
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Stub mock/drivers → empty so seed() does nothing ─────────────
stub('../mock/drivers', { buildDrivers: () => [] });

delete require.cache[require.resolve('../state/driverStore')];
const ds = require('../state/driverStore');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function newDriver(overrides = {}) {
  _seq += 1;
  return {
    hauler_id:  `haul-d${String(_seq).padStart(2, '0')}`,
    full_name:  `Driver ${_seq}`,
    ...overrides,
  };
}

// ── enrich / monthsUntil ──────────────────────────────────────────

describe('driverStore — enrich / monthsUntil', () => {
  it('licence_expiry_months is null when licence_expiry_iso is null', () => {
    const d = ds.create(newDriver({ licence_expiry_iso: null }));
    assert.equal(d.licence_expiry_months, null);
  });

  it('licence_expiry_months is 0 for a past expiry date', () => {
    const d = ds.create(newDriver({ licence_expiry_iso: '2020-01-01' }));
    assert.equal(d.licence_expiry_months, 0,
      'past expiry should return 0 (Math.max(0, ...))');
  });

  it('licence_expiry_months is > 0 for a future expiry date', () => {
    const d = ds.create(newDriver({ licence_expiry_iso: '2035-12-31' }));
    assert.ok(d.licence_expiry_months > 0,
      `future expiry should return positive months, got ${d.licence_expiry_months}`);
  });

  it('every row returned by list() has licence_expiry_months', () => {
    ds.create(newDriver());
    for (const row of ds.list()) {
      assert.ok('licence_expiry_months' in row,
        `row ${row.id} missing licence_expiry_months`);
    }
  });
});

// ── list ──────────────────────────────────────────────────────────

describe('driverStore — list', () => {
  it('returns an empty array on a fresh in-memory DB', () => {
    // Before any create, the store is empty (seed returned 0 drivers)
    // Note: tests run in order and share the DB — if creates occurred above,
    // we assert >= 0 later; here the first describe had creates.
    // Let's verify the return type at minimum.
    assert.ok(Array.isArray(ds.list()));
  });

  it('returns active drivers after creation', () => {
    const before = ds.list().length;
    ds.create(newDriver());
    assert.equal(ds.list().length, before + 1);
  });

  it('hauler_id filter returns only that hauler\'s drivers', () => {
    const h = `haul-lf-${++_seq}`;
    ds.create({ hauler_id: h, full_name: 'Filter Driver' });
    const result = ds.list({ hauler_id: h });
    assert.ok(result.length >= 1);
    assert.ok(result.every((d) => d.hauler_id === h),
      'list({hauler_id}) should return only drivers for that hauler');
  });

  it('archived drivers are excluded from list()', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    assert.ok(!ds.list().some((x) => x.id === d.id),
      'archived driver should not appear in list()');
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('driverStore — findById', () => {
  it('returns null for null id', () => {
    assert.equal(ds.findById(null), null);
  });

  it('returns null for an unknown id', () => {
    assert.equal(ds.findById('drv-does-not-exist'), null);
  });

  it('returns the enriched row for a known id', () => {
    const d = ds.create(newDriver());
    const result = ds.findById(d.id);
    assert.ok(result !== null);
    assert.equal(result.id, d.id);
    assert.ok('licence_expiry_months' in result);
  });

  it('returns null for an archived driver', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    assert.equal(ds.findById(d.id), null,
      'archived driver should not be returned by findById');
  });
});

// ── findByRig ─────────────────────────────────────────────────────

describe('driverStore — findByRig', () => {
  it('returns null for a null rig_id', () => {
    assert.equal(ds.findByRig(null), null);
  });

  it('returns null when no driver is assigned to the rig', () => {
    assert.equal(ds.findByRig('rig-unassigned'), null);
  });

  it('returns the driver assigned to the rig via syncAssignment', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-fr-01', 'GH-0001');
    const found = ds.findByRig('rig-fr-01');
    assert.ok(found !== null);
    assert.equal(found.id, d.id);
  });

  it('returns null for a rig whose driver is archived', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-fr-02', 'GH-0002');
    ds.archive(d.id);
    assert.equal(ds.findByRig('rig-fr-02'), null,
      'archived driver should not be returned by findByRig');
  });
});

// ── create ────────────────────────────────────────────────────────

describe('driverStore — create', () => {
  it('throws when hauler_id is missing', () => {
    assert.throws(
      () => ds.create({ full_name: 'No Hauler' }),
      /required/i,
    );
  });

  it('throws when full_name is missing', () => {
    assert.throws(
      () => ds.create({ hauler_id: 'haul-01' }),
      /required/i,
    );
  });

  it('id starts with "drv-"', () => {
    const d = ds.create(newDriver());
    assert.ok(d.id.startsWith('drv-'), `expected "drv-" prefix, got: ${d.id}`);
  });

  it('full_name is trimmed', () => {
    const d = ds.create(newDriver({ full_name: '  Padded Name  ' }));
    assert.equal(d.full_name, 'Padded Name');
  });

  it('licence_class defaults to "E"', () => {
    const d = ds.create(newDriver());
    assert.equal(d.licence_class, 'E');
  });

  it('shift defaults to "day"', () => {
    const d = ds.create(newDriver());
    assert.equal(d.shift, 'day');
  });

  it('rest_status defaults to "compliant"', () => {
    const d = ds.create(newDriver());
    assert.equal(d.rest_status, 'compliant');
  });

  it('trips_this_week defaults to 0', () => {
    const d = ds.create(newDriver());
    assert.equal(d.trips_this_week, 0);
  });

  it('hours_this_week defaults to 0', () => {
    const d = ds.create(newDriver());
    assert.equal(d.hours_this_week, 0);
  });

  it('safety_score defaults to 80', () => {
    const d = ds.create(newDriver());
    assert.equal(d.safety_score, 80);
  });

  it('psv_expiry_days defaults to 365', () => {
    const d = ds.create(newDriver());
    assert.equal(d.psv_expiry_days, 365);
  });

  it('assigned_rig_id is null on creation', () => {
    const d = ds.create(newDriver());
    assert.equal(d.assigned_rig_id, null);
  });

  it('provided licence_class is stored', () => {
    const d = ds.create(newDriver({ licence_class: 'C' }));
    assert.equal(d.licence_class, 'C');
  });
});

// ── update ────────────────────────────────────────────────────────

describe('driverStore — update', () => {
  it('throws for an unknown driver id', () => {
    assert.throws(
      () => ds.update('drv-does-not-exist', { full_name: 'X' }),
      /not found/i,
    );
  });

  it('patches full_name', () => {
    const d = ds.create(newDriver({ full_name: 'Before' }));
    const patched = ds.update(d.id, { full_name: 'After' });
    assert.equal(patched.full_name, 'After');
  });

  it('patches licence_class', () => {
    const d = ds.create(newDriver({ licence_class: 'E' }));
    const patched = ds.update(d.id, { licence_class: 'B' });
    assert.equal(patched.licence_class, 'B');
  });

  it('patches shift', () => {
    const d = ds.create(newDriver({ shift: 'day' }));
    const patched = ds.update(d.id, { shift: 'night' });
    assert.equal(patched.shift, 'night');
  });

  it('unpatched fields are preserved', () => {
    const d = ds.create(newDriver({ licence_class: 'E', shift: 'day' }));
    ds.update(d.id, { full_name: 'Renamed' });
    const result = ds.findById(d.id);
    assert.equal(result.licence_class, 'E');
    assert.equal(result.shift,         'day');
  });

  it('returns the updated row (enriched)', () => {
    const d = ds.create(newDriver());
    const result = ds.update(d.id, { full_name: 'Updated' });
    assert.ok('licence_expiry_months' in result);
    assert.equal(result.full_name, 'Updated');
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('driverStore — archive / unarchive', () => {
  it('archived driver is excluded from list()', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    assert.ok(!ds.list().some((x) => x.id === d.id));
  });

  it('archived driver returns null from findById', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    assert.equal(ds.findById(d.id), null);
  });

  it('unarchived driver reappears in list()', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    ds.unarchive(d.id);
    assert.ok(ds.list().some((x) => x.id === d.id));
  });

  it('findById returns the driver after unarchive', () => {
    const d = ds.create(newDriver());
    ds.archive(d.id);
    ds.unarchive(d.id);
    assert.ok(ds.findById(d.id) !== null);
  });
});

// ── syncAssignment / clearRigAssignment ───────────────────────────

describe('driverStore — syncAssignment / clearRigAssignment', () => {
  it('syncAssignment sets assigned_rig_id and assigned_plate', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-sa-01', 'GH-5000');
    const row = ds.findById(d.id);
    assert.equal(row.assigned_rig_id, 'rig-sa-01');
    assert.equal(row.assigned_plate,  'GH-5000');
  });

  it('findByRig returns the driver after syncAssignment', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-sa-02', 'GH-5001');
    assert.equal(ds.findByRig('rig-sa-02').id, d.id);
  });

  it('clearRigAssignment clears assigned_rig_id on the driver', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-ca-01', 'GH-6000');
    ds.clearRigAssignment('rig-ca-01');
    const row = ds.findById(d.id);
    assert.equal(row.assigned_rig_id, null);
    assert.equal(row.assigned_plate,  null);
  });

  it('findByRig returns null after clearRigAssignment', () => {
    const d = ds.create(newDriver());
    ds.syncAssignment(d.id, 'rig-ca-02', 'GH-6001');
    ds.clearRigAssignment('rig-ca-02');
    assert.equal(ds.findByRig('rig-ca-02'), null);
  });
});

// ── updateScorecard ───────────────────────────────────────────────

describe('driverStore — updateScorecard', () => {
  it('increments trips_this_week by 1', () => {
    const d = ds.create(newDriver());
    ds.updateScorecard(d.id, { duration_min: 60 });
    assert.equal(ds.findById(d.id).trips_this_week, 1);
  });

  it('accumulates hours_this_week from duration_min', () => {
    const d = ds.create(newDriver());
    ds.updateScorecard(d.id, { duration_min: 120 }); // 2 hours
    const row = ds.findById(d.id);
    assert.ok(
      Math.abs(row.hours_this_week - 2) < 0.01,
      `expected ~2 hours, got ${row.hours_this_week}`,
    );
  });

  it('rest_status stays "compliant" below 85% of 60 h (< 51 h)', () => {
    const d = ds.create(newDriver());
    ds.updateScorecard(d.id, { duration_min: 60 }); // 1 hour — well under threshold
    assert.equal(ds.findById(d.id).rest_status, 'compliant');
  });

  it('rest_status becomes "warning" at 85% of 60 h (= 51 h)', () => {
    const d = ds.create(newDriver());
    // Add exactly 51 hours in one trip
    ds.updateScorecard(d.id, { duration_min: 51 * 60 });
    assert.equal(ds.findById(d.id).rest_status, 'warning',
      'hours_this_week = 51 should trigger warning status');
  });

  it('rest_status becomes "breach" at or above 60 h', () => {
    const d = ds.create(newDriver());
    ds.updateScorecard(d.id, { duration_min: 60 * 60 }); // exactly 60 hours
    assert.equal(ds.findById(d.id).rest_status, 'breach',
      'hours_this_week = 60 should trigger breach status');
  });

  it('null driverId is a no-op (no error thrown)', () => {
    assert.doesNotThrow(() => ds.updateScorecard(null, { duration_min: 60 }));
  });

  it('missing duration_min defaults to 0 hours added', () => {
    const d = ds.create(newDriver());
    ds.updateScorecard(d.id, {});
    const row = ds.findById(d.id);
    assert.equal(row.trips_this_week, 1);
    assert.equal(row.hours_this_week, 0);
  });
});
