'use strict';

/*
 * LP-1 — User state backed by SQLite.
 *
 * On first boot the users table is seeded:
 *   - NODE_ENV=production: seeds a single axis_admin from env vars
 *     INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD (both required).
 *   - Any other env: seeds the four demo accounts with the passwords
 *     listed in DEMO_USERS (useful for local dev and staging review).
 *
 * All passwords are stored as bcrypt hashes (cost=12). Plain-text
 * comparison is gone. The /api/auth/demo endpoint is disabled in
 * production (NODE_ENV=production) to prevent credential disclosure.
 */

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const db      = require('../db');

const BCRYPT_ROUNDS = 12;
const PROD          = process.env.NODE_ENV === 'production';

/* ── Demo seed data (non-production only) ──────────────────────────── */
const DEMO_USERS = [
  {
    id:           'u-axis-admin',
    email:        'admin@axis.gh',
    password:     'axis-admin-change-me',
    display_name: 'Akosua Mensah',
    role:         'axis_admin',
    hauler_id:    null,
    organisation: 'AXIS (NewCo Logistics JV)',
  },
  {
    id:           'u-axis-ops',
    email:        'ops@axis.gh',
    password:     'axis-ops-change-me',
    display_name: 'Kwame Boateng',
    role:         'axis_ops',
    hauler_id:    null,
    organisation: 'AXIS Operations',
  },
  {
    id:           'u-haul-01',
    email:        'admin@haul-01.gh',
    password:     'hauler-change-me',
    display_name: 'Ama Darko',
    role:         'hauler_admin',
    hauler_id:    'haul-01',
    organisation: 'Hauler 01',
  },
  {
    id:           'u-lender',
    email:        'analyst@gibdlc.com',
    password:     'lender-change-me',
    display_name: 'Yaw Osei',
    role:         'lender',
    hauler_id:    null,
    organisation: 'GIBDLC — Lender desk',
  },
];

/* ── Prepared statements ───────────────────────────────────────────── */
const stmts = {
  count:      db.prepare('SELECT COUNT(*) AS n FROM users'),
  insert:     db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
    VALUES (@id, @email, @password_hash, @display_name, @role, @hauler_id, @organisation, 1, @created_at, @updated_at)
  `),
  byEmail:    db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
  byId:       db.prepare('SELECT * FROM users WHERE id = ?'),
  list:       db.prepare('SELECT * FROM users ORDER BY display_name'),
  update:     db.prepare(`
    UPDATE users SET display_name=@display_name, role=@role, hauler_id=@hauler_id,
      organisation=@organisation, active=@active, updated_at=@updated_at
    WHERE id=@id
  `),
  setHash:    db.prepare('UPDATE users SET password_hash=@hash, updated_at=@updated_at WHERE id=@id'),
  deactivate: db.prepare('UPDATE users SET active=0, updated_at=? WHERE id=?'),
  reactivate: db.prepare('UPDATE users SET active=1, updated_at=? WHERE id=?'),
};

/* ── Seed on first boot ────────────────────────────────────────────── */
function seed() {
  const { n } = stmts.count.get();
  if (n > 0) return; // already seeded

  const now = new Date().toISOString();

  if (PROD) {
    // Production: require explicit env vars for the bootstrap admin account.
    const email    = process.env.INITIAL_ADMIN_EMAIL;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error(
        '[LP-1] Production boot requires INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD env vars. ' +
        'Set them before starting the server.'
      );
    }
    const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    stmts.insert.run({
      id:           `u-${crypto.randomBytes(6).toString('hex')}`,
      email,
      password_hash: hash,
      display_name:  process.env.INITIAL_ADMIN_NAME || 'Admin',
      role:          'axis_admin',
      hauler_id:     null,
      organisation:  process.env.INITIAL_ADMIN_ORG || 'AXIS',
      created_at:    now,
      updated_at:    now,
    });
    console.log(`[auth] Production admin seeded: ${email}`);
  } else {
    // Development / staging: seed all four demo accounts.
    for (const u of DEMO_USERS) {
      const hash = bcrypt.hashSync(u.password, BCRYPT_ROUNDS);
      stmts.insert.run({
        id:            u.id,
        email:         u.email,
        password_hash: hash,
        display_name:  u.display_name,
        role:          u.role,
        hauler_id:     u.hauler_id,
        organisation:  u.organisation,
        created_at:    now,
        updated_at:    now,
      });
    }
    console.log('[auth] Demo users seeded (4 accounts). Change passwords before going to production.');
  }
}

seed();

/* ── Public API ────────────────────────────────────────────────────── */

/** Verify email + password. Returns user row (without hash) or null. */
function findByCredentials(email, password) {
  if (!email || !password) return null;
  const u = stmts.byEmail.get(String(email).trim());
  if (!u) return null;
  if (!u.active) return null; // deactivated account — treat as not found
  const ok = bcrypt.compareSync(String(password), u.password_hash);
  if (!ok) return null;
  return u;
}

function findById(id) {
  if (!id) return null;
  return stmts.byId.get(id) || null;
}

function findByEmail(email) {
  if (!email) return null;
  return stmts.byEmail.get(String(email).trim()) || null;
}

/** Strip the password hash before sending to the client. */
function publicShape(u) {
  if (!u) return null;
  // eslint-disable-next-line no-unused-vars
  const { password_hash, ...rest } = u;
  return rest;
}

function list() {
  return stmts.list.all().map(publicShape);
}

/**
 * Create a new user. Returns the created user (public shape) or throws.
 * @param {object} fields — { email, password, display_name, role, hauler_id, organisation }
 */
function create({ email, password, display_name, role, hauler_id = null, organisation = null }) {
  if (!email || !password || !display_name || !role) {
    throw new Error('email, password, display_name, and role are required');
  }
  const now  = new Date().toISOString();
  const id   = `u-${crypto.randomBytes(8).toString('hex')}`;
  const hash = bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
  stmts.insert.run({
    id,
    email:         String(email).trim().toLowerCase(),
    password_hash: hash,
    display_name:  String(display_name).trim(),
    role,
    hauler_id:     hauler_id || null,
    organisation:  organisation || null,
    created_at:    now,
    updated_at:    now,
  });
  return publicShape(stmts.byId.get(id));
}

/**
 * Update mutable fields on a user (not password — use setPassword for that).
 * @param {string} id
 * @param {object} fields — any subset of { display_name, role, hauler_id, organisation, active }
 */
function update(id, { display_name, role, hauler_id, organisation, active }) {
  const existing = stmts.byId.get(id);
  if (!existing) throw new Error(`User ${id} not found`);
  stmts.update.run({
    id,
    display_name:  display_name  ?? existing.display_name,
    role:          role          ?? existing.role,
    hauler_id:     hauler_id     !== undefined ? hauler_id  : existing.hauler_id,
    organisation:  organisation  !== undefined ? organisation : existing.organisation,
    active:        active        !== undefined ? (active ? 1 : 0) : existing.active,
    updated_at:    new Date().toISOString(),
  });
  return publicShape(stmts.byId.get(id));
}

/**
 * Change a user's password. Accepts the new plain-text password and hashes it.
 */
function setPassword(id, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const hash = bcrypt.hashSync(String(newPassword), BCRYPT_ROUNDS);
  stmts.setHash.run({ hash, updated_at: new Date().toISOString(), id });
}

function deactivate(id) {
  stmts.deactivate.run(new Date().toISOString(), id);
}

function reactivate(id) {
  stmts.reactivate.run(new Date().toISOString(), id);
}

/* ── Password reset tokens ─────────────────────────────────────────── */
const resetStmts = {
  insert: db.prepare(`
    INSERT INTO password_reset_tokens (token, user_id, created_at, expires_at, used)
    VALUES (?, ?, ?, ?, 0)
  `),
  get:    db.prepare('SELECT * FROM password_reset_tokens WHERE token = ?'),
  markUsed: db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE token = ?'),
};

/** Generate a short-lived reset token for the given user. Expires in 1 hour. */
function createResetToken(userId) {
  const token      = crypto.randomBytes(32).toString('hex');
  const now        = new Date();
  const expires    = new Date(now.getTime() + 60 * 60 * 1000);
  resetStmts.insert.run(token, userId, now.toISOString(), expires.toISOString());
  return token;
}

/** Validate and consume a reset token. Returns user_id or null. */
function consumeResetToken(token) {
  const row = resetStmts.get.get(token);
  if (!row) return null;
  if (row.used) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  resetStmts.markUsed.run(token);
  return row.user_id;
}

module.exports = {
  findByCredentials,
  findById,
  findByEmail,
  publicShape,
  list,
  create,
  update,
  setPassword,
  deactivate,
  reactivate,
  createResetToken,
  consumeResetToken,
  // Expose DEMO_USERS metadata for the /demo endpoint in non-prod.
  // password_hint is included intentionally — this is dev/staging only and
  // the endpoint is disabled in NODE_ENV=production.
  DEMO_USERS: DEMO_USERS.map(({ password, ...u }) => ({ ...u, password_hint: password })),
};
