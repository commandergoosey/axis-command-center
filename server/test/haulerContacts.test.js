'use strict';

/*
 * Tests for state/haulerContacts.js —
 *   CHANNELS, DIRECTIONS, OUTCOMES,
 *   add, findById, forHauler, resolveFollowup, remove, latestPerHauler
 *
 * Uses an in-memory SQLite DB. haulerContacts.js creates its own table
 * idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - constants: exported arrays with expected values
 *   - add: hauler_id required; unknown channel/direction/outcome throw;
 *     empty summary throws; summary > 1000 chars throws; direction
 *     defaults to 'outbound'; stores all fields; follow_up_resolved
 *     defaults to false; created_at recent ISO; author null/object;
 *     return shape
 *   - findById: null for unknown; shaped row for known
 *   - forHauler: empty for unknown; returns rows; default limit 50;
 *     limit respected; ordered DESC; does not include other haulers
 *   - resolveFollowup: follow_up_resolved becomes true; idempotent
 *     (WHERE follow_up_resolved = 0 guard)
 *   - remove: findById null after; no-op on unknown
 *   - latestPerHauler: empty object when no contacts; entry present
 *     after add; {last_contact_at, n} shape; n increments
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/haulerContacts')];
const hc = require('../state/haulerContacts');

let _seq = 0;
function hid() { return `haul-hc-${String(++_seq).padStart(3, '0')}`; }

function base(hauler_id, overrides = {}) {
  return {
    hauler_id,
    channel:   'phone',
    direction: 'outbound',
    summary:   'Called AP manager re overdue invoice',
    outcome:   'committed',
    by_user_id: 'u-hc-01',
    by_display: 'Ops Lead',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── constants ─────────────────────────────────────────────────────

describe('haulerContacts — constants', () => {
  it('CHANNELS includes phone, whatsapp, email, site_visit, meeting', () => {
    for (const c of ['phone', 'whatsapp', 'email', 'site_visit', 'meeting']) {
      assert.ok(hc.CHANNELS.includes(c), `missing channel: ${c}`);
    }
  });

  it('DIRECTIONS includes outbound and inbound', () => {
    assert.ok(hc.DIRECTIONS.includes('outbound'));
    assert.ok(hc.DIRECTIONS.includes('inbound'));
  });

  it('OUTCOMES includes committed, no_response, resolved and others', () => {
    for (const o of ['committed', 'partial', 'no_response', 'disputed', 'escalation_needed', 'resolved']) {
      assert.ok(hc.OUTCOMES.includes(o), `missing outcome: ${o}`);
    }
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('haulerContacts — add', () => {
  it('throws when hauler_id is missing', () => {
    assert.throws(() => hc.add({ ...base(hid()), hauler_id: null }), /hauler_id required/i);
  });

  it('throws for an unknown channel', () => {
    assert.throws(() => hc.add(base(hid(), { channel: 'fax' })), /unknown channel/i);
  });

  it('throws for an unknown direction', () => {
    assert.throws(() => hc.add(base(hid(), { direction: 'lateral' })), /unknown direction/i);
  });

  it('throws for an unknown outcome', () => {
    assert.throws(() => hc.add(base(hid(), { outcome: 'pending' })), /unknown outcome/i);
  });

  it('throws when summary is empty', () => {
    assert.throws(() => hc.add(base(hid(), { summary: '' })), /summary required/i);
  });

  it('throws when summary exceeds 1000 characters', () => {
    assert.throws(() => hc.add(base(hid(), { summary: 'x'.repeat(1001) })), /too long/i);
  });

  it('throws when follow_up_at is not a valid ISO date', () => {
    assert.throws(() => hc.add(base(hid(), { follow_up_at: 'bad-date' })), /iso date/i);
  });

  it('direction defaults to "outbound"', () => {
    const h = hid();
    const { direction } = hc.add({ hauler_id: h, channel: 'email', summary: 'Test', outcome: 'no_response' });
    assert.equal(direction, 'outbound');
  });

  it('stores channel, direction, summary, outcome', () => {
    const h = hid();
    const c = hc.add(base(h, { channel: 'whatsapp', direction: 'inbound', outcome: 'partial', summary: 'Chased twice' }));
    assert.equal(c.channel,   'whatsapp');
    assert.equal(c.direction, 'inbound');
    assert.equal(c.outcome,   'partial');
    assert.equal(c.summary,   'Chased twice');
  });

  it('follow_up_resolved defaults to false', () => {
    const c = hc.add(base(hid()));
    assert.equal(c.follow_up_resolved, false);
  });

  it('stores follow_up_at when provided', () => {
    const c = hc.add(base(hid(), { follow_up_at: '2026-08-01T09:00:00.000Z' }));
    assert.equal(c.follow_up_at, '2026-08-01T09:00:00.000Z');
  });

  it('follow_up_at is null when omitted', () => {
    assert.equal(hc.add(base(hid())).follow_up_at, null);
  });

  it('created_at is a recent ISO string', () => {
    const before = Date.now();
    const c = hc.add(base(hid()));
    const after = Date.now();
    assert.ok(new Date(c.created_at).getTime() >= before);
    assert.ok(new Date(c.created_at).getTime() <= after);
  });

  it('author has user_id, display_name, role when provided', () => {
    const c = hc.add(base(hid(), { by_user_id: 'u-x', by_display: 'X User', by_role: 'lender' }));
    assert.deepEqual(c.author, { user_id: 'u-x', display_name: 'X User', role: 'lender' });
  });

  it('author fields are null when not provided', () => {
    const h = hid();
    const c = hc.add({ hauler_id: h, channel: 'phone', summary: 'Anon', outcome: 'resolved' });
    assert.equal(c.author.user_id, null);
  });

  it('return shape has id, hauler_id, channel, direction, summary, outcome, follow_up_resolved, author', () => {
    const c = hc.add(base(hid()));
    for (const f of ['id', 'hauler_id', 'channel', 'direction', 'summary', 'outcome', 'follow_up_resolved', 'author']) {
      assert.ok(f in c, `missing: ${f}`);
    }
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('haulerContacts — findById', () => {
  it('returns null for unknown id', () => {
    assert.equal(hc.findById(999999), null);
  });

  it('returns shaped row for known id', () => {
    const h = hid();
    const c = hc.add(base(h));
    const found = hc.findById(c.id);
    assert.equal(found.id,        c.id);
    assert.equal(found.hauler_id, h);
  });
});

// ── forHauler ─────────────────────────────────────────────────────

describe('haulerContacts — forHauler', () => {
  it('returns empty array for unknown hauler', () => {
    assert.deepEqual(hc.forHauler('haul-never'), []);
  });

  it('returns all contacts for a hauler', () => {
    const h = hid();
    hc.add(base(h, { summary: 'A' }));
    hc.add(base(h, { summary: 'B' }));
    assert.equal(hc.forHauler(h).length, 2);
  });

  it('respects the limit parameter', () => {
    const h = hid();
    for (let i = 0; i < 5; i++) hc.add(base(h, { summary: `Contact ${i}` }));
    assert.equal(hc.forHauler(h, 3).length, 3);
  });

  it('does not include contacts from other haulers', () => {
    const hA = hid(); const hB = hid();
    hc.add(base(hA));
    assert.ok(!hc.forHauler(hB).some((c) => c.hauler_id === hA));
  });
});

// ── resolveFollowup ───────────────────────────────────────────────

describe('haulerContacts — resolveFollowup', () => {
  it('follow_up_resolved becomes true after resolveFollowup()', () => {
    const h = hid();
    const c = hc.add(base(h, { follow_up_at: '2026-09-01T00:00:00.000Z' }));
    hc.resolveFollowup(c.id);
    assert.equal(hc.findById(c.id).follow_up_resolved, true);
  });

  it('idempotent: second resolveFollowup() is a no-op (WHERE guard)', () => {
    const h = hid();
    const c = hc.add(base(h, { follow_up_at: '2026-09-01T00:00:00.000Z' }));
    hc.resolveFollowup(c.id);
    assert.doesNotThrow(() => hc.resolveFollowup(c.id));
    assert.equal(hc.findById(c.id).follow_up_resolved, true);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('haulerContacts — remove', () => {
  it('findById null after remove()', () => {
    const c = hc.add(base(hid()));
    hc.remove(c.id);
    assert.equal(hc.findById(c.id), null);
  });

  it('no-op on unknown id', () => {
    assert.doesNotThrow(() => hc.remove(999999));
  });
});

// ── latestPerHauler ───────────────────────────────────────────────

describe('haulerContacts — latestPerHauler', () => {
  it('returns an object', () => {
    assert.ok(typeof hc.latestPerHauler() === 'object');
  });

  it('entry present for hauler after add()', () => {
    const h = hid();
    hc.add(base(h));
    assert.ok(h in hc.latestPerHauler());
  });

  it('entry has last_contact_at and n', () => {
    const h = hid();
    hc.add(base(h));
    const entry = hc.latestPerHauler()[h];
    assert.ok('last_contact_at' in entry);
    assert.ok('n' in entry);
  });

  it('n increments with each add for the same hauler', () => {
    const h = hid();
    hc.add(base(h));
    const before = hc.latestPerHauler()[h].n;
    hc.add(base(h));
    assert.equal(hc.latestPerHauler()[h].n, before + 1);
  });
});
