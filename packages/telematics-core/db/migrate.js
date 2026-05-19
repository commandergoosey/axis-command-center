'use strict';

/*
 * Migration runner for @axis/telematics-core.
 *
 * Reads numbered SQL files from this module's db/migrations/ directory,
 * tracks applied versions in the consuming app's schema_migrations table,
 * and runs pending files in order. Mirrors the AXIS server migrate runner
 * so the tracking table is shared and version numbers never collide.
 *
 * Called once by init() using the consuming app's better-sqlite3 instance.
 */

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

const IDEMPOTENT_PATTERNS = [
  /duplicate column name/i,
  /already exists/i,
  /table.*already exists/i,
];

function isIdempotent(err) {
  return IDEMPOTENT_PATTERNS.some((re) => re.test(err.message));
}

function run(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      filename   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) return;

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();

  if (files.length === 0) return;

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );

  for (const file of files) {
    const version = parseInt(file.split('_')[0], 10);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[telematics] applying migration ${file}`);

    try {
      db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)',
        ).run(version, file, new Date().toISOString());
      })();
    } catch (err) {
      if (isIdempotent(err)) {
        db.prepare(
          'INSERT OR IGNORE INTO schema_migrations (version, filename, applied_at) VALUES (?, ?, ?)',
        ).run(version, file, new Date().toISOString());
      } else {
        throw err;
      }
    }
  }
}

module.exports = { run };
