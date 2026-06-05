'use strict';

/*
 * Tests for middleware/haulerTokenAuth.js — haulerTokenAuth + requireHaulerToken
 *
 * The module imports db at load time and builds a lazy prepared statement
 * that requires api_token and active columns on the haulers table. Those
 * columns are NOT in the base schema, so we:
 *   1. Boot a fresh :memory: DB
 *   2. Seed mock haulers via haulerStore
 *   3. ALTER TABLE to add the missing columns
 *   4. Set a known api_token on the first hauler
 *   5. Re-require haulerTokenAuth so _stmt is initialised against the
 *      patched schema
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── 1. Fresh in-memory DB ─────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

// ── 2. Seed haulers (haulerStore reads the base haulers table) ────────
delete require.cache[require.resolve('../state/haulerStore')];
require('../state/haulerStore');

// ── 3. Add columns needed by haulerTokenAuth (migration-008) ─────────
db.exec('ALTER TABLE haulers ADD COLUMN api_token TEXT');
db.exec('ALTER TABLE haulers ADD COLUMN active INTEGER NOT NULL DEFAULT 1');

// ── 4. Set a known token on the first hauler ──────────────────────────
const TEST_TOKEN = 'test-token-abc123456789';
db.prepare('UPDATE haulers SET api_token = ? WHERE id = (SELECT id FROM haulers LIMIT 1)').run(TEST_TOKEN);

// Capture the id + display_name so we can assert against them
const seededHauler = db.prepare('SELECT id, display_name FROM haulers WHERE api_token = ?').get(TEST_TOKEN);

// ── 5. (Re-)load haulerTokenAuth against the patched schema ──────────
delete require.cache[require.resolve('../middleware/haulerTokenAuth')];
const { haulerTokenAuth, requireHaulerToken } = require('../middleware/haulerTokenAuth');

// ── Helpers ───────────────────────────────────────────────────────────
function mkReq(token) {
  return { headers: token ? { 'x-hauler-token': token } : {} };
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
describe('haulerTokenAuth', () => {
  it('no X-Hauler-Token header — next() is called', () => {
    const req  = mkReq(null);
    const res  = mkRes();
    const next = mkNext();

    haulerTokenAuth(req, res, next);

    assert.equal(next.wasCalled(), true);
  });

  it('no X-Hauler-Token header — req.haulerToken is not set', () => {
    const req  = mkReq(null);
    haulerTokenAuth(req, mkRes(), mkNext());
    assert.equal(req.haulerToken, undefined);
  });

  it('unknown token — next() is called', () => {
    const req  = mkReq('bad-token-zzz');
    const res  = mkRes();
    const next = mkNext();

    haulerTokenAuth(req, res, next);

    assert.equal(next.wasCalled(), true);
  });

  it('unknown token — req.haulerToken is not set', () => {
    const req = mkReq('bad-token-zzz');
    haulerTokenAuth(req, mkRes(), mkNext());
    assert.equal(req.haulerToken, undefined);
  });

  it('valid token — req.haulerToken is set with hauler_id and display_name', () => {
    const req = mkReq(TEST_TOKEN);
    haulerTokenAuth(req, mkRes(), mkNext());

    assert.ok(req.haulerToken, 'req.haulerToken should be set');
    assert.equal(req.haulerToken.hauler_id,    seededHauler.id);
    assert.equal(req.haulerToken.display_name, seededHauler.display_name);
  });

  it('valid token — req.user is set with a synthetic hauler_admin identity', () => {
    const req = mkReq(TEST_TOKEN);
    haulerTokenAuth(req, mkRes(), mkNext());

    assert.ok(req.user, 'req.user should be set');
    assert.equal(req.user.role,      'hauler_admin');
    assert.equal(req.user.hauler_id, seededHauler.id);
    assert.ok(
      req.user.id.includes(seededHauler.id),
      'synthetic user id should embed the hauler id',
    );
  });

  it('valid token when req.user already set — req.user is not overwritten', () => {
    const existingUser = { id: 'u-existing', role: 'axis_admin', hauler_id: null };
    const req = { headers: { 'x-hauler-token': TEST_TOKEN }, user: existingUser };

    haulerTokenAuth(req, mkRes(), mkNext());

    assert.strictEqual(req.user, existingUser, 'pre-existing req.user must not be replaced');
    assert.equal(req.user.role, 'axis_admin');
  });
});

describe('requireHaulerToken', () => {
  it('req.haulerToken not set — returns 401 with error', () => {
    const req  = {};
    const res  = mkRes();
    const next = mkNext();

    requireHaulerToken(req, res, next);

    assert.equal(res.code, 401);
    assert.ok(res.body && res.body.error, 'should respond with an error field');
    assert.equal(next.wasCalled(), false, 'next() must not be called');
  });

  it('req.haulerToken is set — next() is called', () => {
    const req  = { haulerToken: { hauler_id: 'haul-01', display_name: 'Test Hauler' } };
    const res  = mkRes();
    const next = mkNext();

    requireHaulerToken(req, res, next);

    assert.equal(next.wasCalled(), true);
    assert.equal(res.code, null, 'no error status should be set');
  });
});
