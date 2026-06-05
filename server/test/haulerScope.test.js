'use strict';

/*
 * Tests for middleware/haulerScope.js — enforceHaulerScope
 *
 * No DB needed; all tests use plain mock req/res/next objects.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { enforceHaulerScope } = require('../middleware/haulerScope');

// ── Helpers ───────────────────────────────────────────────────────────
function mkReq(user = null, query = {}, params = {}) {
  return { user, query: { ...query }, params: { ...params } };
}

function mkRes() {
  let code = null;
  let body = null;
  return {
    status(c) { code = c; return this; },
    json(b)   { body = b; },
    get code() { return code; },
    get body() { return body; },
  };
}

function mkNext() {
  let called = false;
  const fn = () => { called = true; };
  fn.wasCalled = () => called;
  return fn;
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('enforceHaulerScope', () => {
  it('no user — next() is called and no 403 is sent', () => {
    const req  = mkReq(null);
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(next.wasCalled(), true, 'next() should be called');
    assert.equal(res.code, null, 'no status code should be set');
  });

  it('axis_admin — next() is called and query.hauler_id is not overwritten', () => {
    const req  = mkReq({ role: 'axis_admin', hauler_id: null }, { hauler_id: 'haul-99' });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(next.wasCalled(), true);
    assert.equal(req.query.hauler_id, 'haul-99', 'query.hauler_id should be unchanged');
    assert.equal(res.code, null);
  });

  it('axis_ops — next() is called and query.hauler_id is not overwritten', () => {
    const req  = mkReq({ role: 'axis_ops', hauler_id: null }, { hauler_id: 'haul-42' });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(next.wasCalled(), true);
    assert.equal(req.query.hauler_id, 'haul-42', 'query.hauler_id should be unchanged');
    assert.equal(res.code, null);
  });

  it('hauler_admin with hauler_id — overwrites req.query.hauler_id', () => {
    const req  = mkReq({ role: 'hauler_admin', hauler_id: 'haul-01' }, { hauler_id: 'haul-99' });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(req.query.hauler_id, 'haul-01', 'query.hauler_id should be overwritten with user hauler_id');
  });

  it('hauler_admin with hauler_id — overwrites req.params.hauler_id', () => {
    const req  = mkReq({ role: 'hauler_admin', hauler_id: 'haul-01' }, {}, { hauler_id: 'haul-99' });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(req.params.hauler_id, 'haul-01', 'params.hauler_id should be overwritten with user hauler_id');
  });

  it('hauler_admin with hauler_id — next() is called (not 403)', () => {
    const req  = mkReq({ role: 'hauler_admin', hauler_id: 'haul-01' });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(next.wasCalled(), true, 'next() should be called');
    assert.equal(res.code, null, 'no 403 should be sent');
  });

  it('hauler_admin with no hauler_id — returns 403 with error message', () => {
    const req  = mkReq({ role: 'hauler_admin', hauler_id: null });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(res.code, 403);
    assert.ok(res.body && res.body.error, 'response body should have an error field');
    assert.ok(
      typeof res.body.error === 'string' && res.body.error.length > 0,
      'error message should be a non-empty string',
    );
  });

  it('hauler_admin with no hauler_id — next() is NOT called', () => {
    const req  = mkReq({ role: 'hauler_admin', hauler_id: null });
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(next.wasCalled(), false, 'next() must not be called on 403');
  });

  it('hauler_admin — original query.hauler_id value is replaced, not merged', () => {
    const req  = mkReq(
      { role: 'hauler_admin', hauler_id: 'haul-01' },
      { hauler_id: 'haul-evil', extra: 'keep' },
    );
    const res  = mkRes();
    const next = mkNext();

    enforceHaulerScope(req, res, next);

    assert.equal(req.query.hauler_id, 'haul-01', 'hauler_id should be the user value');
    assert.equal(req.query.extra, 'keep', 'other query params should be untouched');
    assert.notEqual(req.query.hauler_id, 'haul-evil', 'original spoofed value must not survive');
  });
});
