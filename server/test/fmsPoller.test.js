'use strict';

/**
 * Tests for services/fmsPoller.js — DEMO flag, poll(), start(), stop().
 *
 * Module-level constants (POLL_INTERVAL_S, API_KEY, DEMO) are frozen at
 * require() time, so each describe block that needs a different environment
 * performs a fresh require with the module cache cleared.
 *
 * Setup order within each block:
 *   1. Set process.env.DB_PATH = ':memory:'
 *   2. Stub eventProcessor into require.cache
 *   3. Clear db / haulerStore / logger / fmsPoller from cache
 *   4. require('../db'), then require('../state/haulerStore') (seeds mock data)
 *   5. Optionally add a loconav hauler via haulerStore.create()
 *   6. require('../services/fmsPoller')
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const EP_PATH      = require.resolve('../services/eventProcessor');
const DB_PATH_KEY  = require.resolve('../db');
const HS_PATH_KEY  = require.resolve('../state/haulerStore');
const LOG_PATH_KEY = require.resolve('../services/logger');
const FP_PATH_KEY  = require.resolve('../services/fmsPoller');

function stubEventProcessor() {
  require.cache[EP_PATH] = {
    id: EP_PATH, filename: EP_PATH, loaded: true,
    exports: { processIds: () => {} },
  };
}

function clearAppModules() {
  delete require.cache[DB_PATH_KEY];
  delete require.cache[HS_PATH_KEY];
  delete require.cache[LOG_PATH_KEY];
  delete require.cache[FP_PATH_KEY];
}

function loadFresh() {
  process.env.DB_PATH = ':memory:';
  stubEventProcessor();
  clearAppModules();
  const db          = require('../db');
  const haulerStore = require('../state/haulerStore');
  const fp          = require('../services/fmsPoller');
  return { db, haulerStore, fp };
}

const LOCO_HAULER = {
  id:             'haul-loco-fp01',
  display_name:   'Loco Test',
  onboarded_date: '2026-01-01',
  status:         'active',
  integration:    { type: 'loconav' },
  fleet:          { contracted_trucks: 2 },
};

// ── DEMO flag ─────────────────────────────────────────────────────────────────

describe('fmsPoller — DEMO flag', () => {
  let fp;

  before(() => {
    delete process.env.LOCONAV_API_KEY;
    ({ fp } = loadFresh());
  });

  after(() => fp.stop());

  it('DEMO is true when LOCONAV_API_KEY is not set', () => {
    assert.strictEqual(fp.DEMO, true);
  });

  it('exports start, stop, poll, and DEMO', () => {
    assert.strictEqual(typeof fp.start, 'function');
    assert.strictEqual(typeof fp.stop,  'function');
    assert.strictEqual(typeof fp.poll,  'function');
    assert.ok('DEMO' in fp);
  });
});

// ── poll() with no loconav haulers ────────────────────────────────────────────

describe('fmsPoller — poll() with no loconav haulers', () => {
  let fp, db;

  before(() => {
    delete process.env.LOCONAV_API_KEY;
    process.env.DB_PATH = ':memory:';
    stubEventProcessor();
    clearAppModules();

    db = require('../db');

    const hsKey = require.resolve('../state/haulerStore');
    require.cache[hsKey] = {
      id: hsKey, filename: hsKey, loaded: true,
      exports: {
        list:     () => [],
        findById: () => null,
        create:   () => null,
      },
    };

    delete require.cache[FP_PATH_KEY];
    fp = require('../services/fmsPoller');
  });

  after(() => fp.stop());

  it('poll() resolves immediately when no loconav haulers exist', async () => {
    await assert.doesNotReject(() => fp.poll());
  });

  it('poll() inserts no webhook_events when no loconav haulers exist', async () => {
    await fp.poll();
    const row = db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get();
    assert.strictEqual(row.n, 0);
  });
});

// ── poll() demo mode ──────────────────────────────────────────────────────────

describe('fmsPoller — poll() demo mode', () => {
  let fp, db;

  before(() => {
    delete process.env.LOCONAV_API_KEY;
    const { fp: _fp, db: _db, haulerStore } = loadFresh();
    fp = _fp;
    db = _db;
    haulerStore.create(LOCO_HAULER);
  });

  after(() => fp.stop());

  it('poll() resolves without throwing in demo mode', async () => {
    await assert.doesNotReject(() => fp.poll());
  });

  it('poll() inserts at least one row into webhook_events', async () => {
    await fp.poll();
    const row = db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get();
    assert.ok(row.n > 0, `expected webhook_events rows > 0, got ${row.n}`);
  });

  it('inserted events have source = "loconav"', async () => {
    await fp.poll();
    const rows = db.prepare('SELECT DISTINCT source FROM webhook_events').all();
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.strictEqual(r.source, 'loconav');
    }
  });

  it('inserted events have event_type = "position"', async () => {
    await fp.poll();
    const rows = db.prepare('SELECT DISTINCT event_type FROM webhook_events').all();
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.strictEqual(r.event_type, 'position');
    }
  });

  it('inserted events include our test loconav hauler_id', async () => {
    await fp.poll();
    const rows = db.prepare('SELECT DISTINCT hauler_id FROM webhook_events').all();
    const ids  = rows.map((r) => r.hauler_id);
    assert.ok(ids.includes(LOCO_HAULER.id),
      `expected ${LOCO_HAULER.id} in hauler_ids [${ids.join(', ')}]`);
  });
});

// ── start / stop ──────────────────────────────────────────────────────────────

describe('fmsPoller — start / stop', () => {
  let fp;

  before(() => {
    delete process.env.LOCONAV_API_KEY;
    ({ fp } = loadFresh());
  });

  it('start() does not throw', () => {
    assert.doesNotThrow(() => fp.start());
    fp.stop();
  });

  it('stop() does not throw after start()', () => {
    fp.start();
    assert.doesNotThrow(() => fp.stop());
  });

  it('stop() is idempotent — calling twice does not throw', () => {
    fp.start();
    fp.stop();
    assert.doesNotThrow(() => fp.stop());
  });

  it('start() can be called again after stop()', () => {
    fp.start();
    fp.stop();
    assert.doesNotThrow(() => fp.start());
    fp.stop();
  });

  it('stop() with no prior start() does not throw', () => {
    assert.doesNotThrow(() => fp.stop());
  });
});
