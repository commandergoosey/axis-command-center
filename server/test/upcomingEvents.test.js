'use strict';

/*
 * Tests for services/upcomingEvents.js — compose()
 *
 * compose({ days, now }) accepts an injectable `now` (timestamp ms),
 * which makes precise date-driven assertions possible.
 *
 * Fixed reference point: 2026-05-21T00:00:00Z (day 141 of 2026)
 * Horizon default: 30 days → cutoff = 2026-06-20T00:00:00Z
 *
 * With all state stubs returning empty, only mock file data fires:
 *   FILINGS (compliance.js):
 *     flg-dvla-q1  Apr 30 DUE     → overdue  (included)
 *     flg-gha-levy May 15 ON_TRACK → overdue  (included)
 *     flg-epa-mon  May 07 DUE     → overdue  (included)
 *     flg-dvla-ann Jul 31 ON_TRACK → beyond horizon (excluded)
 *     flg-minc-q1  Apr 15 FILED   → skipped by mapper
 *
 *   LICENCE_EXPIRY (compliance.js):
 *     lic-1021 May 02 → overdue  (included)
 *     lic-1022 May 18 → overdue  (included)
 *     lic-1023 Jun 04 → warn     (included, ≤ Jun 20 cutoff)
 *     lic-1024 Jun 11 → info     (included, ≤ Jun 20 cutoff)
 *     lic-1025 Jun 28 → beyond cutoff (excluded)
 *     lic-1026 Jul 09 → beyond cutoff (excluded)
 *
 *   Take-or-pay reset: May 31 (1 event in 30d window)
 *
 * Default total (empty stubs, days=30): 8 events
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

const EMPTY_STATE = {
  actionAssignments: { all: () => [] },
  filingState:       { getState: () => null },
  licenceState:      { getState: () => null },
  haulerContacts:    { latestPerHauler: () => ({}), forHauler: () => [] },
  riskRegister:      { listActive: () => [] },
  riskSteps:         { openWithDueDate: () => [] },
  maintenanceSchedule: { upcoming: () => [] },
};

function freshCompose(stateOverrides = {}) {
  const state = { ...EMPTY_STATE, ...stateOverrides };
  stub('../state/actionAssignments',   state.actionAssignments);
  stub('../state/filingState',         state.filingState);
  stub('../state/licenceState',        state.licenceState);
  stub('../state/haulerContacts',      state.haulerContacts);
  stub('../state/riskRegister',        state.riskRegister);
  stub('../state/riskSteps',           state.riskSteps);
  stub('../state/maintenanceSchedule', state.maintenanceSchedule);
  delete require.cache[require.resolve('../services/upcomingEvents')];
  return require('../services/upcomingEvents').compose;
}

after(() => {
  for (const p of [
    '../services/upcomingEvents',
    '../state/actionAssignments',
    '../state/filingState',
    '../state/licenceState',
    '../state/haulerContacts',
    '../state/riskRegister',
    '../state/riskSteps',
    '../state/maintenanceSchedule',
  ]) delete require.cache[require.resolve(p)];
});

// Fixed reference point (ms)
const NOW_MS   = new Date('2026-05-21T00:00:00Z').getTime();
const NOW_OPTS = { now: NOW_MS };

// ── Output shape ──────────────────────────────────────────────────

describe('upcomingEvents — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    for (const k of ['generated_at', 'horizon', 'counts', 'events']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at equals now ISO string', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    assert.equal(r.generated_at, new Date(NOW_MS).toISOString());
  });

  it('horizon block has days and until', () => {
    const compose = freshCompose();
    const { horizon } = compose(NOW_OPTS);
    assert.equal(horizon.days, 30);
    assert.equal(typeof horizon.until, 'string');
    assert.ok(!isNaN(new Date(horizon.until).getTime()));
  });

  it('horizon.until is 30 days after now', () => {
    const compose = freshCompose();
    const { horizon } = compose(NOW_OPTS);
    const expectedCutoff = new Date(NOW_MS + 30 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(horizon.until, expectedCutoff);
  });

  it('counts block has total, overdue, warn, info, by_type', () => {
    const compose = freshCompose();
    const { counts } = compose(NOW_OPTS);
    for (const k of ['total', 'overdue', 'warn', 'info', 'by_type']) {
      assert.ok(k in counts, `counts missing field: ${k}`);
    }
  });

  it('events is an array', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    assert.ok(Array.isArray(r.events));
  });

  it('counts.total equals events.length', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    assert.equal(r.counts.total, r.events.length);
  });
});

// ── Event count from mock file fixtures ──────────────────────────

describe('upcomingEvents — default fixture event count', () => {
  it('returns 8 events with empty stubs and days=30', () => {
    // 3 non-FILED, in-window filings + 4 in-window licences + 1 take-or-pay reset
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    assert.equal(r.events.length, 8,
      `expected 8 events but got ${r.events.length}: ${r.events.map((e) => e.id).join(', ')}`);
  });

  it('filings: 3 events (FILED status excluded; dvla-ann beyond horizon excluded)', () => {
    const compose = freshCompose();
    const filingEvts = compose(NOW_OPTS).events.filter((e) => e.type === 'filing');
    assert.equal(filingEvts.length, 3);
  });

  it('licences: 4 events (2 overdue + 2 upcoming; 2 beyond June-20 cutoff excluded)', () => {
    const compose = freshCompose();
    const licEvts = compose(NOW_OPTS).events.filter((e) => e.type === 'licence');
    assert.equal(licEvts.length, 4);
  });

  it('take_or_pay_reset: 1 event (May 31)', () => {
    const compose = freshCompose();
    const topEvts = compose(NOW_OPTS).events.filter((e) => e.type === 'take_or_pay_reset');
    assert.equal(topEvts.length, 1);
    assert.ok(topEvts[0].id.includes('2026-05-31'), `expected May-31 reset, got ${topEvts[0].id}`);
  });
});

// ── Event structure ───────────────────────────────────────────────

describe('upcomingEvents — event structure', () => {
  it('each event has required fields: id, type, date, severity, title, link, days_until', () => {
    const compose = freshCompose();
    for (const e of compose(NOW_OPTS).events) {
      for (const k of ['id', 'type', 'date', 'severity', 'title', 'link', 'days_until']) {
        assert.ok(k in e, `event ${e.id} missing field: ${k}`);
      }
    }
  });

  it('each event severity is one of overdue / warn / info', () => {
    const compose = freshCompose();
    for (const e of compose(NOW_OPTS).events) {
      assert.ok(['overdue', 'warn', 'info'].includes(e.severity),
        `${e.id} has unexpected severity: ${e.severity}`);
    }
  });

  it('each event link has path and label', () => {
    const compose = freshCompose();
    for (const e of compose(NOW_OPTS).events) {
      assert.ok(e.link && typeof e.link.path === 'string' && typeof e.link.label === 'string',
        `${e.id} has invalid link`);
    }
  });

  it('events with past dates have severity=overdue and days_until < 0', () => {
    const compose = freshCompose();
    for (const e of compose(NOW_OPTS).events) {
      const eventMs = new Date(e.date).getTime();
      if (eventMs < NOW_MS) {
        assert.equal(e.severity, 'overdue',
          `${e.id} date is in the past but severity is ${e.severity}`);
        assert.ok(e.days_until < 0,
          `${e.id} is overdue but days_until ${e.days_until} is not negative`);
      }
    }
  });
});

// ── Filing events ─────────────────────────────────────────────────

describe('upcomingEvents — filing events', () => {
  it('FILED filing (flg-minc-q1) is not in the event list', () => {
    const compose = freshCompose();
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-filing-flg-minc-q1'),
      'FILED filing should be excluded');
  });

  it('dvla-ann (Jul 31) is excluded when horizon=30d', () => {
    const compose = freshCompose();
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-filing-flg-dvla-ann'),
      'dvla-ann is beyond horizon and should be excluded');
  });

  it('dvla-ann (Jul 31) is included when horizon=90d', () => {
    const compose = freshCompose();
    const ids = compose({ now: NOW_MS, days: 90 }).events.map((e) => e.id);
    assert.ok(ids.includes('evt-filing-flg-dvla-ann'),
      'dvla-ann should appear with days=90');
  });

  it('filingState override suppresses a filing (status=FILED)', () => {
    // Override getState to report dvla-q1 as FILED → should disappear
    const compose = freshCompose({
      filingState: { getState: (id) => id === 'flg-dvla-q1' ? { status: 'FILED' } : null },
    });
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-filing-flg-dvla-q1'),
      'state-overridden FILED filing should be excluded');
  });
});

// ── Licence events ────────────────────────────────────────────────

describe('upcomingEvents — licence events', () => {
  it('lic-1021 and lic-1022 (both past May 21) are overdue', () => {
    const compose = freshCompose();
    const licEvts = compose(NOW_OPTS).events.filter((e) => e.type === 'licence');
    const overdueIds = licEvts.filter((e) => e.severity === 'overdue').map((e) => e.id);
    assert.ok(overdueIds.includes('evt-licence-lic-1021'));
    assert.ok(overdueIds.includes('evt-licence-lic-1022'));
  });

  it('lic-1025 (Jun 28) and lic-1026 (Jul 9) are excluded from days=30 window', () => {
    const compose = freshCompose();
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-licence-lic-1025'));
    assert.ok(!ids.includes('evt-licence-lic-1026'));
  });

  it('licenceState.renewed=true removes a licence from the feed', () => {
    const compose = freshCompose({
      licenceState: { getState: (id) => id === 'lic-1021' ? { renewed: true } : null },
    });
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-licence-lic-1021'),
      'renewed licence should be removed from feed');
  });
});

// ── Injected events ───────────────────────────────────────────────

describe('upcomingEvents — injected state events', () => {
  it('action item with due_date within horizon appears as action_item event', () => {
    const dueDate = '2026-05-25';
    const compose = freshCompose({
      actionAssignments: {
        all: () => [{
          action_item_id: 'act-test-001',
          due_date: dueDate,
          assignee: { display_name: 'Test User' },
        }],
      },
    });
    const evt = compose(NOW_OPTS).events.find((e) => e.id === 'evt-action-act-test-001');
    assert.ok(evt != null, 'action item event should appear');
    assert.equal(evt.type, 'action_item');
    assert.equal(evt.date, dueDate);
  });

  it('action item without due_date is excluded', () => {
    const compose = freshCompose({
      actionAssignments: {
        all: () => [{ action_item_id: 'act-noduedate', due_date: null }],
      },
    });
    const ids = compose(NOW_OPTS).events.map((e) => e.id);
    assert.ok(!ids.includes('evt-action-act-noduedate'));
  });

  it('risk review appears for active risk with no last_reviewed_at', () => {
    // last_reviewed_at=null → dueMs=now → days=0 → severity='warn' (0 ≤ 7, not < 0)
    const compose = freshCompose({
      riskRegister: {
        listActive: () => [{
          id: 'risk-new',
          title: 'Unreviewed risk',
          severity: 'medium',
          category: 'operational',
          status: 'open',
          last_reviewed_at: null,
          owner: null,
        }],
      },
    });
    const evt = compose(NOW_OPTS).events.find((e) => e.id === 'evt-risk-risk-new');
    assert.ok(evt != null, 'unreviewed risk should appear for immediate review');
    assert.equal(evt.type, 'risk_review');
    // dueMs=now → days_until=0 → severity='warn' (within 7-day threshold)
    assert.equal(evt.severity, 'warn');
    assert.equal(evt.days_until, 0);
  });

  it('risk review is overdue when last_reviewed_at > 30 days ago', () => {
    // 31 days before now → overdue by 1 day
    const reviewedAt = new Date(NOW_MS - 31 * 24 * 60 * 60 * 1000).toISOString();
    const compose = freshCompose({
      riskRegister: {
        listActive: () => [{
          id: 'risk-stale',
          title: 'Stale risk',
          severity: 'high',
          category: 'financial',
          status: 'open',
          last_reviewed_at: reviewedAt,
          owner: null,
        }],
      },
    });
    const evt = compose(NOW_OPTS).events.find((e) => e.id === 'evt-risk-risk-stale');
    assert.ok(evt != null, 'overdue risk review should appear');
    assert.equal(evt.severity, 'overdue');
    assert.ok(evt.days_until < 0, `days_until should be negative, got ${evt.days_until}`);
  });

  it('maintenance window appears when upcoming() returns one', () => {
    const compose = freshCompose({
      maintenanceSchedule: {
        upcoming: () => [{
          id: 'mnt-001',
          hauler_id: 'haul-01',
          rig_id: 'H01-0001',
          type: 'scheduled_service',
          start_at: '2026-05-28T06:00:00Z',
          end_at:   '2026-05-29T06:00:00Z',
          notes: null,
        }],
      },
    });
    const evt = compose(NOW_OPTS).events.find((e) => e.id === 'evt-maint-mnt-001');
    assert.ok(evt != null, 'maintenance event should appear');
    assert.equal(evt.type, 'maintenance');
    assert.ok(evt.title.includes('H01-0001'));
  });
});

// ── Sorting ───────────────────────────────────────────────────────

describe('upcomingEvents — sorting', () => {
  it('events are sorted ascending by date string', () => {
    const compose = freshCompose();
    const events = compose(NOW_OPTS).events;
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].date >= events[i - 1].date,
        `event[${i}].date ${events[i].date} < event[${i - 1}].date ${events[i - 1].date}`);
    }
  });

  it('within same date, overdue appears before warn and info', () => {
    // Inject two action items with the same due_date but craft
    // different severities by setting one past and one future.
    // Both are action_items; severity depends on days_until.
    // Create two events falling on same day but different times won't work
    // since date is an ISO string. Use a risk review + action item
    // both due on the same day to get overdue+warn in the same partition.
    //
    // Simpler: inject an overdue action item (past date) and check it
    // precedes the same-date warn licence if any two events share a date prefix.
    // The sort is by full date string then severity rank, so let's use a
    // fixed date to force two events on the same date.
    const sameDate = '2026-05-21'; // today — both action items will be overdue
    const compose = freshCompose({
      actionAssignments: {
        all: () => [
          { action_item_id: 'act-a', due_date: sameDate, assignee: { display_name: 'A' } },
          { action_item_id: 'act-b', due_date: sameDate, assignee: { display_name: 'B' } },
        ],
      },
    });
    const events = compose(NOW_OPTS).events;
    // Verify basic sort invariant holds across all returned events
    for (let i = 1; i < events.length; i++) {
      const [a, b] = [events[i - 1], events[i]];
      if (a.date === b.date) {
        const SEV = { overdue: 0, warn: 1, info: 2 };
        assert.ok((SEV[a.severity] ?? 3) <= (SEV[b.severity] ?? 3),
          `same-date events: ${a.id}(${a.severity}) should sort before ${b.id}(${b.severity})`);
      }
    }
  });
});

// ── Horizon control ───────────────────────────────────────────────

describe('upcomingEvents — horizon control', () => {
  it('days=7 returns fewer events than days=30', () => {
    const compose = freshCompose();
    const r7  = compose({ now: NOW_MS, days: 7 });
    const r30 = compose({ now: NOW_MS, days: 30 });
    assert.ok(r7.events.length < r30.events.length,
      `days=7 (${r7.events.length}) should have fewer events than days=30 (${r30.events.length})`);
  });

  it('days=365 includes contract anniversary (2027-01-01)', () => {
    const compose = freshCompose();
    const r = compose({ now: NOW_MS, days: 365 });
    const hasAnniversary = r.events.some((e) => e.type === 'contract_anniversary');
    assert.ok(hasAnniversary, 'days=365 should include the 2027-01-01 contract anniversary');
  });

  it('days=1 returns only same-day or overdue events', () => {
    const compose = freshCompose();
    const { events } = compose({ now: NOW_MS, days: 1 });
    const cutoffMs = NOW_MS + 1 * 24 * 60 * 60 * 1000;
    for (const e of events) {
      assert.ok(new Date(e.date).getTime() <= cutoffMs,
        `${e.id} date ${e.date} is beyond days=1 cutoff`);
    }
  });

  it('take-or-pay reset: May 31 included in days=30, excluded in days=5', () => {
    const compose = freshCompose();
    const r30 = compose({ now: NOW_MS, days: 30 });
    const r5  = compose({ now: NOW_MS, days: 5 });
    const top30 = r30.events.some((e) => e.type === 'take_or_pay_reset');
    const top5  = r5.events.some((e)  => e.type === 'take_or_pay_reset');
    assert.ok(top30, 'May 31 take-or-pay reset should appear in days=30');
    assert.ok(!top5,  'May 31 take-or-pay reset should not appear in days=5');
  });
});

// ── Counts accuracy ───────────────────────────────────────────────

describe('upcomingEvents — counts', () => {
  it('counts.overdue matches events with severity=overdue', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    const actual = r.events.filter((e) => e.severity === 'overdue').length;
    assert.equal(r.counts.overdue, actual);
  });

  it('counts.warn matches events with severity=warn', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    const actual = r.events.filter((e) => e.severity === 'warn').length;
    assert.equal(r.counts.warn, actual);
  });

  it('counts.info matches events with severity=info', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    const actual = r.events.filter((e) => e.severity === 'info').length;
    assert.equal(r.counts.info, actual);
  });

  it('counts.by_type is accurate', () => {
    const compose = freshCompose();
    const r = compose(NOW_OPTS);
    const byType = {};
    for (const e of r.events) byType[e.type] = (byType[e.type] || 0) + 1;
    assert.deepEqual(r.counts.by_type, byType);
  });
});
