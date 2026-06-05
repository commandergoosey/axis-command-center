'use strict';

/*
 * Tests for services/reportAI.js — generate(prompt) and stream(jobId, res)
 *
 * Uses an in-memory SQLite DB. ANTHROPIC_API_KEY is deliberately absent so
 * generate() exercises the buildFallbackSpec path throughout.
 *
 * Setup order:
 *   1. DB_PATH = ':memory:'
 *   2. Clear module caches for all dependent modules
 *   3. Load ../db first (creates tables)
 *   4. Load ../services/reportAI
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── Environment ────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete process.env.ANTHROPIC_API_KEY;

// ── Clear caches ───────────────────────────────────────────────────
for (const rel of [
  '../db',
  '../state/alertState',
  '../state/haulerStore',
  '../state/roster',
  '../services/aggregator',
  '../services/reportAI',
]) {
  try { delete require.cache[require.resolve(rel)]; } catch (_) { /* not yet loaded */ }
}

// ── Boot DB (creates tables) then load service ─────────────────────
require('../db');
const { generate, stream } = require('../services/reportAI');

// ── Mock res factory ───────────────────────────────────────────────
function mockRes() {
  const headers = {};
  let endBuf = null;
  return {
    setHeader(k, v) { headers[k] = v; },
    end(buf) { endBuf = buf; },
    get headers() { return headers; },
    get body() { return endBuf; },
  };
}

// ── Shared state: one generate() call shared across stream tests ───
let sharedJobId;
let sharedTitle;

before(async () => {
  const result = await generate('Give me a corridor status summary');
  sharedJobId = result.jobId;
  sharedTitle = result.title;
});

// ── reportAI — generate ────────────────────────────────────────────

describe('reportAI — generate', () => {
  it('returns an object with jobId and title', async () => {
    const result = await generate('fleet overview');
    assert.ok(result !== null && typeof result === 'object');
    assert.ok('jobId' in result);
    assert.ok('title' in result);
  });

  it('jobId starts with "ai-"', async () => {
    const { jobId } = await generate('hauler performance');
    assert.ok(jobId.startsWith('ai-'), `expected jobId to start with "ai-", got "${jobId}"`);
  });

  it('title is a non-empty string', async () => {
    const { title } = await generate('SLA report');
    assert.equal(typeof title, 'string');
    assert.ok(title.length > 0, 'title should be non-empty');
  });

  it('two generate calls return different jobIds', async () => {
    const a = await generate('report one');
    const b = await generate('report two');
    assert.notEqual(a.jobId, b.jobId);
  });
});

// ── reportAI — stream (unknown job) ───────────────────────────────

describe('reportAI — stream (unknown job)', () => {
  it('stream("ai-never", res) returns false', () => {
    const res = mockRes();
    const result = stream('ai-never', res);
    assert.equal(result, false);
  });

  it('res.end is not called for unknown jobId', () => {
    const res = mockRes();
    stream('ai-never-x', res);
    assert.equal(res.body, null);
  });
});

// ── reportAI — stream (valid job) ─────────────────────────────────

describe('reportAI — stream (valid job)', () => {
  it('stream(jobId, res) returns true', () => {
    const res = mockRes();
    const result = stream(sharedJobId, res);
    assert.equal(result, true);
  });

  it('Content-Type header is "application/pdf"', () => {
    const res = mockRes();
    stream(sharedJobId, res);
    assert.equal(res.headers['Content-Type'], 'application/pdf');
  });

  it('Content-Disposition header contains the jobId', () => {
    const res = mockRes();
    stream(sharedJobId, res);
    assert.ok(
      res.headers['Content-Disposition'].includes(sharedJobId),
      `expected Content-Disposition to contain "${sharedJobId}"`,
    );
  });

  it('res.end is called with a Buffer', () => {
    const res = mockRes();
    stream(sharedJobId, res);
    assert.ok(Buffer.isBuffer(res.body), 'expected res.end to receive a Buffer');
  });

  it('the buffer is non-empty (PDF has bytes)', () => {
    const res = mockRes();
    stream(sharedJobId, res);
    assert.ok(res.body.length > 0, 'expected non-empty PDF buffer');
  });

  it('stream is non-destructive — same jobId can be streamed twice', () => {
    const res1 = mockRes();
    const res2 = mockRes();
    const r1 = stream(sharedJobId, res1);
    const r2 = stream(sharedJobId, res2);
    assert.equal(r1, true);
    assert.equal(r2, true);
    assert.deepEqual(res1.body, res2.body);
  });
});
