'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-today';
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
insertUser.run('u-adm', 'admin@today.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@today.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@today.test',    bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'lender@today.test', bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

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
app.use('/api/auth',  require('../routes/auth'));
app.use('/api/today', require('../routes/today'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok, lenderTok;
let firstActionItemId = null; // populated in before()

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
  adminTok  = await login('admin@today.test');
  opsTok    = await login('ops@today.test');
  haulerTok = await login('h01@today.test');
  lenderTok = await login('lender@today.test');

  // Discover the first live action item ID for later assignment tests.
  const r = await fetch(`${base}/api/today`, {
    headers: { Authorization: `Bearer ${adminTok}` },
  });
  const body = await r.json();
  firstActionItemId = body.action_items?.[0]?.id ?? null;
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
// GET /api/today (corridor briefing — open)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today', () => {
  it('200 — open endpoint, no auth required', async () => {
    assert.equal((await api('GET', '/api/today')).status, 200);
  });

  it('has all top-level keys', async () => {
    const r = await api('GET', '/api/today');
    for (const k of [
      'generated_at', 'dominant_story', 'forecast', 'convoy_cycle',
      'hauler_contribution', 'brief_strip', 'observations', 'action_items',
      'hauler_status',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('brief_strip has 4 entries with expected keys', async () => {
    const { brief_strip } = (await api('GET', '/api/today')).body;
    assert.equal(brief_strip.length, 4);
    const keys = ['tor_cushion', 'axle_breaches', 'alerts_critical', 'receivables_aged'];
    for (const k of keys) {
      assert.ok(brief_strip.some((s) => s.key === k), `missing strip key: ${k}`);
    }
  });

  it('convoy_cycle has 7 entries with date, cycle_hours, trips_laden, trips_empty', async () => {
    const { convoy_cycle } = (await api('GET', '/api/today')).body;
    assert.equal(convoy_cycle.length, 7);
    for (const d of convoy_cycle) {
      assert.ok(typeof d.date === 'string');
      assert.ok(typeof d.cycle_hours === 'number');
      assert.ok(typeof d.trips_laden === 'number');
      assert.ok(typeof d.trips_empty === 'number');
    }
  });

  it('observations is an array (max 6)', async () => {
    const { observations } = (await api('GET', '/api/today')).body;
    assert.ok(Array.isArray(observations));
    assert.ok(observations.length <= 6);
    for (const o of observations) {
      assert.ok(typeof o.id === 'string');
      assert.ok(['warn', 'info'].includes(o.severity));
      assert.ok(typeof o.body === 'string');
    }
  });

  it('action_items is an array (max 5)', async () => {
    const { action_items } = (await api('GET', '/api/today')).body;
    assert.ok(Array.isArray(action_items));
    assert.ok(action_items.length <= 5);
  });

  it('action_items have id, priority, body, link, source', async () => {
    const { action_items } = (await api('GET', '/api/today')).body;
    for (const item of action_items) {
      assert.ok(typeof item.id === 'string');
      assert.ok(['high', 'medium', 'low'].includes(item.priority));
      assert.ok(typeof item.body === 'string');
      assert.ok(typeof item.link === 'object');
    }
  });

  it('hauler_status is an array with corridor projection fields', async () => {
    const { hauler_status } = (await api('GET', '/api/today')).body;
    assert.ok(Array.isArray(hauler_status));
    for (const h of hauler_status) {
      assert.ok(typeof h.id === 'string');
      assert.ok(typeof h.active_trucks === 'number');
      assert.ok(typeof h.projected_eom_tonnes === 'number');
    }
  });

  it('dominant_story has severity, headline, body, action, metric', async () => {
    const { dominant_story } = (await api('GET', '/api/today')).body;
    assert.ok(['warn', 'info'].includes(dominant_story.severity));
    assert.ok(typeof dominant_story.headline === 'string');
    assert.ok(typeof dominant_story.body === 'string');
    assert.ok(typeof dominant_story.action === 'string');
    assert.ok('metric' in dominant_story);
  });

  it('forecast has projection and horizon fields', async () => {
    const { forecast } = (await api('GET', '/api/today')).body;
    assert.ok(forecast.projection != null);
    assert.ok(forecast.horizon != null);
    assert.ok(typeof forecast.projection.eom_tonnes === 'number');
    assert.ok(typeof forecast.projection.verdict === 'string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/forecast
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/forecast', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/forecast')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/today/forecast', null, tok)).status, 200);
    }
  });

  it('returns projection, horizon, levers, required, haulers', async () => {
    const r = await api('GET', '/api/today/forecast', null, adminTok);
    for (const k of ['projection', 'horizon', 'levers', 'required', 'haulers']) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });
});

describe('GET /api/today/forecast/history', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/forecast/history')).status, 401);
  });

  it('200 — returns days and points array', async () => {
    const r = await api('GET', '/api/today/forecast/history', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.days === 'number');
    assert.ok(Array.isArray(r.body.points));
  });

  it('?days= clamps to valid range', async () => {
    const r = await api('GET', '/api/today/forecast/history?days=7', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.days, 7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/today/forecast/scenario
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/today/forecast/scenario', () => {
  it('401 without token', async () => {
    assert.equal((await api('POST', '/api/today/forecast/scenario', {})).status, 401);
  });

  it('200 — open to all roles with empty scenario', async () => {
    const r = await api('POST', '/api/today/forecast/scenario', {}, adminTok);
    assert.equal(r.status, 200);
    assert.ok('baseline' in r.body || 'scenario' in r.body);
  });

  it('200 — lender can also run scenarios', async () => {
    assert.equal((await api('POST', '/api/today/forecast/scenario', {}, lenderTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forecast scenario library
// ─────────────────────────────────────────────────────────────────────────────

let scenarioId;

describe('GET /api/today/forecast/scenarios', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/forecast/scenarios')).status, 401);
  });

  it('200 for all roles — returns baseline and scenarios array', async () => {
    const r = await api('GET', '/api/today/forecast/scenarios', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('baseline' in r.body);
    assert.ok(Array.isArray(r.body.scenarios));
  });
});

describe('POST /api/today/forecast/scenarios', () => {
  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/today/forecast/scenarios',
        { name: 'S', params: {} }, lenderTok)).status, 403,
    );
  });

  it('400 — missing name', async () => {
    const r = await api('POST', '/api/today/forecast/scenarios', { params: {} }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin creates scenario', async () => {
    const r = await api('POST', '/api/today/forecast/scenarios', {
      name:        'H05 fleet static',
      description: 'Haul-05 stays at current truck count for the month',
      params:      { hauler_truck_lifts: {} },
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.scenario);
    assert.equal(r.body.scenario.name, 'H05 fleet static');
    scenarioId = r.body.scenario.id;
  });
});

describe('PATCH /api/today/forecast/scenarios/:id', () => {
  it('400 — invalid id', async () => {
    assert.equal(
      (await api('PATCH', '/api/today/forecast/scenarios/abc', { name: 'X' }, adminTok)).status, 400,
    );
  });

  it('404 — not found', async () => {
    assert.equal(
      (await api('PATCH', '/api/today/forecast/scenarios/999999', { name: 'X' }, adminTok)).status, 404,
    );
  });

  it('200 — axis_ops updates scenario', async () => {
    const r = await api('PATCH', `/api/today/forecast/scenarios/${scenarioId}`,
      { description: 'Updated description' }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.scenario.description, 'Updated description');
  });
});

describe('POST /api/today/forecast/scenarios/:id/archive + unarchive + delete', () => {
  it('404 archive — not found', async () => {
    assert.equal(
      (await api('POST', '/api/today/forecast/scenarios/999999/archive', null, adminTok)).status, 404,
    );
  });

  it('200 — archive scenario', async () => {
    const r = await api('POST', `/api/today/forecast/scenarios/${scenarioId}/archive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.archived, true);
  });

  it('200 — unarchive scenario', async () => {
    const r = await api('POST', `/api/today/forecast/scenarios/${scenarioId}/unarchive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unarchived, true);
  });

  it('403 — axis_ops cannot hard-delete', async () => {
    assert.equal(
      (await api('DELETE', `/api/today/forecast/scenarios/${scenarioId}`, null, opsTok)).status, 403,
    );
  });

  it('200 — axis_admin hard-deletes scenario', async () => {
    const r = await api('DELETE', `/api/today/forecast/scenarios/${scenarioId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/operations-log
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/operations-log', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/operations-log')).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/today/operations-log', null, lenderTok)).status, 403);
  });

  it('200 for axis_admin — returns since, counts, entries', async () => {
    const r = await api('GET', '/api/today/operations-log', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.since === 'string');
    assert.ok('counts' in r.body);
    assert.ok(Array.isArray(r.body.entries));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/today/operations-log', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/today/operations-log', null, haulerTok)).status, 200);
  });

  it('counts has writes and auto_cleared', async () => {
    const { counts } = (await api('GET', '/api/today/operations-log', null, adminTok)).body;
    assert.ok(typeof counts.writes === 'number');
    assert.ok(typeof counts.auto_cleared === 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/digest
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/digest', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/digest')).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/today/digest', null, lenderTok)).status, 403);
  });

  it('200 for axis_admin — returns top-level keys', async () => {
    const r = await api('GET', '/api/today/digest', null, adminTok);
    assert.equal(r.status, 200);
    for (const k of [
      'generated_at', 'generated_by', 'period', 'corridor', 'dominant_story',
      'forecast', 'observations', 'open_action_items', 'haulers',
      'operations_log', 'filings_posture',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/today/digest', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/today/digest', null, haulerTok)).status, 200);
  });

  it('filings_posture has total, filed, overdue, due_in_3d, upcoming', async () => {
    const { filings_posture } = (await api('GET', '/api/today/digest', null, adminTok)).body;
    assert.ok(typeof filings_posture.total === 'number');
    assert.ok(typeof filings_posture.filed === 'number');
    assert.ok(typeof filings_posture.overdue === 'number');
    assert.ok(Array.isArray(filings_posture.upcoming));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handover notes
// ─────────────────────────────────────────────────────────────────────────────

let handoverId;

describe('GET /api/today/handover/latest + GET /api/today/handover', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/handover/latest')).status, 401);
  });

  it('200 — latest handover (null initially)', async () => {
    const r = await api('GET', '/api/today/handover/latest', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('handover' in r.body); // may be null
  });

  it('200 — handover list for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      const r = await api('GET', '/api/today/handover', null, tok);
      assert.equal(r.status, 200);
      assert.ok(Array.isArray(r.body.handovers));
    }
  });
});

describe('POST /api/today/handover', () => {
  it('401 without token', async () => {
    assert.equal((await api('POST', '/api/today/handover', { body: 'Hello' })).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/today/handover', { body: 'Hello' }, lenderTok)).status, 403,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/today/handover', { body: 'Hello' }, haulerTok)).status, 403,
    );
  });

  it('400 — missing body', async () => {
    const r = await api('POST', '/api/today/handover', {}, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin creates handover', async () => {
    const r = await api('POST', '/api/today/handover', {
      body: 'N6 km 85 closure resolved. H01 and H03 back on schedule. H05 still 2 trucks down.',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.handover);
    assert.ok(typeof r.body.handover.id === 'number');
    handoverId = r.body.handover.id;
  });

  it('200 — axis_ops creates handover', async () => {
    const r = await api('POST', '/api/today/handover', {
      body: 'Weighbridge calibrated at 14:30. Port berth 4 cleared for offload.',
    }, opsTok);
    assert.equal(r.status, 200);
  });

  it('GET /latest now returns the most recent handover', async () => {
    const r = await api('GET', '/api/today/handover/latest', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.handover != null);
  });
});

describe('GET /api/today/handover-brief', () => {
  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/today/handover-brief', null, lenderTok)).status, 403);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/today/handover-brief', null, haulerTok)).status, 403);
  });

  it('200 — axis_admin gets structured brief', async () => {
    const r = await api('GET', '/api/today/handover-brief', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.brief === 'string');
    assert.ok(r.body.brief.length > 0);
  });

  it('200 — axis_ops can also get brief', async () => {
    assert.equal((await api('GET', '/api/today/handover-brief', null, opsTok)).status, 200);
  });
});

describe('DELETE /api/today/handover/:id', () => {
  it('403 for axis_ops', async () => {
    assert.equal(
      (await api('DELETE', `/api/today/handover/${handoverId}`, null, opsTok)).status, 403,
    );
  });

  it('404 — not found', async () => {
    assert.equal(
      (await api('DELETE', '/api/today/handover/999999', null, adminTok)).status, 404,
    );
  });

  it('200 — axis_admin deletes handover', async () => {
    const r = await api('DELETE', `/api/today/handover/${handoverId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/calendar
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/calendar', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/calendar')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/today/calendar', null, tok)).status, 200);
    }
  });

  it('?days= param accepted', async () => {
    const r = await api('GET', '/api/today/calendar?days=60', null, adminTok);
    assert.equal(r.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/week
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/week', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/week')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/today/week', null, tok)).status, 200);
    }
  });

  it('?ending= param accepted', async () => {
    const r = await api('GET', '/api/today/week?ending=2026-05-01', null, adminTok);
    assert.equal(r.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/today/closeout
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/closeout', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/closeout')).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/today/closeout', null, lenderTok)).status, 403);
  });

  it('200 for axis_admin — returns queue, shipped_today, forecast', async () => {
    const r = await api('GET', '/api/today/closeout', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('queue' in r.body);
    assert.ok('shipped_today' in r.body);
    assert.ok('forecast' in r.body);
    const q = r.body.queue;
    for (const k of ['overdue', 'due_next_48h', 'active', 'waking_soon', 'counts']) {
      assert.ok(k in q, `missing queue key: ${k}`);
    }
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/today/closeout', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/today/closeout', null, haulerTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Action item assignment workflow
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/today/action-items/mine', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/today/action-items/mine')).status, 401);
  });

  it('200 — returns items array', async () => {
    const r = await api('GET', '/api/today/action-items/mine', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.items));
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/today/action-items/mine', null, haulerTok)).status, 200);
  });
});

describe('POST /api/today/action-items/:id/assign', () => {
  it('401 without token', async () => {
    assert.equal(
      (await api('POST', '/api/today/action-items/act-test/assign', { assignee_user_id: 'u-ops' })).status, 401,
    );
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/today/action-items/act-test/assign',
        { assignee_user_id: 'u-ops' }, lenderTok)).status, 403,
    );
  });

  it('400 — missing assignee_user_id', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('assignee'));
  });

  it('400 — assignee is a lender (no write capability)', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-len' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — assignee_user_id does not exist', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-ghost' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — invalid due_date format', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-ops', due_date: '2026/05/30' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin assigns item to axis_ops with due_date', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`, {
      assignee_user_id: 'u-ops',
      due_date:         '2026-06-30',
      notes:            'Escalate H05 activation — 2 trucks still idle.',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.assignment);
    assert.equal(r.body.assignment.assignee.user_id, 'u-ops');
  });

  it('403 — hauler_admin cannot assign to another user', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-ops' }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('200 — hauler_admin can self-assign', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    // Re-assign (overwrite) to hauler_admin themselves
    const r = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-h01' }, adminTok);
    assert.equal(r.status, 200);
    // Now self-assign as hauler_admin
    const r2 = await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-h01' }, haulerTok);
    assert.equal(r2.status, 200);
  });

  it('GET /action-items/mine shows the item for ops after re-assign', async () => {
    // Reassign back to ops first
    const id = firstActionItemId ?? 'act-forecast-eom';
    await api('POST', `/api/today/action-items/${id}/assign`,
      { assignee_user_id: 'u-ops', due_date: '2026-06-30' }, adminTok);
    const r = await api('GET', '/api/today/action-items/mine', null, opsTok);
    assert.equal(r.status, 200);
    // The assigned item should appear in ops' mine list
    const found = r.body.items.some((i) => i.action_item_id === id);
    assert.ok(found, 'assigned item should appear in ops mine list');
  });
});

describe('GET /api/today/action-items/by-user/:userId', () => {
  it('403 for axis_ops', async () => {
    assert.equal(
      (await api('GET', '/api/today/action-items/by-user/u-ops', null, opsTok)).status, 403,
    );
  });

  it('404 — user not found', async () => {
    assert.equal(
      (await api('GET', '/api/today/action-items/by-user/u-ghost', null, adminTok)).status, 404,
    );
  });

  it('200 — axis_admin can see any user queue', async () => {
    const r = await api('GET', '/api/today/action-items/by-user/u-ops', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('user' in r.body);
    assert.ok(Array.isArray(r.body.items));
    assert.equal(r.body.user.id, 'u-ops');
  });
});

describe('POST /api/today/action-items/:id/snooze', () => {
  const FUTURE_DATE = '2099-12-31';

  it('401 without token', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    assert.equal(
      (await api('POST', `/api/today/action-items/${id}/snooze`, { until: FUTURE_DATE })).status, 401,
    );
  });

  it('400 — missing until', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/snooze`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('until'));
  });

  it('400 — until is in the past', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/snooze`,
      { until: '2020-01-01' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('404 — item is not assigned', async () => {
    // Use an ID that we've never assigned
    const r = await api('POST', '/api/today/action-items/act-unassigned-ghost/snooze',
      { until: FUTURE_DATE }, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 — axis_admin snoozes assigned item', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('POST', `/api/today/action-items/${id}/snooze`, {
      until:  FUTURE_DATE,
      reason: 'GIBDLC payment conference next month',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.assignment);
    assert.equal(r.body.assignment.snooze?.until, FUTURE_DATE);
  });
});

describe('DELETE /api/today/action-items/:id/snooze', () => {
  it('404 — not snoozed (unknown item)', async () => {
    const r = await api('DELETE', '/api/today/action-items/act-not-snoozed/snooze', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 — axis_admin unsnoozes', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('DELETE', `/api/today/action-items/${id}/snooze`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unsnoozed, true);
  });
});

describe('Action item comments', () => {
  const id = () => firstActionItemId ?? 'act-forecast-eom';
  let commentId;

  it('403 — lender cannot read comments', async () => {
    const r = await api('GET', `/api/today/action-items/${id()}/comments`, null, lenderTok);
    assert.equal(r.status, 403);
  });

  it('200 — axis_admin reads comments (empty initially)', async () => {
    const r = await api('GET', `/api/today/action-items/${id()}/comments`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.comments));
  });

  it('400 — POST comment missing body', async () => {
    const r = await api('POST', `/api/today/action-items/${id()}/comments`, {}, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin posts comment', async () => {
    const r = await api('POST', `/api/today/action-items/${id()}/comments`, {
      body: 'Called GIBDLC AP — payment confirmed for end of month.',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.comment);
    assert.ok(typeof r.body.comment.id === 'number');
    commentId = r.body.comment.id;
  });

  it('200 — axis_ops posts comment', async () => {
    const r = await api('POST', `/api/today/action-items/${id()}/comments`, {
      body: 'Confirmed via email — reference PAY-2026-048.',
    }, opsTok);
    assert.equal(r.status, 200);
  });

  it('GET comments shows all posted entries', async () => {
    const r = await api('GET', `/api/today/action-items/${id()}/comments`, null, adminTok);
    assert.ok(r.body.comments.length >= 2);
  });

  it('403 — ops cannot delete admin comment (not the author)', async () => {
    const r = await api('DELETE',
      `/api/today/action-items/${id()}/comments/${commentId}`, null, opsTok);
    assert.equal(r.status, 403);
  });

  it('200 — axis_admin can delete any comment', async () => {
    const r = await api('DELETE',
      `/api/today/action-items/${id()}/comments/${commentId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — deleted comment is gone', async () => {
    const r = await api('DELETE',
      `/api/today/action-items/${id()}/comments/${commentId}`, null, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('DELETE /api/today/action-items/:id/assign', () => {
  it('404 — item not assigned', async () => {
    const r = await api('DELETE', '/api/today/action-items/act-ghost-unassigned/assign', null, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 — axis_admin unassigns the item', async () => {
    const id = firstActionItemId ?? 'act-forecast-eom';
    const r = await api('DELETE', `/api/today/action-items/${id}/assign`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unassigned, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bulk action item operations
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/today/action-items/bulk-reassign', () => {
  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/today/action-items/bulk-reassign',
        { from_user_id: 'u-ops', to_user_id: 'u-adm' }, lenderTok)).status, 403,
    );
  });

  it('400 — missing from_user_id', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-reassign',
      { to_user_id: 'u-adm' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — same from and to user', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-reassign',
      { from_user_id: 'u-ops', to_user_id: 'u-ops' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — cannot reassign to lender', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-reassign',
      { from_user_id: 'u-ops', to_user_id: 'u-len' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('404 — target user not found', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-reassign',
      { from_user_id: 'u-ops', to_user_id: 'u-ghost' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('200 — bulk-reassign (0 transfers when source has nothing assigned)', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-reassign',
      { from_user_id: 'u-ops', to_user_id: 'u-adm' }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(typeof r.body.transferred_count === 'number');
    assert.ok(typeof r.body.skipped_count === 'number');
    assert.ok(Array.isArray(r.body.transferred));
    assert.ok(Array.isArray(r.body.skipped));
  });
});

describe('POST /api/today/action-items/bulk-snooze', () => {
  it('400 — missing action_item_ids', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-snooze',
      { until: '2099-12-31' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — empty action_item_ids array', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-snooze',
      { action_item_ids: [], until: '2099-12-31' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — until in the past', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-snooze',
      { action_item_ids: ['act-forecast-eom'], until: '2020-01-01' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — skips unassigned items without error', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-snooze', {
      action_item_ids: ['act-ghost-1', 'act-ghost-2'],
      until: '2099-12-31',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.snoozed_count, 0);
    assert.equal(r.body.skipped_count, 2);
  });
});

describe('POST /api/today/action-items/bulk-unassign', () => {
  it('400 — missing action_item_ids', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-unassign', {}, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — empty array', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-unassign',
      { action_item_ids: [] }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — skips unassigned items without error', async () => {
    const r = await api('POST', '/api/today/action-items/bulk-unassign', {
      action_item_ids: ['act-ghost-1', 'act-ghost-2'],
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unassigned_count, 0);
    assert.equal(r.body.skipped_count, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/today/action-items/:id/escalation/acknowledge
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/today/action-items/:id/escalation/acknowledge', () => {
  it('403 for axis_ops', async () => {
    assert.equal(
      (await api('POST', '/api/today/action-items/act-test/escalation/acknowledge', null, opsTok)).status, 403,
    );
  });

  it('404 — item not escalated', async () => {
    const r = await api('POST',
      '/api/today/action-items/act-not-escalated/escalation/acknowledge', null, adminTok);
    assert.equal(r.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/today/targets
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/today/targets', () => {
  it('401 without token', async () => {
    assert.equal((await api('POST', '/api/today/targets', { target_tonnes: 1200 })).status, 401);
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/today/targets', { target_tonnes: 1200 }, lenderTok)).status, 403,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/today/targets', { target_tonnes: 1200 }, haulerTok)).status, 403,
    );
  });

  it('400 — missing target_tonnes', async () => {
    const r = await api('POST', '/api/today/targets', {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('target_tonnes'));
  });

  it('400 — zero target_tonnes', async () => {
    const r = await api('POST', '/api/today/targets', { target_tonnes: 0 }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — negative target_tonnes', async () => {
    const r = await api('POST', '/api/today/targets', { target_tonnes: -500 }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — invalid date format', async () => {
    const r = await api('POST', '/api/today/targets',
      { target_tonnes: 1200, date: '20260520' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin sets target for today', async () => {
    const r = await api('POST', '/api/today/targets', { target_tonnes: 1200 }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.target);
    assert.equal(r.body.target.target_tonnes, 1200);
  });

  it('200 — axis_ops sets target for explicit future date', async () => {
    const r = await api('POST', '/api/today/targets',
      { target_tonnes: 1350, date: '2026-06-01' }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.target.target_tonnes, 1350);
    assert.equal(r.body.target.date, '2026-06-01');
  });

  it('GET /api/today includes throughput after target is set', async () => {
    const r = await api('GET', '/api/today');
    assert.equal(r.status, 200);
    // throughput should be populated (target was set above)
    assert.ok(r.body.throughput != null);
    assert.ok(typeof r.body.throughput.actual_tonnes === 'number');
  });
});
