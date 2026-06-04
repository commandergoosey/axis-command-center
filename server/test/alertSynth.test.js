'use strict';

/*
 * Tests for services/alertSynth.js —
 *   allAlerts(now), generated(now), autoClearedAlerts(now), whyCleared(alert, now)
 *
 * allAlerts(now) = static MOCK alerts + synthesized, de-duped on id.
 * STATIC_ALERTS in mock/alerts is empty so allAlerts == generated in practice.
 *
 * With NOW = 2026-05-21T00:00:00Z and empty stubs:
 *   synthAxleHolds  → 0 (no HOLD events within 24h in mock data)
 *   synthLiveWbHolds→ 0 (weighbridgeEvents stubbed empty)
 *   synthFilings    → 3 CRITICAL (flg-dvla-q1 -21d, flg-epa-mon -14d, flg-gha-levy -6d)
 *   synthMaintenance→ 0 (max 2 critical rigs per hauler in mock, threshold is 3)
 *   synthIntegration→ 0 (integrationStore stubbed has_credentials=false)
 *   synthCovenants  → 0 (buildCovenants stubbed [])
 *   synthRealAlerts → 0 (db stubbed [])
 *
 * whyCleared(alert, now) is a pure suppression function tested with:
 *   RESOLVED / MONITORING status shortcuts
 *   axle_load_breach  → coaching_logged  (coachingState stub)
 *   hse_event         → hse_closed       (incidentState stub)
 *   licence_expiry    → licence_renewed  (licenceState stub + real LICENCE_EXPIRY entry)
 *
 * Stubs: filingState, integrationStore, workorderState, coachingState,
 *        licenceState, incidentState, weighbridgeEvents, roster,
 *        services/covenants, db
 * Mock files (compliance, fleet, alerts, haulers) load from disk.
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

// ── Fixed now ─────────────────────────────────────────────────────

const NOW = new Date('2026-05-21T00:00:00Z').getTime(); // epoch ms

// ── Baseline stubs (all generators return empty) ──────────────────

function applyBaseStubs(overrides = {}) {
  stub('../db', { prepare: () => ({ all: () => [], run: () => ({ changes: 0 }) }) });
  stub('../state/filingState',
    overrides.filingState ?? { getState: () => null });
  stub('../state/integrationStore',
    overrides.integrationStore ?? { summary: () => ({ has_credentials: false }), list: () => [] });
  stub('../state/workorderState',
    overrides.workorderState ?? { allOpen: () => [], rigsInRemediation: () => new Set() });
  stub('../state/coachingState',
    overrides.coachingState ?? { recentForHauler: () => null, recentWindow: () => [] });
  stub('../state/licenceState',
    overrides.licenceState ?? { getState: () => null });
  stub('../state/incidentState',
    overrides.incidentState ?? { since: () => [] });
  stub('../state/weighbridgeEvents',
    overrides.weighbridgeEvents ?? { since: () => [] });
  stub('../state/roster',
    overrides.roster ?? { list: () => [] });
  stub('../services/covenants',
    overrides.covenants ?? { buildCovenants: () => [] });
}

function freshModule(overrides = {}) {
  applyBaseStubs(overrides);
  delete require.cache[require.resolve('../services/alertSynth')];
  return require('../services/alertSynth');
}

after(() => {
  for (const p of [
    '../services/alertSynth',
    '../db',
    '../state/filingState',
    '../state/integrationStore',
    '../state/workorderState',
    '../state/coachingState',
    '../state/licenceState',
    '../state/incidentState',
    '../state/weighbridgeEvents',
    '../state/roster',
    '../services/covenants',
  ]) delete require.cache[require.resolve(p)];
});

// ── allAlerts — basic structure ───────────────────────────────────

describe('alertSynth — allAlerts structure', () => {
  it('returns an array', () => {
    const { allAlerts } = freshModule();
    assert.ok(Array.isArray(allAlerts(NOW)));
  });

  it('every item has id, type, title, body, severity, status, link', () => {
    const { allAlerts } = freshModule();
    const alerts = allAlerts(NOW);
    assert.ok(alerts.length > 0, 'expected at least one alert');
    for (const a of alerts) {
      for (const k of ['id', 'type', 'title', 'body', 'severity', 'status', 'link']) {
        assert.ok(k in a, `alert ${a.id} missing field: ${k}`);
      }
    }
  });

  it('generated alerts also have impact and action fields', () => {
    const { allAlerts } = freshModule();
    const generated = allAlerts(NOW).filter((a) => a.generated);
    assert.ok(generated.length > 0, 'expected at least one generated alert');
    for (const a of generated) {
      assert.ok('impact' in a, `generated alert ${a.id} missing impact`);
      assert.ok('action' in a, `generated alert ${a.id} missing action`);
    }
  });

  it('no duplicate alert IDs', () => {
    const { allAlerts } = freshModule();
    const ids = allAlerts(NOW).map((a) => a.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, 'duplicate IDs found in allAlerts');
  });

  it('with NOW=May21 and empty stubs, exactly 3 generated filing alerts appear', () => {
    const { allAlerts } = freshModule();
    const filingAlerts = allAlerts(NOW).filter((a) => a.type === 'filing_overdue');
    assert.equal(filingAlerts.length, 3,
      `expected 3 overdue filing alerts with NOW=2026-05-21, got ${filingAlerts.length}`);
    for (const a of filingAlerts) {
      assert.ok(a.id.startsWith('gen-filing-'),
        `expected gen-filing- id prefix, got: ${a.id}`);
    }
  });
});

// ── allAlerts — filing alert content ─────────────────────────────

describe('alertSynth — filing alerts', () => {
  it('overdue filing alerts have severity = CRITICAL', () => {
    const { allAlerts } = freshModule();
    const filingAlerts = allAlerts(NOW).filter((a) => a.type === 'filing_overdue');
    assert.ok(filingAlerts.length > 0, 'expected filing alerts');
    for (const a of filingAlerts) {
      assert.equal(a.severity, 'CRITICAL',
        `${a.id}: expected CRITICAL severity for overdue filing`);
    }
  });

  it('generated filing alerts have status = NEEDS_ACTION', () => {
    const { allAlerts } = freshModule();
    const filingAlerts = allAlerts(NOW).filter((a) => a.type === 'filing_overdue');
    for (const a of filingAlerts) {
      assert.equal(a.status, 'NEEDS_ACTION');
    }
  });

  it('when all filings overridden as FILED, no filing alerts are generated', () => {
    const { allAlerts } = freshModule({
      // getState returns a FILED override for every filing
      filingState: { getState: () => ({ status: 'FILED', submitted_at: '2026-05-01T00:00:00Z' }) },
    });
    const alerts = allAlerts(NOW).filter((a) => a.type === 'filing_overdue');
    assert.equal(alerts.length, 0, 'FILED override should suppress all filing alerts');
  });

  it('filing due in 1 day has severity = WARNING', () => {
    // now = 2026-07-30 → flg-dvla-ann due 2026-07-31 → days = 1 → WARNING
    const futureNow = new Date('2026-07-30T00:00:00Z').getTime();
    const { generated } = freshModule({
      // Keep other 3 non-filed filings filed so only ann generates
      filingState: { getState: (id) =>
        id !== 'flg-dvla-ann' ? { status: 'FILED', submitted_at: '2026-05-01T00:00:00Z' } : null
      },
    });
    const alerts = generated(futureNow).filter((a) => a.id === 'gen-filing-flg-dvla-ann');
    assert.equal(alerts.length, 1, 'expected filing alert for flg-dvla-ann at day -1 of window');
    assert.equal(alerts[0].severity, 'WARNING', 'due-in-1-day filing should be WARNING');
  });
});

// ── generated — all alerts flagged ───────────────────────────────

describe('alertSynth — generated flags', () => {
  it('all results from generated() have generated=true', () => {
    const { generated } = freshModule();
    const alerts = generated(NOW);
    for (const a of alerts) {
      assert.equal(a.generated, true, `${a.id}: expected generated=true`);
    }
  });

  it('generated() with all filing stubs filed and empty stubs returns []', () => {
    const { generated } = freshModule({
      filingState: { getState: () => ({ status: 'FILED', submitted_at: '2026-05-01T00:00:00Z' }) },
    });
    assert.equal(generated(NOW).length, 0, 'all generators should be silent with these stubs');
  });
});

// ── integration-failure alert ─────────────────────────────────────

describe('alertSynth — integration failure alerts', () => {
  it('integration alert emitted when credentials exist and last probe failed', () => {
    const { allAlerts } = freshModule({
      filingState: { getState: () => ({ status: 'FILED', submitted_at: '2026-01-01T00:00:00Z' }) },
      integrationStore: {
        summary: () => ({
          has_credentials: true,
          live: false,
          last_probe: { probed_at: '2026-05-21T00:00:00Z', adapter: 'fms' },
        }),
        list: () => [],
      },
    });
    const intAlerts = allAlerts(NOW).filter((a) => a.type === 'integration_failure');
    assert.ok(intAlerts.length > 0, 'expected at least one integration_failure alert');
    assert.equal(intAlerts[0].severity, 'WARNING');
  });
});

// ── whyCleared — status shortcuts ────────────────────────────────

describe('alertSynth — whyCleared status shortcuts', () => {
  it('RESOLVED alert returns null (skip all checks)', () => {
    const { whyCleared } = freshModule();
    const alert = { id: 'a1', type: 'axle_load_breach', hauler_id: 'haul-01', status: 'RESOLVED', asset_ref: null };
    assert.equal(whyCleared(alert, NOW), null);
  });

  it('MONITORING alert returns null (skip all checks)', () => {
    const { whyCleared } = freshModule();
    const alert = { id: 'a2', type: 'axle_load_breach', hauler_id: 'haul-01', status: 'MONITORING', asset_ref: null };
    assert.equal(whyCleared(alert, NOW), null);
  });
});

// ── whyCleared — axle_load_breach + coaching ─────────────────────

describe('alertSynth — whyCleared axle_load_breach', () => {
  const ALERT_AXLE = {
    id: 'axle-001', type: 'axle_load_breach',
    hauler_id: 'haul-01', status: 'NEEDS_ACTION', asset_ref: null,
  };

  it('no recent coaching → returns null', () => {
    const { whyCleared } = freshModule({ coachingState: { recentForHauler: () => null } });
    assert.equal(whyCleared(ALERT_AXLE, NOW), null);
  });

  it('recent coaching → returns { kind: "coaching_logged" }', () => {
    const session = { topic: 'pre-departure axle check', created_by_display: 'Alice', held_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z' };
    const { whyCleared } = freshModule({ coachingState: { recentForHauler: () => session } });
    const result = whyCleared(ALERT_AXLE, NOW);
    assert.ok(result !== null, 'expected non-null result with recent coaching');
    assert.equal(result.kind, 'coaching_logged');
  });

  it('coaching_logged result has reason, actor, when, link fields', () => {
    const session = { topic: 'axle verification', created_by_display: 'Alice', held_at: '2026-05-18T00:00:00Z', created_at: '2026-05-18T00:00:00Z' };
    const { whyCleared } = freshModule({ coachingState: { recentForHauler: () => session } });
    const result = whyCleared(ALERT_AXLE, NOW);
    for (const k of ['reason', 'actor', 'when', 'link']) {
      assert.ok(k in result, `coaching_logged result missing field: ${k}`);
    }
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
    assert.equal(result.actor, 'Alice');
  });
});

// ── whyCleared — hse_event + incident ────────────────────────────

describe('alertSynth — whyCleared hse_event', () => {
  const ALERT_HSE = {
    id: 'hse-001', type: 'hse_event',
    hauler_id: 'haul-01', status: 'NEEDS_ACTION', asset_ref: null,
  };

  it('no closed incidents → returns null', () => {
    const { whyCleared } = freshModule({ incidentState: { since: () => [] } });
    assert.equal(whyCleared(ALERT_HSE, NOW), null);
  });

  it('open incident for same hauler → still null (must be CLOSED)', () => {
    const { whyCleared } = freshModule({
      incidentState: { since: () => [{ hauler_id: 'haul-01', status: 'OPEN', closed_at: null, closed_by_display: null, corrective_action: null }] },
    });
    assert.equal(whyCleared(ALERT_HSE, NOW), null);
  });

  it('closed incident for same hauler → returns { kind: "hse_closed" }', () => {
    const incident = { hauler_id: 'haul-01', status: 'CLOSED', closed_at: '2026-05-10T00:00:00Z', closed_by_display: 'Bob', corrective_action: 'Driver retrained' };
    const { whyCleared } = freshModule({ incidentState: { since: () => [incident] } });
    const result = whyCleared(ALERT_HSE, NOW);
    assert.ok(result !== null);
    assert.equal(result.kind, 'hse_closed');
  });

  it('hse_closed result has reason, actor, when, link fields', () => {
    const incident = { hauler_id: 'haul-01', status: 'CLOSED', closed_at: '2026-05-10T00:00:00Z', closed_by_display: 'Bob', corrective_action: 'Retrained' };
    const { whyCleared } = freshModule({ incidentState: { since: () => [incident] } });
    const result = whyCleared(ALERT_HSE, NOW);
    for (const k of ['reason', 'actor', 'when', 'link']) {
      assert.ok(k in result, `hse_closed result missing field: ${k}`);
    }
    assert.equal(result.actor, 'Bob');
    assert.equal(result.when, '2026-05-10T00:00:00Z');
  });

  it('closed incident for different hauler → returns null', () => {
    const incident = { hauler_id: 'haul-99', status: 'CLOSED', closed_at: '2026-05-10T00:00:00Z', closed_by_display: 'Bob', corrective_action: 'Done' };
    const { whyCleared } = freshModule({ incidentState: { since: () => [incident] } });
    assert.equal(whyCleared(ALERT_HSE, NOW), null);
  });
});

// ── whyCleared — licence_expiry ───────────────────────────────────

describe('alertSynth — whyCleared licence_expiry', () => {
  // LICENCE_EXPIRY from disk contains driver 'Driver 01-034' → id 'lic-1022'
  const ALERT_LIC_KNOWN   = { id: 'lic-alert-01', type: 'licence_expiry', status: 'NEEDS_ACTION', hauler_id: 'haul-01', asset_ref: 'Driver 01-034' };
  const ALERT_LIC_UNKNOWN = { id: 'lic-alert-02', type: 'licence_expiry', status: 'NEEDS_ACTION', hauler_id: null, asset_ref: 'NOT_A_DRIVER_IN_MOCK' };

  it('asset_ref not in LICENCE_EXPIRY → returns null', () => {
    const { whyCleared } = freshModule({ licenceState: { getState: () => null } });
    assert.equal(whyCleared(ALERT_LIC_UNKNOWN, NOW), null);
  });

  it('known driver + no overlay (licenceState returns null) → returns null', () => {
    const { whyCleared } = freshModule({ licenceState: { getState: () => null } });
    assert.equal(whyCleared(ALERT_LIC_KNOWN, NOW), null);
  });

  it('known driver + overlay exists → returns { kind: "licence_renewed" }', () => {
    const overlay = { expiry_iso: '2027-05-01T00:00:00Z', renewed_by: 'Carol', renewed_at: '2026-05-15T00:00:00Z' };
    const { whyCleared } = freshModule({ licenceState: { getState: () => overlay } });
    const result = whyCleared(ALERT_LIC_KNOWN, NOW);
    assert.ok(result !== null);
    assert.equal(result.kind, 'licence_renewed');
  });

  it('licence_renewed result has reason, actor, when, link fields', () => {
    const overlay = { expiry_iso: '2027-05-01T00:00:00Z', renewed_by: 'Carol', renewed_at: '2026-05-15T00:00:00Z' };
    const { whyCleared } = freshModule({ licenceState: { getState: () => overlay } });
    const result = whyCleared(ALERT_LIC_KNOWN, NOW);
    for (const k of ['reason', 'actor', 'when', 'link']) {
      assert.ok(k in result, `licence_renewed result missing field: ${k}`);
    }
    assert.ok(result.reason.includes('renewed'), 'reason should mention renewal');
  });
});

// ── whyCleared — unrelated type ───────────────────────────────────

describe('alertSynth — whyCleared unrelated type', () => {
  it('type with no suppression rule → returns null', () => {
    const { whyCleared } = freshModule();
    const alert = { id: 'misc-001', type: 'maintenance_cluster', hauler_id: 'haul-01', status: 'NEEDS_ACTION', asset_ref: null };
    assert.equal(whyCleared(alert, NOW), null);
  });
});

// ── autoClearedAlerts ─────────────────────────────────────────────

describe('alertSynth — autoClearedAlerts', () => {
  it('returns an array', () => {
    const { autoClearedAlerts } = freshModule();
    assert.ok(Array.isArray(autoClearedAlerts(NOW)));
  });

  it('returns [] when no static alert is suppressed (default stubs return no lifecycle hits)', () => {
    // No coaching / licence / hse overrides → none of the static alerts are cleared
    const { autoClearedAlerts } = freshModule();
    assert.deepEqual(autoClearedAlerts(NOW), [],
      'no static alerts should be auto-cleared when lifecycle stubs return null/empty');
  });
});
