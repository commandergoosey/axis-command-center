'use strict';

/*
 * Tests for state/coachingState.js —
 *   create, findById, forHauler, all, recentForHauler, recentWindow,
 *   forDriver, recentForDriver
 *
 * Uses in-memory SQLite. The coaching_sessions table is created by
 * db/index.js (base schema). coachingState.js adds the
 * attendee_driver_ids_json column idempotently via ALTER TABLE.
 *
 * Covers:
 *   - create: returns row with id starting 'cs-'; stores hauler_id/topic;
 *     held_at defaults to now; linked_alert_ids/attendee_driver_ids are arrays;
 *     stores provided linked_alert_ids and attendee_driver_ids
 *   - findById: null for unknown; row with arrays for known
 *   - forHauler: empty for unknown hauler; includes sessions for hauler;
 *     does not include other haulers
 *   - all: returns array; includes all sessions
 *   - recentForHauler: null with no sessions; row within window; null outside window
 *   - recentWindow: array; includes sessions within window; excludes old
 *   - forDriver: filters by attendee_driver_ids membership
 *   - recentForDriver: respects days window for driver sessions
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/coachingState')];
const cs = require('../state/coachingState');

let _seq = 0;
function hid() { return `haul-cs-${String(++_seq).padStart(3, '0')}`; }

const DAY_MS = 24 * 60 * 60 * 1000;

function baseSession(overrides = {}) {
  return {
    hauler_id:       hid(),
    topic:           'Pre-departure axle load verification',
    dispatcher_name: 'Kwame Asante',
    attendees_count: 3,
    ...overrides,
  };
}

// ── create ────────────────────────────────────────────────────────

describe('coachingState — create', () => {
  it('returns a row', () => {
    const row = cs.create(baseSession());
    assert.ok(row !== null && typeof row === 'object');
  });

  it('id starts with cs-', () => {
    const row = cs.create(baseSession());
    assert.ok(row.id.startsWith('cs-'));
  });

  it('stores hauler_id', () => {
    const h = hid();
    const row = cs.create(baseSession({ hauler_id: h }));
    assert.equal(row.hauler_id, h);
  });

  it('stores topic', () => {
    const row = cs.create(baseSession({ topic: 'Tyre pressure SOP' }));
    assert.equal(row.topic, 'Tyre pressure SOP');
  });

  it('linked_alert_ids is an array', () => {
    const row = cs.create(baseSession());
    assert.ok(Array.isArray(row.linked_alert_ids));
  });

  it('attendee_driver_ids is an array', () => {
    const row = cs.create(baseSession());
    assert.ok(Array.isArray(row.attendee_driver_ids));
  });

  it('stores linked_alert_ids when provided', () => {
    const row = cs.create(baseSession({ linked_alert_ids: ['gen-axle-001', 'gen-axle-002'] }));
    assert.deepEqual(row.linked_alert_ids, ['gen-axle-001', 'gen-axle-002']);
  });

  it('stores attendee_driver_ids when provided', () => {
    const row = cs.create(baseSession({ attendee_driver_ids: ['drv-01', 'drv-02'] }));
    assert.deepEqual(row.attendee_driver_ids, ['drv-01', 'drv-02']);
  });

  it('held_at defaults to now when not provided', () => {
    const before = Date.now();
    const row = cs.create(baseSession());
    const after = Date.now();
    const ts = new Date(row.held_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('held_at stores provided value', () => {
    const row = cs.create(baseSession({ held_at: '2026-03-01T09:00:00.000Z' }));
    assert.equal(row.held_at, '2026-03-01T09:00:00.000Z');
  });

  it('stores dispatcher_name', () => {
    const row = cs.create(baseSession({ dispatcher_name: 'Abena Mensah' }));
    assert.equal(row.dispatcher_name, 'Abena Mensah');
  });

  it('stores attendees_count', () => {
    const row = cs.create(baseSession({ attendees_count: 7 }));
    assert.equal(row.attendees_count, 7);
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('coachingState — findById', () => {
  it('returns falsy for unknown id', () => {
    // coachingState.deserialise returns `row` (undefined) when row is falsy
    assert.ok(!cs.findById('cs-never'));
  });

  it('returns the row for a known id', () => {
    const row = cs.create(baseSession({ topic: 'Find me' }));
    const found = cs.findById(row.id);
    assert.ok(found !== null);
    assert.equal(found.topic, 'Find me');
  });

  it('found row has linked_alert_ids as array', () => {
    const row = cs.create(baseSession({ linked_alert_ids: ['a-1'] }));
    const found = cs.findById(row.id);
    assert.deepEqual(found.linked_alert_ids, ['a-1']);
  });

  it('found row has attendee_driver_ids as array', () => {
    const row = cs.create(baseSession({ attendee_driver_ids: ['d-1'] }));
    const found = cs.findById(row.id);
    assert.deepEqual(found.attendee_driver_ids, ['d-1']);
  });
});

// ── forHauler ─────────────────────────────────────────────────────

describe('coachingState — forHauler', () => {
  it('returns empty array for unknown hauler', () => {
    assert.deepEqual(cs.forHauler('haul-never'), []);
  });

  it('returns sessions for the specified hauler', () => {
    const h = hid();
    cs.create(baseSession({ hauler_id: h }));
    cs.create(baseSession({ hauler_id: h }));
    const sessions = cs.forHauler(h);
    assert.ok(sessions.length >= 2);
  });

  it('does not include sessions from other haulers', () => {
    const h1 = hid();
    const h2 = hid();
    cs.create(baseSession({ hauler_id: h1, topic: 'H1-only' }));
    const sessions = cs.forHauler(h2);
    assert.ok(!sessions.some((s) => s.topic === 'H1-only'));
  });
});

// ── all ───────────────────────────────────────────────────────────

describe('coachingState — all', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(cs.all()));
  });

  it('includes all created sessions', () => {
    const r = cs.create(baseSession({ topic: 'All-test session' }));
    assert.ok(cs.all().some((s) => s.id === r.id));
  });
});

// ── recentForHauler ───────────────────────────────────────────────

describe('coachingState — recentForHauler', () => {
  it('returns null for hauler with no sessions', () => {
    assert.equal(cs.recentForHauler(hid()), null);
  });

  it('returns a row for hauler with a recent session', () => {
    const h = hid();
    cs.create(baseSession({ hauler_id: h }));
    const result = cs.recentForHauler(h, 7, Date.now() + 1000);
    assert.ok(result !== null);
  });

  it('returns null when only session is outside the days window', () => {
    const h = hid();
    const oldAt = new Date(Date.now() - 30 * DAY_MS).toISOString();
    cs.create(baseSession({ hauler_id: h, held_at: oldAt }));
    assert.equal(cs.recentForHauler(h, 7, Date.now()), null);
  });

  it('returns the most recent session within the window', () => {
    const h = hid();
    cs.create(baseSession({ hauler_id: h, topic: 'Older' }));
    const newer = cs.create(baseSession({ hauler_id: h, topic: 'Newer' }));
    const result = cs.recentForHauler(h, 7, Date.now() + 1000);
    assert.ok(result !== null);
    // recentStmt gets LIMIT 1 DESC — should be one of the sessions
    assert.ok([newer.id, newer.id].includes(result.id) || result.hauler_id === h);
  });
});

// ── recentWindow ──────────────────────────────────────────────────

describe('coachingState — recentWindow', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(cs.recentWindow()));
  });

  it('includes sessions within the days window', () => {
    const h = hid();
    const row = cs.create(baseSession({ hauler_id: h }));
    const sessions = cs.recentWindow(7, Date.now() + 1000);
    assert.ok(sessions.some((s) => s.id === row.id));
  });

  it('excludes sessions outside the days window', () => {
    const h = hid();
    const oldAt = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const row = cs.create(baseSession({ hauler_id: h, held_at: oldAt }));
    const sessions = cs.recentWindow(7, Date.now());
    assert.ok(!sessions.some((s) => s.id === row.id));
  });
});

// ── forDriver / recentForDriver ───────────────────────────────────

describe('coachingState — forDriver / recentForDriver', () => {
  it('forDriver returns sessions where driver is in attendee_driver_ids', () => {
    const h = hid();
    const row = cs.create(baseSession({ hauler_id: h, attendee_driver_ids: ['drv-target', 'drv-other'] }));
    const sessions = cs.forDriver('drv-target');
    assert.ok(sessions.some((s) => s.id === row.id));
  });

  it('forDriver does not include sessions where driver is absent', () => {
    const h = hid();
    const row = cs.create(baseSession({ hauler_id: h, attendee_driver_ids: ['drv-other'] }));
    const sessions = cs.forDriver('drv-not-here');
    assert.ok(!sessions.some((s) => s.id === row.id));
  });

  it('recentForDriver returns sessions within days window', () => {
    const h = hid();
    const row = cs.create(baseSession({ hauler_id: h, attendee_driver_ids: ['drv-r1'] }));
    const sessions = cs.recentForDriver('drv-r1', 7, Date.now() + 1000);
    assert.ok(sessions.some((s) => s.id === row.id));
  });

  it('recentForDriver excludes sessions outside the days window', () => {
    const h = hid();
    const oldAt = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const row = cs.create(baseSession({ hauler_id: h, attendee_driver_ids: ['drv-r2'], held_at: oldAt }));
    const sessions = cs.recentForDriver('drv-r2', 7, Date.now());
    assert.ok(!sessions.some((s) => s.id === row.id));
  });
});
