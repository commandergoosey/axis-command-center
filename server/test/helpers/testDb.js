'use strict';

/**
 * Sets up a fresh in-memory SQLite database and injects it into the
 * require cache at the canonical 'server/db' key. Any application module
 * required *after* calling makeTestDb() will bind its prepared statements
 * to the in-memory database instead of the real file on disk.
 *
 * Usage (at the top of a test file, before any app requires):
 *
 *   process.env.DB_PATH = ':memory:';
 *   delete require.cache[require.resolve('../db')];
 *   const db = require('../db');
 *
 * We expose makeTestDb() as a convenience but the manual pattern above is
 * equally valid — and clearer about what's happening.
 */
function makeTestDb() {
  process.env.DB_PATH = ':memory:';
  const key = require.resolve('../../db');
  delete require.cache[key];
  const db = require('../../db');
  // Apply all migrations so modules that reference added columns
  // (estimated_fuel_l, convoy_id, api_token, etc.) prepare successfully.
  const migrate = require('../../db/migrate');
  migrate.run(db);
  return db;
}

module.exports = { makeTestDb };
