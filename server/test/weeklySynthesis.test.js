'use strict';

/*
 * Tests for services/weeklySynthesis.js — compose()
 *
 * compose(now) accepts an injectable now (ms). Stubs:
 *   - roster.list()                  → hauler fixtures
 *   - forecastSnapshots.recent(n)    → snapshot fixtures
 *   - listAudit(opts)                → { rows: [...] }
 *
 * aggregate() is a pure function — passed haulers directly.
 *
 * Fixed now = 2026-05-21T00:00:00Z
 * Period window: May 15 → May 21 (7 days inclusive)
 *   start_day = isoDay(now - 6*ONE_DAY) = 2026-05-15
 *   end_day   = isoDay(now)             = 2026-05-21
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helpers ──────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports,
  };
}

function freshCompose({
  haulers   = [],
  snapshots = [],
  auditRows = [],
} = {}) {
  stub('../state/roster',            { list: () => haulers });
  stub('../state/forecastSnapshots', { recent: () => snapshots });
  stub('../db/audit',                { listAudit: () => ({ rows: auditRows }) });
  delete require.cache[require.resolve('../services/weeklySynthesis')];
  return require('../services/weeklySynthesis').compose;
}

after(() => {
  for (const p of [
    '../services/weeklySynthesis',
    '../state/roster',
    '../state/forecastSnapshots',
    '../db/audit',
  ]) delete require.cache[require.resolve(p)];
});

const NOW_MS   = new Date('2026-05-21T00:00:00Z').getTime();
const ONE_DAY  = 24 * 60 * 60 * 1000;

// Minimal hauler fixture compatible with aggregate()
function makeHauler(id, overrides = {}) {
  return {
    id,
    display_name:   `Hauler ${id}`,
    status:         overrides.status    ?? 'active',
    onboarded_date: '2026-01-01',
    run_rate:       overrides.run_rate  ?? 1.0,
    fleet: {
      contracted_trucks: overrides.contracted_trucks ?? 10,
      active_trucks:     overrides.active_trucks     ?? 10,
    },
    performance:  { sla_attainment_pct: overrides.sla ?? 90 },
    integration:  { type: 'api', error_count_24h: 0 },
  };
}

// Minimal forecast snapshot for tonnage tests
function makeSnapshot(date, opts = {}) {
  return {
    snapshot_date:  date,
    eom_tonnes:     opts.eom    ?? 79_000,
    delivered_mtd:  opts.mtd    ?? 50_000,
    pct_of_floor:   opts.floor  ?? 102.0,
    pct_of_monthly: opts.monthly ?? 87.0,
    verdict:        opts.verdict ?? 'above_floor',
    floor_target:   opts.ft     ?? 66_667,
  };
}

// ── Output shape ──────────────────────────────────────────────────

describe('weeklySynthesis — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose(NOW_MS);
    for (const k of ['generated_at', 'period', 'tonnage', 'actions', 'themes', 'haulers']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at equals now ISO string', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW_MS).generated_at, new Date(NOW_MS).toISOString());
  });

  it('period block has start, end, days=7', () => {
    const compose = freshCompose();
    const { period } = compose(NOW_MS);
    assert.equal(period.days, 7);
    assert.ok(typeof period.start === 'string');
    assert.ok(typeof period.end   === 'string');
  });

  it('period.start is 6 days before period.end (7-day window inclusive)', () => {
    const compose = freshCompose();
    const { period } = compose(NOW_MS);
    const startMs = new Date(period.start).getTime();
    const endMs   = new Date(period.end).getTime();
    const diffDays = (endMs - startMs) / ONE_DAY;
    assert.equal(diffDays, 6, `period span should be 6 days (7 inclusive), got ${diffDays}`);
  });

  it('period dates match expected window for fixed now', () => {
    const compose = freshCompose();
    const { period } = compose(NOW_MS);
    assert.ok(period.start.startsWith('2026-05-15'),
      `expected start 2026-05-15, got ${period.start}`);
    assert.ok(period.end.startsWith('2026-05-21'),
      `expected end 2026-05-21, got ${period.end}`);
  });
});

// ── Tonnage block ─────────────────────────────────────────────────

describe('weeklySynthesis — tonnage block', () => {
  it('tonnage has all required fields', () => {
    const compose = freshCompose();
    const { tonnage } = compose(NOW_MS);
    for (const k of ['points', 'delivered_in_week', 'forecast_start',
                      'forecast_end', 'forecast_delta', 'verdict_start', 'verdict_end']) {
      assert.ok(k in tonnage, `tonnage missing field: ${k}`);
    }
  });

  it('returns null values when no snapshots in window', () => {
    const compose = freshCompose({ snapshots: [] });
    const { tonnage } = compose(NOW_MS);
    assert.deepEqual(tonnage.points, []);
    assert.equal(tonnage.delivered_in_week, null);
    assert.equal(tonnage.forecast_start, null);
  });

  it('snapshots outside window are excluded', () => {
    // May 10 and May 25 are both outside May 15-21
    const compose = freshCompose({
      snapshots: [
        makeSnapshot('2026-05-10', { eom: 70_000 }),
        makeSnapshot('2026-05-25', { eom: 80_000 }),
      ],
    });
    const { tonnage } = compose(NOW_MS);
    assert.deepEqual(tonnage.points, [], 'out-of-window snapshots should be excluded');
  });

  it('snapshots in window are included and ordered', () => {
    const compose = freshCompose({
      snapshots: [
        makeSnapshot('2026-05-15', { eom: 75_000, mtd: 40_000 }),
        makeSnapshot('2026-05-19', { eom: 78_000, mtd: 53_000 }),
        makeSnapshot('2026-05-21', { eom: 79_000, mtd: 60_000 }),
      ],
    });
    const { tonnage } = compose(NOW_MS);
    assert.equal(tonnage.points.length, 3);
    assert.equal(tonnage.forecast_start, 75_000);
    assert.equal(tonnage.forecast_end, 79_000);
    assert.equal(tonnage.forecast_delta, 4_000);
  });

  it('delivered_in_week = last.delivered_mtd - first.delivered_mtd when same month', () => {
    const compose = freshCompose({
      snapshots: [
        makeSnapshot('2026-05-15', { mtd: 40_000, eom: 75_000 }),
        makeSnapshot('2026-05-21', { mtd: 60_000, eom: 79_000 }),
      ],
    });
    const { tonnage } = compose(NOW_MS);
    assert.equal(tonnage.delivered_in_week, 20_000);
    assert.equal(tonnage.same_month, true);
  });

  it('delivered_in_week is null when snapshots span different months', () => {
    // Use a now at month boundary — Apr 30 to May 06
    const nowApr = new Date('2026-04-30T00:00:00Z').getTime();
    const compose = freshCompose({
      snapshots: [
        makeSnapshot('2026-04-25', { mtd: 55_000, eom: 78_000 }),
        makeSnapshot('2026-04-30', { mtd: 80_000, eom: 81_000 }),
      ],
    });
    // Both are in April so same_month=true; to get cross-month we need a snapshot in two months.
    // Reset: use a now in May 2 so window is Apr 27-May 2, put snapshots in both months.
    const nowMay2 = new Date('2026-05-02T00:00:00Z').getTime();
    const compose2 = freshCompose({
      snapshots: [
        makeSnapshot('2026-04-27', { mtd: 80_000, eom: 81_000 }),
        makeSnapshot('2026-05-01', { mtd:  5_000, eom: 70_000 }),
      ],
    });
    const { tonnage } = compose2(nowMay2);
    assert.equal(tonnage.same_month, false);
    assert.equal(tonnage.delivered_in_week, null);
  });

  it('each points entry has all expected fields', () => {
    const compose = freshCompose({
      snapshots: [makeSnapshot('2026-05-20', { eom: 79_000, mtd: 58_000 })],
    });
    const point = compose(NOW_MS).tonnage.points[0];
    for (const k of ['date', 'eom_tonnes', 'pct_of_floor', 'pct_of_monthly',
                      'delivered_mtd', 'verdict', 'floor_target']) {
      assert.ok(k in point, `point missing field: ${k}`);
    }
  });
});

// ── Actions block ─────────────────────────────────────────────────

describe('weeklySynthesis — actions block', () => {
  it('actions block has all required fields', () => {
    const compose = freshCompose();
    const { actions } = compose(NOW_MS);
    for (const k of ['opened', 'closed', 'escalated', 'snoozed', 'commented', 'net', 'total_events']) {
      assert.ok(k in actions, `actions missing field: ${k}`);
    }
  });

  it('all counters are 0 when audit log is empty', () => {
    const compose = freshCompose({ auditRows: [] });
    const { actions } = compose(NOW_MS);
    assert.equal(actions.opened, 0);
    assert.equal(actions.closed, 0);
    assert.equal(actions.escalated, 0);
    assert.equal(actions.net, 0);
    assert.equal(actions.total_events, 0);
  });

  it('assign rows increment opened (deduped by entity_id)', () => {
    const compose = freshCompose({
      auditRows: [
        { entity_type: 'action_item', entity_id: 'act-1', action: 'assign' },
        { entity_type: 'action_item', entity_id: 'act-1', action: 'assign' }, // duplicate
        { entity_type: 'action_item', entity_id: 'act-2', action: 'assign' },
      ],
    });
    assert.equal(compose(NOW_MS).actions.opened, 2); // deduped
  });

  it('auto_clear and unassign rows increment closed (deduped)', () => {
    const compose = freshCompose({
      auditRows: [
        { entity_type: 'action_item', entity_id: 'act-1', action: 'auto_clear' },
        { entity_type: 'action_item', entity_id: 'act-1', action: 'unassign' }, // same id
        { entity_type: 'action_item', entity_id: 'act-2', action: 'unassign' },
      ],
    });
    assert.equal(compose(NOW_MS).actions.closed, 2); // deduped on entity_id
  });

  it('net = opened - closed', () => {
    const compose = freshCompose({
      auditRows: [
        { entity_type: 'action_item', entity_id: 'act-1', action: 'assign' },
        { entity_type: 'action_item', entity_id: 'act-2', action: 'assign' },
        { entity_type: 'action_item', entity_id: 'act-1', action: 'auto_clear' },
      ],
    });
    const { actions } = compose(NOW_MS);
    assert.equal(actions.opened, 2);
    assert.equal(actions.closed, 1);
    assert.equal(actions.net, 1);
  });

  it('total_events = rows.length (all entity types)', () => {
    const compose = freshCompose({
      auditRows: [
        { entity_type: 'action_item', entity_id: 'a1', action: 'assign' },
        { entity_type: 'alert',       entity_id: 'a2', action: 'view' },
        { entity_type: 'workorder',   entity_id: 'w1', action: 'create' },
      ],
    });
    // total_events in actionsBlock counts rows from the action_item-filtered listAudit call
    // BUT listAudit is stubbed globally — both actionsBlock and themesBlock share the stub.
    // Our stub always returns the same rows regardless of opts.
    // actionsBlock calls listAudit({entity_type:'action_item',...}) →
    // stub returns all 3 rows → total_events = 3.
    assert.equal(compose(NOW_MS).actions.total_events, 3);
  });
});

// ── Themes block ──────────────────────────────────────────────────

describe('weeklySynthesis — themes block', () => {
  it('themes is an array (empty when no audit rows)', () => {
    const compose = freshCompose({ auditRows: [] });
    const { themes } = compose(NOW_MS);
    assert.ok(Array.isArray(themes));
    assert.equal(themes.length, 0);
  });

  it('returns top 5 entity types by count', () => {
    // 6 distinct types, but we want at most 5 in output
    const rows = [
      ...Array(10).fill(null).map((_, i) => ({ entity_type: 'alert', entity_id: `a${i}`, action: 'view' })),
      ...Array(8).fill(null).map((_, i)  => ({ entity_type: 'filing', entity_id: `f${i}`, action: 'view' })),
      ...Array(6).fill(null).map((_, i)  => ({ entity_type: 'action_item', entity_id: `ai${i}`, action: 'view' })),
      ...Array(4).fill(null).map((_, i)  => ({ entity_type: 'workorder', entity_id: `w${i}`, action: 'view' })),
      ...Array(3).fill(null).map((_, i)  => ({ entity_type: 'incident', entity_id: `in${i}`, action: 'view' })),
      ...Array(2).fill(null).map((_, i)  => ({ entity_type: 'licence', entity_id: `l${i}`, action: 'view' })),
    ];
    const compose = freshCompose({ auditRows: rows });
    const { themes } = compose(NOW_MS);
    assert.ok(themes.length <= 5, `should return at most 5 themes, got ${themes.length}`);
    assert.equal(themes[0].entity_type, 'alert'); // highest count first
  });

  it('session rows are excluded from themes', () => {
    const compose = freshCompose({
      auditRows: [
        { entity_type: 'session', entity_id: 's1', action: 'login' },
        { entity_type: 'session', entity_id: 's2', action: 'login' },
        { entity_type: 'alert',   entity_id: 'a1', action: 'view' },
      ],
    });
    const { themes } = compose(NOW_MS);
    assert.ok(!themes.some((t) => t.entity_type === 'session'),
      'session events should be excluded from themes');
    assert.equal(themes.length, 1); // only 'alert'
  });

  it('each theme entry has entity_type, label, count', () => {
    const compose = freshCompose({
      auditRows: [{ entity_type: 'alert', entity_id: 'a1', action: 'view' }],
    });
    const theme = compose(NOW_MS).themes[0];
    assert.ok('entity_type' in theme && 'label' in theme && 'count' in theme);
  });
});

// ── Haulers block ─────────────────────────────────────────────────

describe('weeklySynthesis — haulers block', () => {
  it('haulers block has winners and strugglers arrays', () => {
    const compose = freshCompose({ haulers: [] });
    const { haulers } = compose(NOW_MS);
    assert.ok(Array.isArray(haulers.winners));
    assert.ok(Array.isArray(haulers.strugglers));
  });

  it('high run_rate haulers appear in winners', () => {
    // run_rate=1.5 → attainment > 100% → well above 80% threshold
    const compose = freshCompose({
      haulers: [makeHauler('h1', { run_rate: 1.5 })],
    });
    const { haulers } = compose(NOW_MS);
    const win = haulers.winners.find((h) => h.hauler_id === 'h1');
    assert.ok(win != null, 'high-attainment hauler should appear in winners');
    assert.ok(win.attainment_pct >= 80);
  });

  it('low run_rate haulers appear in strugglers', () => {
    // run_rate=0.5 → attainment = 50% → below 80% threshold
    const compose = freshCompose({
      haulers: [makeHauler('h2', { run_rate: 0.5 })],
    });
    const { haulers } = compose(NOW_MS);
    const str = haulers.strugglers.find((h) => h.hauler_id === 'h2');
    assert.ok(str != null, 'low-attainment hauler should appear in strugglers');
    assert.ok(str.attainment_pct < 80);
  });

  it('each hauler entry has required fields', () => {
    const compose = freshCompose({ haulers: [makeHauler('h1')] });
    const { haulers } = compose(NOW_MS);
    const allEntries = [...haulers.winners, ...haulers.strugglers];
    for (const h of allEntries) {
      for (const k of ['hauler_id', 'display_name', 'attainment_pct', 'delivered_mtd', 'contracted_mtd']) {
        assert.ok(k in h, `hauler entry missing field: ${k}`);
      }
    }
  });

  it('inactive haulers are excluded from winners and strugglers', () => {
    const compose = freshCompose({
      haulers: [makeHauler('h-inactive', { status: 'inactive', run_rate: 1.0 })],
    });
    const { haulers } = compose(NOW_MS);
    const ids = [...haulers.winners, ...haulers.strugglers].map((h) => h.hauler_id);
    assert.ok(!ids.includes('h-inactive'), 'inactive hauler should not appear');
  });

  it('winners are sorted by attainment_pct descending', () => {
    // run_rate 2.0 vs 1.2 vs 1.0 → descending attainment
    const compose = freshCompose({
      haulers: [
        makeHauler('h1', { run_rate: 1.0 }),
        makeHauler('h2', { run_rate: 2.0 }),
        makeHauler('h3', { run_rate: 1.2 }),
      ],
    });
    const { winners } = compose(NOW_MS).haulers;
    for (let i = 1; i < winners.length; i++) {
      assert.ok(winners[i].attainment_pct <= winners[i - 1].attainment_pct,
        'winners not sorted by attainment_pct desc');
    }
  });
});
