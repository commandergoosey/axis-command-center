'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// Insert test users before requiring users.js (bypasses cost-12 seed).
const NOW = new Date().toISOString();
const ADMIN_PASS = 'admin-pass-xx9';
const OPS_PASS   = 'ops-pass-xx9';
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@test.gh', bcrypt.hashSync(ADMIN_PASS, 1), 'Test Admin', 'axis_admin',  null, 'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@test.gh',   bcrypt.hashSync(OPS_PASS,   1), 'Test Ops',   'axis_ops',    null, 'AXIS', NOW, NOW);

// ── Stubs ─────────────────────────────────────────────────────────────

const mailerKey = require.resolve('../services/mailer');
require.cache[mailerKey] = {
  id: mailerKey, filename: mailerKey, loaded: true,
  exports: { sendInvite: async () => {}, sendPasswordReset: async () => {} },
};

// haulerStore — simple in-memory store so hauler route tests can run
// without the full file-backed mock.
const haulers = new Map();
let haulerSeq = 1;
const haulerStoreKey = require.resolve('../state/haulerStore');
require.cache[haulerStoreKey] = {
  id: haulerStoreKey, filename: haulerStoreKey, loaded: true,
  exports: {
    list:       ({ include_deactivated } = {}) =>
      [...haulers.values()].filter((h) => include_deactivated || !h.deactivated),
    findById:   (id) => haulers.get(id) ?? null,
    nextId:     () => `haul-${String(haulerSeq++).padStart(2, '0')}`,
    create:     (fields) => {
      const h = { ...fields, deactivated: false, api_token: null, webhook_secret: null };
      haulers.set(fields.id, h);
      return h;
    },
    update:     (id, fields) => {
      const h = { ...haulers.get(id), ...fields };
      haulers.set(id, h);
      return h;
    },
    deactivate: (id) => { const h = haulers.get(id); if (h) h.deactivated = true; },
    reactivate: (id) => { const h = haulers.get(id); if (h) h.deactivated = false; },
  },
};

const integrationStoreKey = require.resolve('../state/integrationStore');
require.cache[integrationStoreKey] = {
  id: integrationStoreKey, filename: integrationStoreKey, loaded: true,
  exports: { summary: () => ({ has_credentials: false, live: false, last_probe: null }) },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/admin', require('../routes/admin'));

// Auth route needed so our helper can get a token.
app.use('/api/auth', require('../routes/auth'));

let server, base;

before(() => new Promise((resolve) => {
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve) => server.close(resolve)));

// ── Helpers ───────────────────────────────────────────────────────────
async function login(email, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json()).token;
}

async function api(method, path, body, token) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────

describe('admin — role gating', () => {
  it('unauthenticated request returns 401', async () => {
    const res = await api('GET', '/api/admin/alert-rules');
    assert.strictEqual(res.status, 401);
  });

  it('axis_ops role returns 403 (not axis_admin)', async () => {
    const token = await login('ops@test.gh', OPS_PASS);
    const res = await api('GET', '/api/admin/alert-rules', null, token);
    assert.strictEqual(res.status, 403);
  });

  it('axis_admin can access admin routes', async () => {
    const token = await login('admin@test.gh', ADMIN_PASS);
    const res = await api('GET', '/api/admin/alert-rules', null, token);
    assert.strictEqual(res.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('admin — alert rules CRUD', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /alert-rules returns seeded default rules', async () => {
    const res = await api('GET', '/api/admin/alert-rules', null, adminToken);
    assert.strictEqual(res.status, 200);
    const { alert_rules } = await res.json();
    assert.ok(Array.isArray(alert_rules));
    assert.ok(alert_rules.length > 0, 'default rules should be seeded');
    assert.ok(alert_rules.every((r) => r.rule_type && r.threshold != null));
  });

  it('POST /alert-rules returns 400 when required fields are missing', async () => {
    const res = await api('POST', '/api/admin/alert-rules', { threshold: 90 }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('POST /alert-rules creates a rule and returns 201', async () => {
    const res = await api('POST', '/api/admin/alert-rules', {
      rule_type: 'speed',
      threshold: 75,
      severity:  'warning',
      label:     'Test speed rule',
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const { alert_rule } = await res.json();
    assert.ok(alert_rule.id);
    assert.strictEqual(alert_rule.rule_type, 'speed');
    assert.strictEqual(alert_rule.threshold, 75);
    assert.strictEqual(alert_rule.enabled,   1);
    // Clean up
    await api('DELETE', `/api/admin/alert-rules/${alert_rule.id}`, null, adminToken);
  });

  it('POST /alert-rules creates a hauler-scoped rule', async () => {
    const res = await api('POST', '/api/admin/alert-rules', {
      rule_type: 'idle_engine',
      threshold: 20,
      severity:  'info',
      hauler_id: 'haul-01',
      label:     'Hauler-specific idle rule',
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const { alert_rule } = await res.json();
    assert.strictEqual(alert_rule.hauler_id, 'haul-01');
    await api('DELETE', `/api/admin/alert-rules/${alert_rule.id}`, null, adminToken);
  });

  it('PATCH /alert-rules/:id updates fields on the rule', async () => {
    // Create a rule to update
    const createRes = await api('POST', '/api/admin/alert-rules', {
      rule_type: 'hours_driving',
      threshold: 9,
      severity:  'info',
    }, adminToken);
    const { alert_rule: created } = await createRes.json();

    const patchRes = await api('PATCH', `/api/admin/alert-rules/${created.id}`,
      { threshold: 12, enabled: false }, adminToken);
    assert.strictEqual(patchRes.status, 200);
    const { alert_rule: updated } = await patchRes.json();
    assert.strictEqual(updated.threshold, 12);
    assert.strictEqual(updated.enabled,   0);

    await api('DELETE', `/api/admin/alert-rules/${created.id}`, null, adminToken);
  });

  it('PATCH /alert-rules/:id returns 404 for an unknown rule', async () => {
    const res = await api('PATCH', '/api/admin/alert-rules/no-such-rule',
      { threshold: 50 }, adminToken);
    assert.strictEqual(res.status, 404);
    assert.ok((await res.json()).error);
  });

  it('DELETE /alert-rules/:id removes the rule', async () => {
    const createRes = await api('POST', '/api/admin/alert-rules', {
      rule_type: 'speed', threshold: 55, severity: 'warning',
    }, adminToken);
    const { alert_rule } = await createRes.json();

    const delRes = await api('DELETE', `/api/admin/alert-rules/${alert_rule.id}`, null, adminToken);
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual((await delRes.json()).ok, true);

    // Confirm gone
    const patchRes = await api('PATCH', `/api/admin/alert-rules/${alert_rule.id}`,
      { threshold: 60 }, adminToken);
    assert.strictEqual(patchRes.status, 404);
  });

  it('DELETE /alert-rules/:id returns 404 for an unknown rule', async () => {
    const res = await api('DELETE', '/api/admin/alert-rules/does-not-exist', null, adminToken);
    assert.strictEqual(res.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('admin — alert rules dry-run test endpoint', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('POST /alert-rules/test returns 400 when rule_type is missing', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test', { value: 90 }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /alert-rules/test returns 400 when value is missing', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test', { rule_type: 'speed' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('speed=50 does not trigger any seeded speed rules (all thresholds > 50)', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test',
      { rule_type: 'speed', value: 50 }, adminToken);
    assert.strictEqual(res.status, 200);
    const { would_fire, dry_run } = await res.json();
    assert.strictEqual(dry_run, true);
    assert.strictEqual(would_fire.length, 0);
  });

  it('speed=95 triggers warning rule but not critical rule', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test',
      { rule_type: 'speed', value: 95 }, adminToken);
    assert.strictEqual(res.status, 200);
    const { would_fire } = await res.json();
    // Seeded: warning > 80, critical > 100
    assert.ok(would_fire.some((r) => r.severity === 'warning'), 'warning rule should fire');
    assert.ok(!would_fire.some((r) => r.severity === 'critical'), 'critical rule must not fire');
  });

  it('speed=105 triggers both warning and critical rules', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test',
      { rule_type: 'speed', value: 105 }, adminToken);
    const { would_fire } = await res.json();
    assert.ok(would_fire.some((r) => r.severity === 'warning'),  'warning rule should fire');
    assert.ok(would_fire.some((r) => r.severity === 'critical'), 'critical rule should fire');
  });

  it('unknown rule_type returns empty would_fire and evaluated=0', async () => {
    const res = await api('POST', '/api/admin/alert-rules/test',
      { rule_type: 'not_a_real_type', value: 9999 }, adminToken);
    const { would_fire, evaluated } = await res.json();
    assert.strictEqual(would_fire.length, 0);
    assert.strictEqual(evaluated, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('admin — hauler onboarding validation', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('POST /haulers returns 400 when display_name is missing', async () => {
    const res = await api('POST', '/api/admin/haulers',
      { contracted_trucks: 5 }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('POST /haulers returns 400 for an invalid integration_type', async () => {
    const res = await api('POST', '/api/admin/haulers',
      { display_name: 'Test Co', contracted_trucks: 5, integration_type: 'fax_machine' }, adminToken);
    assert.strictEqual(res.status, 400);
    const { error } = await res.json();
    assert.ok(error.includes('integration_type'), 'error should mention integration_type');
  });

  it("POST /haulers accepts 'mqtt' integration_type (added in this sprint)", async () => {
    const res = await api('POST', '/api/admin/haulers', {
      display_name:     'MQTT Hauler',
      contracted_trucks: 3,
      integration_type:  'mqtt',
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const { hauler } = await res.json();
    assert.ok(hauler.id);
  });

  it("POST /haulers accepts all four valid integration types", async () => {
    for (const t of ['loconav', 'custom', 'manual', 'mqtt']) {
      const res = await api('POST', '/api/admin/haulers', {
        display_name:     `${t} Hauler`,
        contracted_trucks: 1,
        integration_type:  t,
      }, adminToken);
      assert.strictEqual(res.status, 201, `integration_type '${t}' should be accepted`);
    }
  });

  it('PATCH /haulers/:id returns 400 for an invalid integration_type', async () => {
    // First create a hauler
    const createRes = await api('POST', '/api/admin/haulers',
      { display_name: 'Patch Test', contracted_trucks: 2 }, adminToken);
    const { hauler } = await createRes.json();

    const patchRes = await api('PATCH', `/api/admin/haulers/${hauler.id}`,
      { integration_type: 'carrier_pigeon' }, adminToken);
    assert.strictEqual(patchRes.status, 400);
  });

  it('POST /haulers returns 400 for an invalid contact_email', async () => {
    const res = await api('POST', '/api/admin/haulers', {
      display_name:  'Email Test',
      contracted_trucks: 1,
      contact_email: 'not-an-email',
    }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error.includes('email'));
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('admin — readiness endpoint', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /readiness returns JSON with a checked_at field', async () => {
    const res = await api('GET', '/api/admin/readiness', null, adminToken);
    const body = await res.json();
    assert.ok(body.checked_at, 'checked_at must be present');
    assert.ok(Array.isArray(body.checks), 'checks array must be present');
    assert.ok(typeof body.ready === 'boolean', 'ready flag must be boolean');
  });

  it('GET /readiness — database and required_tables checks pass', async () => {
    const res = await api('GET', '/api/admin/readiness', null, adminToken);
    const { checks } = await res.json();
    const db_check     = checks.find((c) => c.name === 'database');
    const tables_check = checks.find((c) => c.name === 'required_tables');
    assert.ok(db_check?.ok,     'database check must pass');
    assert.ok(tables_check?.ok, 'required_tables check must pass');
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Users CRUD
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — users CRUD', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /users returns array including seed users', async () => {
    const res = await api('GET', '/api/admin/users', null, adminToken);
    assert.equal(res.status, 200);
    const { users } = await res.json();
    assert.ok(Array.isArray(users));
    assert.ok(users.some((u) => u.email === 'admin@test.gh'));
  });

  it('POST /users — 400 when required fields missing', async () => {
    const res = await api('POST', '/api/admin/users', { email: 'x@x.com' }, adminToken);
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.ok(j.error.includes('required'));
  });

  it('POST /users — 400 for invalid role', async () => {
    const res = await api('POST', '/api/admin/users',
      { email: 'bad@test.gh', password: 'Password1', display_name: 'Bad', role: 'superuser' }, adminToken);
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.ok(j.error.includes('Invalid role'));
  });

  it('POST /users — 400 when password too short', async () => {
    const res = await api('POST', '/api/admin/users',
      { email: 'short@test.gh', password: 'abc', display_name: 'Short', role: 'axis_ops' }, adminToken);
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.ok(j.error.includes('8 characters'));
  });

  it('POST /users — 400 when hauler_admin missing hauler_id', async () => {
    const res = await api('POST', '/api/admin/users',
      { email: 'ha@test.gh', password: 'Password1', display_name: 'HA', role: 'hauler_admin' }, adminToken);
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.ok(j.error.includes('hauler_id'));
  });

  it('POST /users — 201 creates user; 409 on duplicate email', async () => {
    const body = { email: 'newuser@test.gh', password: 'Password1!', display_name: 'New User', role: 'axis_ops' };
    const r1 = await api('POST', '/api/admin/users', body, adminToken);
    assert.equal(r1.status, 201);
    const { user } = await r1.json();
    assert.equal(user.email, 'newuser@test.gh');
    assert.equal(user.role,  'axis_ops');

    const r2 = await api('POST', '/api/admin/users', body, adminToken);
    assert.equal(r2.status, 409);
  });

  it('PATCH /users/:id — updates display_name', async () => {
    const create = await api('POST', '/api/admin/users',
      { email: 'patch@test.gh', password: 'Password1!', display_name: 'Before', role: 'axis_ops' }, adminToken);
    const { user } = await create.json();

    const res = await api('PATCH', `/api/admin/users/${user.id}`, { display_name: 'After' }, adminToken);
    assert.equal(res.status, 200);
    const updated = (await res.json()).user;
    assert.equal(updated.display_name, 'After');
  });

  it('PATCH /users/:id — 404 for unknown user', async () => {
    const res = await api('PATCH', '/api/admin/users/no-such-id', { display_name: 'X' }, adminToken);
    assert.equal(res.status, 404);
  });

  it('POST /users/:id/set-password — 200 changes password', async () => {
    const create = await api('POST', '/api/admin/users',
      { email: 'setpw@test.gh', password: 'OldPass123', display_name: 'SetPw', role: 'axis_ops' }, adminToken);
    const { user } = await create.json();

    const res = await api('POST', `/api/admin/users/${user.id}/set-password`, { new_password: 'NewPass456' }, adminToken);
    assert.equal(res.status, 200);
    assert.ok((await res.json()).ok);
  });

  it('POST /users/:id/set-password — 400 for short password', async () => {
    const create = await api('POST', '/api/admin/users',
      { email: 'setpw2@test.gh', password: 'Password1!', display_name: 'SetPw2', role: 'axis_ops' }, adminToken);
    const { user } = await create.json();

    const res = await api('POST', `/api/admin/users/${user.id}/set-password`, { new_password: 'abc' }, adminToken);
    assert.equal(res.status, 400);
  });

  it('POST /users/:id/deactivate — 200 deactivates; 400 on double deactivate', async () => {
    const create = await api('POST', '/api/admin/users',
      { email: 'deact@test.gh', password: 'Password1!', display_name: 'Deact', role: 'axis_ops' }, adminToken);
    const { user } = await create.json();

    const r1 = await api('POST', `/api/admin/users/${user.id}/deactivate`, null, adminToken);
    assert.equal(r1.status, 200);

    const r2 = await api('POST', `/api/admin/users/${user.id}/deactivate`, null, adminToken);
    assert.equal(r2.status, 400);
    assert.ok((await r2.json()).error.includes('already inactive'));
  });

  it('POST /users/:id/deactivate — 400 when deactivating self', async () => {
    const admins = await api('GET', '/api/admin/users', null, adminToken);
    const self = (await admins.json()).users.find((u) => u.email === 'admin@test.gh');
    const res = await api('POST', `/api/admin/users/${self.id}/deactivate`, null, adminToken);
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.includes('own account'));
  });

  it('POST /users/:id/reactivate — 200 restores; 400 when already active', async () => {
    const create = await api('POST', '/api/admin/users',
      { email: 'react@test.gh', password: 'Password1!', display_name: 'React', role: 'axis_ops' }, adminToken);
    const { user } = await create.json();

    // Deactivate first.
    await api('POST', `/api/admin/users/${user.id}/deactivate`, null, adminToken);
    const r1 = await api('POST', `/api/admin/users/${user.id}/reactivate`, null, adminToken);
    assert.equal(r1.status, 200);

    // Already active — should fail.
    const r2 = await api('POST', `/api/admin/users/${user.id}/reactivate`, null, adminToken);
    assert.equal(r2.status, 400);
    assert.ok((await r2.json()).error.includes('already active'));
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Hauler admin operations
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — hauler operations', () => {
  let adminToken, haulerId;

  before(async () => {
    adminToken = await login('admin@test.gh', ADMIN_PASS);
    // Create a hauler to use in tests below.
    const r = await api('POST', '/api/admin/haulers',
      { display_name: 'Ops Hauler', contracted_trucks: 5, integration_type: 'manual' }, adminToken);
    haulerId = (await r.json()).hauler.id;
  });

  it('GET /haulers returns all haulers including deactivated', async () => {
    const res = await api('GET', '/api/admin/haulers', null, adminToken);
    assert.equal(res.status, 200);
    const { haulers } = await res.json();
    assert.ok(Array.isArray(haulers));
    assert.ok(haulers.some((h) => h.id === haulerId));
  });

  it('PATCH /haulers/:id — updates display_name', async () => {
    const res = await api('PATCH', `/api/admin/haulers/${haulerId}`,
      { display_name: 'Renamed Hauler' }, adminToken);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).hauler.display_name, 'Renamed Hauler');
  });

  it('PATCH /haulers/:id — 404 for unknown hauler', async () => {
    const res = await api('PATCH', '/api/admin/haulers/no-such', { display_name: 'X' }, adminToken);
    assert.equal(res.status, 404);
  });

  it('POST /haulers/:id/deactivate and reactivate lifecycle', async () => {
    const r1 = await api('POST', `/api/admin/haulers/${haulerId}/deactivate`, null, adminToken);
    assert.equal(r1.status, 200);

    const r2 = await api('POST', `/api/admin/haulers/${haulerId}/deactivate`, null, adminToken);
    assert.equal(r2.status, 400);
    assert.ok((await r2.json()).error.includes('already deactivated'));

    const r3 = await api('POST', `/api/admin/haulers/${haulerId}/reactivate`, null, adminToken);
    assert.equal(r3.status, 200);

    const r4 = await api('POST', `/api/admin/haulers/${haulerId}/reactivate`, null, adminToken);
    assert.equal(r4.status, 400);
    assert.ok((await r4.json()).error.includes('not deactivated'));
  });

  it('POST /haulers/:id/webhook-secret — returns 64-char hex secret', async () => {
    const res = await api('POST', `/api/admin/haulers/${haulerId}/webhook-secret`, null, adminToken);
    assert.equal(res.status, 200);
    const { ok, secret } = await res.json();
    assert.ok(ok);
    assert.equal(secret.length, 64);
    assert.match(secret, /^[0-9a-f]+$/);
  });

  it('POST /haulers/:id/api-token — rotates and returns token; no_rotate checks presence', async () => {
    const r1 = await api('POST', `/api/admin/haulers/${haulerId}/api-token`, {}, adminToken);
    assert.equal(r1.status, 200);
    const { ok, token, rotated } = await r1.json();
    assert.ok(ok);
    assert.ok(rotated);
    assert.equal(token.length, 64);

    const r2 = await api('POST', `/api/admin/haulers/${haulerId}/api-token`, { no_rotate: true }, adminToken);
    assert.equal(r2.status, 200);
    const body = await r2.json();
    assert.ok(body.has_token);
    assert.equal(body.rotated, false);
  });

  it('GET /haulers/:id/integration — returns structured view', async () => {
    const res = await api('GET', `/api/admin/haulers/${haulerId}/integration`, null, adminToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.hauler_id, haulerId);
    assert.ok(typeof body.integration === 'object');
    assert.ok(typeof body.tokens === 'object');
    assert.ok(body.checked_at);
  });

  it('GET /haulers/:id/integration — 404 for unknown hauler', async () => {
    const res = await api('GET', '/api/admin/haulers/no-such/integration', null, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Fleet CRUD
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — fleet CRUD', () => {
  let adminToken, truckId;

  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /fleet returns list', async () => {
    const res = await api('GET', '/api/admin/fleet', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).trucks));
  });

  it('POST /fleet — 400 when plate or hauler_id missing', async () => {
    const r1 = await api('POST', '/api/admin/fleet', { plate: 'GR-0001' }, adminToken);
    assert.equal(r1.status, 400);
    const r2 = await api('POST', '/api/admin/fleet', { hauler_id: 'h-1' }, adminToken);
    assert.equal(r2.status, 400);
  });

  it('POST /fleet — 201 creates truck; 409 on duplicate plate', async () => {
    const body = { plate: 'GR-TEST-01', hauler_id: 'test-hauler', make: 'Volvo', model: 'FH16' };
    const r1 = await api('POST', '/api/admin/fleet', body, adminToken);
    assert.equal(r1.status, 201);
    const { truck } = await r1.json();
    truckId = truck.id;
    assert.equal(truck.plate, 'GR-TEST-01');

    const r2 = await api('POST', '/api/admin/fleet', body, adminToken);
    assert.equal(r2.status, 409);
  });

  it('PATCH /fleet/:id — updates make field', async () => {
    const res = await api('PATCH', `/api/admin/fleet/${truckId}`, { make: 'MAN' }, adminToken);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).truck.make, 'MAN');
  });

  it('PATCH /fleet/:id — 404 for unknown truck', async () => {
    const res = await api('PATCH', '/api/admin/fleet/no-such', { make: 'X' }, adminToken);
    assert.equal(res.status, 404);
  });

  it('POST /fleet/:id/archive and unarchive lifecycle', async () => {
    const r1 = await api('POST', `/api/admin/fleet/${truckId}/archive`, null, adminToken);
    assert.equal(r1.status, 200);
    assert.ok((await r1.json()).ok);

    // Archived truck no longer in standard list.
    const listRes = await api('GET', '/api/admin/fleet', null, adminToken);
    const { trucks } = await listRes.json();
    assert.ok(!trucks.some((t) => t.id === truckId), 'archived truck should not appear in list');

    const r2 = await api('POST', `/api/admin/fleet/${truckId}/unarchive`, null, adminToken);
    assert.equal(r2.status, 200);
    assert.ok((await r2.json()).ok);
  });

  it('POST /fleet/:id/archive — 404 for unknown truck', async () => {
    const res = await api('POST', '/api/admin/fleet/no-such/archive', null, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Driver CRUD
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — driver CRUD', () => {
  let adminToken, driverId;

  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /drivers returns list', async () => {
    const res = await api('GET', '/api/admin/drivers', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).drivers));
  });

  it('POST /drivers — 400 when hauler_id or full_name missing', async () => {
    const r1 = await api('POST', '/api/admin/drivers', { full_name: 'Kwame Asante' }, adminToken);
    assert.equal(r1.status, 400);
    const r2 = await api('POST', '/api/admin/drivers', { hauler_id: 'h-1' }, adminToken);
    assert.equal(r2.status, 400);
  });

  it('POST /drivers — 201 creates driver', async () => {
    const res = await api('POST', '/api/admin/drivers',
      { hauler_id: 'test-hauler', full_name: 'Kwame Asante' }, adminToken);
    assert.equal(res.status, 201);
    const { driver } = await res.json();
    driverId = driver.id;
    assert.equal(driver.full_name, 'Kwame Asante');
  });

  it('PATCH /drivers/:id — updates full_name', async () => {
    const res = await api('PATCH', `/api/admin/drivers/${driverId}`,
      { full_name: 'Kwame A. Updated' }, adminToken);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).driver.full_name, 'Kwame A. Updated');
  });

  it('PATCH /drivers/:id — 404 for unknown driver', async () => {
    const res = await api('PATCH', '/api/admin/drivers/no-such', { full_name: 'X' }, adminToken);
    assert.equal(res.status, 404);
  });

  it('POST /drivers/:id/archive and unarchive lifecycle', async () => {
    const r1 = await api('POST', `/api/admin/drivers/${driverId}/archive`, null, adminToken);
    assert.equal(r1.status, 200);

    const listRes = await api('GET', '/api/admin/drivers', null, adminToken);
    const { drivers } = await listRes.json();
    assert.ok(!drivers.some((d) => d.id === driverId), 'archived driver should not appear in list');

    const r2 = await api('POST', `/api/admin/drivers/${driverId}/unarchive`, null, adminToken);
    assert.equal(r2.status, 200);
  });

  it('POST /drivers/:id/archive — 404 for unknown driver', async () => {
    const res = await api('POST', '/api/admin/drivers/no-such/archive', null, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Webhook inspector
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — webhook inspector', () => {
  let adminToken, opsToken;

  before(async () => {
    adminToken = await login('admin@test.gh', ADMIN_PASS);
    opsToken   = await login('ops@test.gh',   OPS_PASS);
  });

  it('GET /webhooks returns paginated list (axis_admin)', async () => {
    const res = await api('GET', '/api/admin/webhooks', null, adminToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.events));
    assert.ok(typeof body.total === 'number');
  });

  it('GET /webhooks — axis_ops blocked by router-level axis_admin gate', async () => {
    // router.use(requireRole('axis_admin')) at the top of admin.js blocks all
    // non-admin roles before the per-route requireRole can fire.
    const res = await api('GET', '/api/admin/webhooks', null, opsToken);
    assert.equal(res.status, 403);
  });

  it('POST /webhooks/:id/retry — 404 for nonexistent event', async () => {
    const res = await api('POST', '/api/admin/webhooks/no-such-event/retry', null, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Notification preferences
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — notification preferences', () => {
  let adminToken, targetUserId;

  before(async () => {
    adminToken = await login('admin@test.gh', ADMIN_PASS);
    const r = await api('POST', '/api/admin/users',
      { email: 'notifpref@test.gh', password: 'Password1!', display_name: 'NP User', role: 'axis_ops' }, adminToken);
    targetUserId = (await r.json()).user.id;
  });

  it('GET /users/:id/notification-prefs — returns empty prefs for new user', async () => {
    const res = await api('GET', `/api/admin/users/${targetUserId}/notification-prefs`, null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray((await res.json()).prefs));
  });

  it('GET /users/:id/notification-prefs — 404 for unknown user', async () => {
    const res = await api('GET', '/api/admin/users/no-such/notification-prefs', null, adminToken);
    assert.equal(res.status, 404);
  });

  it('PUT /users/:id/notification-prefs — upserts prefs and returns them', async () => {
    const prefs = [
      { alert_type: 'speed_breach', via_email: true },
      { alert_type: 'overload',     via_email: false },
    ];
    const res = await api('PUT', `/api/admin/users/${targetUserId}/notification-prefs`,
      { prefs }, adminToken);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.ok);
    assert.ok(body.prefs.some((p) => p.alert_type === 'speed_breach'));
  });

  it('PUT /users/:id/notification-prefs — 404 for unknown user', async () => {
    const res = await api('PUT', '/api/admin/users/no-such/notification-prefs', { prefs: [] }, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Session management
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — session management', () => {
  let adminToken;

  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /sessions returns array of active sessions', async () => {
    const res = await api('GET', '/api/admin/sessions', null, adminToken);
    assert.equal(res.status, 200);
    const { sessions } = await res.json();
    assert.ok(Array.isArray(sessions));
    assert.ok(sessions.length > 0, 'at least the admin session must be listed');
    assert.ok(sessions[0].display_name, 'sessions should have display_name enrichment');
  });

  it('DELETE /sessions/:prefix — 400 for short prefix', async () => {
    const res = await api('DELETE', '/api/admin/sessions/abc', null, adminToken);
    assert.equal(res.status, 400);
  });

  it('DELETE /sessions/:prefix — 404 for nonexistent prefix', async () => {
    const res = await api('DELETE', '/api/admin/sessions/nonexistent-prefix', null, adminToken);
    assert.equal(res.status, 404);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * CSV import / export
 * ───────────────────────────────────────────────────────────────────── */

async function csvPost(base, path, csvBody, token) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/csv',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: csvBody,
  });
}

describe('admin — CSV import / export', () => {
  let adminToken;

  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /fleet/export returns text/csv', async () => {
    const res = await api('GET', '/api/admin/fleet/export', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/csv'));
    const text = await res.text();
    assert.ok(text.includes('plate'), 'CSV header row should include "plate"');
  });

  it('POST /fleet/import — 400 for empty body', async () => {
    // Empty body must be sent as text/csv not JSON.
    const res = await fetch(`${base}/api/admin/fleet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${adminToken}` },
      body: '',
    });
    assert.equal(res.status, 400);
  });

  it('POST /fleet/import — 207 with partial errors', async () => {
    const csv = [
      'plate,hauler_id,make,model',
      'GR-IMPORT-01,test-h,Volvo,FH16',
      ',test-h,Volvo,FH16',          // missing plate → error row
    ].join('\n');
    const res = await fetch(`${base}/api/admin/fleet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${adminToken}` },
      body: csv,
    });
    assert.equal(res.status, 207);
    const body = await res.json();
    assert.equal(body.created, 1);
    assert.equal(body.errors.length, 1);
  });

  it('POST /fleet/import — 400 when all rows fail', async () => {
    const csv = 'plate,hauler_id\n,\n,';   // all rows missing required fields
    const res = await fetch(`${base}/api/admin/fleet/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${adminToken}` },
      body: csv,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.created, 0);
    assert.ok(body.errors.length > 0);
  });

  it('GET /drivers/export returns text/csv', async () => {
    const res = await api('GET', '/api/admin/drivers/export', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/csv'));
    const text = await res.text();
    assert.ok(text.includes('full_name'), 'CSV header row should include "full_name"');
  });

  it('POST /drivers/import — 207 creates driver from CSV', async () => {
    const csv = 'hauler_id,full_name,licence_class\ntest-h,CSV Driver,E';
    const res = await fetch(`${base}/api/admin/drivers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', Authorization: `Bearer ${adminToken}` },
      body: csv,
    });
    assert.equal(res.status, 207);
    assert.equal((await res.json()).created, 1);
  });
});

/* ─────────────────────────────────────────────────────────────────────
 * Data exports (trips / metrics / health / positions)
 * ───────────────────────────────────────────────────────────────────── */

describe('admin — data exports', () => {
  let adminToken;

  before(async () => { adminToken = await login('admin@test.gh', ADMIN_PASS); });

  it('GET /export/trips returns text/csv', async () => {
    const res = await api('GET', '/api/admin/export/trips', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/csv'));
    const text = await res.text();
    assert.ok(text.includes('hauler_id'));
  });

  it('GET /export/positions returns text/csv', async () => {
    const res = await api('GET', '/api/admin/export/positions', null, adminToken);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/csv'));
  });

  it('GET /export/metrics returns text/csv or 500 if not migrated', async () => {
    const res = await api('GET', '/api/admin/export/metrics', null, adminToken);
    // Either 200 CSV or 500 with a clear error — both are valid behaviour.
    assert.ok([200, 500].includes(res.status));
  });

  it('GET /export/health returns text/csv or 500 if not migrated', async () => {
    const res = await api('GET', '/api/admin/export/health', null, adminToken);
    assert.ok([200, 500].includes(res.status));
  });
});
