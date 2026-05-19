'use strict';

/*
 * Migration runner — LP-10.
 *
 * Reads numbered SQL files from server/db/migrations/*.sql, tracks which
 * have been applied in the `schema_migrations` table, and runs pending ones
 * in order on every boot. Operations are wrapped in a single transaction so
 * a failed migration rolls back entirely.
 *
 * Migration files must be named NNN_description.sql (zero-padded integer
 * prefix), e.g.:
 *   001_add_webhook_secret_to_haulers.sql
 *   002_trip_position_events.sql
 *
 * The CREATE TABLE IF NOT EXISTS statements in db/index.js remain the
 * canonical baseline for fresh installs. Migrations handle additive changes
 * on top of that baseline for existing databases.
 */

const fs   = require('fs');
const path = require('path');
const log  = require('../services/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function run(db) {
  // Ensure the tracking table exists.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      filename    TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    log.debug('No migrations directory — skipping');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) {
    log.debug('No migration files found');
    return;
  }

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );

  // Errors that indicate the migration's desired state is already satisfied.
  // SQLite returns these when ALTER TABLE tries to add a column that already
  // exists (e.g. because db/index.js CREATE TABLE already included it for
  // fresh installs). We treat them as "already applied" so the version is
  // recorded and the migration never runs again.
  const IDEMPOTENT_PATTERNS = [
    /duplicate column name/i,
    /already exists/i,
    /table.*already exists/i,
  ];

  function isIdempotentError(err) {
    return IDEMPOTENT_PATTERNS.some((re) => re.test(err.message));
  }

  let count = 0;
  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    log.info(`Applying migration ${file}`);

    try {
      db.transaction(() => {
        db.exec(sql);
        db.prepare(
          `INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)`,
        ).run(version, file, new Date().toISOString());
      })();
    } catch (err) {
      if (isIdempotentError(err)) {
        // Desired state already exists — record as applied and move on.
        log.info(`Migration ${file} already applied (${err.message}) — recording as done`);
        db.prepare(
          `INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)`,
        ).run(version, file, new Date().toISOString());
      } else {
        throw err; // real error — propagate
      }
    }

    count++;
  }

  if (count > 0) {
    log.info(`Applied ${count} migration(s)`);
  } else {
    log.debug('Database schema is up to date');
  }
}

module.exports = { run };
