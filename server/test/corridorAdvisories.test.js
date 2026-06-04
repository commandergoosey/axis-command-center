'use strict';

/*
 * Tests for state/corridorAdvisories.js —
 *   SEVERITIES, add, resolve, remove, listActive, listAll, findById
 *
 * Uses an in-memory SQLite DB. corridorAdvisories.js creates its own
 * corridor_advisories table idempotently — no stubs or migrations required.
 *
 * Key shape note: id in the returned shape is prefixed "live-{dbId}";
 * the raw integer is exposed as _db_id. resolve() and remove() take
 * the raw integer dbId (i.e. shape._db_id).
 *
 * Covers:
 *   - SEVERITIES: array with info/warn/critical
 *   - add: empty body throws; body > 500 chars throws; unknown severity
 *     throws; invalid expires_at throws; severity defaults to 'info';
 *     stores body/km_from/km_to; posted_at recent ISO; id prefixed
 *     'live-'; _db_id is numeric; is_live: true; posted_by_name stored;
 *     resolved_at null on fresh row
 *   - resolve: returns null for unknown dbId; resolved_at set; resolved_by_name
 *     stored; idempotent (WHERE resolved_at IS NULL)
 *   - remove: findById null after; no-op on unknown
 *   - listActive: returns array; excludes resolved; excludes expired
 *     (expires_at in the past); includes null/future expires_at;
 *     severity ordering (critical → warn → info)
 *   - listAll: returns all including resolved; at most 50
 *   - findById: null for unknown; shaped row for known
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/corridorAdvisories')];
const ca = require('../state/corridorAdvisories');

function base(overrides = {}) {
  return {
    severity: 'info',
    body:     'Weighbridge 3 lane closure — expect 20-min queues.',
    km_from:  45,
    km_to:    47,
    by_id:    'u-ca-01',
    by_name:  'Night Shift Op',
    ...overrides,
  };
}

// ── SEVERITIES ────────────────────────────────────────────────────

describe('corridorAdvisories — SEVERITIES', () => {
  it('is an array with info, warn, critical', () => {
    assert.ok(Array.isArray(ca.SEVERITIES));
    assert.ok(ca.SEVERITIES.includes('info'));
    assert.ok(ca.SEVERITIES.includes('warn'));
    assert.ok(ca.SEVERITIES.includes('critical'));
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('corridorAdvisories — add', () => {
  it('throws when body is empty', () => {
    assert.throws(() => ca.add(base({ body: '' })), /body.*required/i);
  });

  it('throws when body is only whitespace', () => {
    assert.throws(() => ca.add(base({ body: '   ' })), /body.*required/i);
  });

  it('throws when body exceeds 500 characters', () => {
    assert.throws(() => ca.add(base({ body: 'x'.repeat(501) })), /too long/i);
  });

  it('throws for an unknown severity', () => {
    assert.throws(() => ca.add(base({ severity: 'mega' })), /invalid severity/i);
  });

  it('throws when expires_at is not a valid ISO date', () => {
    assert.throws(() => ca.add(base({ expires_at: 'not-a-date' })), /iso date/i);
  });

  it('severity defaults to "info" when not provided', () => {
    const adv = ca.add({ body: 'Test advisory' });
    assert.equal(adv.severity, 'info');
  });

  it('stores body', () => {
    const adv = ca.add(base({ body: 'Specific advisory body' }));
    assert.equal(adv.body, 'Specific advisory body');
  });

  it('stores km_from and km_to when provided', () => {
    const adv = ca.add(base({ km_from: 100, km_to: 120 }));
    assert.equal(adv.km_from, 100);
    assert.equal(adv.km_to,   120);
  });

  it('posted_at is a recent ISO string', () => {
    const before = Date.now();
    const adv = ca.add(base());
    const after = Date.now();
    assert.ok(new Date(adv.posted_at).getTime() >= before);
    assert.ok(new Date(adv.posted_at).getTime() <= after);
  });

  it('id is prefixed with "live-"', () => {
    const adv = ca.add(base());
    assert.ok(adv.id.startsWith('live-'));
  });

  it('_db_id is a numeric integer', () => {
    const adv = ca.add(base());
    assert.ok(Number.isInteger(adv._db_id));
    assert.ok(adv._db_id > 0);
  });

  it('is_live is true', () => {
    assert.equal(ca.add(base()).is_live, true);
  });

  it('posted_by_name is stored', () => {
    const adv = ca.add(base({ by_name: 'Corridor Lead' }));
    assert.equal(adv.posted_by_name, 'Corridor Lead');
  });

  it('resolved_at is null on a fresh advisory', () => {
    assert.equal(ca.add(base()).resolved_at, null);
  });
});

// ── resolve ───────────────────────────────────────────────────────

describe('corridorAdvisories — resolve', () => {
  it('returns null for an unknown dbId', () => {
    assert.equal(ca.resolve(999999, { by_name: 'Ops' }), null);
  });

  it('resolved_at is set after resolve()', () => {
    const adv = ca.add(base());
    const before = Date.now();
    ca.resolve(adv._db_id, { by_name: 'Resolver' });
    const after = Date.now();
    const row = ca.findById(adv._db_id);
    const ts = new Date(row.resolved_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('resolved_by_name is stored', () => {
    const adv = ca.add(base());
    ca.resolve(adv._db_id, { by_name: 'Night Op' });
    assert.equal(ca.findById(adv._db_id).resolved_by_name, 'Night Op');
  });

  it('idempotent: second resolve() does not change resolved_at', () => {
    const adv = ca.add(base());
    ca.resolve(adv._db_id, { by_name: 'First' });
    const firstTs = ca.findById(adv._db_id).resolved_at;
    ca.resolve(adv._db_id, { by_name: 'Second' });
    assert.equal(ca.findById(adv._db_id).resolved_at, firstTs);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('corridorAdvisories — remove', () => {
  it('findById returns null after remove()', () => {
    const adv = ca.add(base());
    ca.remove(adv._db_id);
    assert.equal(ca.findById(adv._db_id), null);
  });

  it('no-op on unknown id', () => {
    assert.doesNotThrow(() => ca.remove(999999));
  });
});

// ── listActive ────────────────────────────────────────────────────

describe('corridorAdvisories — listActive', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ca.listActive()));
  });

  it('includes a fresh advisory (no expires_at)', () => {
    const adv = ca.add(base({ body: 'Active no expiry' }));
    assert.ok(ca.listActive().some((x) => x._db_id === adv._db_id));
  });

  it('excludes resolved advisories', () => {
    const adv = ca.add(base({ body: 'To be resolved' }));
    ca.resolve(adv._db_id, { by_name: 'Op' });
    assert.ok(!ca.listActive().some((x) => x._db_id === adv._db_id));
  });

  it('excludes advisories whose expires_at is in the past', () => {
    const adv = ca.add(base({ body: 'Expired adv', expires_at: '2020-01-01T00:00:00.000Z' }));
    assert.ok(!ca.listActive().some((x) => x._db_id === adv._db_id));
  });

  it('includes advisories with a future expires_at', () => {
    const adv = ca.add(base({ body: 'Future expiry', expires_at: '2099-01-01T00:00:00.000Z' }));
    assert.ok(ca.listActive().some((x) => x._db_id === adv._db_id));
  });

  it('critical sorts before warn, warn before info', () => {
    const info     = ca.add(base({ body: 'Info adv',     severity: 'info' }));
    const warn     = ca.add(base({ body: 'Warn adv',     severity: 'warn' }));
    const critical = ca.add(base({ body: 'Critical adv', severity: 'critical' }));
    const active   = ca.listActive().filter((x) => [info._db_id, warn._db_id, critical._db_id].includes(x._db_id));
    assert.equal(active[0]._db_id, critical._db_id, 'critical first');
    assert.equal(active[1]._db_id, warn._db_id,     'warn second');
    assert.equal(active[2]._db_id, info._db_id,     'info last');
  });
});

// ── listAll ───────────────────────────────────────────────────────

describe('corridorAdvisories — listAll', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(ca.listAll()));
  });

  it('includes resolved advisories', () => {
    const adv = ca.add(base({ body: 'Resolved but listed' }));
    ca.resolve(adv._db_id, { by_name: 'Op' });
    assert.ok(ca.listAll().some((x) => x._db_id === adv._db_id));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('corridorAdvisories — findById', () => {
  it('returns null for an unknown dbId', () => {
    assert.equal(ca.findById(999999), null);
  });

  it('returns shaped row for a known dbId', () => {
    const adv = ca.add(base({ body: 'Find me' }));
    const found = ca.findById(adv._db_id);
    assert.ok(found !== null);
    assert.equal(found._db_id, adv._db_id);
    assert.equal(found.body,   'Find me');
  });
});
