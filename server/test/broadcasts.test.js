'use strict';

/*
 * Tests for state/broadcasts.js —
 *   SEVERITIES, AUDIENCES,
 *   add, update, archive, unarchive, remove,
 *   findById, listAll, activeForRole
 *
 * Uses an in-memory SQLite DB. broadcasts.js creates its own
 * broadcasts table idempotently — no stubs or migrations required.
 *
 * Covers:
 *   - SEVERITIES / AUDIENCES: exported arrays with expected values
 *   - add: empty/missing title throws; empty/missing body throws;
 *     title > 120 chars throws; body > 2000 chars throws; unknown
 *     severity throws; unknown audience throws; invalid expires_at
 *     throws; title/body trimmed; severity defaults to 'info';
 *     audience defaults to 'all'; posted_at recent ISO; expires_at
 *     stored or null; posted_by null when omitted / nested when
 *     provided; full return shape
 *   - update: null for unknown id; unknown severity throws; unknown
 *     audience throws; invalid expires_at throws; patches each field;
 *     clear_expiry (expires_at: null explicitly clears);
 *     unpatched fields preserved (COALESCE)
 *   - archive: archived_at set; findById still returns the row
 *   - unarchive: archived_at null after unarchive
 *   - remove: findById null after; no-op on unknown id
 *   - findById: null for unknown; shaped row for known
 *   - listAll: returns array; includes archived; count increments
 *   - activeForRole: excludes archived; excludes expired
 *     (expires_at < now); includes non-expired; severity ordering
 *     (urgent → warn → info); audience filtering — 'all' visible
 *     to all; 'operators' visible to axis_admin/axis_ops only;
 *     'haulers' visible to hauler_admin only
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

delete require.cache[require.resolve('../state/broadcasts')];
const bc = require('../state/broadcasts');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;
function uid() { return `u-bc-${++_seq}`; }

function baseAdd(overrides = {}) {
  return {
    title:      'Corridor tariff change',
    body:       'New toll rates take effect 1 July 2026.',
    severity:   'info',
    audience:   'all',
    by_user_id: 'u-bc-00',
    by_display: 'Broadcast Author',
    by_role:    'axis_ops',
    ...overrides,
  };
}

// ── SEVERITIES / AUDIENCES ────────────────────────────────────────

describe('broadcasts — constants', () => {
  it('SEVERITIES is an array', () => {
    assert.ok(Array.isArray(bc.SEVERITIES));
  });

  it('SEVERITIES contains info, warn, urgent', () => {
    assert.ok(bc.SEVERITIES.includes('info'));
    assert.ok(bc.SEVERITIES.includes('warn'));
    assert.ok(bc.SEVERITIES.includes('urgent'));
  });

  it('AUDIENCES is an array', () => {
    assert.ok(Array.isArray(bc.AUDIENCES));
  });

  it('AUDIENCES contains all, operators, haulers', () => {
    assert.ok(bc.AUDIENCES.includes('all'));
    assert.ok(bc.AUDIENCES.includes('operators'));
    assert.ok(bc.AUDIENCES.includes('haulers'));
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('broadcasts — add', () => {
  it('throws when title is empty', () => {
    assert.throws(() => bc.add(baseAdd({ title: '' })), /title required/i);
  });

  it('throws when title is only whitespace', () => {
    assert.throws(() => bc.add(baseAdd({ title: '   ' })), /title required/i);
  });

  it('throws when body is empty', () => {
    assert.throws(() => bc.add(baseAdd({ body: '' })), /body required/i);
  });

  it('throws when body is only whitespace', () => {
    assert.throws(() => bc.add(baseAdd({ body: '  ' })), /body required/i);
  });

  it('throws when title exceeds 120 characters', () => {
    assert.throws(
      () => bc.add(baseAdd({ title: 'x'.repeat(121) })),
      /too long/i,
    );
  });

  it('accepts a title of exactly 120 characters', () => {
    const b = bc.add(baseAdd({ title: 'a'.repeat(120) }));
    assert.equal(b.title.length, 120);
  });

  it('throws when body exceeds 2000 characters', () => {
    assert.throws(
      () => bc.add(baseAdd({ body: 'x'.repeat(2001) })),
      /too long/i,
    );
  });

  it('throws for an unknown severity', () => {
    assert.throws(
      () => bc.add(baseAdd({ severity: 'critical' })),
      /unknown severity/i,
    );
  });

  it('throws for an unknown audience', () => {
    assert.throws(
      () => bc.add(baseAdd({ audience: 'public' })),
      /unknown audience/i,
    );
  });

  it('throws when expires_at is not a valid ISO date', () => {
    assert.throws(
      () => bc.add(baseAdd({ expires_at: 'not-a-date' })),
      /iso date/i,
    );
  });

  it('trims whitespace from title and body', () => {
    const b = bc.add(baseAdd({ title: '  Trimmed Title  ', body: '  Trimmed Body  ' }));
    assert.equal(b.title, 'Trimmed Title');
    assert.equal(b.body,  'Trimmed Body');
  });

  it('severity defaults to "info" when not provided', () => {
    const b = bc.add({ title: 'T', body: 'B' });
    assert.equal(b.severity, 'info');
  });

  it('audience defaults to "all" when not provided', () => {
    const b = bc.add({ title: 'T', body: 'B' });
    assert.equal(b.audience, 'all');
  });

  it('posted_at is a recent ISO string', () => {
    const before = Date.now();
    const b = bc.add(baseAdd());
    const after = Date.now();
    assert.ok(new Date(b.posted_at).getTime() >= before);
    assert.ok(new Date(b.posted_at).getTime() <= after);
  });

  it('stores expires_at when provided', () => {
    const b = bc.add(baseAdd({ expires_at: '2026-12-31T00:00:00.000Z' }));
    assert.equal(b.expires_at, '2026-12-31T00:00:00.000Z');
  });

  it('expires_at is null when not provided', () => {
    const b = bc.add(baseAdd());
    assert.equal(b.expires_at, null);
  });

  it('posted_by is null when by fields are not provided', () => {
    const b = bc.add({ title: 'T', body: 'B' });
    assert.equal(b.posted_by, null);
  });

  it('posted_by has user_id, display_name, role when provided', () => {
    const b = bc.add(baseAdd({
      by_user_id: 'u-poster',
      by_display: 'Poster Name',
      by_role:    'axis_admin',
    }));
    assert.deepEqual(b.posted_by, {
      user_id:      'u-poster',
      display_name: 'Poster Name',
      role:         'axis_admin',
    });
  });

  it('return shape has id, title, body, severity, audience, posted_at, expires_at, archived_at, posted_by', () => {
    const b = bc.add(baseAdd());
    for (const f of ['id', 'title', 'body', 'severity', 'audience',
                     'posted_at', 'expires_at', 'archived_at', 'posted_by']) {
      assert.ok(f in b, `missing field: ${f}`);
    }
  });

  it('archived_at is null on a fresh broadcast', () => {
    const b = bc.add(baseAdd());
    assert.equal(b.archived_at, null);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('broadcasts — update', () => {
  it('returns null for an unknown id', () => {
    assert.equal(bc.update(999999, { title: 'New' }), null);
  });

  it('throws for an unknown severity in patch', () => {
    const b = bc.add(baseAdd());
    assert.throws(() => bc.update(b.id, { severity: 'mega' }), /unknown severity/i);
  });

  it('throws for an unknown audience in patch', () => {
    const b = bc.add(baseAdd());
    assert.throws(() => bc.update(b.id, { audience: 'everyone' }), /unknown audience/i);
  });

  it('throws for an invalid expires_at in patch', () => {
    const b = bc.add(baseAdd());
    assert.throws(() => bc.update(b.id, { expires_at: 'bad' }), /iso date/i);
  });

  it('patches title', () => {
    const b = bc.add(baseAdd());
    const u = bc.update(b.id, { title: 'New Title' });
    assert.equal(u.title, 'New Title');
  });

  it('patches body', () => {
    const b = bc.add(baseAdd());
    const u = bc.update(b.id, { body: 'New body text.' });
    assert.equal(u.body, 'New body text.');
  });

  it('patches severity', () => {
    const b = bc.add(baseAdd({ severity: 'info' }));
    const u = bc.update(b.id, { severity: 'urgent' });
    assert.equal(u.severity, 'urgent');
  });

  it('patches audience', () => {
    const b = bc.add(baseAdd({ audience: 'all' }));
    const u = bc.update(b.id, { audience: 'operators' });
    assert.equal(u.audience, 'operators');
  });

  it('patches expires_at', () => {
    const b = bc.add(baseAdd());
    const u = bc.update(b.id, { expires_at: '2027-01-01T00:00:00.000Z' });
    assert.equal(u.expires_at, '2027-01-01T00:00:00.000Z');
  });

  it('clears expires_at when patch passes expires_at: null', () => {
    const b = bc.add(baseAdd({ expires_at: '2027-01-01T00:00:00.000Z' }));
    const u = bc.update(b.id, { expires_at: null });
    assert.equal(u.expires_at, null);
  });

  it('unpatched fields are preserved (COALESCE)', () => {
    const b = bc.add(baseAdd({ severity: 'warn', audience: 'operators' }));
    bc.update(b.id, { title: 'Only title patched' });
    const after = bc.findById(b.id);
    assert.equal(after.severity, 'warn');
    assert.equal(after.audience, 'operators');
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('broadcasts — archive / unarchive', () => {
  it('archived_at is set after archive()', () => {
    const b = bc.add(baseAdd());
    bc.archive(b.id);
    assert.ok(bc.findById(b.id).archived_at !== null);
  });

  it('findById still returns the row after archive', () => {
    const b = bc.add(baseAdd());
    bc.archive(b.id);
    assert.ok(bc.findById(b.id) !== null);
  });

  it('archived_at is null after unarchive()', () => {
    const b = bc.add(baseAdd());
    bc.archive(b.id);
    bc.unarchive(b.id);
    assert.equal(bc.findById(b.id).archived_at, null);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('broadcasts — remove', () => {
  it('findById returns null after remove()', () => {
    const b = bc.add(baseAdd());
    bc.remove(b.id);
    assert.equal(bc.findById(b.id), null);
  });

  it('does not throw when removing an unknown id', () => {
    assert.doesNotThrow(() => bc.remove(999999));
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('broadcasts — findById', () => {
  it('returns null for an unknown id', () => {
    assert.equal(bc.findById(999999), null);
  });

  it('returns the shaped row for a known id', () => {
    const b = bc.add(baseAdd({ title: 'Known Broadcast' }));
    const found = bc.findById(b.id);
    assert.ok(found !== null);
    assert.equal(found.id,    b.id);
    assert.equal(found.title, 'Known Broadcast');
  });
});

// ── listAll ───────────────────────────────────────────────────────

describe('broadcasts — listAll', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(bc.listAll()));
  });

  it('count increments after add()', () => {
    const before = bc.listAll().length;
    bc.add(baseAdd());
    assert.equal(bc.listAll().length, before + 1);
  });

  it('includes archived broadcasts', () => {
    const b = bc.add(baseAdd());
    bc.archive(b.id);
    assert.ok(bc.listAll().some((x) => x.id === b.id));
  });
});

// ── activeForRole ─────────────────────────────────────────────────

describe('broadcasts — activeForRole', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(bc.activeForRole('axis_ops')));
  });

  it('excludes archived broadcasts', () => {
    const b = bc.add(baseAdd());
    bc.archive(b.id);
    assert.ok(!bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('excludes broadcasts whose expires_at is in the past', () => {
    const b = bc.add(baseAdd({ expires_at: '2020-01-01T00:00:00.000Z' }));
    assert.ok(!bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('includes broadcasts with no expires_at', () => {
    const b = bc.add(baseAdd({ expires_at: null }));
    assert.ok(bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('includes broadcasts whose expires_at is in the future', () => {
    const b = bc.add(baseAdd({ expires_at: '2099-01-01T00:00:00.000Z' }));
    assert.ok(bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('urgent sorts before warn, warn before info', () => {
    // Use a fresh unique identifier so we can isolate just these three
    const tag = `order-${++_seq}`;
    const info   = bc.add(baseAdd({ title: `${tag}-info`,   severity: 'info' }));
    const warn   = bc.add(baseAdd({ title: `${tag}-warn`,   severity: 'warn' }));
    const urgent = bc.add(baseAdd({ title: `${tag}-urgent`, severity: 'urgent' }));
    const active = bc.activeForRole('axis_ops')
      .filter((x) => [info.id, warn.id, urgent.id].includes(x.id));
    assert.equal(active[0].id, urgent.id, 'urgent should be first');
    assert.equal(active[1].id, warn.id,   'warn should be second');
    assert.equal(active[2].id, info.id,   'info should be last');
  });

  it('"all" audience is visible to axis_ops', () => {
    const b = bc.add(baseAdd({ audience: 'all' }));
    assert.ok(bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('"all" audience is visible to hauler_admin', () => {
    const b = bc.add(baseAdd({ audience: 'all' }));
    assert.ok(bc.activeForRole('hauler_admin').some((x) => x.id === b.id));
  });

  it('"operators" audience is visible to axis_ops', () => {
    const b = bc.add(baseAdd({ audience: 'operators' }));
    assert.ok(bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });

  it('"operators" audience is visible to axis_admin', () => {
    const b = bc.add(baseAdd({ audience: 'operators' }));
    assert.ok(bc.activeForRole('axis_admin').some((x) => x.id === b.id));
  });

  it('"operators" audience is NOT visible to hauler_admin', () => {
    const b = bc.add(baseAdd({ audience: 'operators' }));
    assert.ok(!bc.activeForRole('hauler_admin').some((x) => x.id === b.id));
  });

  it('"haulers" audience is visible to hauler_admin', () => {
    const b = bc.add(baseAdd({ audience: 'haulers' }));
    assert.ok(bc.activeForRole('hauler_admin').some((x) => x.id === b.id));
  });

  it('"haulers" audience is NOT visible to axis_ops', () => {
    const b = bc.add(baseAdd({ audience: 'haulers' }));
    assert.ok(!bc.activeForRole('axis_ops').some((x) => x.id === b.id));
  });
});
