'use strict';

/*
 * Tests for state/driverStatus.js —
 *   VALID_AVAILABILITY, VALID_REST, VALID_FLAGS,
 *   setStatus, getAllOverrides, getOverride, applyOverride
 *
 * Uses an in-memory SQLite DB. driverStatus.js creates its own
 * driver_status_overrides table idempotently (PRIMARY KEY driver_id →
 * one override per driver, upsert semantics). No stubs required.
 *
 * Covers:
 *   - VALID_AVAILABILITY / VALID_REST / VALID_FLAGS: exported arrays
 *   - setStatus: driver_id required; invalid availability throws;
 *     invalid rest_status throws; invalid flag throws; empty string
 *     flag coerced to null; stores all fields; updated_at recent ISO;
 *     upsert overwrites on same driver_id; returns raw row
 *   - getAllOverrides: returns Map keyed by driver_id; size increments
 *   - getOverride: null for unknown; row for known
 *   - applyOverride: no override → truck gets availability from shift
 *     ('rest' → 'on_leave', other → 'available'); override applied →
 *     availability/rest_status/flag replaced; _status_override added;
 *     does not mutate originals
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/driverStatus')];
const ds = require('../state/driverStatus');

let _seq = 0;
function drv() { return `drv-ds-${String(++_seq).padStart(3, '0')}`; }

function baseSet(overrides = {}) {
  return {
    driver_id:       drv(),
    availability:    'available',
    rest_status:     'compliant',
    flag:            null,
    notes:           'Routine update',
    updated_by_id:   'u-ds-01',
    updated_by_name: 'Dispatcher',
    ...overrides,
  };
}

// ── constants ─────────────────────────────────────────────────────

describe('driverStatus — constants', () => {
  it('VALID_AVAILABILITY is an array with expected values', () => {
    assert.ok(Array.isArray(ds.VALID_AVAILABILITY));
    for (const v of ['available', 'on_leave', 'sick', 'suspended']) {
      assert.ok(ds.VALID_AVAILABILITY.includes(v), `missing: ${v}`);
    }
  });

  it('VALID_REST is an array with expected values', () => {
    assert.ok(Array.isArray(ds.VALID_REST));
    for (const v of ['compliant', 'warning', 'breach']) {
      assert.ok(ds.VALID_REST.includes(v), `missing: ${v}`);
    }
  });

  it('VALID_FLAGS includes null and named flag values', () => {
    assert.ok(Array.isArray(ds.VALID_FLAGS));
    assert.ok(ds.VALID_FLAGS.includes(null));
    for (const v of ['rest_breach', 'psv_expiring', 'licence_expiring', 'coaching_due']) {
      assert.ok(ds.VALID_FLAGS.includes(v), `missing: ${v}`);
    }
  });
});

// ── setStatus ─────────────────────────────────────────────────────

describe('driverStatus — setStatus', () => {
  it('throws when driver_id is missing', () => {
    assert.throws(
      () => ds.setStatus({ ...baseSet(), driver_id: null }),
      /driver_id required/i,
    );
  });

  it('throws for an invalid availability', () => {
    assert.throws(
      () => ds.setStatus(baseSet({ availability: 'working' })),
      /availability must be one of/i,
    );
  });

  it('throws for an invalid rest_status', () => {
    assert.throws(
      () => ds.setStatus(baseSet({ rest_status: 'ok' })),
      /rest_status must be one of/i,
    );
  });

  it('throws for an invalid flag', () => {
    assert.throws(
      () => ds.setStatus(baseSet({ flag: 'late' })),
      /flag must be one of/i,
    );
  });

  it('coerces empty string flag to null', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, flag: '' }));
    assert.equal(row.flag, null);
  });

  it('stores availability', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, availability: 'sick' }));
    assert.equal(row.availability, 'sick');
  });

  it('stores rest_status', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, rest_status: 'breach' }));
    assert.equal(row.rest_status, 'breach');
  });

  it('stores flag when provided', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, flag: 'coaching_due' }));
    assert.equal(row.flag, 'coaching_due');
  });

  it('flag is null when not provided', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, flag: null }));
    assert.equal(row.flag, null);
  });

  it('trims and stores notes', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId, notes: '  Rest completed  ' }));
    assert.equal(row.notes, 'Rest completed');
  });

  it('updated_at is a recent ISO string', () => {
    const drvId = drv();
    const before = Date.now();
    const row = ds.setStatus(baseSet({ driver_id: drvId }));
    const after = Date.now();
    assert.ok(new Date(row.updated_at).getTime() >= before);
    assert.ok(new Date(row.updated_at).getTime() <= after);
  });

  it('returns the stored row', () => {
    const drvId = drv();
    const row = ds.setStatus(baseSet({ driver_id: drvId }));
    assert.equal(row.driver_id, drvId);
  });

  it('upsert: second setStatus overwrites for same driver_id', () => {
    const drvId = drv();
    ds.setStatus(baseSet({ driver_id: drvId, availability: 'available' }));
    ds.setStatus(baseSet({ driver_id: drvId, availability: 'suspended' }));
    assert.equal(ds.getOverride(drvId).availability, 'suspended');
  });
});

// ── getAllOverrides ───────────────────────────────────────────────

describe('driverStatus — getAllOverrides', () => {
  it('returns a Map', () => {
    assert.ok(ds.getAllOverrides() instanceof Map);
  });

  it('Map is keyed by driver_id', () => {
    const drvId = drv();
    ds.setStatus(baseSet({ driver_id: drvId }));
    const map = ds.getAllOverrides();
    assert.ok(map.has(drvId));
    assert.equal(map.get(drvId).driver_id, drvId);
  });

  it('size increments after each new driver setStatus()', () => {
    const before = ds.getAllOverrides().size;
    ds.setStatus(baseSet());
    assert.equal(ds.getAllOverrides().size, before + 1);
  });
});

// ── getOverride ───────────────────────────────────────────────────

describe('driverStatus — getOverride', () => {
  it('returns null for an unknown driver_id', () => {
    assert.equal(ds.getOverride('drv-never'), null);
  });

  it('returns the row for a known driver_id', () => {
    const drvId = drv();
    ds.setStatus(baseSet({ driver_id: drvId, rest_status: 'warning' }));
    const row = ds.getOverride(drvId);
    assert.ok(row !== null);
    assert.equal(row.driver_id,  drvId);
    assert.equal(row.rest_status, 'warning');
  });
});

// ── applyOverride ─────────────────────────────────────────────────

describe('driverStatus — applyOverride', () => {
  it('no override + shift "rest" → availability is "on_leave"', () => {
    const driver = { id: 'drv-a', shift: 'rest', flag: null };
    const result = ds.applyOverride(driver, null);
    assert.equal(result.availability, 'on_leave');
  });

  it('no override + non-rest shift → availability is "available"', () => {
    const driver = { id: 'drv-b', shift: 'morning', flag: null };
    const result = ds.applyOverride(driver, null);
    assert.equal(result.availability, 'available');
  });

  it('no override → other fields from mock driver are preserved', () => {
    const driver = { id: 'drv-c', shift: 'morning', flag: 'psv_expiring' };
    const result = ds.applyOverride(driver, null);
    assert.equal(result.flag, 'psv_expiring');
    assert.ok(!('_status_override' in result));
  });

  it('override applied → availability replaced', () => {
    const driver = { id: 'drv-d', shift: 'morning', flag: null };
    const override = { availability: 'sick', rest_status: 'compliant', flag: null,
                       notes: null, updated_by_name: 'Mgr', updated_at: new Date().toISOString() };
    const result = ds.applyOverride(driver, override);
    assert.equal(result.availability, 'sick');
  });

  it('override applied → rest_status replaced', () => {
    const driver = { id: 'drv-e', shift: 'morning', rest_status: 'compliant', flag: null };
    const override = { availability: 'available', rest_status: 'breach', flag: null,
                       notes: null, updated_by_name: 'Ops', updated_at: new Date().toISOString() };
    const result = ds.applyOverride(driver, override);
    assert.equal(result.rest_status, 'breach');
  });

  it('override applied → flag replaced', () => {
    const driver = { id: 'drv-f', shift: 'morning', flag: null };
    const override = { availability: 'available', rest_status: 'compliant',
                       flag: 'licence_expiring', notes: null,
                       updated_by_name: 'Ops', updated_at: new Date().toISOString() };
    const result = ds.applyOverride(driver, override);
    assert.equal(result.flag, 'licence_expiring');
  });

  it('override applied → _status_override envelope present', () => {
    const driver = { id: 'drv-g', shift: 'morning', flag: null };
    const override = { availability: 'on_leave', rest_status: 'compliant', flag: null,
                       notes: 'Annual leave', updated_by_name: 'HR',
                       updated_at: '2026-06-01T00:00:00.000Z' };
    const result = ds.applyOverride(driver, override);
    assert.ok('_status_override' in result);
    assert.equal(result._status_override.notes,           'Annual leave');
    assert.equal(result._status_override.updated_by_name, 'HR');
  });

  it('does not mutate the original driver object', () => {
    const driver = { id: 'drv-h', shift: 'morning', availability: 'available', flag: null };
    const override = { availability: 'suspended', rest_status: 'breach', flag: 'rest_breach',
                       notes: null, updated_by_name: 'X', updated_at: new Date().toISOString() };
    ds.applyOverride(driver, override);
    assert.equal(driver.availability, 'available');
  });
});
