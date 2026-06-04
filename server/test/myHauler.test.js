'use strict';

/*
 * Tests for services/myHauler.js — compose(haulerId, now)
 *
 * compose(haulerId, now) returns null when hauler not found, otherwise
 * composes a multi-section payload from:
 *   roster.find / roster.list  → stubbed
 *   haulerContacts.forHauler   → stubbed
 *   workorderState.allOpen     → stubbed
 *   licenceState.getState      → stubbed
 *   actionAssignments.all      → stubbed
 *   buildForecast(haulers, now)→ stubbed (via services/forecast cache)
 *   allAlerts()                → stubbed (via services/alertSynth)
 *   alertState.getState        → stubbed
 *   listAudit(...)             → stubbed
 *   FLEET, LICENCE_EXPIRY, DRIVERS → loaded from disk
 *
 * now is a Date object (not ms). Fixed = new Date('2026-05-21T00:00:00Z').
 *
 * Output sections:
 *   generated_at, corridor, mtd, performance, action_items,
 *   contacts, fleet_health, open_alerts, recent_audit
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

// Minimal hauler that satisfies aggregator + forecast input shapes
function makeHauler(id, overrides = {}) {
  return {
    id,
    display_name:   overrides.display_name ?? `Hauler ${id}`,
    status:         overrides.status       ?? 'active',
    onboarded_date: '2026-01-01',
    run_rate:       overrides.run_rate     ?? 1.0,
    fleet: {
      contracted_trucks: overrides.contracted_trucks ?? 10,
      active_trucks:     overrides.active_trucks     ?? 10,
    },
    performance: {
      on_time_pct:        overrides.on_time_pct        ?? 91,
      sla_attainment_pct: overrides.sla_attainment_pct ?? 92,
      safety_score:       overrides.safety_score       ?? 88,
    },
    integration: {
      type:            'api',
      error_count_24h: 0,
      last_sync:       null,
      adapter:         null,
    },
    contract_share: overrides.contract_share ?? 0.3,
    api_status:     'connected',
  };
}

const TEST_HAULER = makeHauler('haul-01');

function freshCompose(hauler = TEST_HAULER, overrides = {}) {
  const rosterHaulers = overrides.rosterList ?? (hauler ? [hauler] : []);
  stub('../state/roster', {
    find: (id) => (id === hauler?.id ? hauler : null),
    list: () => rosterHaulers,
  });
  stub('../state/haulerContacts',   { forHauler: () => overrides.contacts ?? [] });
  stub('../state/workorderState',   { allOpen: () => overrides.workorders ?? [] });
  stub('../state/licenceState',     { getState: () => null });
  stub('../state/actionAssignments',{ all: () => overrides.actionItems ?? [] });
  stub('../services/alertSynth',    { allAlerts: () => overrides.alerts ?? [] });
  stub('../state/alertState',       { getState: () => ({}) });
  stub('../db/audit',               { listAudit: () => ({ rows: overrides.auditRows ?? [], total: 0 }) });
  // Forecast: needs workorderState stub (already done above) but also its own cache clear
  stub('../state/workorderState',   { allOpen: () => overrides.workorders ?? [] });
  delete require.cache[require.resolve('../services/forecast')];
  delete require.cache[require.resolve('../services/myHauler')];
  return require('../services/myHauler').compose;
}

after(() => {
  for (const p of [
    '../services/myHauler',
    '../services/forecast',
    '../state/roster',
    '../state/haulerContacts',
    '../state/workorderState',
    '../state/licenceState',
    '../state/actionAssignments',
    '../services/alertSynth',
    '../state/alertState',
    '../db/audit',
  ]) delete require.cache[require.resolve(p)];
});

// ── Null return for unknown hauler ────────────────────────────────

describe('myHauler — null for unknown hauler', () => {
  it('returns null when hauler not found in roster', () => {
    const compose = freshCompose(null);
    assert.equal(compose('nonexistent', NOW), null);
  });

  it('returns non-null for known hauler', () => {
    const compose = freshCompose(TEST_HAULER);
    assert.notEqual(compose('haul-01', NOW), null);
  });
});

// ── Output shape ──────────────────────────────────────────────────

describe('myHauler — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose('haul-01', NOW);
    for (const k of ['generated_at', 'corridor', 'mtd', 'performance',
                      'action_items', 'contacts', 'fleet_health', 'open_alerts', 'recent_audit']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at equals now.toISOString()', () => {
    const compose = freshCompose();
    assert.equal(compose('haul-01', NOW).generated_at, NOW.toISOString());
  });
});

// ── Corridor block ────────────────────────────────────────────────

describe('myHauler — corridor block', () => {
  it('corridor has all required fields', () => {
    const compose = freshCompose();
    const { corridor } = compose('haul-01', NOW);
    for (const k of ['hauler_id', 'display_name', 'onboarded_date', 'contracted_trucks',
                      'active_trucks', 'idle_trucks', 'status', 'integration', 'take_or_pay_floor_pct']) {
      assert.ok(k in corridor, `corridor missing field: ${k}`);
    }
  });

  it('corridor.hauler_id matches requested haulerId', () => {
    const compose = freshCompose();
    assert.equal(compose('haul-01', NOW).corridor.hauler_id, 'haul-01');
  });

  it('corridor.display_name from roster', () => {
    const compose = freshCompose();
    assert.equal(compose('haul-01', NOW).corridor.display_name, 'Hauler haul-01');
  });

  it('corridor.idle_trucks = contracted - active (≥0)', () => {
    const h = makeHauler('haul-01', { contracted_trucks: 10, active_trucks: 8 });
    const compose = freshCompose(h);
    assert.equal(compose('haul-01', NOW).corridor.idle_trucks, 2);
  });

  it('corridor.idle_trucks is 0 when active ≥ contracted', () => {
    const h = makeHauler('haul-01', { contracted_trucks: 10, active_trucks: 12 });
    const compose = freshCompose(h);
    assert.equal(compose('haul-01', NOW).corridor.idle_trucks, 0);
  });
});

// ── MTD block ─────────────────────────────────────────────────────

describe('myHauler — mtd block', () => {
  it('mtd has all required fields', () => {
    const compose = freshCompose();
    const { mtd } = compose('haul-01', NOW);
    for (const k of ['delivered_mtd', 'contracted_mtd', 'attainment_pct',
                      'forecast_eom', 'forecast_verdict', 'pct_of_contracted']) {
      assert.ok(k in mtd, `mtd missing field: ${k}`);
    }
  });

  it('mtd.attainment_pct is a number ≥ 0', () => {
    const compose = freshCompose();
    const { mtd } = compose('haul-01', NOW);
    assert.ok(typeof mtd.attainment_pct === 'number' && mtd.attainment_pct >= 0);
  });
});

// ── Performance block ─────────────────────────────────────────────

describe('myHauler — performance block', () => {
  it('performance has on_time_pct, sla_attainment_pct, safety_score for active hauler', () => {
    const compose = freshCompose();
    const { performance } = compose('haul-01', NOW);
    assert.ok(performance != null);
    for (const k of ['on_time_pct', 'sla_attainment_pct', 'safety_score']) {
      assert.ok(k in performance, `performance missing field: ${k}`);
    }
  });

  it('performance is null for inactive hauler', () => {
    const h = makeHauler('haul-01', { status: 'inactive' });
    const compose = freshCompose(h);
    const { performance } = compose('haul-01', NOW);
    assert.equal(performance, null);
  });
});

// ── Action items ──────────────────────────────────────────────────

describe('myHauler — action_items', () => {
  it('action_items is an array', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose('haul-01', NOW).action_items));
  });

  it('action item with hauler_id in action_item_id blob appears', () => {
    const compose = freshCompose(TEST_HAULER, {
      actionItems: [
        { action_item_id: 'ai-haul-01-001', notes: '', snooze: null },
      ],
    });
    assert.equal(compose('haul-01', NOW).action_items.length, 1);
  });

  it('action item for different hauler does not appear', () => {
    const compose = freshCompose(TEST_HAULER, {
      actionItems: [
        { action_item_id: 'ai-haul-99-001', notes: '', snooze: null },
      ],
    });
    assert.equal(compose('haul-01', NOW).action_items.length, 0);
  });

  it('action_items capped at 8', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      action_item_id: `ai-haul-01-${String(i).padStart(3, '0')}`,
      notes: '',
      snooze: null,
    }));
    const compose = freshCompose(TEST_HAULER, { actionItems: items });
    assert.ok(compose('haul-01', NOW).action_items.length <= 8);
  });
});

// ── Fleet health ──────────────────────────────────────────────────

describe('myHauler — fleet_health', () => {
  it('fleet_health has all required fields', () => {
    const compose = freshCompose();
    const { fleet_health } = compose('haul-01', NOW);
    for (const k of ['open_workorder_count', 'open_workorders', 'licence_expiries_60d',
                      'at_risk_drivers', 'rigs_total', 'rigs_in_garage', 'rigs_with_critical']) {
      assert.ok(k in fleet_health, `fleet_health missing field: ${k}`);
    }
  });

  it('open_workorder_count = open_workorders.length when ≤ 5', () => {
    const compose = freshCompose(TEST_HAULER, {
      workorders: [
        { rig_id: 'H01-0001', status: 'open', id: 'wo-1' },
        { rig_id: 'H01-0002', status: 'open', id: 'wo-2' },
      ],
    });
    const { fleet_health } = compose('haul-01', NOW);
    assert.equal(fleet_health.open_workorder_count, fleet_health.open_workorders.length);
  });

  it('rigs_total > 0 (FLEET mock has haul-01 rigs)', () => {
    const compose = freshCompose();
    const { fleet_health } = compose('haul-01', NOW);
    assert.ok(fleet_health.rigs_total > 0, 'haul-01 should have rigs in the FLEET mock');
  });
});

// ── Contacts and audit ────────────────────────────────────────────

describe('myHauler — contacts and recent_audit', () => {
  it('contacts is an array', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose('haul-01', NOW).contacts));
  });

  it('recent_audit is an array', () => {
    const compose = freshCompose();
    assert.ok(Array.isArray(compose('haul-01', NOW).recent_audit));
  });

  it('audit row with entity_id = haulerId appears in recent_audit', () => {
    const compose = freshCompose(TEST_HAULER, {
      auditRows: [{ entity_id: 'haul-01', entity_type: 'hauler', action: 'view', summary: '', payload: null }],
    });
    const { recent_audit } = compose('haul-01', NOW);
    assert.equal(recent_audit.length, 1);
  });

  it('audit row for different hauler_id does not appear', () => {
    const compose = freshCompose(TEST_HAULER, {
      auditRows: [{ entity_id: 'haul-99', entity_type: 'hauler', action: 'view', summary: '', payload: null }],
    });
    const { recent_audit } = compose('haul-01', NOW);
    assert.equal(recent_audit.length, 0);
  });
});
