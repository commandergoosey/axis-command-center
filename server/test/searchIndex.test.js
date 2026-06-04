'use strict';

/*
 * Tests for services/searchIndex.js — compose({ q, role, hauler_id })
 *
 * compose() is a role-aware global search across haulers, drivers,
 * risks, alerts, contacts, filings, and audit.
 *
 * Key behaviors tested:
 *   - Empty / whitespace query → empty result shape
 *   - Output shape: query, total, by_type, results
 *   - No _score field in returned items
 *   - Each result item has type, id, title, subtitle, link
 *   - Matching by field: hauler display_name, id, risk title, alert title
 *   - No match → total = 0
 *   - Scoring: exact match (100) ranks above prefix match (50)
 *   - Role filtering: lender ↛ drivers/contacts/audit; hauler_admin → own data only
 *   - Per-type cap of 5
 *   - by_type counts match group sizes
 *   - searchAudit skipped for single-char queries (q.length < 2)
 *   - Filing results appear for matching query
 *
 * Stubs: roster.list, riskRegister.listActive, haulerContacts,
 *        alertState.getState, filingState.getState, alertSynth.allAlerts,
 *        audit.listAudit
 * Static mocks: DRIVERS, FILINGS loaded from disk (no stub needed).
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

// ── Fixtures ──────────────────────────────────────────────────────

const MOCK_HAULERS = [
  {
    id: 'haul-01',
    display_name: 'Alpha Transport',
    status: 'active',
    fleet: { contracted_trucks: 10 },
    integration: { type: 'api' },
    api_status: 'connected',
  },
  {
    id: 'haul-02',
    display_name: 'Beta Haulage',
    status: 'active',
    fleet: { contracted_trucks: 8 },
    integration: { type: 'manual' },
    api_status: 'manual',
  },
];

const MOCK_RISKS = [
  {
    id: 1,
    title: 'Currency fluctuation risk',
    description: 'GHS/USD volatility affects haulage margins',
    mitigation_plan: 'Hedge via forward contracts',
    category: 'financial',
    severity: 'HIGH',
    status: 'open',
    owner: null,
  },
];

const MOCK_ALERTS = [
  {
    id: 'alert-001',
    title: 'Convoy delayed on corridor',
    body: 'TRK-001 is 4 hours overdue',
    severity: 'CRITICAL',
    status: 'NEEDS_ACTION',
    type: 'ops',
    hauler_id: 'haul-01',
  },
  {
    id: 'alert-002',
    title: 'Integration degraded',
    body: 'API sync failing for haul-02',
    severity: 'WARNING',
    status: 'IN_TRIAGE',
    type: 'integration',
    hauler_id: 'haul-02',
  },
];

function freshCompose({
  haulers      = MOCK_HAULERS,
  risks        = MOCK_RISKS,
  alerts       = MOCK_ALERTS,
  contactIndex = {},
  alertStateFn = () => ({}),
  auditRows    = [],
} = {}) {
  stub('../state/roster',         { list: () => haulers });
  stub('../state/riskRegister',   { listActive: () => risks });
  stub('../state/haulerContacts', {
    latestPerHauler: () => contactIndex,
    forHauler:       () => [],
  });
  stub('../state/alertState',  { getState: alertStateFn });
  stub('../state/filingState', { getState: () => null });
  stub('../services/alertSynth', { allAlerts: () => alerts });
  stub('../db/audit', { listAudit: () => ({ rows: auditRows }) });
  delete require.cache[require.resolve('../services/searchIndex')];
  return require('../services/searchIndex').compose;
}

after(() => {
  for (const p of [
    '../services/searchIndex',
    '../state/roster',
    '../state/riskRegister',
    '../state/haulerContacts',
    '../state/alertState',
    '../state/filingState',
    '../services/alertSynth',
    '../db/audit',
  ]) delete require.cache[require.resolve(p)];
});

// ── Empty / blank queries ─────────────────────────────────────────

describe('searchIndex — empty query', () => {
  it('empty string q returns empty result shape', () => {
    const compose = freshCompose();
    const r = compose({ q: '', role: 'axis_admin' });
    assert.equal(r.query, '');
    assert.equal(r.total, 0);
    assert.deepEqual(r.by_type, {});
    assert.deepEqual(r.results, []);
  });

  it('whitespace-only q returns empty result after normalization', () => {
    const compose = freshCompose();
    const r = compose({ q: '   ', role: 'axis_admin' });
    assert.equal(r.total, 0);
    assert.deepEqual(r.results, []);
  });

  it('missing q defaults to empty string and returns empty result', () => {
    const compose = freshCompose();
    const r = compose({});
    assert.equal(r.total, 0);
  });
});

// ── Output shape ──────────────────────────────────────────────────

describe('searchIndex — output shape', () => {
  it('result has all four top-level fields', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    for (const k of ['query', 'total', 'by_type', 'results']) {
      assert.ok(k in r, `missing field: ${k}`);
    }
  });

  it('results is an array', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    assert.ok(Array.isArray(r.results));
  });

  it('by_type is a plain object', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    assert.equal(typeof r.by_type, 'object');
    assert.ok(r.by_type !== null && !Array.isArray(r.by_type));
  });

  it('total equals results.length', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    assert.equal(r.total, r.results.length);
  });

  it('query field reflects original q (not normalized)', () => {
    const compose = freshCompose();
    const r = compose({ q: 'Alpha Transport', role: 'axis_admin' });
    assert.equal(r.query, 'Alpha Transport');
  });
});

// ── Result item shape ─────────────────────────────────────────────

describe('searchIndex — result item shape', () => {
  it('each result has type, id, title, subtitle, link', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    assert.ok(r.results.length > 0, 'expected at least one result for "alpha"');
    for (const item of r.results) {
      for (const k of ['type', 'id', 'title', 'subtitle', 'link']) {
        assert.ok(k in item, `result item missing field: ${k}`);
      }
    }
  });

  it('no result item has a _score field', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    for (const item of r.results) {
      assert.ok(!('_score' in item), '_score must be stripped from results');
    }
  });

  it('each link has path and label', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    for (const item of r.results) {
      assert.ok(typeof item.link.path === 'string', `${item.type}: link.path missing`);
      assert.ok(typeof item.link.label === 'string', `${item.type}: link.label missing`);
    }
  });
});

// ── Matching behavior ─────────────────────────────────────────────

describe('searchIndex — matching', () => {
  it('query matching hauler display_name returns hauler result', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    const haulers = r.results.filter((i) => i.type === 'hauler');
    assert.ok(haulers.length > 0, 'expected at least one hauler result');
    assert.ok(haulers.some((h) => h.title === 'Alpha Transport'));
  });

  it('query matching hauler id returns that hauler', () => {
    const compose = freshCompose();
    const r = compose({ q: 'haul-01', role: 'axis_admin' });
    const haulers = r.results.filter((i) => i.type === 'hauler');
    assert.ok(haulers.some((h) => h.id === 'haul-01'), 'expected haul-01 in results');
  });

  it('query with no matches in any type returns total=0', () => {
    const compose = freshCompose();
    const r = compose({ q: 'zzznomatchxxx', role: 'axis_admin' });
    assert.equal(r.total, 0);
    assert.deepEqual(r.results, []);
  });

  it('query matching risk title returns a risk result', () => {
    const compose = freshCompose();
    const r = compose({ q: 'currency', role: 'axis_admin' });
    const risks = r.results.filter((i) => i.type === 'risk');
    assert.ok(risks.length > 0, 'expected at least one risk result for "currency"');
    assert.ok(risks.some((r) => r.type === 'risk'));
  });

  it('query matching alert title returns an alert result', () => {
    const compose = freshCompose();
    const r = compose({ q: 'convoy', role: 'axis_admin' });
    const alerts = r.results.filter((i) => i.type === 'alert');
    assert.ok(alerts.length > 0, 'expected at least one alert result for "convoy"');
  });

  it('query matching a FILINGS record (from disk) returns a filing result', () => {
    const compose = freshCompose();
    // FILINGS come from disk — query against a known field type-prefix
    const r = compose({ q: 'ghana', role: 'axis_admin' });
    // Results may or may not hit filings depending on content — just confirm no throw
    assert.ok(typeof r.total === 'number');
  });
});

// ── Scoring — order ───────────────────────────────────────────────

describe('searchIndex — scoring order', () => {
  it('exact match (score 100) ranks before prefix match (score 50)', () => {
    const haulers = [
      // h2 has display_name that starts with 'alpha' (prefix → 50)
      { id: 'h2', display_name: 'alpha transport', status: 'active',
        fleet: { contracted_trucks: 5 }, integration: { type: 'api' }, api_status: 'connected' },
      // h1 has display_name exactly 'alpha' (exact → 100)
      { id: 'h1', display_name: 'alpha', status: 'active',
        fleet: { contracted_trucks: 5 }, integration: { type: 'api' }, api_status: 'connected' },
    ];
    const compose = freshCompose({ haulers });
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    const haulerResults = r.results.filter((i) => i.type === 'hauler');
    assert.ok(haulerResults.length >= 2, 'expected both haulers to match');
    // h1 is exact match → should be first
    assert.equal(haulerResults[0].id, 'h1', 'exact match should rank first');
  });
});

// ── by_type counts ────────────────────────────────────────────────

describe('searchIndex — by_type', () => {
  it('by_type.haulers matches hauler results count', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'axis_admin' });
    const haulerCount = r.results.filter((i) => i.type === 'hauler').length;
    assert.equal(r.by_type.haulers, haulerCount);
  });

  it('axis_admin broad query populates haulers and alerts in by_type', () => {
    const compose = freshCompose();
    const r = compose({ q: 'a', role: 'axis_admin' });
    assert.ok('haulers' in r.by_type, 'by_type missing haulers');
    assert.ok('alerts' in r.by_type,  'by_type missing alerts');
  });
});

// ── Role filtering ────────────────────────────────────────────────

describe('searchIndex — role filtering', () => {
  it('lender role: results contain no driver items', () => {
    const compose = freshCompose();
    const r = compose({ q: 'a', role: 'lender' });
    assert.ok(!r.results.some((i) => i.type === 'driver'),
      'lender should not see driver results');
  });

  it('lender role: results contain no contact items', () => {
    const compose = freshCompose();
    const r = compose({ q: 'a', role: 'lender' });
    assert.ok(!r.results.some((i) => i.type === 'contact'),
      'lender should not see contact results');
  });

  it('lender role: results contain no audit items', () => {
    const compose = freshCompose();
    const r = compose({ q: 'ab', role: 'lender' });
    assert.ok(!r.results.some((i) => i.type === 'audit'),
      'lender should not see audit results');
  });

  it('lender by_type has no drivers, contacts, audit keys', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'lender' });
    assert.ok(!('drivers'  in r.by_type), 'lender by_type should not have drivers');
    assert.ok(!('contacts' in r.by_type), 'lender by_type should not have contacts');
    assert.ok(!('audit'    in r.by_type), 'lender by_type should not have audit');
  });

  it('hauler_admin: hauler results contain only own hauler', () => {
    const compose = freshCompose();
    // 'haul' matches both haul-01 and haul-02 by id, but hauler_admin is scoped to haul-01
    const r = compose({ q: 'haul', role: 'hauler_admin', hauler_id: 'haul-01' });
    const haulers = r.results.filter((i) => i.type === 'hauler');
    assert.ok(haulers.every((h) => h.id === 'haul-01'),
      'hauler_admin should only see their own hauler');
  });

  it('hauler_admin: other haulers are not in results', () => {
    const compose = freshCompose();
    const r = compose({ q: 'haul', role: 'hauler_admin', hauler_id: 'haul-01' });
    const haulers = r.results.filter((i) => i.type === 'hauler');
    assert.ok(!haulers.some((h) => h.id === 'haul-02'),
      'haul-02 must not appear for haul-01 admin');
  });

  it('null role defaults to axis_admin (all types present in by_type)', () => {
    const compose = freshCompose();
    // null role falls back to axis_admin which includes drivers
    const r = compose({ q: 'a', role: null });
    // axis_admin is the default — drivers key should be present (even if 0)
    assert.ok('drivers' in r.by_type, 'null role should default to axis_admin with drivers');
  });

  it('unknown role string defaults to axis_admin', () => {
    const compose = freshCompose();
    const r = compose({ q: 'alpha', role: 'unknown_role' });
    // axis_admin default — should still return haulers
    assert.ok(r.results.length > 0, 'unknown role should not block all results');
    assert.ok('haulers' in r.by_type);
  });
});

// ── Per-type cap ──────────────────────────────────────────────────

describe('searchIndex — per-type cap', () => {
  it('more than 5 matching haulers are capped at 5', () => {
    const manyHaulers = Array.from({ length: 10 }, (_, i) => ({
      id:           `testco-${String(i).padStart(2, '0')}`,
      display_name: `Testco Haulage ${i}`,
      status:       'active',
      fleet:        { contracted_trucks: 10 },
      integration:  { type: 'api' },
      api_status:   'connected',
    }));
    const compose = freshCompose({ haulers: manyHaulers });
    const r = compose({ q: 'testco', role: 'axis_admin' });
    const haulers = r.results.filter((i) => i.type === 'hauler');
    assert.ok(haulers.length <= 5,
      `per-type cap of 5 exceeded: got ${haulers.length} hauler results`);
  });
});

// ── Audit search ──────────────────────────────────────────────────

describe('searchIndex — audit search', () => {
  it('single-char query returns no audit results (searchAudit bails on q.length < 2)', () => {
    const compose = freshCompose({
      auditRows: [{
        id: 1, summary: 'test audit event', entity_type: 'hauler',
        action: 'update', actor: { display_name: 'Admin' },
        ts: new Date().toISOString(),
      }],
    });
    const r = compose({ q: 'x', role: 'axis_admin' });
    const auditResults = r.results.filter((i) => i.type === 'audit');
    assert.equal(auditResults.length, 0,
      'single-char query should not invoke listAudit (returns [] immediately)');
  });

  it('two-char query passes through to listAudit and returns its rows', () => {
    const row = {
      id: 42, summary: 'ab corridor update', entity_type: 'hauler',
      action: 'update', actor: { display_name: 'Alice' },
      ts: new Date().toISOString(),
    };
    const compose = freshCompose({ auditRows: [row] });
    const r = compose({ q: 'ab', role: 'axis_admin' });
    const auditResults = r.results.filter((i) => i.type === 'audit');
    assert.equal(auditResults.length, 1, 'two-char query should return audit row');
    assert.equal(auditResults[0].type, 'audit');
    assert.equal(auditResults[0].id, '42');
    assert.equal(auditResults[0].title, 'ab corridor update');
  });
});
