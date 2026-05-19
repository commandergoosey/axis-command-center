'use strict';

/*
 * Logger — LP-8.
 *
 * Thin structured JSON logger. Each call emits a single JSON line to stdout
 * (or stderr for error-level), making log ingestion trivial for any platform
 * that understands NDJSON (Railway, Datadog, Logtail, etc.).
 *
 * Usage:
 *   const log = require('./logger');
 *   log.info('Server started', { port: 3002 });
 *   log.http('Request', { method: 'GET', path: '/api/health', status: 200, ms: 4 });
 *   log.error('DB query failed', { err: err.message });
 *
 * Levels (ascending verbosity):
 *   error | warn | info | http | debug
 *
 * Set LOG_LEVEL env var to control verbosity (default: info in production,
 * http in development).
 */

const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'http';
const activeLevel  = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ??
                     LEVELS[defaultLevel];

function emit(level, msg, data = {}) {
  if (LEVELS[level] > activeLevel) return;

  const line = JSON.stringify({
    ts:    new Date().toISOString(),
    level,
    msg,
    ...data,
  });

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  error: (msg, data) => emit('error', msg, data),
  warn:  (msg, data) => emit('warn',  msg, data),
  info:  (msg, data) => emit('info',  msg, data),
  http:  (msg, data) => emit('http',  msg, data),
  debug: (msg, data) => emit('debug', msg, data),
};
