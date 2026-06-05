'use strict';

/*
 * Tests for middleware/userWriteLimit.js — express-rate-limit wrapper.
 *
 * In the test environment NODE_ENV is not 'production' and
 * AXIS_WRITE_RATE_LIMIT is not '1', so ENABLED=false and the skip
 * function always returns true — every request is passed straight to
 * next() without hitting the rate-limiter internals.
 *
 * We verify:
 *   - the module exports a function (the middleware)
 *   - calling limiter() with GET / POST / DELETE all invoke next()
 *   - no rate-limit headers are set on the response (skip=true path)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Ensure ENABLED stays false for this test run
delete process.env.AXIS_WRITE_RATE_LIMIT;

delete require.cache[require.resolve('../middleware/userWriteLimit')];
const limiter = require('../middleware/userWriteLimit');

// ── Helpers ───────────────────────────────────────────────────────────
function mkReq(method = 'GET', user = null) {
  return {
    method,
    user,
    ip: '127.0.0.1',
    headers:    {},
    connection: { remoteAddress: '127.0.0.1' },
  };
}

function mkRes() {
  const headers = {};
  return {
    setHeader(k, v)    { headers[k] = v; },
    getHeader(k)       { return headers[k]; },
    removeHeader(k)    { delete headers[k]; },
    get headers()      { return headers; },
  };
}

function mkNext() {
  let called = false;
  const fn = () => { called = true; };
  fn.wasCalled = () => called;
  return fn;
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('userWriteLimit', () => {
  it('exports a function (the middleware)', () => {
    assert.equal(typeof limiter, 'function');
  });

  it('GET request — next() is called in test env (ENABLED=false)', async () => {
    const req  = mkReq('GET');
    const res  = mkRes();
    const next = mkNext();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'promise resolved, meaning next() was invoked');
  });

  it('POST request — next() is called in test env (skip=true)', async () => {
    const req  = mkReq('POST');
    const res  = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'next() was called for POST despite being a write method');
  });

  it('DELETE request — next() is called in test env (skip=true)', async () => {
    const req = mkReq('DELETE');
    const res = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'next() was called for DELETE');
  });

  it('PUT request — next() is called in test env (skip=true)', async () => {
    const req = mkReq('PUT');
    const res = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'next() was called for PUT');
  });

  it('PATCH request — next() is called in test env (skip=true)', async () => {
    const req = mkReq('PATCH');
    const res = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'next() was called for PATCH');
  });

  it('no rate-limit headers set on response when skip=true', async () => {
    const req = mkReq('POST', { id: 'u-test' });
    const res = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    const headerKeys = Object.keys(res.headers).map(k => k.toLowerCase());
    const hasRateLimitHeader = headerKeys.some(k => k.startsWith('ratelimit') || k.startsWith('x-ratelimit'));
    assert.equal(hasRateLimitHeader, false, 'no rate-limit headers should be present when skipped');
  });

  it('authenticated user POST — next() is called (ENABLED=false)', async () => {
    const req = mkReq('POST', { id: 'u-auth-user', role: 'axis_ops' });
    const res = mkRes();

    await new Promise(resolve => limiter(req, res, () => { resolve(); }));

    assert.equal(true, true, 'authenticated write request passes through when rate limiting disabled');
  });
});
