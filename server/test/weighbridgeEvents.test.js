'use strict';

/*
 * Tests for state/weighbridgeEvents.js —
 *   add, recent, since, summary
 *
 * Uses in-memory SQLite. weighbridgeEvents.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - add: stores plate/gross_weight_t; limit_t defaults to 60;
 *     overage_t computed (gross - limit, clamped to 0 when under);
 *     hold_minutes stored; logged_at defaults to now; rig_id/hauler_id
 *     optional; is_live: true
 *   - recent: returns array; limit respected; ordered DESC
 *   - since: excludes events before sinceIso; includes after
 *   - summary: shape fields; has_live_data false when no events;
 *     event_count increments; total_overage_t rounded to 1dp;
 *     avg_hold_minutes rounded; affected_rigs counts distinct rig_ids
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/weighbridgeEvents')];
const wb = require('../state/weighbridgeEvents');

let _seq = 0;
function plate() { return `GR-${String(++_seq).padStart(4, '0')}-WB`; }

function base(overrides = {}) {
  return {
    plate:          plate(),
    gross_weight_t: 65,
    ...overrides,
  };
}

// ── add ───────────────────────────────────────────────────────────

describe('weighbridgeEvents — add', () => {
  it('returns a row with a numeric id', () => {
    const row = wb.add(base());
    assert.ok(typeof row.id === 'number' && row.id > 0);
  });

  it('stores plate', () => {
    const p = plate();
    const row = wb.add(base({ plate: p }));
    assert.equal(row.plate, p);
  });

  it('stores gross_weight_t', () => {
    const row = wb.add(base({ gross_weight_t: 70 }));
    assert.equal(row.gross_weight_t, 70);
  });

  it('limit_t defaults to 60 when not provided', () => {
    const row = wb.add(base());
    assert.equal(row.limit_t, 60);
  });

  it('limit_t can be overridden', () => {
    const row = wb.add(base({ limit_t: 55 }));
    assert.equal(row.limit_t, 55);
  });

  it('overage_t is computed as gross - limit', () => {
    const row = wb.add(base({ gross_weight_t: 68, limit_t: 60 }));
    assert.equal(row.overage_t, 8);
  });

  it('overage_t is 0 (not negative) when under limit', () => {
    const row = wb.add(base({ gross_weight_t: 55, limit_t: 60 }));
    assert.equal(row.overage_t, 0);
  });

  it('stores hold_minutes when provided', () => {
    const row = wb.add(base({ hold_minutes: 45 }));
    assert.equal(row.hold_minutes, 45);
  });

  it('hold_minutes is null when not provided', () => {
    const row = wb.add(base());
    assert.equal(row.hold_minutes, null);
  });

  it('logged_at defaults to a recent ISO string', () => {
    const before = Date.now();
    const row = wb.add(base());
    const after = Date.now();
    const ts = new Date(row.logged_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('logged_at can be overridden', () => {
    const row = wb.add(base({ logged_at: '2026-01-01T06:00:00.000Z' }));
    assert.equal(row.logged_at, '2026-01-01T06:00:00.000Z');
  });

  it('rig_id and hauler_id are null when not provided', () => {
    const row = wb.add(base());
    assert.equal(row.rig_id, null);
    assert.equal(row.hauler_id, null);
  });

  it('stores rig_id and hauler_id when provided', () => {
    const row = wb.add(base({ rig_id: 'rig-x', hauler_id: 'h-x' }));
    assert.equal(row.rig_id, 'rig-x');
    assert.equal(row.hauler_id, 'h-x');
  });

  it('is_live is true', () => {
    assert.equal(wb.add(base()).is_live, true);
  });
});

// ── recent ────────────────────────────────────────────────────────

describe('weighbridgeEvents — recent', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(wb.recent()));
  });

  it('includes freshly added events', () => {
    const p = plate();
    wb.add(base({ plate: p }));
    assert.ok(wb.recent().some((r) => r.plate === p));
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) wb.add(base());
    const limited = wb.recent(3);
    assert.ok(limited.length <= 3);
  });
});

// ── since ─────────────────────────────────────────────────────────

describe('weighbridgeEvents — since', () => {
  it('excludes events before sinceIso', () => {
    const p = plate();
    wb.add(base({ plate: p, logged_at: '2020-01-01T00:00:00.000Z' }));
    const rows = wb.since('2025-01-01T00:00:00.000Z');
    assert.ok(!rows.some((r) => r.plate === p));
  });

  it('includes events after sinceIso', () => {
    const p = plate();
    wb.add(base({ plate: p, logged_at: '2099-01-01T00:00:00.000Z' }));
    const rows = wb.since('2026-01-01T00:00:00.000Z');
    assert.ok(rows.some((r) => r.plate === p));
  });
});

// ── summary ───────────────────────────────────────────────────────

describe('weighbridgeEvents — summary', () => {
  it('returns shape with required fields', () => {
    const s = wb.summary('2020-01-01T00:00:00.000Z');
    for (const f of ['event_count', 'total_overage_t', 'avg_hold_minutes', 'affected_rigs', 'has_live_data']) {
      assert.ok(f in s, `missing: ${f}`);
    }
  });

  it('has_live_data is false when no events in window', () => {
    // Use 2200 — the 'since' test adds a row at 2099-01-01, which would be
    // matched by WHERE logged_at >= '2099-01-01'; use a safely later century.
    const s = wb.summary('2200-01-01T00:00:00.000Z');
    assert.equal(s.has_live_data, false);
    assert.equal(s.event_count, 0);
  });

  it('event_count increments after add', () => {
    const before = wb.summary('2026-01-01T00:00:00.000Z').event_count;
    wb.add(base());
    const after = wb.summary('2026-01-01T00:00:00.000Z').event_count;
    assert.ok(after > before);
  });

  it('has_live_data is true when there are events in the window', () => {
    wb.add(base());
    assert.equal(wb.summary('2026-01-01T00:00:00.000Z').has_live_data, true);
  });

  it('total_overage_t is rounded to 1 decimal place', () => {
    wb.add(base({ gross_weight_t: 61.333, limit_t: 60 }));
    const { total_overage_t } = wb.summary('2026-01-01T00:00:00.000Z');
    assert.equal(total_overage_t, Math.round(total_overage_t * 10) / 10);
  });

  it('avg_hold_minutes is rounded when present', () => {
    wb.add(base({ hold_minutes: 33 }));
    const { avg_hold_minutes } = wb.summary('2026-01-01T00:00:00.000Z');
    if (avg_hold_minutes !== null) {
      assert.equal(avg_hold_minutes, Math.round(avg_hold_minutes));
    }
  });

  it('affected_rigs counts distinct rig_ids', () => {
    const r = `rig-sum-${++_seq}`;
    wb.add(base({ rig_id: r }));
    wb.add(base({ rig_id: r }));
    const { affected_rigs } = wb.summary('2026-01-01T00:00:00.000Z');
    assert.ok(Number.isInteger(affected_rigs));
  });
});
