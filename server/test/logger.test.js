'use strict';

/*
 * Tests for services/logger.js
 *
 * Covers:
 *   - error/warn route to stderr; info/http/debug route to stdout
 *   - Each emitted line is valid JSON with ts, level, msg fields
 *   - ts is a recent ISO 8601 string
 *   - Extra data fields are spread into the emitted JSON
 *   - Level filtering via LOG_LEVEL env var
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

function captureStdout(fn) {
  const lines = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { lines.push(String(s)); return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return lines;
}

function captureStderr(fn) {
  const lines = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { lines.push(String(s)); return true; };
  try { fn(); } finally { process.stderr.write = orig; }
  return lines;
}

function freshLogger() {
  delete require.cache[require.resolve('../services/logger')];
  return require('../services/logger');
}

before(() => {
  process.env.LOG_LEVEL = 'debug';
  delete require.cache[require.resolve('../services/logger')];
});

after(() => {
  delete process.env.LOG_LEVEL;
  delete require.cache[require.resolve('../services/logger')];
});

describe('stderr levels', () => {
  it('error writes to stderr', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.error('boom'));
    assert.equal(lines.length, 1);
  });

  it('error does not write to stdout', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.error('boom'));
    assert.equal(lines.length, 0);
  });

  it('warn writes to stderr', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.warn('heads up'));
    assert.equal(lines.length, 1);
  });

  it('warn does not write to stdout', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.warn('heads up'));
    assert.equal(lines.length, 0);
  });
});

describe('stdout levels', () => {
  it('info writes to stdout', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('started'));
    assert.equal(lines.length, 1);
  });

  it('info does not write to stderr', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.info('started'));
    assert.equal(lines.length, 0);
  });

  it('http writes to stdout', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.http('GET /'));
    assert.equal(lines.length, 1);
  });

  it('http does not write to stderr', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.http('GET /'));
    assert.equal(lines.length, 0);
  });

  it('debug writes to stdout', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.debug('trace'));
    assert.equal(lines.length, 1);
  });

  it('debug does not write to stderr', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.debug('trace'));
    assert.equal(lines.length, 0);
  });
});

describe('JSON shape', () => {
  it('each line is valid JSON', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('hello'));
    assert.doesNotThrow(() => JSON.parse(lines[0]));
  });

  it('emitted object has ts field', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('hello'));
    const obj = JSON.parse(lines[0]);
    assert.ok('ts' in obj);
  });

  it('emitted object has level field matching the called method', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('hello'));
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.level, 'info');
  });

  it('emitted object has msg field matching the argument', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('hello'));
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.msg, 'hello');
  });

  it('ts is a recent ISO 8601 string', () => {
    const logger = freshLogger();
    const before = Date.now();
    const lines = captureStdout(() => logger.info('time check'));
    const after = Date.now();
    const obj = JSON.parse(lines[0]);
    const ts = new Date(obj.ts).getTime();
    assert.ok(!Number.isNaN(ts), 'ts should parse to a valid date');
    assert.ok(ts >= before && ts <= after, 'ts should fall within the call window');
  });

  it('extra data fields are spread into the emitted JSON', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('with data', { hauler: 'H1', trips: 3 }));
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.hauler, 'H1');
    assert.equal(obj.trips, 3);
  });

  it('extra data does not overwrite core fields', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('core fields', { msg: 'override attempt' }));
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.msg, 'override attempt');
  });

  it('error level is recorded correctly in JSON', () => {
    const logger = freshLogger();
    const lines = captureStderr(() => logger.error('fail'));
    const obj = JSON.parse(lines[0]);
    assert.equal(obj.level, 'error');
    assert.equal(obj.msg, 'fail');
  });

  it('each emitted line ends with a newline', () => {
    const logger = freshLogger();
    const lines = captureStdout(() => logger.info('newline check'));
    assert.ok(lines[0].endsWith('\n'));
  });
});

describe('level filtering', () => {
  it('debug is suppressed when LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStdout(() => filtered.debug('should not appear'));
    assert.equal(lines.length, 0);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('http is suppressed when LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStdout(() => filtered.http('GET /'));
    assert.equal(lines.length, 0);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('info is emitted when LOG_LEVEL=info', () => {
    process.env.LOG_LEVEL = 'info';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStdout(() => filtered.info('visible'));
    assert.equal(lines.length, 1);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('http is suppressed when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStdout(() => filtered.http('GET /'));
    assert.equal(lines.length, 0);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('info is suppressed when LOG_LEVEL=warn', () => {
    process.env.LOG_LEVEL = 'warn';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStdout(() => filtered.info('silent'));
    assert.equal(lines.length, 0);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('error is emitted when LOG_LEVEL=error', () => {
    process.env.LOG_LEVEL = 'error';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStderr(() => filtered.error('critical'));
    assert.equal(lines.length, 1);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });

  it('warn is suppressed when LOG_LEVEL=error', () => {
    process.env.LOG_LEVEL = 'error';
    delete require.cache[require.resolve('../services/logger')];
    const filtered = require('../services/logger');
    const lines = captureStderr(() => filtered.warn('not shown'));
    assert.equal(lines.length, 0);
    process.env.LOG_LEVEL = 'debug';
    delete require.cache[require.resolve('../services/logger')];
  });
});
