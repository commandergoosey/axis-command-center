'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-coaching';
process.env.NODE_ENV   = 'test';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// ── Seed users ────────────────────────────────────────────────────────────────
const NOW  = new Date().toISOString();
const PASS = 'Test1234!';

const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm', 'admin@cch.test',   bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@cch.test',     bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@cch.test',     bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-h02', 'h02@cch.test',     bcrypt.hashSync(PASS, 1), 'H02',    'hauler_admin', 'haul-02', 'H02',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',     require('../routes/auth'));
app.use('/api/coaching', require('../routes/coaching'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, h01Tok, h02Tok;

before(async () => {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  const login = async (email) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASS }),
    });
    return (await r.json()).token;
  };
  adminTok = await login('admin@cch.test');
  opsTok   = await login('ops@cch.test');
  h01Tok   = await login('h01@cch.test');
  h02Tok   = await login('h02@cch.test');
});

after(() => new Promise((resolve) => server.close(resolve)));

async function api(method, path, body, token) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/coaching/pipeline', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/coaching/pipeline')).status, 401);
  });

  it('200 for axis_admin with required top-level keys', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    assert.equal(r.status, 200);
    for (const k of ['pipeline', 'recent_sessions', 'counts', 'effectiveness_summary',
                      'session_trend', 'backlog_by_hauler', 'topic_breakdown']) {
      assert.ok(k in r.body, `Missing key: ${k}`);
    }
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/coaching/pipeline', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin — pipeline is scoped to their hauler', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, h01Tok);
    assert.equal(r.status, 200);
    for (const row of r.body.pipeline) {
      assert.equal(row.hauler_id, 'haul-01', 'hauler_admin should only see their own hauler');
    }
  });

  it('session_trend has 8 entries (7 prior + current)', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    assert.equal(r.body.session_trend.length, 8);
  });

  it('session_trend current week has is_current=true', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    const current = r.body.session_trend.find((w) => w.is_current === true);
    assert.ok(current, 'no current week entry found');
  });

  it('counts has total, flagged, overdue keys', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    const c = r.body.counts;
    assert.ok('total' in c);
    assert.ok('flagged' in c);
    assert.ok('overdue' in c);
  });

  it('backlog_by_hauler is an array', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    assert.ok(Array.isArray(r.body.backlog_by_hauler));
  });

  it('topic_breakdown entries have key, label, count, modelled', async () => {
    const r = await api('GET', '/api/coaching/pipeline', null, adminTok);
    for (const t of r.body.topic_breakdown) {
      assert.ok(t.key, 'missing key');
      assert.ok(t.label, 'missing label');
      assert.ok(typeof t.count === 'number');
      assert.equal(t.modelled, true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/coaching/sessions', () => {
  it('200 without token (open endpoint)', async () => {
    const r = await api('GET', '/api/coaching/sessions');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.sessions));
    assert.ok(typeof r.body.generated_at === 'string');
  });

  it('200 for axis_admin — returns all sessions', async () => {
    const r = await api('GET', '/api/coaching/sessions', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.sessions));
  });

  it('sessions include attendee_drivers array', async () => {
    // First create a session so the list is non-trivial
    await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01', topic: 'HOS compliance check', attendees_count: 3,
    }, adminTok);
    const r = await api('GET', '/api/coaching/sessions', null, adminTok);
    for (const s of r.body.sessions) {
      assert.ok(Array.isArray(s.attendee_drivers), `session ${s.id} missing attendee_drivers`);
    }
  });

  it('hauler_admin only sees sessions for their own hauler', async () => {
    // Create a session for haul-02 too
    await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-02', topic: 'Vehicle inspection review',
    }, adminTok);

    const r = await api('GET', '/api/coaching/sessions', null, h01Tok);
    assert.equal(r.status, 200);
    for (const s of r.body.sessions) {
      assert.equal(s.hauler_id, 'haul-01', 'haul-01 admin should only see haul-01 sessions');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/coaching/sessions/:id', () => {
  let sessionId;

  before(async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01', topic: 'Pre-departure safety check',
      dispatcher_name: 'Kwame Mensah', attendees_count: 5,
    }, adminTok);
    sessionId = r.body.id;
  });

  it('404 for unknown id', async () => {
    assert.equal((await api('GET', '/api/coaching/sessions/cs-notexist')).status, 404);
  });

  it('200 — returns session for unauthenticated caller', async () => {
    const r = await api('GET', `/api/coaching/sessions/${sessionId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, sessionId);
    assert.equal(r.body.hauler_id, 'haul-01');
  });

  it('200 — axis_admin can access any session', async () => {
    assert.equal((await api('GET', `/api/coaching/sessions/${sessionId}`, null, adminTok)).status, 200);
  });

  it('200 — haul-01 admin can access their own session', async () => {
    assert.equal((await api('GET', `/api/coaching/sessions/${sessionId}`, null, h01Tok)).status, 200);
  });

  it('403 — haul-02 admin cannot access haul-01 session', async () => {
    assert.equal((await api('GET', `/api/coaching/sessions/${sessionId}`, null, h02Tok)).status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/coaching/sessions', () => {
  it('401 without token', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01', topic: 'Safety briefing',
    });
    assert.equal(r.status, 401);
  });

  it('400 — missing hauler_id', async () => {
    const r = await api('POST', '/api/coaching/sessions', { topic: 'Safety' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('hauler_id'));
  });

  it('404 — unknown hauler_id', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-99', topic: 'Safety',
    }, adminTok);
    assert.equal(r.status, 404);
  });

  it('400 — missing topic', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('topic'));
  });

  it('403 — hauler_admin cannot log session for different hauler', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-02', topic: 'Forbidden session',
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('201 — axis_admin creates session with full fields', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id:          'haul-01',
      topic:              'Axle load pre-departure checklist',
      dispatcher_name:    'Kwame Mensah',
      attendees_count:    4,
      expected_delta_pct: 12,
      notes:              'All axle limits reviewed.',
      linked_alert_ids:   [],
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.id.startsWith('cs-'));
    assert.equal(r.body.hauler_id, 'haul-01');
    assert.equal(r.body.topic, 'Axle load pre-departure checklist');
    assert.ok(Array.isArray(r.body.auto_closed_alerts));
    assert.equal(r.body.attendees_count, 4);
    assert.equal(r.body.expected_delta_pct, 12);
  });

  it('201 — axis_ops creates session', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-02', topic: 'Fuel efficiency brief',
    }, opsTok);
    assert.equal(r.status, 201);
    assert.equal(r.body.hauler_id, 'haul-02');
  });

  it('201 — hauler_admin creates session for own hauler', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01', topic: 'Driver HOS check',
      attendee_driver_ids: [],
    }, h01Tok);
    assert.equal(r.status, 201);
    assert.equal(r.body.hauler_id, 'haul-01');
  });

  it('auto_closed_alerts is empty when linked IDs do not exist', async () => {
    const r = await api('POST', '/api/coaching/sessions', {
      hauler_id:        'haul-03',
      topic:            'Route adherence review',
      linked_alert_ids: ['alert-nonexistent-001', 'alert-nonexistent-002'],
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(Array.isArray(r.body.auto_closed_alerts));
  });

  it('session appears in GET /sessions list after creation', async () => {
    const createR = await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-04', topic: 'Verify session appears in list',
    }, adminTok);
    const newId = createR.body.id;

    const listR = await api('GET', '/api/coaching/sessions', null, adminTok);
    const found = listR.body.sessions.find((s) => s.id === newId);
    assert.ok(found, 'newly created session should appear in list');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/coaching/haulers/:haulerId/recent', () => {
  before(async () => {
    // Ensure haul-01 has at least one recent session
    await api('POST', '/api/coaching/sessions', {
      hauler_id: 'haul-01', topic: 'Recent session for hauler endpoint',
    }, adminTok);
  });

  it('200 — open endpoint, no auth required', async () => {
    const r = await api('GET', '/api/coaching/haulers/haul-01/recent');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.sessions));
    assert.ok(typeof r.body.days === 'number');
    assert.ok(typeof r.body.generated_at === 'string');
  });

  it('200 — axis_admin can access any hauler', async () => {
    assert.equal(
      (await api('GET', '/api/coaching/haulers/haul-02/recent', null, adminTok)).status, 200,
    );
  });

  it('200 — hauler_admin can access their own hauler', async () => {
    assert.equal(
      (await api('GET', '/api/coaching/haulers/haul-01/recent', null, h01Tok)).status, 200,
    );
  });

  it('403 — hauler_admin cannot access a different hauler', async () => {
    assert.equal(
      (await api('GET', '/api/coaching/haulers/haul-02/recent', null, h01Tok)).status, 403,
    );
  });

  it('default days is 30', async () => {
    const r = await api('GET', '/api/coaching/haulers/haul-01/recent', null, adminTok);
    assert.equal(r.body.days, 30);
  });

  it('accepts ?days= query param', async () => {
    const r = await api('GET', '/api/coaching/haulers/haul-01/recent?days=7', null, adminTok);
    assert.equal(r.body.days, 7);
  });

  it('sessions in response are within the requested day window', async () => {
    // With days=1 only today's sessions should appear
    const r = await api('GET', '/api/coaching/haulers/haul-01/recent?days=1', null, adminTok);
    const cutoff = Date.now() - 1 * 24 * 60 * 60 * 1000;
    for (const s of r.body.sessions) {
      assert.ok(new Date(s.held_at).getTime() >= cutoff,
        `session ${s.id} held_at outside 1-day window`);
    }
  });
});
