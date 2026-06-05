'use strict';

/*
 * Tests for services/startup.js
 *
 * Covers:
 *   - validate() does not throw and returns undefined (REQUIRED is empty)
 *   - Missing RECOMMENDED vars produce one warn line each on stderr
 *   - Each warn line is valid JSON with level:'warn' and the missing key name
 *   - Setting all RECOMMENDED vars suppresses all warnings
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const RECOMMENDED_KEYS = ['SMTP_HOST', 'CORS_ORIGIN', 'APP_URL', 'ANTHROPIC_API_KEY'];

function captureStderr(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return lines;
}

function freshStartup() {
  delete require.cache[require.resolve('../services/startup')];
  delete require.cache[require.resolve('../services/logger')];
  return require('../services/startup');
}

before(() => {
  process.env.LOG_LEVEL = 'warn';
});

after(() => {
  delete process.env.LOG_LEVEL;
  delete require.cache[require.resolve('../services/startup')];
  delete require.cache[require.resolve('../services/logger')];
});

describe('startup — validate() basic', () => {
  beforeEach(() => {
    for (const key of RECOMMENDED_KEYS) delete process.env[key];
  });

  it('does not throw', () => {
    const { validate } = freshStartup();
    assert.doesNotThrow(() => captureStderr(() => validate()));
  });

  it('returns undefined', () => {
    const { validate } = freshStartup();
    let result;
    captureStderr(() => { result = validate(); });
    assert.equal(result, undefined);
  });
});

describe('startup — validate() warnings for missing RECOMMENDED vars', () => {
  beforeEach(() => {
    for (const key of RECOMMENDED_KEYS) delete process.env[key];
  });

  it('produces exactly 4 stderr lines when all 4 vars are unset', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    assert.equal(lines.length, 4);
  });

  it('each stderr line is valid JSON', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `not valid JSON: ${line}`);
    }
  });

  it('each warning JSON has level: "warn"', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.equal(obj.level, 'warn');
    }
  });

  it('each warning JSON includes the missing key name in the key field or msg', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    const parsed = lines.map((l) => JSON.parse(l));
    for (const key of RECOMMENDED_KEYS) {
      const found = parsed.some(
        (obj) => obj.key === key || (typeof obj.msg === 'string' && obj.msg.includes(key)),
      );
      assert.ok(found, `no warning found mentioning key: ${key}`);
    }
  });

  it('SMTP_HOST warning is emitted when SMTP_HOST is unset', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    const parsed = lines.map((l) => JSON.parse(l));
    const smtpWarn = parsed.find(
      (obj) => obj.key === 'SMTP_HOST' || (typeof obj.msg === 'string' && obj.msg.includes('SMTP_HOST')),
    );
    assert.ok(smtpWarn, 'expected a warning for SMTP_HOST');
    assert.equal(smtpWarn.level, 'warn');
  });

  it('each warning JSON has a msg field', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok('msg' in obj, `missing msg field in: ${line}`);
    }
  });

  it('each warning JSON has a ts field', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok('ts' in obj, `missing ts field in: ${line}`);
    }
  });
});

describe('startup — validate() no warnings when vars set', () => {
  before(() => {
    for (const key of RECOMMENDED_KEYS) process.env[key] = 'set';
  });

  after(() => {
    for (const key of RECOMMENDED_KEYS) delete process.env[key];
  });

  it('produces 0 stderr lines when all 4 RECOMMENDED vars are set', () => {
    const { validate } = freshStartup();
    const lines = captureStderr(() => validate());
    assert.equal(lines.length, 0);
  });

  it('does not throw when all vars are set', () => {
    const { validate } = freshStartup();
    assert.doesNotThrow(() => validate());
  });

  it('returns undefined when all vars are set', () => {
    const { validate } = freshStartup();
    const result = validate();
    assert.equal(result, undefined);
  });
});
