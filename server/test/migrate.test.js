'use strict';

/*
 * Tests for db/migrate.js — run(db).
 *
 * Uses an in-memory SQLite DB so no real axis.db is touched.
 * migrate.run() is called against the real in-memory DB to exercise
 * the actual migration files in db/migrations/*.sql.
 *
 * Covers:
 *   - run(db) does not throw on a fresh :memory: db
 *   - schema_migrations table exists after run
 *   - real migration files get applied (count > 0)
 *   - running run(db) a second time is idempotent (same count, no throw)
 *   - applied migrations have version, filename, applied_at fields
 *   - version is a number, applied_at is a valid ISO string
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
// Do NOT pre-clear the cache — migrate.run() needs the real db instance
// that already has the base schema tables created.
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');

delete require.cache[require.resolve('../db/migrate')];
const migrate = require('../db/migrate');

// ─────────────────────────────────────────────────────────────────
describe('migrate.run', () => {
  it('does not throw on a fresh in-memory database', () => {
    assert.doesNotThrow(() => migrate.run(db));
  });

  it('schema_migrations table exists after run', () => {
    migrate.run(db);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
    ).all();
    assert.equal(tables.length, 1);
  });

  it('real migration files were applied (count > 0)', () => {
    migrate.run(db);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.ok(n > 0, `expected at least one applied migration, got ${n}`);
  });

  it('run(db) a second time is idempotent — same row count, no throw', () => {
    migrate.run(db);
    const { n: before } = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.doesNotThrow(() => migrate.run(db));
    const { n: after } = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.equal(after, before, 'row count should not change on second run');
  });

  it('applied migrations have version, filename, applied_at fields', () => {
    migrate.run(db);
    const rows = db.prepare('SELECT version, filename, applied_at FROM schema_migrations').all();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.ok(typeof row.version === 'number', 'version should be a number');
      assert.ok(typeof row.filename === 'string' && row.filename.length > 0, 'filename should be a non-empty string');
      assert.ok(typeof row.applied_at === 'string' && row.applied_at.length > 0, 'applied_at should be a non-empty string');
    }
  });

  it('version is a positive integer', () => {
    migrate.run(db);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    for (const row of rows) {
      assert.ok(Number.isInteger(row.version) && row.version > 0, `version ${row.version} should be a positive integer`);
    }
  });

  it('applied_at is a valid ISO 8601 date string', () => {
    migrate.run(db);
    const rows = db.prepare('SELECT applied_at FROM schema_migrations').all();
    for (const row of rows) {
      const d = new Date(row.applied_at);
      assert.ok(!isNaN(d.getTime()), `applied_at "${row.applied_at}" should be a valid date`);
    }
  });

  it('filenames match the NNN_description.sql pattern', () => {
    migrate.run(db);
    const rows = db.prepare('SELECT filename FROM schema_migrations').all();
    const pattern = /^\d+_.*\.sql$/;
    for (const row of rows) {
      assert.match(row.filename, pattern, `filename "${row.filename}" should match NNN_description.sql`);
    }
  });

  it('versions are unique in schema_migrations', () => {
    migrate.run(db);
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    const versions = rows.map((r) => r.version);
    const unique = new Set(versions);
    assert.equal(unique.size, versions.length, 'each migration version should appear only once');
  });
});
