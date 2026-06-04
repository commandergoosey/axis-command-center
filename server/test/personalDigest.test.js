'use strict';

/*
 * Tests for services/personalDigest.js — compose()
 *
 * compose({ actor_user_id, days, now }) has:
 *   - injectable now (ms) and days
 *   - early return when actor_user_id is missing
 *   - single dependency: listAudit({ actor_user_id, since, limit })
 *                        → { rows: [...], total: N }
 *
 * Fixed now = 2026-05-21T00:00:00Z; default days = 7.
 *
 * Output shape:
 *   generated_at, days, horizon, counts, daily_series, by_action, recent
 *   counts: { total, by_category, action_item_flow }
 *   horizon: { since, until }
 *   daily_series: [{ date, n }, ...] length = days, oldest → newest
 *   recent: rows.slice(0, 25)
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

function freshCompose(rows = [], total = rows.length) {
  stub('../db/audit', { listAudit: () => ({ rows, total }) });
  delete require.cache[require.resolve('../services/personalDigest')];
  return require('../services/personalDigest').compose;
}

after(() => {
  for (const p of ['../services/personalDigest', '../db/audit'])
    delete require.cache[require.resolve(p)];
});

const NOW_MS  = new Date('2026-05-21T00:00:00Z').getTime();
const ONE_DAY = 24 * 60 * 60 * 1000;

function makeRow(entity_type, action, overrides = {}) {
  return {
    entity_type,
    action,
    entity_id: overrides.entity_id ?? `${entity_type}-1`,
    actor_user_id: overrides.actor ?? 'user-42',
    ts: overrides.ts ?? new Date(NOW_MS - ONE_DAY).toISOString(),
    summary: overrides.summary ?? '',
  };
}

// ── Early return when no actor_user_id ────────────────────────────

describe('personalDigest — no actor_user_id', () => {
  it('returns minimal shape with empty counts when actor_user_id omitted', () => {
    const compose = freshCompose();
    const r = compose({ now: NOW_MS });
    assert.ok('generated_at' in r);
    assert.deepEqual(r.counts, {});
    assert.deepEqual(r.by_category, {});
    assert.deepEqual(r.recent, []);
    assert.equal(r.total, 0);
  });

  it('generated_at matches now even on early return', () => {
    const compose = freshCompose();
    const r = compose({ now: NOW_MS });
    assert.equal(r.generated_at, new Date(NOW_MS).toISOString());
  });
});

// ── Output shape ──────────────────────────────────────────────────

describe('personalDigest — output shape', () => {
  it('compose() returns all top-level keys', () => {
    const compose = freshCompose([]);
    const r = compose({ actor_user_id: 'user-42', now: NOW_MS });
    for (const k of ['generated_at', 'days', 'horizon', 'counts', 'daily_series', 'by_action', 'recent']) {
      assert.ok(k in r, `missing top-level key: ${k}`);
    }
  });

  it('generated_at equals now ISO string', () => {
    const compose = freshCompose([]);
    const r = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(r.generated_at, new Date(NOW_MS).toISOString());
  });

  it('horizon.until equals now ISO string', () => {
    const compose = freshCompose([]);
    const { horizon } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(horizon.until, new Date(NOW_MS).toISOString());
  });

  it('horizon.since is days before now', () => {
    const compose = freshCompose([]);
    const { horizon } = compose({ actor_user_id: 'user-42', days: 7, now: NOW_MS });
    const expected = new Date(NOW_MS - 7 * ONE_DAY).toISOString();
    assert.equal(horizon.since, expected);
  });

  it('days field reflects the requested days (default 7)', () => {
    const compose = freshCompose([]);
    assert.equal(compose({ actor_user_id: 'user-42', now: NOW_MS }).days, 7);
    assert.equal(compose({ actor_user_id: 'user-42', days: 14, now: NOW_MS }).days, 14);
  });

  it('counts block has total, by_category, action_item_flow', () => {
    const compose = freshCompose([]);
    const { counts } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    for (const k of ['total', 'by_category', 'action_item_flow']) {
      assert.ok(k in counts, `counts missing field: ${k}`);
    }
  });
});

// ── Category roll-up ──────────────────────────────────────────────

describe('personalDigest — by_category counts', () => {
  it('empty rows → empty by_category', () => {
    const compose = freshCompose([]);
    const { counts } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.deepEqual(counts.by_category, {});
  });

  it('action_item rows map to "action_items" category', () => {
    const compose = freshCompose([
      makeRow('action_item', 'assign'),
      makeRow('action_item', 'comment'),
    ]);
    const { counts } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(counts.by_category.action_items, 2);
  });

  it('risk and risk_step both roll up to "risks"', () => {
    const compose = freshCompose([
      makeRow('risk', 'create'),
      makeRow('risk_step', 'complete'),
      makeRow('risk_comment', 'add'),
    ]);
    const { counts } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(counts.by_category.risks, 3);
  });

  it('unmapped entity_type falls into "other"', () => {
    const compose = freshCompose([makeRow('custom_thing', 'view')]);
    const { counts } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(counts.by_category.other, 1);
  });

  it('counts.total = rows.length', () => {
    const rows = [
      makeRow('action_item', 'assign'),
      makeRow('risk', 'create'),
      makeRow('forecast', 'view'),
    ];
    const compose = freshCompose(rows);
    assert.equal(compose({ actor_user_id: 'user-42', now: NOW_MS }).counts.total, 3);
  });
});

// ── Action-item flow ──────────────────────────────────────────────

describe('personalDigest — action_item_flow', () => {
  it('assign rows increment opened', () => {
    const compose = freshCompose([makeRow('action_item', 'assign')]);
    const { action_item_flow } = compose({ actor_user_id: 'user-42', now: NOW_MS }).counts;
    assert.equal(action_item_flow.opened, 1);
  });

  it('auto_clear and unassign both increment closed', () => {
    const compose = freshCompose([
      makeRow('action_item', 'auto_clear'),
      makeRow('action_item', 'unassign'),
    ]);
    const { action_item_flow } = compose({ actor_user_id: 'user-42', now: NOW_MS }).counts;
    assert.equal(action_item_flow.closed, 2);
  });

  it('escalate increments escalated', () => {
    const compose = freshCompose([makeRow('action_item', 'escalate')]);
    const { action_item_flow } = compose({ actor_user_id: 'user-42', now: NOW_MS }).counts;
    assert.equal(action_item_flow.escalated, 1);
  });

  it('action_item_flow is 0 when no action_item rows', () => {
    const compose = freshCompose([makeRow('risk', 'create')]);
    const { action_item_flow } = compose({ actor_user_id: 'user-42', now: NOW_MS }).counts;
    assert.equal(action_item_flow.opened, 0);
    assert.equal(action_item_flow.closed, 0);
  });
});

// ── Daily series ──────────────────────────────────────────────────

describe('personalDigest — daily_series', () => {
  it('daily_series has exactly days entries (default 7)', () => {
    const compose = freshCompose([]);
    const r = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(r.daily_series.length, 7);
  });

  it('daily_series has exactly days entries when days=14', () => {
    const compose = freshCompose([]);
    const r = compose({ actor_user_id: 'user-42', days: 14, now: NOW_MS });
    assert.equal(r.daily_series.length, 14);
  });

  it('daily_series is ordered oldest → newest', () => {
    const compose = freshCompose([]);
    const { daily_series } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    for (let i = 1; i < daily_series.length; i++) {
      assert.ok(daily_series[i].date > daily_series[i - 1].date,
        `daily_series not sorted: ${daily_series[i - 1].date} after ${daily_series[i].date}`);
    }
  });

  it('each entry has date and n fields', () => {
    const compose = freshCompose([]);
    for (const entry of compose({ actor_user_id: 'user-42', now: NOW_MS }).daily_series) {
      assert.ok('date' in entry && 'n' in entry);
    }
  });

  it('rows are bucketed by date into daily_series', () => {
    // Row dated yesterday (May 20) should appear in the May 20 bucket
    const yesterday = new Date(NOW_MS - ONE_DAY).toISOString().slice(0, 10); // 2026-05-20
    const rows = [
      makeRow('action_item', 'assign', { ts: new Date(NOW_MS - ONE_DAY).toISOString() }),
      makeRow('action_item', 'assign', { ts: new Date(NOW_MS - ONE_DAY).toISOString() }),
    ];
    const compose = freshCompose(rows);
    const { daily_series } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    const bucket = daily_series.find((d) => d.date === yesterday);
    assert.ok(bucket != null, `no bucket for ${yesterday}`);
    assert.equal(bucket.n, 2);
  });

  it('all n values are ≥ 0', () => {
    const compose = freshCompose([]);
    for (const d of compose({ actor_user_id: 'user-42', now: NOW_MS }).daily_series) {
      assert.ok(d.n >= 0);
    }
  });
});

// ── Recent timeline ───────────────────────────────────────────────

describe('personalDigest — recent', () => {
  it('recent is capped at 25 even when rows > 25', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      makeRow('action_item', 'assign', { entity_id: `act-${i}` }),
    );
    const compose = freshCompose(rows);
    assert.equal(compose({ actor_user_id: 'user-42', now: NOW_MS }).recent.length, 25);
  });

  it('recent is exactly rows.length when rows ≤ 25', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow('action_item', 'assign', { entity_id: `act-${i}` }),
    );
    const compose = freshCompose(rows);
    assert.equal(compose({ actor_user_id: 'user-42', now: NOW_MS }).recent.length, 5);
  });

  it('recent is empty when rows is empty', () => {
    const compose = freshCompose([]);
    assert.deepEqual(compose({ actor_user_id: 'user-42', now: NOW_MS }).recent, []);
  });
});

// ── by_action ─────────────────────────────────────────────────────

describe('personalDigest — by_action', () => {
  it('by_action keys are "entity_type:action" format', () => {
    const compose = freshCompose([
      makeRow('action_item', 'assign'),
      makeRow('risk', 'create'),
    ]);
    const { by_action } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.ok('action_item:assign' in by_action);
    assert.ok('risk:create' in by_action);
  });

  it('by_action counts multiple occurrences of same key', () => {
    const compose = freshCompose([
      makeRow('action_item', 'comment'),
      makeRow('action_item', 'comment'),
      makeRow('action_item', 'comment'),
    ]);
    const { by_action } = compose({ actor_user_id: 'user-42', now: NOW_MS });
    assert.equal(by_action['action_item:comment'], 3);
  });

  it('by_action is empty when rows is empty', () => {
    const compose = freshCompose([]);
    assert.deepEqual(compose({ actor_user_id: 'user-42', now: NOW_MS }).by_action, {});
  });
});
