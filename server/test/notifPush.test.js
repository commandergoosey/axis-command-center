'use strict';

/*
 * Tests for services/notifPush.js — add, remove, pushToUser, connectionCount
 *
 * notifPush is a pure in-memory SSE stream registry:
 *   Map<userId, Set<res>>
 *
 * No external dependencies. Tests use unique userId strings per group to
 * avoid state cross-contamination between suites (the module is a singleton).
 *
 * Mock `res` objects expose a `write(str)` method and optionally throw to
 * test the graceful-write-error path.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const push = require('../services/notifPush');

// ── Helpers ───────────────────────────────────────────────────────

let _uidSeq = 0;
function uid() { return `test-user-${++_uidSeq}`; }

function mockRes() {
  const writes = [];
  return {
    written: writes,
    write(payload) { writes.push(payload); },
  };
}

function throwingRes() {
  return { write() { throw new Error('socket gone'); } };
}

// ── connectionCount ───────────────────────────────────────────────

describe('notifPush — connectionCount', () => {
  it('returns 0 for a user with no registered streams', () => {
    assert.equal(push.connectionCount(uid()), 0);
  });

  it('returns 1 after add()', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    assert.equal(push.connectionCount(u), 1);
    push.remove(u, res); // cleanup
  });

  it('returns 2 after two add() calls for the same user', () => {
    const u = uid();
    const r1 = mockRes();
    const r2 = mockRes();
    push.add(u, r1);
    push.add(u, r2);
    assert.equal(push.connectionCount(u), 2);
    push.remove(u, r1);
    push.remove(u, r2);
  });

  it('returns 0 after remove() removes the last stream', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    push.remove(u, res);
    assert.equal(push.connectionCount(u), 0);
  });
});

// ── add / remove ──────────────────────────────────────────────────

describe('notifPush — add and remove', () => {
  it('remove() on a user with no streams does not throw', () => {
    const res = mockRes();
    assert.doesNotThrow(() => push.remove(uid(), res));
  });

  it('remove() on a stream that was never added does not throw', () => {
    const u = uid();
    const r1 = mockRes();
    const r2 = mockRes();
    push.add(u, r1);
    assert.doesNotThrow(() => push.remove(u, r2)); // r2 never added
    push.remove(u, r1);
  });

  it('removing one of two streams decrements count to 1', () => {
    const u = uid();
    const r1 = mockRes();
    const r2 = mockRes();
    push.add(u, r1);
    push.add(u, r2);
    push.remove(u, r1);
    assert.equal(push.connectionCount(u), 1);
    push.remove(u, r2);
  });
});

// ── pushToUser ────────────────────────────────────────────────────

describe('notifPush — pushToUser', () => {
  it('returns 0 for a user with no registered streams', () => {
    assert.equal(push.pushToUser(uid(), 'ping', {}), 0);
  });

  it('returns 1 when one stream is registered and write succeeds', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    const sent = push.pushToUser(u, 'ping', { ok: true });
    assert.equal(sent, 1);
    push.remove(u, res);
  });

  it('returns 2 when two streams are registered', () => {
    const u = uid();
    const r1 = mockRes();
    const r2 = mockRes();
    push.add(u, r1);
    push.add(u, r2);
    const sent = push.pushToUser(u, 'test', {});
    assert.equal(sent, 2);
    push.remove(u, r1);
    push.remove(u, r2);
  });

  it('write payload has correct SSE format: event + data + blank line', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    push.pushToUser(u, 'notification_update', { count: 3 });
    assert.equal(res.written.length, 1);
    const payload = res.written[0];
    assert.ok(payload.startsWith('event: notification_update\n'),
      `payload should start with event line, got: ${payload.slice(0, 50)}`);
    assert.ok(payload.includes('\ndata: '),
      'payload should include a data line');
    assert.ok(payload.endsWith('\n\n'),
      'SSE payload should end with double newline');
    push.remove(u, res);
  });

  it('data field is valid JSON containing the pushed object', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    push.pushToUser(u, 'alert_raised', { alert_id: 'a-42', severity: 'CRITICAL' });
    const payload = res.written[0];
    const dataLine = payload.split('\n').find((l) => l.startsWith('data: '));
    const json = JSON.parse(dataLine.slice('data: '.length));
    assert.deepEqual(json, { alert_id: 'a-42', severity: 'CRITICAL' });
    push.remove(u, res);
  });

  it('returns 0 after the stream is removed', () => {
    const u = uid();
    const res = mockRes();
    push.add(u, res);
    push.remove(u, res);
    assert.equal(push.pushToUser(u, 'ping', {}), 0);
  });

  it('write error is swallowed gracefully (does not throw)', () => {
    const u = uid();
    const bad = throwingRes();
    push.add(u, bad);
    assert.doesNotThrow(() => push.pushToUser(u, 'ping', {}));
    push.remove(u, bad);
  });

  it('write error on one stream does not prevent writing to another', () => {
    const u = uid();
    const good = mockRes();
    const bad  = throwingRes();
    push.add(u, good);
    push.add(u, bad);
    // Should not throw; bad stream swallows error
    assert.doesNotThrow(() => push.pushToUser(u, 'test', { x: 1 }));
    // good stream received the write
    assert.equal(good.written.length, 1);
    push.remove(u, good);
    push.remove(u, bad);
  });
});
