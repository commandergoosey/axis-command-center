'use strict';

/*
 * Per-user write rate limiting — LP-46.
 *
 * Wraps express-rate-limit with a key generator that uses the
 * authenticated user's ID, falling back to IP for unauthenticated
 * requests. Applied globally to POST/PUT/PATCH/DELETE methods so
 * write-heavy operations can't be abused per-user.
 *
 * Limits:
 *   Authenticated users:     60 writes per 15 minutes
 *   Unauthenticated (IP):    20 writes per 15 minutes
 *
 * Env overrides:
 *   USER_WRITE_MAX        — per-user maximum (default 60)
 *   USER_WRITE_WINDOW_MS  — window in ms (default 900000 = 15 min)
 *
 * Skip: only active in production (NODE_ENV=production) and when
 *   AXIS_WRITE_RATE_LIMIT is set, to avoid breaking dev workflows.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const WRITE_MAX    = parseInt(process.env.USER_WRITE_MAX       ?? '60',     10);
const WINDOW_MS    = parseInt(process.env.USER_WRITE_WINDOW_MS ?? '900000', 10);
const ENABLED      = process.env.NODE_ENV === 'production' || process.env.AXIS_WRITE_RATE_LIMIT === '1';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const limiter = rateLimit({
  windowMs:        WINDOW_MS,
  max:             WRITE_MAX,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => !ENABLED || !WRITE_METHODS.has(req.method),
  keyGenerator:    (req) => req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req)}`,
  message:         { error: 'Too many write requests — please slow down' },
});

module.exports = limiter;
