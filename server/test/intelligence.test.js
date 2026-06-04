'use strict';

/*
 * Tests for services/intelligence.js — observe(), chat(), _hasKey
 *
 * ANTHROPIC_API_KEY is NOT set in the test environment, so _hasKey()
 * returns false and all tests exercise the no-key fallback path.
 *
 * No-key observe() path:
 *   1. Calls observationSynth.synthesize(page, context)
 *   2. If null → uses FALLBACK_OBSERVATIONS[page] ?? FALLBACK_OBSERVATIONS.today
 *   3. Returns { observations, chips, live: false, synthesized: bool }
 *
 * No-key chat() path:
 *   1. Checks curatedChipReply(page, question) — predefined chip answers
 *   2. Otherwise returns demo-mode fallback string
 *
 * observe() caches results for 60s using node-cache. Tests clear the
 * module cache between freshModule() calls to reset the NodeCache.
 *
 * Stubs:
 *   observationSynth.synthesize → controlled via freshModule(synthResult)
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

// Reload intelligence with a controlled observationSynth result.
// Deleting the cache forces NodeCache reset too (module-level).
function freshModule(synthResult = null) {
  stub('../services/observationSynth', { synthesize: () => synthResult });
  delete require.cache[require.resolve('../services/intelligence')];
  return require('../services/intelligence');
}

after(() => {
  for (const p of ['../services/intelligence', '../services/observationSynth'])
    delete require.cache[require.resolve(p)];
});

const MOCK_OBS = [
  { id: 'obs-test-1', severity: 'warn', body: 'Test observation one.' },
  { id: 'obs-test-2', severity: 'info', body: 'Test observation two.' },
];

// ── _hasKey ───────────────────────────────────────────────────────

describe('intelligence — _hasKey', () => {
  it('_hasKey is exported', () => {
    const { _hasKey } = freshModule();
    assert.equal(typeof _hasKey, 'function');
  });

  it('_hasKey() returns false when ANTHROPIC_API_KEY is not set', () => {
    const { _hasKey } = freshModule();
    // In test environment there is no API key
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const result = _hasKey();
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    assert.equal(result, false);
  });
});

// ── observe() — output shape ──────────────────────────────────────

describe('intelligence — observe() output shape', () => {
  it('observe() returns an object with observations, chips, live, synthesized', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    for (const k of ['observations', 'chips', 'live', 'synthesized']) {
      assert.ok(k in r, `observe result missing field: ${k}`);
    }
  });

  it('live is false in no-key mode', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.equal(r.live, false);
  });

  it('observations is an array', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.ok(Array.isArray(r.observations));
  });

  it('chips is an array', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.ok(Array.isArray(r.chips));
  });
});

// ── observe() — synthesized path ─────────────────────────────────

describe('intelligence — observe() synthesized path', () => {
  it('synthesized=true when observationSynth returns data', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.equal(r.synthesized, true);
  });

  it('observations come from observationSynth when it returns data', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.deepEqual(r.observations, MOCK_OBS);
  });

  it('synthesized=false when observationSynth returns null', async () => {
    const { observe } = freshModule(null);
    const r = await observe('today', {});
    assert.equal(r.synthesized, false);
  });

  it('falls back to FALLBACK_OBSERVATIONS when synthesize returns null', async () => {
    const { observe } = freshModule(null);
    const r = await observe('today', {});
    // FALLBACK_OBSERVATIONS.today has 4 pre-authored observations
    assert.ok(r.observations.length > 0,
      'should fall back to FALLBACK_OBSERVATIONS.today');
    // Each fallback observation has id, severity, body
    for (const o of r.observations) {
      assert.ok(typeof o.id === 'string', 'obs missing id');
      assert.ok(typeof o.severity === 'string', 'obs missing severity');
      assert.ok(typeof o.body === 'string', 'obs missing body');
    }
  });

  it('uses FALLBACK_OBSERVATIONS.today for unknown page when synthesize null', async () => {
    const { observe } = freshModule(null);
    const r = await observe('unknown_page', {});
    // unknown_page has no FALLBACK → falls through to .today
    assert.ok(r.observations.length > 0);
  });
});

// ── observe() — chips ─────────────────────────────────────────────

describe('intelligence — observe() chips', () => {
  it('chips array is non-empty for known page', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('today', {});
    assert.ok(r.chips.length > 0, 'chips should not be empty for "today"');
  });

  it('chips are strings', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r = await observe('compliance', {});
    for (const c of r.chips) assert.equal(typeof c, 'string');
  });
});

// ── observe() — caching ───────────────────────────────────────────

describe('intelligence — observe() caching', () => {
  it('repeated calls return structurally equal result (cache hit)', async () => {
    // NodeCache uses useClones:true by default → returns copies, not same ref.
    // Verify deepEqual (same data) and that synthesize is only called once.
    let callCount = 0;
    stub('../services/observationSynth', { synthesize: () => { callCount++; return MOCK_OBS; } });
    delete require.cache[require.resolve('../services/intelligence')];
    const { observe } = require('../services/intelligence');

    const r1 = await observe('fleet', {});
    const r2 = await observe('fleet', {});
    assert.deepEqual(r1, r2, 'second call should return same data as first');
    assert.equal(callCount, 1, 'synthesize should only be called once (second call is a cache hit)');
  });

  it('different pages produce different cache entries', async () => {
    const { observe } = freshModule(MOCK_OBS);
    const r1 = await observe('today',   {});
    const r2 = await observe('alerts',  {});
    // Different keys → different result objects
    assert.notStrictEqual(r1, r2);
  });
});

// ── observe() — all known pages ───────────────────────────────────

describe('intelligence — observe() known pages', () => {
  const PAGES = ['today', 'alerts', 'compliance', 'financials', 'settings',
                 'fleet', 'maintenance', 'contract', 'tariff', 'haulers'];

  for (const page of PAGES) {
    it(`observe("${page}") resolves without throwing`, async () => {
      const { observe } = freshModule(null); // synthesize returns null → fallback
      const r = await observe(page, {});
      assert.ok(r !== null && typeof r === 'object',
        `observe("${page}") should return an object`);
      assert.ok(Array.isArray(r.observations), 'observations must be array');
    });
  }
});

// ── chat() — no-key mode ──────────────────────────────────────────

describe('intelligence — chat() no-key mode', () => {
  it('chat() returns an object with reply and live fields', async () => {
    const { chat } = freshModule();
    const r = await chat('How is the corridor doing?', {}, 'today');
    assert.ok('reply' in r, 'chat result missing reply');
    assert.ok('live'  in r, 'chat result missing live');
  });

  it('live is false in no-key mode', async () => {
    const { chat } = freshModule();
    const r = await chat('How is the corridor doing?', {}, 'today');
    assert.equal(r.live, false);
  });

  it('reply is a non-empty string', async () => {
    const { chat } = freshModule();
    const r = await chat('How is the corridor doing?', {}, 'today');
    assert.equal(typeof r.reply, 'string');
    assert.ok(r.reply.length > 0);
  });

  it('reply mentions "demonstration mode" for free-form question', async () => {
    const { chat } = freshModule();
    // Non-chip question won't match curatedChipReply → demo fallback
    const r = await chat('What is the square root of seventeen?', {}, 'today');
    assert.ok(r.reply.toLowerCase().includes('demonstration'),
      `expected "demonstration" in reply, got: "${r.reply}"`);
  });

  it('chat() does not throw for any page', async () => {
    const { chat } = freshModule();
    const pages = ['today', 'alerts', 'compliance', 'financials', 'settings'];
    for (const page of pages) {
      await assert.doesNotReject(() => chat('Test question', {}, page),
        `chat() should not reject for page "${page}"`);
    }
  });
});
