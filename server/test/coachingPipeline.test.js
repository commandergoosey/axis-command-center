'use strict';

/*
 * Tests for services/coachingPipeline.js
 *
 * Stubs both `mock/drivers` (DRIVERS array) and `state/coachingState`
 * so compose(now) runs against fully controlled inputs.
 *
 * Test driver set (6 drivers):
 *   drv-ur  flag=rest_breach       → urgent tier,  14-day cadence, session 10d ago  → INCLUDED
 *   drv-hi  flag=coaching_due      → high tier,    30-day cadence, session 20d ago  → INCLUDED
 *   drv-me  flag=licence_expiring  → medium tier,  60-day cadence, session 50d ago  → INCLUDED
 *   drv-ov  no flag                → overdue (100d > 90d)                           → INCLUDED (tier: high)
 *   drv-ns  no flag                → no session ever                                → INCLUDED (tier: medium)
 *   drv-ex  no flag                → session 30d ago, within 90d cadence            → EXCLUDED
 *
 * Sort order expected: drv-ur(urgent) → drv-ov(high/overdue) → drv-hi(high/not-overdue) →
 *                      drv-me(medium, safety 80) → drv-ns(medium, safety 90)
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Time helpers ──────────────────────────────────────────────────────

const NOW = new Date('2026-05-21T00:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d) => new Date(NOW - d * DAY).toISOString();

// ── Fixtures ──────────────────────────────────────────────────────────

function makeDriver(id, overrides = {}) {
  return {
    id,
    full_name:       overrides.full_name    ?? `Driver ${id}`,
    hauler_id:       overrides.hauler_id    ?? 'h1',
    hauler_display:  overrides.hauler_display ?? 'H1',
    assigned_plate:  overrides.assigned_plate ?? 'GH-001',
    flag:            overrides.flag          ?? null,
    safety_score:    overrides.safety_score  ?? 80,
    harsh_events_7d: overrides.harsh_events_7d ?? 0,
    rest_status:     overrides.rest_status   ?? null,
    hours_this_week: overrides.hours_this_week ?? 48,
  };
}

const ALL_DRIVERS = [
  makeDriver('drv-ur', { flag: 'rest_breach',      safety_score: 70 }),
  makeDriver('drv-hi', { flag: 'coaching_due',     safety_score: 75 }),
  makeDriver('drv-me', { flag: 'licence_expiring', safety_score: 80 }),
  makeDriver('drv-ov', { safety_score: 85 }),   // no flag, will be overdue
  makeDriver('drv-ns', { safety_score: 90 }),   // no flag, no sessions
  makeDriver('drv-ex', { safety_score: 95 }),   // no flag, recent session → excluded
];

const SESSIONS = [
  { attendee_driver_ids: ['drv-ur'], held_at: daysAgo(10),  topic: 'Safety review'   },
  { attendee_driver_ids: ['drv-hi'], held_at: daysAgo(20),  topic: 'Coaching check'  },
  { attendee_driver_ids: ['drv-me'], held_at: daysAgo(50),  topic: 'Licence check'   },
  { attendee_driver_ids: ['drv-ov'], held_at: daysAgo(100), topic: 'Routine review'  },
  { attendee_driver_ids: ['drv-ex'], held_at: daysAgo(30),  topic: 'Recent session'  },
  // drv-ns has no session entry
];

// ── Stub helpers ──────────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id: require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded: true,
    exports,
  };
}

function freshCompose(drivers = ALL_DRIVERS, sessions = SESSIONS) {
  stub('../mock/drivers',        { DRIVERS: drivers });
  stub('../state/coachingState', {
    all:          () => sessions,
    recentWindow: () => sessions,
  });
  delete require.cache[require.resolve('../services/coachingPipeline')];
  return require('../services/coachingPipeline').compose;
}

after(() => {
  for (const p of [
    '../services/coachingPipeline',
    '../mock/drivers',
    '../state/coachingState',
  ]) delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────────

describe('coachingPipeline — output shape', () => {
  it('returns required top-level keys', () => {
    const result = freshCompose()(NOW);
    for (const k of ['generated_at', 'counts', 'pipeline', 'pipeline_capped', 'recent_sessions']) {
      assert.ok(k in result, `missing key: ${k}`);
    }
  });

  it('counts has total / flagged / overdue / by_tier', () => {
    const { counts } = freshCompose()(NOW);
    for (const k of ['total', 'flagged', 'overdue', 'by_tier']) {
      assert.ok(k in counts, `counts missing: ${k}`);
    }
  });

  it('each pipeline row has required fields', () => {
    const { pipeline } = freshCompose()(NOW);
    for (const r of pipeline) {
      for (const k of ['driver_id', 'tier', 'cadence_days', 'overdue',
                        'due_in_days', 'days_since_last', 'flag']) {
        assert.ok(k in r, `row missing: ${k}`);
      }
    }
  });
});

// ── Inclusion / exclusion ─────────────────────────────────────────────

describe('coachingPipeline — inclusion rules', () => {
  it('excludes drivers with no flag, no overdue, recent session', () => {
    const { pipeline } = freshCompose()(NOW);
    const ids = pipeline.map((r) => r.driver_id);
    assert.ok(!ids.includes('drv-ex'), 'drv-ex (recent session, no flag) should be excluded');
  });

  it('includes all flagged drivers regardless of session recency', () => {
    const { pipeline } = freshCompose()(NOW);
    const ids = pipeline.map((r) => r.driver_id);
    assert.ok(ids.includes('drv-ur'), 'drv-ur (rest_breach) must be included');
    assert.ok(ids.includes('drv-hi'), 'drv-hi (coaching_due) must be included');
    assert.ok(ids.includes('drv-me'), 'drv-me (licence_expiring) must be included');
  });

  it('includes overdue unflagged driver (100d > 90d cadence)', () => {
    const { pipeline } = freshCompose()(NOW);
    assert.ok(pipeline.some((r) => r.driver_id === 'drv-ov'));
  });

  it('includes driver with no sessions ever (no flag, cadence not started)', () => {
    const { pipeline } = freshCompose()(NOW);
    assert.ok(pipeline.some((r) => r.driver_id === 'drv-ns'));
  });

  it('pipeline length is 5 (6 drivers minus 1 excluded)', () => {
    const { pipeline } = freshCompose()(NOW);
    assert.equal(pipeline.length, 5);
  });
});

// ── Flag → cadence mapping ────────────────────────────────────────────

describe('coachingPipeline — flag urgency and cadence', () => {
  it('rest_breach → urgent tier, 14-day cadence', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-ur');
    assert.equal(row.tier,         'urgent');
    assert.equal(row.cadence_days, 14);
  });

  it('coaching_due → high tier, 30-day cadence', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-hi');
    assert.equal(row.tier,         'high');
    assert.equal(row.cadence_days, 30);
  });

  it('licence_expiring → medium tier, 60-day cadence', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-me');
    assert.equal(row.tier,         'medium');
    assert.equal(row.cadence_days, 60);
  });

  it('unknown / null flag → routine tier, 90-day cadence', () => {
    // drv-ov overrides tier due to being overdue, so use a fresh driver with no flag and recent session...
    // easier: create isolated driver with unknown flag
    const d = [makeDriver('drv-unk', { flag: 'some_unknown_flag', safety_score: 80 })];
    const s = [{ attendee_driver_ids: ['drv-unk'], held_at: daysAgo(10), topic: 'test' }];
    const row = freshCompose(d, s)(NOW).pipeline.find((r) => r.driver_id === 'drv-unk');
    assert.equal(row.cadence_days, 90, 'unknown flag should use default 90-day cadence');
  });

  it('psv_expiring → medium tier, 60-day cadence', () => {
    const d = [makeDriver('drv-psv', { flag: 'psv_expiring', safety_score: 80 })];
    const row = freshCompose(d, [])(NOW).pipeline.find((r) => r.driver_id === 'drv-psv');
    assert.equal(row.tier,         'medium');
    assert.equal(row.cadence_days, 60);
  });
});

// ── Overdue detection ─────────────────────────────────────────────────

describe('coachingPipeline — overdue detection', () => {
  it('drv-ov (100d since last, 90d cadence) is overdue', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-ov');
    assert.equal(row.overdue, true);
    assert.ok(row.due_in_days < 0, `due_in_days should be negative, got ${row.due_in_days}`);
    assert.equal(row.due_in_days, -10); // 90 - 100 = -10
  });

  it('drv-ur (10d since last, 14d cadence) is NOT overdue', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-ur');
    assert.equal(row.overdue, false);
    assert.ok(row.due_in_days >= 0);
    assert.equal(row.due_in_days, 4); // 14 - 10 = 4
  });

  it('driver exactly at cadence boundary is not overdue', () => {
    // session exactly 90 days ago: dueIn = 90 - 90 = 0, overdue = 0 < 0 = false
    const d = [makeDriver('drv-bd', { flag: 'coaching_due', safety_score: 80 })]; // cadence 30
    const s = [{ attendee_driver_ids: ['drv-bd'], held_at: daysAgo(30), topic: 'test' }];
    const row = freshCompose(d, s)(NOW).pipeline.find((r) => r.driver_id === 'drv-bd');
    assert.equal(row.overdue,    false);
    assert.equal(row.due_in_days, 0);
  });

  it('driver one day past cadence IS overdue', () => {
    const d = [makeDriver('drv-od2', { flag: 'coaching_due', safety_score: 80 })]; // cadence 30
    const s = [{ attendee_driver_ids: ['drv-od2'], held_at: daysAgo(31), topic: 'test' }];
    const row = freshCompose(d, s)(NOW).pipeline.find((r) => r.driver_id === 'drv-od2');
    assert.equal(row.overdue,    true);
    assert.equal(row.due_in_days, -1);
  });
});

// ── Tier assignment for unflagged drivers ─────────────────────────────

describe('coachingPipeline — tier assignment (no flag)', () => {
  it('overdue unflagged driver with last session → tier: high', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-ov');
    assert.equal(row.tier, 'high');
  });

  it('no-session driver → tier: medium', () => {
    const row = freshCompose()(NOW).pipeline.find((r) => r.driver_id === 'drv-ns');
    assert.equal(row.tier, 'medium');
    assert.equal(row.days_since_last, null);
  });
});

// ── Sort order ────────────────────────────────────────────────────────

describe('coachingPipeline — sort order', () => {
  it('urgent driver appears first', () => {
    const { pipeline } = freshCompose()(NOW);
    assert.equal(pipeline[0].driver_id, 'drv-ur');
  });

  it('overdue high-tier before non-overdue high-tier', () => {
    const { pipeline } = freshCompose()(NOW);
    const ovPos = pipeline.findIndex((r) => r.driver_id === 'drv-ov');
    const hiPos = pipeline.findIndex((r) => r.driver_id === 'drv-hi');
    assert.ok(ovPos < hiPos, `overdue(drv-ov pos ${ovPos}) should precede not-overdue(drv-hi pos ${hiPos})`);
  });

  it('within same tier, overdue driver sorts before non-overdue (drv-ns before drv-me)', () => {
    // drv-ns has no session ever → dueIn=-9999 → overdue=true
    // drv-me has licence_expiring flag → 50d since last, 60d cadence → dueIn=10, overdue=false
    // Both are medium tier; overdue sorts first regardless of safety score
    const { pipeline } = freshCompose()(NOW);
    const nsPos = pipeline.findIndex((r) => r.driver_id === 'drv-ns');
    const mePos = pipeline.findIndex((r) => r.driver_id === 'drv-me');
    assert.ok(nsPos < mePos, `overdue(drv-ns pos ${nsPos}) should precede not-overdue(drv-me pos ${mePos})`);
  });

  it('within same tier and same overdue status, lower safety score appears first', () => {
    // Two medium drivers, both not overdue: lower safety first
    const d = [
      makeDriver('drv-lo', { flag: 'licence_expiring', safety_score: 70 }), // medium, dueIn=10
      makeDriver('drv-hi2', { flag: 'licence_expiring', safety_score: 90 }), // medium, dueIn=10
    ];
    const s = [
      { attendee_driver_ids: ['drv-lo'],  held_at: daysAgo(50), topic: 'test' },
      { attendee_driver_ids: ['drv-hi2'], held_at: daysAgo(50), topic: 'test' },
    ];
    const { pipeline } = freshCompose(d, s)(NOW);
    const loPos  = pipeline.findIndex((r) => r.driver_id === 'drv-lo');
    const hiPos2 = pipeline.findIndex((r) => r.driver_id === 'drv-hi2');
    assert.ok(loPos < hiPos2, `lower safety(drv-lo pos ${loPos}) should precede higher(drv-hi2 pos ${hiPos2})`);
  });

  it('more overdue (more negative due_in_days) sorts first within same tier', () => {
    // Two overdue unflagged drivers: one 100d overdue (-10), another 110d overdue (-20)
    const d = [
      makeDriver('drv-a', { safety_score: 80 }), // session 100d ago, dueIn=-10
      makeDriver('drv-b', { safety_score: 80 }), // session 110d ago, dueIn=-20
    ];
    const s = [
      { attendee_driver_ids: ['drv-a'], held_at: daysAgo(100), topic: 't' },
      { attendee_driver_ids: ['drv-b'], held_at: daysAgo(110), topic: 't' },
    ];
    const { pipeline } = freshCompose(d, s)(NOW);
    assert.equal(pipeline[0].driver_id, 'drv-b'); // more overdue first (-20 < -10)
  });
});

// ── Counts ────────────────────────────────────────────────────────────

describe('coachingPipeline — counts', () => {
  it('counts.total equals pipeline rows (before cap)', () => {
    const { counts } = freshCompose()(NOW);
    assert.equal(counts.total, 5); // 5 included drivers
  });

  it('counts.flagged equals number of drivers with a flag', () => {
    const { counts } = freshCompose()(NOW);
    assert.equal(counts.flagged, 3); // drv-ur, drv-hi, drv-me
  });

  it('counts.overdue counts all overdue drivers (including no-session)', () => {
    const { counts } = freshCompose()(NOW);
    // drv-ov: 100d > 90d cadence → overdue
    // drv-ns: no session ever → dueIn=-9999 → overdue
    assert.equal(counts.overdue, 2);
  });

  it('counts.by_tier sums to total', () => {
    const { counts } = freshCompose()(NOW);
    const tierSum = Object.values(counts.by_tier).reduce((s, n) => s + n, 0);
    assert.equal(tierSum, counts.total);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────

describe('coachingPipeline — edge cases', () => {
  it('empty driver roster returns empty pipeline with zero counts', () => {
    const result = freshCompose([], [])(NOW);
    assert.equal(result.pipeline.length, 0);
    assert.equal(result.counts.total, 0);
  });

  it('driver with multiple sessions uses the most recent one', () => {
    const d = [makeDriver('drv-ms', { flag: 'coaching_due', safety_score: 80 })];
    const s = [
      { attendee_driver_ids: ['drv-ms'], held_at: daysAgo(40), topic: 'older' },
      { attendee_driver_ids: ['drv-ms'], held_at: daysAgo(20), topic: 'newer' },
    ];
    const row = freshCompose(d, s)(NOW).pipeline.find((r) => r.driver_id === 'drv-ms');
    assert.equal(row.days_since_last, 20);  // should use most recent (20d ago)
    assert.equal(row.last_session_topic, 'newer');
  });

  it('pipeline_capped is false when driver count ≤ 50', () => {
    assert.equal(freshCompose()(NOW).pipeline_capped, false);
  });
});
