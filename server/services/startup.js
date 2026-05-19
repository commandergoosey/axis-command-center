'use strict';

/*
 * Startup validation — LP-9.
 *
 * Called once on boot before the server starts listening. Fails fast on any
 * hard-required variable, warns on recommended-but-optional ones so operators
 * know what they're missing before a user hits the missing-config path.
 *
 * Hard-required (exits with code 1 if absent):
 *   none currently — AXIS runs in demo/offline mode without any external deps.
 *
 * Recommended (warns, continues):
 *   SMTP_HOST     — email delivery (password reset, invites)
 *   CORS_ORIGIN   — CORS allowlist for production
 *   APP_URL       — base URL used in email links
 *   ANTHROPIC_API_KEY — AI intelligence panel
 *   DB_PATH       — persistent volume path on Railway etc.
 */

const log = require('./logger');

const REQUIRED = [
  // Add hard requirements here as the system grows, e.g.:
  // 'JWT_SECRET',
];

const RECOMMENDED = [
  { key: 'SMTP_HOST',          note: 'Email delivery will use demo/log mode — reset links logged to console' },
  { key: 'CORS_ORIGIN',        note: 'All origins permitted — set to your Vercel/CDN URL before going live' },
  { key: 'APP_URL',            note: 'Email links will use http://localhost:5173' },
  { key: 'ANTHROPIC_API_KEY',  note: 'Intelligence panel (/api/intelligence) will be unavailable' },
];

function validate() {
  let ok = true;

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      log.error(`Missing required env var: ${key} — cannot start`, { key });
      ok = false;
    }
  }

  if (!ok) {
    process.exit(1);
  }

  for (const { key, note } of RECOMMENDED) {
    if (!process.env[key]) {
      log.warn(`Env var not set: ${key}`, { key, note });
    }
  }
}

module.exports = { validate };
