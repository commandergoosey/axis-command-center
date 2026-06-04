'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB — must happen before any app module ─────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// ── Fresh modules bound to the in-memory DB ───────────────────────────
for (const rel of ['../state/positionStore', '../services/healthScorer']) {
  delete require.cache[require.resolve(rel)];
}
const positionStore = require('../state/positionStore');
const healthScorer  = require('../services/healthScorer');

// ── Helpers ───────────────────────────────────────────────────────────
// CYCLE_TARGET_HOURS defaults to 26 → target = 26 × 60 = 1560 min.
const ON_TIME_MIN = 100;   // well under 1560 — always on time
const LATE_MIN    = 2000;  // over 1560 — always late
const RECENTLY    = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();  // 2 days ago
const FRESH_POS   = new Date().toISOString();
const STALE_POS   = new Date(Date.now() - 60 * 60_000).toISOString(); // 60 min ago > 45 min cutoff

let tripSeq = 0;
function insertTrip({ duration_min, status = 'completed', departed_at = RECENTLY, hauler_id = 'h1', vehicle_id = 'V1' } = {}) {
  tripSeq++;
  db.prepare(`
    INSERT INTO trips (id, hauler_id, vehicle_id, direction, status, departed_at, duration_min, created_at, updated_at)
    VALUES (?, ?, ?, 'laden', ?, ?, ?, ?, ?)
  `).run(`t-${tripSeq}`, hauler_id, vehicle_id, status, departed_at, duration_min, RECENTLY, RECENTLY);
}

function insertAlertState({ severity = 'critical', status_override = 'NEEDS_ACTION', resolved_at_iso = null } = {}) {
  tripSeq++;
  db.prepare(`
    INSERT INTO alert_state (alert_id, status_override, notes_json, updated_at, severity, resolved_at_iso)
    VALUES (?, ?, '[]', ?, ?, ?)
  `).run(`as-${tripSeq}`, status_override, RECENTLY, severity, resolved_at_iso);
}

function clearAll() {
  db.exec('DELETE FROM trips; DELETE FROM alert_state; DELETE FROM vehicle_positions; DELETE FROM corridor_health');
}

// ─────────────────────────────────────────────────────────────────────

describe('healthScorer — default score with no data', () => {
  before(clearAll);

  it('score is 100 when there are no trips, alerts, or positions', () => {
    const { score, on_time_rate, alert_load, pos_freshness } = healthScorer.computeScore('2026-01-01');
    assert.strictEqual(score, 100);
    assert.strictEqual(on_time_rate, 1);
    assert.strictEqual(alert_load,   1);
    assert.strictEqual(pos_freshness, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('healthScorer — on-time trip rate component', () => {
  beforeEach(clearAll);

  it('100 % on-time trips → on_time_rate = 1.0', () => {
    insertTrip({ duration_min: ON_TIME_MIN });
    insertTrip({ duration_min: ON_TIME_MIN });
    const { on_time_rate } = healthScorer.computeScore('2026-01-02');
    assert.strictEqual(on_time_rate, 1);
  });

  it('0 % on-time trips → on_time_rate = 0.0', () => {
    insertTrip({ duration_min: LATE_MIN });
    insertTrip({ duration_min: LATE_MIN });
    const { on_time_rate } = healthScorer.computeScore('2026-01-03');
    assert.strictEqual(on_time_rate, 0);
  });

  it('50 % on-time trips → on_time_rate = 0.5', () => {
    insertTrip({ duration_min: ON_TIME_MIN });
    insertTrip({ duration_min: LATE_MIN });
    const { on_time_rate } = healthScorer.computeScore('2026-01-04');
    assert.strictEqual(on_time_rate, 0.5);
  });

  it('pending (non-completed) trips are ignored', () => {
    insertTrip({ duration_min: LATE_MIN, status: 'in_progress' });
    const { on_time_rate } = healthScorer.computeScore('2026-01-05');
    assert.strictEqual(on_time_rate, 1, 'in_progress trips must not count');
  });

  it('trips older than 7 days are excluded from the window', () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    insertTrip({ duration_min: LATE_MIN, departed_at: old });
    const { on_time_rate } = healthScorer.computeScore('2026-01-06');
    assert.strictEqual(on_time_rate, 1, 'trips outside 7-day window must not count');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('healthScorer — alert load component', () => {
  beforeEach(clearAll);

  it('no active critical/high alerts → alert_load = 1.0', () => {
    const { alert_load } = healthScorer.computeScore('2026-01-10');
    assert.strictEqual(alert_load, 1);
  });

  it('MAX_ALERTS (10) active critical alerts → alert_load = 0.0', () => {
    for (let i = 0; i < 10; i++) insertAlertState({ severity: 'critical' });
    const { alert_load } = healthScorer.computeScore('2026-01-11');
    assert.strictEqual(alert_load, 0);
  });

  it('5 active critical alerts → alert_load = 0.5', () => {
    for (let i = 0; i < 5; i++) insertAlertState({ severity: 'critical' });
    const { alert_load } = healthScorer.computeScore('2026-01-12');
    assert.strictEqual(alert_load, 0.5);
  });

  it('resolved critical alerts are not counted', () => {
    insertAlertState({ severity: 'critical', resolved_at_iso: RECENTLY });
    const { alert_load } = healthScorer.computeScore('2026-01-13');
    assert.strictEqual(alert_load, 1, 'resolved alert must not count against load');
  });

  it('warning-severity alerts do not count against alert_load', () => {
    for (let i = 0; i < 10; i++) insertAlertState({ severity: 'warning' });
    const { alert_load } = healthScorer.computeScore('2026-01-14');
    assert.strictEqual(alert_load, 1, 'warning alerts must not affect alert_load');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('healthScorer — position freshness component', () => {
  beforeEach(clearAll);

  it('no positions → pos_freshness = 1.0 (default perfect)', () => {
    const { pos_freshness } = healthScorer.computeScore('2026-01-20');
    assert.strictEqual(pos_freshness, 1);
  });

  it('all fresh positions → pos_freshness = 1.0', () => {
    positionStore.upsert({ vehicle_id: 'V1', hauler_id: 'h1', latitude: 6.0, longitude: -2.0, position_at: FRESH_POS });
    positionStore.upsert({ vehicle_id: 'V2', hauler_id: 'h1', latitude: 6.1, longitude: -2.1, position_at: FRESH_POS });
    const { pos_freshness } = healthScorer.computeScore('2026-01-21');
    assert.strictEqual(pos_freshness, 1);
  });

  it('all stale positions → pos_freshness = 0.0', () => {
    positionStore.upsert({ vehicle_id: 'V3', hauler_id: 'h1', latitude: 6.0, longitude: -2.0, position_at: STALE_POS });
    positionStore.upsert({ vehicle_id: 'V4', hauler_id: 'h1', latitude: 6.1, longitude: -2.1, position_at: STALE_POS });
    const { pos_freshness } = healthScorer.computeScore('2026-01-22');
    assert.strictEqual(pos_freshness, 0);
  });

  it('half stale → pos_freshness = 0.5', () => {
    positionStore.upsert({ vehicle_id: 'V5', hauler_id: 'h1', latitude: 6.0, longitude: -2.0, position_at: FRESH_POS });
    positionStore.upsert({ vehicle_id: 'V6', hauler_id: 'h1', latitude: 6.1, longitude: -2.1, position_at: STALE_POS });
    const { pos_freshness } = healthScorer.computeScore('2026-01-23');
    assert.strictEqual(pos_freshness, 0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('healthScorer — composite formula and persistence', () => {
  beforeEach(clearAll);

  it('weighted formula: 40 % on_time + 30 % alert + 30 % pos rounds correctly', () => {
    // on_time_rate = 0.5 (one on-time, one late)
    // alert_load   = 0.5 (5 of 10 max alerts active)
    // pos_freshness = 1.0 (no positions → default)
    // expected raw = 0.5*0.40 + 0.5*0.30 + 1.0*0.30 = 0.20 + 0.15 + 0.30 = 0.65 → score 65
    insertTrip({ duration_min: ON_TIME_MIN });
    insertTrip({ duration_min: LATE_MIN });
    for (let i = 0; i < 5; i++) insertAlertState({ severity: 'critical' });
    const { score } = healthScorer.computeScore('2026-02-01');
    assert.strictEqual(score, 65);
  });

  it('score is clamped to [0, 100]', () => {
    // All defaults → 100
    const { score } = healthScorer.computeScore('2026-02-02');
    assert.ok(score >= 0 && score <= 100, `score ${score} out of [0,100]`);
  });

  it('computeScore persists to corridor_health and is retrievable via get()', () => {
    healthScorer.computeScore('2026-02-03');
    const row = healthScorer.get('2026-02-03');
    assert.ok(row, 'row should exist after computeScore');
    assert.strictEqual(row.date, '2026-02-03');
    assert.ok(typeof row.score === 'number');
    assert.ok(row.computed_at);
  });

  it('run() stores today\'s date and returns the result', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = healthScorer.run();
    assert.strictEqual(result.date, today);
    const stored = healthScorer.get(today);
    assert.ok(stored, 'run() must persist to corridor_health');
    assert.strictEqual(stored.score, result.score);
  });

  it('getRange() returns rows for the requested date span', () => {
    healthScorer.computeScore('2026-03-01');
    healthScorer.computeScore('2026-03-02');
    healthScorer.computeScore('2026-03-03');
    const rows = healthScorer.getRange('2026-03-01', '2026-03-03');
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].date, '2026-03-01');
    assert.strictEqual(rows[2].date, '2026-03-03');
  });

  it('calling computeScore twice for the same date upserts (does not duplicate)', () => {
    healthScorer.computeScore('2026-04-01');
    healthScorer.computeScore('2026-04-01');
    const rows = healthScorer.getRange('2026-04-01', '2026-04-01');
    assert.strictEqual(rows.length, 1, 'should upsert not insert on conflict');
  });

  it('get() returns null for a date with no stored score', () => {
    assert.strictEqual(healthScorer.get('2099-12-31'), null);
  });
});
