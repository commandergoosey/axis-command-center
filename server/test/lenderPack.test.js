'use strict';

/*
 * Tests for services/lenderPack.js — compose()
 *
 * compose(now, generatedBy) accepts a Date (not ms) — fixed at
 * 2026-05-21T00:00:00Z. Stubs all services/state that have side-
 * effects; mock files (financials, contract, tranches) load from disk.
 *
 * Stubs:
 *   forecast.buildForecast    → makeForeccast()
 *   covenants.buildCovenants  → makeCovenants() — 7-entry array
 *   dscr.compute              → makeDscr()
 *   alertSynth.allAlerts      → []
 *   alertState.getState       → ({})
 *   roster.list               → [makeHauler('h1')]
 *   forecastSnapshots.recent  → []
 *   receivableFollowups.countsByBand → ({})
 *   riskRegister.listActive, .counts → [], { open_count: 0 }
 *   riskSteps.countsByRisk    → ({})
 *   riskComments.countsByRisk, .recentForRisk → ({}, [])
 *
 * Output sections:
 *   generated_at, generated_by, period, corridor,
 *   executive_summary, dscr, covenants, capital, pnl,
 *   receivables, forecast, cashflow_90d, open_alerts,
 *   hauler_ranking, risks, risk_counts
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

const NOW = new Date('2026-05-21T00:00:00Z');

// Minimal hauler for aggregator
function makeHauler(id, overrides = {}) {
  return {
    id,
    display_name:   `Hauler ${id}`,
    status:         'active',
    onboarded_date: '2026-01-01',
    run_rate:       overrides.run_rate ?? 1.0,
    fleet: { contracted_trucks: 10, active_trucks: 10 },
    performance: { sla_attainment_pct: 92 },
    integration: { type: 'api', error_count_24h: 0 },
  };
}

function makeForecast({ eomTonnes = 79_000 } = {}) {
  return {
    projection: {
      eom_tonnes:         eomTonnes,
      pct_of_floor:       118.5,
      pct_of_monthly:     94.8,
      verdict:            'above_floor',
      shortfall_to_floor: 0,
      surplus_over_floor: 12_333,
    },
    targets:  { floor: 66_667, monthly: 83_333 },
    horizon:  { days_remaining: 10, days_elapsed: 21 },
    actual:   { delivered_mtd: 50_000, daily_avg: 2381 },
    required: { daily_to_floor: 0, daily_to_contracted: 1_580 },
    haulers:  [],
  };
}

function makeDscr({ current = 1.40, target_min = 1.3 } = {}) {
  return {
    current,
    target_min,
    headroom_pct:  Number((((current - target_min) / target_min) * 100).toFixed(1)),
    trailing_6m_avg: 1.35,
    steady_state:   2.5,
    computed:       { this_month_revenue_usd: 1_800_000 },
    series:         [],
  };
}

// 7 covenants all PASS
function makeCovenants() {
  return [
    { id: 'cov-dscr',          name: 'DSCR',          metric: '1.40×', status: 'PASS', detail: '', threshold: 1.3,    current: 1.40 },
    { id: 'cov-gearing',       name: 'Gearing',        metric: '70%',   status: 'PASS', detail: '', threshold: 70,     current: 70 },
    { id: 'cov-take-or-pay',   name: 'Take-or-pay',    metric: '79kt',  status: 'PASS', detail: '', threshold: 66_667, current: 79_000 },
    { id: 'cov-concentration', name: 'Concentration',  metric: '30%',   status: 'PASS', detail: '', threshold: 50,     current: 30 },
    { id: 'cov-sla',           name: 'SLA',            metric: '92%',   status: 'PASS', detail: '', threshold: 88,     current: 92 },
    { id: 'cov-ageing',        name: 'Ageing',         metric: '3%',    status: 'PASS', detail: '', threshold: 8,      current: 3 },
    { id: 'cov-liquidity',     name: 'Liquidity',      metric: '1.8×',  status: 'PASS', detail: '', threshold: 1.5,    current: 1.8 },
  ];
}

function freshCompose(opts = {}) {
  stub('../services/forecast',             { buildForecast: () => opts.forecast  ?? makeForecast() });
  stub('../services/covenants',            { buildCovenants: () => opts.covenants ?? makeCovenants() });
  stub('../services/dscr',                 { compute: () => opts.dscr ?? makeDscr() });
  stub('../services/alertSynth',           { allAlerts: () => opts.alerts ?? [] });
  stub('../state/alertState',              { getState: () => ({}) });
  stub('../state/roster',                  { list: () => opts.haulers ?? [makeHauler('h1')] });
  stub('../state/forecastSnapshots',       { recent: () => [] });
  stub('../state/receivableFollowups',     { countsByBand: () => ({}) });
  stub('../state/riskRegister',            {
    listActive: () => opts.risks ?? [],
    counts:     () => opts.riskCounts ?? { open_count: 0, high_open_count: 0 },
  });
  stub('../state/riskSteps',               { countsByRisk: () => ({}) });
  stub('../state/riskComments',            { countsByRisk: () => ({}), recentForRisk: () => [] });
  stub('../state/workorderState',          { allOpen: () => [] }); // transitive via forecast
  delete require.cache[require.resolve('../services/lenderPack')];
  return require('../services/lenderPack').compose;
}

after(() => {
  for (const p of [
    '../services/lenderPack',
    '../services/forecast',
    '../services/covenants',
    '../services/dscr',
    '../services/alertSynth',
    '../state/alertState',
    '../state/roster',
    '../state/forecastSnapshots',
    '../state/receivableFollowups',
    '../state/riskRegister',
    '../state/riskSteps',
    '../state/riskComments',
    '../state/workorderState',
  ]) delete require.cache[require.resolve(p)];
});

// ── Output shape ──────────────────────────────────────────────────

describe('lenderPack — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose(NOW);
    for (const k of ['generated_at', 'generated_by', 'period', 'corridor',
                      'executive_summary', 'dscr', 'covenants', 'capital', 'pnl',
                      'receivables', 'forecast', 'cashflow_90d', 'open_alerts',
                      'hauler_ranking', 'risks', 'risk_counts']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at = now.toISOString()', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).generated_at, NOW.toISOString());
  });

  it('generated_by defaults to null', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).generated_by, null);
  });

  it('generated_by passes through the argument', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW, 'user-test').generated_by, 'user-test');
  });
});

// ── Period block ──────────────────────────────────────────────────

describe('lenderPack — period', () => {
  it('period has label, start, end, month', () => {
    const compose = freshCompose();
    const { period } = compose(NOW);
    for (const k of ['label', 'start', 'end', 'month']) {
      assert.ok(k in period, `period missing field: ${k}`);
    }
  });

  it('period.label is "Month-to-date"', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).period.label, 'Month-to-date');
  });

  it('period.start is the first day of the now month (UTC)', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).period.start, '2026-05-01T00:00:00.000Z');
  });

  it('period.end equals now.toISOString()', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).period.end, NOW.toISOString());
  });
});

// ── Corridor block ────────────────────────────────────────────────

describe('lenderPack — corridor', () => {
  it('corridor has all required fields', () => {
    const compose = freshCompose();
    const { corridor } = compose(NOW);
    for (const k of ['name', 'offtaker', 'contracted_trucks', 'active_trucks',
                      'tonnes_delivered_mtd', 'tonnes_contracted_mtd', 'sla_attainment_pct',
                      'take_or_pay_floor_pct']) {
      assert.ok(k in corridor, `corridor missing field: ${k}`);
    }
  });

  it('corridor.offtaker = "GIBDLC"', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).corridor.offtaker, 'GIBDLC');
  });
});

// ── Executive summary ─────────────────────────────────────────────

describe('lenderPack — executive_summary', () => {
  it('executive_summary has lines (array), headline_status, open_breaches, open_watches', () => {
    const compose = freshCompose();
    const { executive_summary } = compose(NOW);
    for (const k of ['lines', 'headline_status', 'open_breaches', 'open_watches']) {
      assert.ok(k in executive_summary, `executive_summary missing field: ${k}`);
    }
  });

  it('lines is a non-empty array of strings', () => {
    const compose = freshCompose();
    const { lines } = compose(NOW).executive_summary;
    assert.ok(Array.isArray(lines) && lines.length > 0);
    for (const l of lines) assert.equal(typeof l, 'string');
  });

  it('headline_status = PASS when all covenants pass', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).executive_summary.headline_status, 'PASS');
  });

  it('headline_status = BREACH when any covenant is BREACH', () => {
    const covs = makeCovenants();
    covs[0].status = 'BREACH';
    const compose = freshCompose({ covenants: covs });
    assert.equal(compose(NOW).executive_summary.headline_status, 'BREACH');
    assert.equal(compose(NOW).executive_summary.open_breaches, 1);
  });

  it('headline_status = WATCH when any is WATCH but none BREACH', () => {
    const covs = makeCovenants();
    covs[1].status = 'WATCH';
    const compose = freshCompose({ covenants: covs });
    assert.equal(compose(NOW).executive_summary.headline_status, 'WATCH');
    assert.equal(compose(NOW).executive_summary.open_watches, 1);
  });

  it('DSCR BREACH line appears when dscr.current < target_min', () => {
    const compose = freshCompose({ dscr: makeDscr({ current: 0.57 }) });
    const { lines } = compose(NOW).executive_summary;
    assert.ok(lines.some((l) => l.includes('below')),
      'expected breach line containing "below"');
  });

  it('DSCR PASS line appears when dscr.current ≥ target_min + 0.1', () => {
    const compose = freshCompose({ dscr: makeDscr({ current: 1.50 }) });
    const { lines } = compose(NOW).executive_summary;
    assert.ok(lines.some((l) => l.includes('headroom')),
      'expected pass line containing "headroom"');
  });

  it('take-or-pay PASS line when projected EOM ≥ floor', () => {
    const compose = freshCompose();
    const { lines } = compose(NOW).executive_summary;
    assert.ok(lines.some((l) => l.toLowerCase().includes('floor')));
  });
});

// ── DSCR forwarding ───────────────────────────────────────────────

describe('lenderPack — dscr forwarding', () => {
  it('dscr.current forwarded from dscrService stub', () => {
    const compose = freshCompose({ dscr: makeDscr({ current: 1.55 }) });
    assert.equal(compose(NOW).dscr.current, 1.55);
  });

  it('dscr.target_min forwarded', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).dscr.target_min, 1.3);
  });
});

// ── Covenants forwarding ──────────────────────────────────────────

describe('lenderPack — covenants', () => {
  it('covenants array forwarded from buildCovenants stub (7 entries)', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).covenants.length, 7);
  });

  it('covenants entries carry expected ids', () => {
    const compose = freshCompose();
    const ids = compose(NOW).covenants.map((c) => c.id);
    for (const id of ['cov-dscr', 'cov-gearing', 'cov-take-or-pay',
                       'cov-concentration', 'cov-sla', 'cov-ageing', 'cov-liquidity']) {
      assert.ok(ids.includes(id), `missing covenant id: ${id}`);
    }
  });
});

// ── Receivables block ─────────────────────────────────────────────

describe('lenderPack — receivables', () => {
  it('receivables has overdue_usd and overdue_pct', () => {
    const compose = freshCompose();
    const { receivables } = compose(NOW);
    assert.ok('overdue_usd' in receivables);
    assert.ok('overdue_pct' in receivables);
  });

  it('overdue_pct is consistent with overdue_usd / current_balance_usd', () => {
    const compose = freshCompose();
    const { receivables } = compose(NOW);
    const expected = Number(((receivables.overdue_usd / receivables.current_balance_usd) * 100).toFixed(1));
    assert.equal(receivables.overdue_pct, expected);
  });
});

// ── Forecast forwarding ───────────────────────────────────────────

describe('lenderPack — forecast forwarding', () => {
  it('forecast.projected_eom forwarded from buildForecast stub', () => {
    const compose = freshCompose({ forecast: makeForecast({ eomTonnes: 77_000 }) });
    assert.equal(compose(NOW).forecast.projected_eom, 77_000);
  });

  it('forecast.days_remaining forwarded', () => {
    const compose = freshCompose();
    assert.equal(compose(NOW).forecast.days_remaining, 10);
  });

  it('forecast.trend is an array (from forecastSnapshots.recent stub)', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose(NOW).forecast.trend));
  });
});

// ── Hauler ranking ────────────────────────────────────────────────

describe('lenderPack — hauler_ranking', () => {
  it('hauler_ranking is an array', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose(NOW).hauler_ranking));
  });

  it('each hauler_ranking entry has required fields', () => {
    const compose = freshCompose({ haulers: [makeHauler('h1')] });
    for (const h of compose(NOW).hauler_ranking) {
      for (const k of ['hauler_id', 'display_name', 'attainment_pct',
                        'delivered_mtd', 'contracted_mtd']) {
        assert.ok(k in h, `hauler_ranking entry missing field: ${k}`);
      }
    }
  });

  it('hauler_ranking sorted by attainment_pct descending', () => {
    const haulers = [
      makeHauler('h1', { run_rate: 0.8 }),
      makeHauler('h2', { run_rate: 1.5 }),
      makeHauler('h3', { run_rate: 1.0 }),
    ];
    const compose = freshCompose({ haulers });
    const ranking = compose(NOW).hauler_ranking;
    for (let i = 1; i < ranking.length; i++) {
      assert.ok(ranking[i].attainment_pct <= ranking[i - 1].attainment_pct,
        'hauler_ranking not sorted desc');
    }
  });
});

// ── Open alerts ───────────────────────────────────────────────────

describe('lenderPack — open_alerts', () => {
  it('open_alerts is an array', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose(NOW).open_alerts));
  });

  it('only OPEN/IN_TRIAGE CRITICAL/WARNING alerts appear', () => {
    const compose = freshCompose({
      alerts: [
        { id: 'a1', title: 'Crit open',    severity: 'CRITICAL', status: 'OPEN',      body: '', hauler_id: null },
        { id: 'a2', title: 'Warn triage',  severity: 'WARNING',  status: 'IN_TRIAGE', body: '', hauler_id: null },
        { id: 'a3', title: 'Crit resolved',severity: 'CRITICAL', status: 'RESOLVED',  body: '', hauler_id: null },
        { id: 'a4', title: 'Low open',     severity: 'LOW',      status: 'OPEN',      body: '', hauler_id: null },
      ],
    });
    const alerts = compose(NOW).open_alerts;
    const ids = alerts.map((a) => a.id);
    assert.ok(ids.includes('a1'),  'CRITICAL OPEN should appear');
    assert.ok(ids.includes('a2'),  'WARNING IN_TRIAGE should appear');
    assert.ok(!ids.includes('a3'), 'CRITICAL RESOLVED should not appear');
    assert.ok(!ids.includes('a4'), 'LOW OPEN should not appear');
  });
});

// ── Capital block from mock ───────────────────────────────────────

describe('lenderPack — capital', () => {
  it('capital has required fields from CAPITAL_STRUCTURE mock', () => {
    const compose = freshCompose();
    const { capital } = compose(NOW);
    for (const k of ['debt_committed_usd', 'debt_drawn_usd', 'equity_committed_usd', 'equity_drawn_usd']) {
      assert.ok(k in capital, `capital missing field: ${k}`);
    }
  });

  it('capital values are positive numbers', () => {
    const compose = freshCompose();
    const { capital } = compose(NOW);
    for (const v of Object.values(capital)) {
      assert.ok(typeof v === 'number' && v > 0, `capital value ${v} should be a positive number`);
    }
  });
});
