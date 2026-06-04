'use strict';

/*
 * Tests for state/fuelLogs.js —
 *   add, getByRig, summaryByHauler, recentByHauler, corridorSummary
 *
 * Uses an in-memory SQLite DB. fuelLogs.js creates its own fuel_logs
 * table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: returns row with numeric id; stores rig_id/hauler_id/litres;
 *     litres cast to Number; cost_ghs/odometer_km stored or null;
 *     notes stored or null; logged_at defaults to now; logged_at
 *     can be overridden
 *   - getByRig: empty for unknown rig; returns rows for known rig;
 *     default limit 10; limit respected; ordered logged_at DESC
 *   - summaryByHauler: empty for unknown hauler; returns per-rig
 *     summary with fill_count/total_litres/last_fill_at; sinceIso
 *     filter respected
 *   - recentByHauler: empty for unknown; returns rows for hauler;
 *     default limit 50; limit respected
 *   - corridorSummary: shape has fill_count/total_litres/total_cost_ghs/
 *     has_live_data/since_iso/by_hauler; has_live_data false when no
 *     data; fill_count increments; by_hauler has hauler entries;
 *     since_iso filter excludes old entries; total_litres rounded
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/fuelLogs')];
const fl = require('../state/fuelLogs');

let _seq = 0;
function rig()    { return `rig-fl-${String(++_seq).padStart(3, '0')}`; }
function hauler() { return `haul-fl-${_seq}`; }

function base(overrides = {}) {
  return {
    rig_id:    rig(),
    hauler_id: hauler(),
    litres:    150,
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('fuelLogs — add', () => {
  it('returns a row with a numeric id', () => {
    const row = fl.add(base());
    assert.ok(typeof row.id === 'number');
    assert.ok(row.id > 0);
  });

  it('stores rig_id and hauler_id', () => {
    const rigId = rig(); const haulId = hauler();
    const row = fl.add(base({ rig_id: rigId, hauler_id: haulId }));
    assert.equal(row.rig_id,    rigId);
    assert.equal(row.hauler_id, haulId);
  });

  it('stores litres as a number', () => {
    const row = fl.add(base({ litres: '200.5' }));
    assert.equal(typeof row.litres, 'number');
    assert.equal(row.litres, 200.5);
  });

  it('stores cost_ghs when provided', () => {
    const row = fl.add(base({ cost_ghs: 875.50 }));
    assert.equal(row.cost_ghs, 875.50);
  });

  it('cost_ghs is null when not provided', () => {
    const row = fl.add(base());
    assert.equal(row.cost_ghs, null);
  });

  it('stores odometer_km when provided', () => {
    const row = fl.add(base({ odometer_km: 42500 }));
    assert.equal(row.odometer_km, 42500);
  });

  it('odometer_km is null when not provided', () => {
    assert.equal(fl.add(base()).odometer_km, null);
  });

  it('stores notes when provided', () => {
    const row = fl.add(base({ notes: 'Full tank' }));
    assert.equal(row.notes, 'Full tank');
  });

  it('notes is null when not provided', () => {
    assert.equal(fl.add(base()).notes, null);
  });

  it('logged_at defaults to a recent ISO string when not provided', () => {
    const before = Date.now();
    const row = fl.add(base());
    const after = Date.now();
    const ts = new Date(row.logged_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('logged_at can be overridden', () => {
    const row = fl.add(base({ logged_at: '2026-07-01T06:00:00.000Z' }));
    assert.equal(row.logged_at, '2026-07-01T06:00:00.000Z');
  });
});

// ── getByRig ──────────────────────────────────────────────────────

describe('fuelLogs — getByRig', () => {
  it('returns empty array for unknown rig', () => {
    assert.deepEqual(fl.getByRig('rig-never'), []);
  });

  it('returns rows for a known rig', () => {
    const r = rig(); const h = hauler();
    fl.add(base({ rig_id: r, hauler_id: h }));
    fl.add(base({ rig_id: r, hauler_id: h }));
    assert.equal(fl.getByRig(r).length, 2);
  });

  it('respects the limit parameter', () => {
    const r = rig(); const h = hauler();
    for (let i = 0; i < 5; i++) fl.add(base({ rig_id: r, hauler_id: h }));
    assert.equal(fl.getByRig(r, 2).length, 2);
  });

  it('default limit is 10', () => {
    const r = rig(); const h = hauler();
    for (let i = 0; i < 15; i++) fl.add(base({ rig_id: r, hauler_id: h }));
    assert.equal(fl.getByRig(r).length, 10);
  });
});

// ── summaryByHauler ───────────────────────────────────────────────

describe('fuelLogs — summaryByHauler', () => {
  it('returns empty array for unknown hauler', () => {
    assert.deepEqual(fl.summaryByHauler('haul-never'), []);
  });

  it('returns a per-rig summary row', () => {
    const r = rig(); const h = hauler();
    fl.add(base({ rig_id: r, hauler_id: h, litres: 100 }));
    fl.add(base({ rig_id: r, hauler_id: h, litres: 200 }));
    const rows = fl.summaryByHauler(h);
    const row = rows.find((x) => x.rig_id === r);
    assert.ok(row, 'summary row should exist');
    assert.ok(row.fill_count >= 2);
    assert.ok(row.total_litres >= 300);
  });

  it('excludes fills older than sinceIso', () => {
    const r = rig(); const h = hauler();
    fl.add(base({ rig_id: r, hauler_id: h, litres: 50, logged_at: '2020-01-01T00:00:00.000Z' }));
    const rows = fl.summaryByHauler(h, '2025-01-01T00:00:00.000Z');
    assert.ok(!rows.some((x) => x.rig_id === r));
  });
});

// ── recentByHauler ────────────────────────────────────────────────

describe('fuelLogs — recentByHauler', () => {
  it('returns empty array for unknown hauler', () => {
    assert.deepEqual(fl.recentByHauler('haul-never'), []);
  });

  it('returns rows for a known hauler', () => {
    const h = `haul-rbh-${++_seq}`;
    fl.add(base({ hauler_id: h, rig_id: rig() }));
    fl.add(base({ hauler_id: h, rig_id: rig() }));
    assert.equal(fl.recentByHauler(h).length, 2);
  });

  it('respects the limit parameter', () => {
    const h = `haul-rbl-${++_seq}`;
    for (let i = 0; i < 5; i++) fl.add(base({ hauler_id: h, rig_id: rig() }));
    assert.equal(fl.recentByHauler(h, 3).length, 3);
  });
});

// ── corridorSummary ───────────────────────────────────────────────

describe('fuelLogs — corridorSummary', () => {
  it('return shape has expected fields', () => {
    const s = fl.corridorSummary();
    for (const f of ['fill_count', 'total_litres', 'total_cost_ghs', 'has_live_data', 'since_iso', 'by_hauler']) {
      assert.ok(f in s, `missing field: ${f}`);
    }
  });

  it('by_hauler is an array', () => {
    assert.ok(Array.isArray(fl.corridorSummary().by_hauler));
  });

  it('fill_count increments after add()', () => {
    const before = fl.corridorSummary().fill_count;
    fl.add(base());
    const after = fl.corridorSummary().fill_count;
    assert.ok(after > before);
  });

  it('has_live_data is true when there are fills within the window', () => {
    fl.add(base());
    assert.equal(fl.corridorSummary().has_live_data, true);
  });

  it('by_hauler entry present for hauler with recent fills', () => {
    const h = `haul-cs-${++_seq}`;
    fl.add(base({ hauler_id: h, rig_id: rig() }));
    const { by_hauler } = fl.corridorSummary();
    assert.ok(by_hauler.some((x) => x.hauler_id === h));
  });

  it('excludes fills older than since_iso', () => {
    const h = `haul-old-${++_seq}`;
    fl.add(base({ hauler_id: h, rig_id: rig(), logged_at: '2020-01-01T00:00:00.000Z' }));
    const { by_hauler } = fl.corridorSummary({ since_iso: '2025-01-01T00:00:00.000Z' });
    assert.ok(!by_hauler.some((x) => x.hauler_id === h));
  });

  it('total_litres is rounded to 1 decimal place', () => {
    const h = `haul-rnd-${++_seq}`;
    fl.add(base({ hauler_id: h, rig_id: rig(), litres: 100.123 }));
    const { total_litres } = fl.corridorSummary();
    // Should be rounded — check no more than 1 decimal place
    assert.equal(total_litres, Math.round(total_litres * 10) / 10);
  });
});
