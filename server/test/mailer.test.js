'use strict';

/*
 * Tests for services/mailer.js — send, sendReport, sendPasswordReset,
 *   sendInvite, DEMO, APP_URL
 *
 * mailer has a DEMO path (DEMO = !process.env.SMTP_HOST) that is active
 * whenever SMTP_HOST is absent from the environment.  In demo mode every
 * exported function returns a plain result object without contacting any
 * SMTP server, making the entire module testable with zero external
 * dependencies.
 *
 * Covers:
 *   - DEMO flag is true in test env (no SMTP_HOST)
 *   - APP_URL default value and trailing-slash normalisation
 *   - send():              string vs array `to`, accepted shape, Promise
 *   - sendReport():        demo result, accepted equals the to array
 *   - sendPasswordReset(): result shape, logged link carries token
 *   - sendInvite():        result shape, all four role labels, unknown fallback
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Run an async fn while capturing every console.log() call.
 * Returns the array of logged lines (each call joined with ' ').
 */
async function captureLogs(asyncFn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  try {
    await asyncFn();
  } finally {
    console.log = orig;
  }
  return lines;
}

/**
 * Load a fresh copy of mailer with optional environment variable overrides.
 * After require() the env is restored to its previous state.
 */
function freshMailer(envOverrides = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  delete require.cache[require.resolve('../services/mailer')];
  const mod = require('../services/mailer');
  for (const [k] of Object.entries(envOverrides)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  return mod;
}

// Load the default module once — no SMTP_HOST env var → DEMO = true
delete require.cache[require.resolve('../services/mailer')];
const mailer = require('../services/mailer');

// ── Module constants ──────────────────────────────────────────────

describe('mailer — module constants', () => {
  it('DEMO is true when SMTP_HOST is absent', () => {
    assert.equal(mailer.DEMO, true);
  });

  it('APP_URL defaults to http://localhost:5173', () => {
    assert.equal(mailer.APP_URL, 'http://localhost:5173');
  });

  it('APP_URL strips a trailing slash from APP_URL env var', () => {
    const m = freshMailer({ APP_URL: 'https://app.axis-command.com/' });
    assert.equal(m.APP_URL, 'https://app.axis-command.com');
  });

  it('APP_URL without a trailing slash is left unchanged', () => {
    const m = freshMailer({ APP_URL: 'https://app.axis-command.com' });
    assert.equal(m.APP_URL, 'https://app.axis-command.com');
  });
});

// ── send ──────────────────────────────────────────────────────────

describe('mailer — send (DEMO mode)', () => {
  it('returns a Promise', () => {
    const ret = mailer.send({ to: 'x@test.local', subject: 'S', text: 'T' });
    assert.ok(ret instanceof Promise, 'send should return a Promise');
    return ret; // let the runner await it to avoid unhandled-rejection noise
  });

  it('result has demo: true', async () => {
    const result = await mailer.send({ to: 'a@test.local', subject: 'Hi', text: 'body' });
    assert.equal(result.demo, true);
  });

  it('string to is normalised to a one-element accepted array', async () => {
    const result = await mailer.send({ to: 'one@test.local', subject: 'S', text: 'T' });
    assert.deepEqual(result.accepted, ['one@test.local']);
  });

  it('array to is preserved in accepted', async () => {
    const to = ['a@test.local', 'b@test.local', 'c@test.local'];
    const result = await mailer.send({ to, subject: 'Multi', text: 'body' });
    assert.deepEqual(result.accepted, to);
  });

  it('works without an html argument (text-only)', async () => {
    const result = await mailer.send({ to: 'x@test.local', subject: 'S', text: 'plain only' });
    assert.equal(result.demo, true);
  });
});

// ── sendReport ───────────────────────────────────────────────────

describe('mailer — sendReport (DEMO mode)', () => {
  it('returns { demo: true }', async () => {
    const result = await mailer.sendReport({
      to:        ['r@test.local'],
      subject:   'Daily Digest',
      text:      'See attached',
      pdfBuffer: Buffer.from('%PDF-stub'),
      filename:  'report.pdf',
    });
    assert.equal(result.demo, true);
  });

  it('accepted is the same array passed as to', async () => {
    const to = ['r1@test.local', 'r2@test.local'];
    const result = await mailer.sendReport({
      to,
      subject:   'Report',
      text:      'body',
      pdfBuffer: Buffer.alloc(0),
      filename:  'test.pdf',
    });
    assert.deepEqual(result.accepted, to);
  });

  it('returns a Promise', () => {
    const ret = mailer.sendReport({
      to: ['r@test.local'], subject: 'S', text: 'T',
      pdfBuffer: Buffer.alloc(0), filename: 'f.pdf',
    });
    assert.ok(ret instanceof Promise);
    return ret;
  });
});

// ── sendPasswordReset ─────────────────────────────────────────────

describe('mailer — sendPasswordReset (DEMO mode)', () => {
  const USER = { email: 'alice@test.local', display_name: 'Alice Mensah' };

  it('returns { demo: true }', async () => {
    const result = await mailer.sendPasswordReset(USER, 'reset-tok-abc123');
    assert.deepEqual(result, { demo: true });
  });

  it('returns a Promise', () => {
    const ret = mailer.sendPasswordReset(USER, 'tok');
    assert.ok(ret instanceof Promise);
    return ret;
  });

  it('logs a line containing the reset token', async () => {
    const token = 'tok-xyz-999';
    const lines = await captureLogs(() => mailer.sendPasswordReset(USER, token));
    assert.ok(
      lines.join('\n').includes(token),
      `expected logs to mention token "${token}"`,
    );
  });

  it('logged link contains APP_URL and /reset-password?token=<token>', async () => {
    const token = 'tok-link-check';
    const lines = await captureLogs(() => mailer.sendPasswordReset(USER, token));
    const allText = lines.join('\n');
    assert.ok(allText.includes(mailer.APP_URL),   'link should include APP_URL');
    assert.ok(allText.includes('/reset-password?token=' + token),
      'link should include /reset-password?token=<token>');
  });

  it('logs the user email address', async () => {
    const lines = await captureLogs(() => mailer.sendPasswordReset(USER, 'tok'));
    assert.ok(lines.join('\n').includes(USER.email), 'log should mention user email');
  });
});

// ── sendInvite ────────────────────────────────────────────────────

describe('mailer — sendInvite (DEMO mode)', () => {
  const TOKEN = 'invite-tok-42';

  it('returns { demo: true }', async () => {
    const user = { email: 'bob@test.local', display_name: 'Bob Asante', role: 'axis_admin' };
    assert.deepEqual(await mailer.sendInvite(user, TOKEN), { demo: true });
  });

  it('returns a Promise', () => {
    const user = { email: 'bob@test.local', display_name: 'Bob', role: 'axis_admin' };
    const ret = mailer.sendInvite(user, TOKEN);
    assert.ok(ret instanceof Promise);
    return ret;
  });

  it('logged invite link contains /reset-password?token=<token>', async () => {
    const user = { email: 'bob@test.local', display_name: 'Bob Asante', role: 'hauler_admin' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(
      lines.join('\n').includes('/reset-password?token=' + TOKEN),
      'invite log should include the setup link with token',
    );
  });

  it('logs the user email', async () => {
    const user = { email: 'carol@test.local', display_name: 'Carol Osei', role: 'lender' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes(user.email), 'log should mention user email');
  });

  it('role label for axis_admin is "AXIS Admin"', async () => {
    const user = { email: 'u@t.local', display_name: 'U', role: 'axis_admin' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes('AXIS Admin'),
      'expected role label "AXIS Admin" in log');
  });

  it('role label for axis_ops is "AXIS Operations"', async () => {
    const user = { email: 'u@t.local', display_name: 'U', role: 'axis_ops' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes('AXIS Operations'),
      'expected role label "AXIS Operations" in log');
  });

  it('role label for hauler_admin is "Hauler Admin"', async () => {
    const user = { email: 'u@t.local', display_name: 'U', role: 'hauler_admin' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes('Hauler Admin'),
      'expected role label "Hauler Admin" in log');
  });

  it('role label for lender is "Lender"', async () => {
    const user = { email: 'u@t.local', display_name: 'U', role: 'lender' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes('Lender'),
      'expected role label "Lender" in log');
  });

  it('unknown role falls back to the raw role string', async () => {
    const user = { email: 'u@t.local', display_name: 'U', role: 'custom_viewer' };
    const lines = await captureLogs(() => mailer.sendInvite(user, TOKEN));
    assert.ok(lines.join('\n').includes('custom_viewer'),
      'unknown role should fall back to the raw role string in log');
  });
});
