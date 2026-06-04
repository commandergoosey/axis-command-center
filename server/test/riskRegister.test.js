'use strict';

/*
 * Tests for state/riskRegister.js —
 *   add, update, review, archive, unarchive, remove,
 *   findById, listActive, counts, staleReviews
 *   + shape (via returned objects)
 *
 * Uses an in-memory SQLite DB. riskRegister.js creates its own table
 * via db.exec() at module load — no seed function, starts empty.
 *
 * Stale-review tests manipulate last_reviewed_at directly via the
 * shared db instance (set to '2020-01-01') since add() always stamps
 * last_reviewed_at = now.
 *
 * Covers:
 *   - Constants: CATEGORIES / SEVERITIES / LIKELIHOODS / STATUSES are
 *     non-empty arrays containing expected values
 *   - shape: null → null; owner/created_by built when present, null when absent;
 *     link and payload-like fields present
 *   - add: all enum validation throws; empty/overlong title throws;
 *     status defaults 'open'; last_reviewed_at set; description truncated;
 *     returned shape has correct fields; appears in listActive()
 *   - update: null for unknown id; COALESCE (null patch keeps existing);
 *     patches category / severity / status; invalid enum patch throws
 *   - review: stamps last_reviewed_at + last_reviewed_by; returns row
 *   - archive / unarchive: excluded from / restored to listActive();
 *     archived_at set; findById still works after archive
 *   - remove: findById null after; not in listActive()
 *   - findById: null for unknown; shaped row for known
 *   - listActive: empty initially; excludes archived; ordering
 *     (critical before high before medium)
 *   - counts: shape; open_count / high_open_count / stale_count
 *   - staleReviews: empty for fresh risks; stale risks returned after
 *     last_reviewed_at set to distant past
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

delete require.cache[require.resolve('../state/riskRegister')];
const rr = require('../state/riskRegister');

// ── Fixture helper ────────────────────────────────────────────────
function baseRisk(overrides = {}) {
  return {
    title:      'Test Risk',
    category:   'operational',
    severity:   'medium',
    likelihood: 'possible',
    ...overrides,
  };
}

/** Force a risk's last_reviewed_at to a distant-past date so it counts as stale. */
function makeStale(id) {
  db.prepare("UPDATE risk_register SET last_reviewed_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
}

// ── Constants ─────────────────────────────────────────────────────

describe('riskRegister — constants', () => {
  it('CATEGORIES is a non-empty array containing "operational"', () => {
    assert.ok(Array.isArray(rr.CATEGORIES) && rr.CATEGORIES.length > 0);
    assert.ok(rr.CATEGORIES.includes('operational'));
  });

  it('SEVERITIES contains low / medium / high / critical', () => {
    for (const s of ['low', 'medium', 'high', 'critical']) {
      assert.ok(rr.SEVERITIES.includes(s), `SEVERITIES missing: ${s}`);
    }
  });

  it('LIKELIHOODS contains rare / possible / almost_certain', () => {
    for (const l of ['rare', 'possible', 'almost_certain']) {
      assert.ok(rr.LIKELIHOODS.includes(l), `LIKELIHOODS missing: ${l}`);
    }
  });

  it('STATUSES contains open / mitigating / monitoring / closed', () => {
    for (const s of ['open', 'mitigating', 'monitoring', 'closed']) {
      assert.ok(rr.STATUSES.includes(s), `STATUSES missing: ${s}`);
    }
  });
});

// ── shape (tested via add/findById) ───────────────────────────────

describe('riskRegister — shape', () => {
  it('findById returns null for a non-existent id', () => {
    assert.equal(rr.findById(999999), null);
  });

  it('owner is null when owner_user_id is absent', () => {
    const r = rr.add(baseRisk());
    assert.equal(r.owner, null);
  });

  it('owner is an object with user_id and display_name when present', () => {
    const r = rr.add(baseRisk({ owner_user_id: 'u-01', owner_display: 'Alice' }));
    assert.deepEqual(r.owner, { user_id: 'u-01', display_name: 'Alice' });
  });

  it('created_by is null when by_user_id is absent', () => {
    const r = rr.add(baseRisk());
    assert.equal(r.created_by, null);
  });

  it('created_by is an object with user_id, display_name, role when present', () => {
    const r = rr.add(baseRisk({ by_user_id: 'u-02', by_display: 'Bob', by_role: 'axis_ops' }));
    assert.deepEqual(r.created_by, { user_id: 'u-02', display_name: 'Bob', role: 'axis_ops' });
  });

  it('returned shape has expected top-level fields', () => {
    const r = rr.add(baseRisk());
    for (const k of ['id', 'title', 'category', 'severity', 'likelihood',
                     'status', 'created_at', 'last_reviewed_at']) {
      assert.ok(k in r, `missing field: ${k}`);
    }
  });
});

// ── add ───────────────────────────────────────────────────────────

describe('riskRegister — add', () => {
  it('throws for an empty title', () => {
    assert.throws(() => rr.add(baseRisk({ title: '   ' })), /title required/i);
  });

  it('throws for a title exceeding 120 characters', () => {
    assert.throws(() => rr.add(baseRisk({ title: 'x'.repeat(121) })), /too long/i);
  });

  it('throws for an unknown category', () => {
    assert.throws(() => rr.add(baseRisk({ category: 'foobar' })), /unknown category/i);
  });

  it('throws for an unknown severity', () => {
    assert.throws(() => rr.add(baseRisk({ severity: 'catastrophic' })), /unknown severity/i);
  });

  it('throws for an unknown likelihood', () => {
    assert.throws(() => rr.add(baseRisk({ likelihood: 'definite' })), /unknown likelihood/i);
  });

  it('throws for an unknown status', () => {
    assert.throws(() => rr.add(baseRisk({ status: 'pending' })), /unknown status/i);
  });

  it('status defaults to "open"', () => {
    const r = rr.add(baseRisk());
    assert.equal(r.status, 'open');
  });

  it('accepts a valid non-default status', () => {
    const r = rr.add(baseRisk({ status: 'mitigating' }));
    assert.equal(r.status, 'mitigating');
  });

  it('last_reviewed_at is a recent ISO string', () => {
    const before = Date.now();
    const r = rr.add(baseRisk());
    const after  = Date.now();
    const ts = new Date(r.last_reviewed_at).getTime();
    assert.ok(ts >= before && ts <= after,
      `last_reviewed_at ${r.last_reviewed_at} should be between test start and end`);
  });

  it('description longer than 2000 chars is truncated to 2000', () => {
    const r = rr.add(baseRisk({ description: 'a'.repeat(2001) }));
    const raw = db.prepare('SELECT description FROM risk_register WHERE id = ?').get(r.id);
    assert.equal(raw.description.length, 2000);
  });

  it('added risk appears in listActive()', () => {
    const r = rr.add(baseRisk({ title: 'Visibility test' }));
    assert.ok(rr.listActive().some((x) => x.id === r.id));
  });

  it('returned object has numeric auto-increment id', () => {
    const r = rr.add(baseRisk());
    assert.ok(typeof r.id === 'number' && r.id > 0);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('riskRegister — update', () => {
  it('returns null for an unknown id', () => {
    assert.equal(rr.update(999999, { title: 'X' }), null);
  });

  it('COALESCE: null patch does not overwrite existing title', () => {
    const r = rr.add(baseRisk({ title: 'Keep this' }));
    rr.update(r.id, { title: null, severity: 'high' });
    assert.equal(rr.findById(r.id).title, 'Keep this');
  });

  it('patches category', () => {
    const r = rr.add(baseRisk({ category: 'operational' }));
    rr.update(r.id, { category: 'financial' });
    assert.equal(rr.findById(r.id).category, 'financial');
  });

  it('patches severity', () => {
    const r = rr.add(baseRisk({ severity: 'low' }));
    rr.update(r.id, { severity: 'critical' });
    assert.equal(rr.findById(r.id).severity, 'critical');
  });

  it('patches status', () => {
    const r = rr.add(baseRisk());
    rr.update(r.id, { status: 'monitoring' });
    assert.equal(rr.findById(r.id).status, 'monitoring');
  });

  it('throws for invalid category in patch', () => {
    const r = rr.add(baseRisk());
    assert.throws(() => rr.update(r.id, { category: 'notacat' }), /unknown category/i);
  });

  it('throws for invalid severity in patch', () => {
    const r = rr.add(baseRisk());
    assert.throws(() => rr.update(r.id, { severity: 'extreme' }), /unknown severity/i);
  });

  it('patches mitigation_plan', () => {
    const r = rr.add(baseRisk());
    rr.update(r.id, { mitigation_plan: 'Hedge with futures' });
    assert.equal(rr.findById(r.id).mitigation_plan, 'Hedge with futures');
  });
});

// ── review ────────────────────────────────────────────────────────

describe('riskRegister — review', () => {
  it('stamps last_reviewed_at with a recent ISO string', () => {
    const r = rr.add(baseRisk());
    const before = Date.now();
    rr.review(r.id, 'Ops Lead');
    const after  = Date.now();
    const ts = new Date(rr.findById(r.id).last_reviewed_at).getTime();
    assert.ok(ts >= before && ts <= after);
  });

  it('sets last_reviewed_by to the provided display name', () => {
    const r = rr.add(baseRisk());
    rr.review(r.id, 'Kwame Boateng');
    assert.equal(rr.findById(r.id).last_reviewed_by, 'Kwame Boateng');
  });

  it('returns the updated row', () => {
    const r = rr.add(baseRisk());
    const result = rr.review(r.id, 'Reviewer');
    assert.ok(result !== null);
    assert.equal(result.id, r.id);
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('riskRegister — archive / unarchive', () => {
  it('archived risk is excluded from listActive()', () => {
    const r = rr.add(baseRisk({ title: 'To archive' }));
    rr.archive(r.id);
    assert.ok(!rr.listActive().some((x) => x.id === r.id));
  });

  it('archived_at is set after archive', () => {
    const r = rr.add(baseRisk());
    rr.archive(r.id);
    const row = rr.findById(r.id);
    assert.ok(row.archived_at !== null, 'archived_at should be set');
  });

  it('findById still returns the row after archive', () => {
    const r = rr.add(baseRisk());
    rr.archive(r.id);
    assert.ok(rr.findById(r.id) !== null,
      'findById should return the row regardless of archived state');
  });

  it('unarchived risk reappears in listActive()', () => {
    const r = rr.add(baseRisk({ title: 'Unarchive me' }));
    rr.archive(r.id);
    rr.unarchive(r.id);
    assert.ok(rr.listActive().some((x) => x.id === r.id));
  });

  it('archived_at is null after unarchive', () => {
    const r = rr.add(baseRisk());
    rr.archive(r.id);
    rr.unarchive(r.id);
    assert.equal(rr.findById(r.id).archived_at, null);
  });
});

// ── remove ────────────────────────────────────────────────────────

describe('riskRegister — remove', () => {
  it('findById returns null after remove', () => {
    const r = rr.add(baseRisk({ title: 'Removable' }));
    rr.remove(r.id);
    assert.equal(rr.findById(r.id), null);
  });

  it('removed risk does not appear in listActive()', () => {
    const r = rr.add(baseRisk({ title: 'Gone' }));
    rr.remove(r.id);
    assert.ok(!rr.listActive().some((x) => x.id === r.id));
  });
});

// ── listActive ────────────────────────────────────────────────────

describe('riskRegister — listActive', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rr.listActive()));
  });

  it('excludes archived risks', () => {
    const r = rr.add(baseRisk({ title: 'Archived exclusion check' }));
    rr.archive(r.id);
    assert.ok(!rr.listActive().some((x) => x.id === r.id));
  });

  it('critical risks sort before high risks', () => {
    const crit = rr.add(baseRisk({ title: 'Critical one', severity: 'critical' }));
    const high = rr.add(baseRisk({ title: 'High one',     severity: 'high' }));
    const list = rr.listActive();
    const critIdx = list.findIndex((x) => x.id === crit.id);
    const highIdx = list.findIndex((x) => x.id === high.id);
    assert.ok(critIdx < highIdx,
      `critical (idx ${critIdx}) should appear before high (idx ${highIdx})`);
  });
});

// ── counts ────────────────────────────────────────────────────────

describe('riskRegister — counts', () => {
  it('returns an object with open_count, high_open_count, stale_count', () => {
    const c = rr.counts();
    assert.ok('open_count'      in c, 'missing open_count');
    assert.ok('high_open_count' in c, 'missing high_open_count');
    assert.ok('stale_count'     in c, 'missing stale_count');
  });

  it('open_count includes non-closed active risks', () => {
    const before = rr.counts().open_count;
    rr.add(baseRisk({ status: 'open' }));
    assert.equal(rr.counts().open_count, before + 1);
  });

  it('open_count does not include closed risks', () => {
    const before = rr.counts().open_count;
    rr.add(baseRisk({ status: 'closed' }));
    assert.equal(rr.counts().open_count, before,
      'closed risk should not increase open_count');
  });

  it('high_open_count counts only critical and high severity non-closed risks', () => {
    const before = rr.counts().high_open_count;
    rr.add(baseRisk({ severity: 'critical' }));
    rr.add(baseRisk({ severity: 'high' }));
    rr.add(baseRisk({ severity: 'low' }));  // should not count
    assert.equal(rr.counts().high_open_count, before + 2);
  });

  it('stale_count increases after setting last_reviewed_at to distant past', () => {
    const before = rr.counts().stale_count;
    const r = rr.add(baseRisk());
    makeStale(r.id);  // sets last_reviewed_at to 2020-01-01
    assert.equal(rr.counts().stale_count, before + 1);
  });
});

// ── staleReviews ──────────────────────────────────────────────────

describe('riskRegister — staleReviews', () => {
  it('returns an array', () => {
    assert.ok(Array.isArray(rr.staleReviews()));
  });

  it('newly created risks (reviewed at add-time) are not stale', () => {
    const r = rr.add(baseRisk({ title: 'Fresh risk' }));
    assert.ok(!rr.staleReviews().some((x) => x.id === r.id),
      'newly added risk should not appear in staleReviews()');
  });

  it('returns risk whose last_reviewed_at is older than the cutoff', () => {
    const r = rr.add(baseRisk({ title: 'Stale risk' }));
    makeStale(r.id);
    assert.ok(rr.staleReviews().some((x) => x.id === r.id),
      'risk with old last_reviewed_at should appear in staleReviews()');
  });

  it('closed risks are excluded from staleReviews()', () => {
    const r = rr.add(baseRisk({ title: 'Closed stale', status: 'closed' }));
    makeStale(r.id);
    assert.ok(!rr.staleReviews().some((x) => x.id === r.id),
      'closed risks should not appear in staleReviews()');
  });

  it('archived risks are excluded from staleReviews()', () => {
    const r = rr.add(baseRisk({ title: 'Archived stale' }));
    makeStale(r.id);
    rr.archive(r.id);
    assert.ok(!rr.staleReviews().some((x) => x.id === r.id),
      'archived risks should not appear in staleReviews()');
  });
});
