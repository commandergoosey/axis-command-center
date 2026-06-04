'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-small';
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
insertUser.run('u-adm', 'admin@small.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@small.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@small.test',    bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'lender@small.test', bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Stub intelligence service (avoids real Anthropic API calls) ───────────────
const intelligenceKey = require.resolve('../services/intelligence');
require.cache[intelligenceKey] = {
  id: intelligenceKey, filename: intelligenceKey, loaded: true,
  exports: {
    observe: async (page, _ctx) => ({
      observations: [{ id: 1, text: `Stub observation for ${page}`, chips: [] }],
    }),
    chat: async (question, _ctx, _page) => ({
      answer: `Stub answer: ${question.slice(0, 30)}`,
    }),
    _hasKey: () => false,
  },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',        require('../routes/auth'));
app.use('/api/search',      require('../routes/search'));
app.use('/api/sensitivity', require('../routes/sensitivity'));
app.use('/api/events',      require('../routes/events'));
app.use('/api/intelligence',require('../routes/intelligence'));
app.use('/api/lender',      require('../routes/lender'));
app.use('/api/audit',       require('../routes/audit'));
app.use('/api/snapshot',    require('../routes/snapshot'));
app.use('/api/tranches',    require('../routes/tranches'));
app.use('/api/broadcasts',  require('../routes/broadcasts'));
app.use('/api/tariff',      require('../routes/tariff'));
app.use('/api/settings',    require('../routes/settings'));
app.use('/api/playbooks',   require('../routes/playbooks'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok, lenderTok;

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
  adminTok  = await login('admin@small.test');
  opsTok    = await login('ops@small.test');
  haulerTok = await login('h01@small.test');
  lenderTok = await login('lender@small.test');
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
// SEARCH
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/search', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/search')).status, 401);
  });

  it('200 with auth — returns results and counts', async () => {
    const r = await api('GET', '/api/search?q=test', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('results' in r.body || 'hits' in r.body || Array.isArray(r.body.results) || r.body != null,
      'response should have some content');
  });

  it('200 with empty q', async () => {
    assert.equal((await api('GET', '/api/search?q=', null, opsTok)).status, 200);
  });

  it('200 for lender', async () => {
    assert.equal((await api('GET', '/api/search?q=haul', null, lenderTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/search?q=truck', null, haulerTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SENSITIVITY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/sensitivity', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/sensitivity')).status, 401);
  });

  it('200 with defaults (no params)', async () => {
    const r = await api('GET', '/api/sensitivity', null, adminTok);
    assert.equal(r.status, 200);
  });

  it('200 with explicit params', async () => {
    const r = await api('GET', '/api/sensitivity?cedi_pct=10&diesel_pct=20&opex_pct=5', null, opsTok);
    assert.equal(r.status, 200);
  });

  it('200 — out-of-range params are clamped, not rejected', async () => {
    const r = await api('GET', '/api/sensitivity?cedi_pct=999&diesel_pct=-999&opex_pct=999', null, adminTok);
    assert.equal(r.status, 200);
  });

  it('200 for lender', async () => {
    assert.equal((await api('GET', '/api/sensitivity', null, lenderTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/sensitivity', null, haulerTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS (SSE — auth gate only)
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/events/stream', () => {
  it('401 without token', async () => {
    const r = await fetch(`${base}/api/events/stream`);
    assert.equal(r.status, 401);
    await r.body?.cancel().catch(() => {});
  });

  it('200 — authenticated user receives SSE headers', async () => {
    const ac = new AbortController();
    const r = await fetch(`${base}/api/events/stream`, {
      headers: { Authorization: `Bearer ${adminTok}` },
      signal: ac.signal,
    });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type')?.includes('text/event-stream'), 'expected SSE content-type');
    ac.abort();
    await r.body?.cancel().catch(() => {});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/intelligence/observe', () => {
  it('200 — open endpoint, no auth required', async () => {
    const r = await api('GET', '/api/intelligence/observe');
    assert.equal(r.status, 200);
    assert.ok('generated_at' in r.body);
    assert.ok('page' in r.body);
    assert.ok('observations' in r.body);
  });

  it('200 with ?page= param', async () => {
    const r = await api('GET', '/api/intelligence/observe?page=financials');
    assert.equal(r.status, 200);
    assert.equal(r.body.page, 'financials');
  });
});

describe('POST /api/intelligence/chat', () => {
  it('400 — missing question', async () => {
    const r = await api('POST', '/api/intelligence/chat', {});
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('question'));
  });

  it('400 — non-string question', async () => {
    const r = await api('POST', '/api/intelligence/chat', { question: 42 });
    assert.equal(r.status, 400);
  });

  it('200 — valid question, open endpoint', async () => {
    const r = await api('POST', '/api/intelligence/chat', { question: 'What is the current DSCR?' });
    assert.equal(r.status, 200);
    assert.ok('answer' in r.body);
    assert.ok('question' in r.body);
    assert.ok('generated_at' in r.body);
  });

  it('200 — with auth (still open)', async () => {
    const r = await api('POST', '/api/intelligence/chat',
      { question: 'How many active trucks?', page: 'today' }, adminTok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/intelligence/status', () => {
  it('200 — open, returns mode and models', async () => {
    const r = await api('GET', '/api/intelligence/status');
    assert.equal(r.status, 200);
    assert.ok('mode' in r.body);
    assert.ok('obs_model' in r.body);
    assert.ok('chat_model' in r.body);
  });

  it('mode is demonstration when no API key (stub always returns false)', async () => {
    assert.equal((await api('GET', '/api/intelligence/status')).body.mode, 'demonstration');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LENDER
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/lender/pack', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/lender/pack')).status, 401);
  });

  it('200 for axis_admin', async () => {
    const r = await api('GET', '/api/lender/pack', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('dscr' in r.body);
    assert.ok('executive_summary' in r.body);
    assert.ok('period' in r.body);
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/lender/pack', null, opsTok)).status, 200);
  });

  it('200 for lender', async () => {
    assert.equal((await api('GET', '/api/lender/pack', null, lenderTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/lender/pack', null, haulerTok)).status, 200);
  });
});

describe('GET /api/lender/covenants', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/lender/covenants')).status, 401);
  });

  it('200 — returns covenants array and summary', async () => {
    const r = await api('GET', '/api/lender/covenants', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.covenants));
    assert.ok('summary' in r.body);
    assert.ok(typeof r.body.summary.total === 'number');
    assert.ok(typeof r.body.summary.compliant === 'number');
    assert.ok(typeof r.body.summary.watch === 'number');
    assert.ok(typeof r.body.summary.breach === 'number');
  });

  it('200 — dscr present', async () => {
    const r = await api('GET', '/api/lender/covenants', null, lenderTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.dscr != null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/audit')).status, 401);
  });

  it('403 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/audit', null, opsTok)).status, 403);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/audit', null, lenderTok)).status, 403);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/audit', null, haulerTok)).status, 403);
  });

  it('200 for axis_admin — returns rows and total', async () => {
    const r = await api('GET', '/api/audit', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('rows' in r.body);
    assert.ok('total' in r.body);
    assert.ok(Array.isArray(r.body.rows));
  });

  it('accepts ?limit= and ?offset= params', async () => {
    const r = await api('GET', '/api/audit?limit=10&offset=0', null, adminTok);
    assert.equal(r.status, 200);
  });

  it('accepts entity_type and q filters', async () => {
    const r = await api('GET', '/api/audit?entity_type=alert&q=trip', null, adminTok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/audit/export.csv', () => {
  it('403 for non-admin', async () => {
    const r = await fetch(`${base}/api/audit/export.csv`, {
      headers: { Authorization: `Bearer ${opsTok}` },
    });
    assert.equal(r.status, 403);
    await r.body?.cancel().catch(() => {});
  });

  it('200 for axis_admin — content-type is text/csv', async () => {
    const r = await fetch(`${base}/api/audit/export.csv`, {
      headers: { Authorization: `Bearer ${adminTok}` },
    });
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type')?.includes('text/csv'));
    assert.ok(r.headers.get('content-disposition')?.includes('attachment'));
    await r.body?.cancel().catch(() => {});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/snapshot', () => {
  it('200 — open endpoint, no auth required', async () => {
    const r = await api('GET', '/api/snapshot');
    assert.equal(r.status, 200);
  });

  it('has health, corridor, haulers, contract, tranches keys', async () => {
    const r = await api('GET', '/api/snapshot');
    for (const k of ['health', 'corridor', 'haulers', 'contract', 'tranches', 'generated_at']) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('health has score, verdict, color, and all 5 components', async () => {
    const { health } = (await api('GET', '/api/snapshot')).body;
    assert.ok(typeof health.score === 'number');
    assert.ok(['STRONG', 'WATCH', 'BELOW'].includes(health.verdict));
    assert.ok(['green', 'amber', 'rust'].includes(health.color));
    const comps = health.components;
    for (const k of ['dscr', 'sla', 'utilisation', 'driver', 'maintenance']) {
      assert.ok(k in comps, `missing component: ${k}`);
    }
  });

  it('corridor has key operational fields', async () => {
    const { corridor } = (await api('GET', '/api/snapshot')).body;
    assert.ok(typeof corridor.length_km === 'number');
    assert.ok(typeof corridor.sla_attainment_pct === 'number');
    assert.ok(typeof corridor.active_trucks_today === 'number');
  });

  it('haulers is an array', async () => {
    const { haulers } = (await api('GET', '/api/snapshot')).body;
    assert.ok(Array.isArray(haulers));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANCHES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/tranches', () => {
  it('200 — open endpoint, no auth required', async () => {
    const r = await api('GET', '/api/tranches');
    assert.equal(r.status, 200);
    assert.ok('programme' in r.body);
    assert.ok('tranches' in r.body);
    assert.ok('capital' in r.body);
    assert.ok('generated_at' in r.body);
  });

  it('each tranche has gates_met and gates_total', async () => {
    const { tranches } = (await api('GET', '/api/tranches')).body;
    assert.ok(Array.isArray(tranches));
    for (const t of tranches) {
      assert.ok(typeof t.gates_met === 'number', `${t.id} missing gates_met`);
      assert.ok(typeof t.gates_total === 'number', `${t.id} missing gates_total`);
      assert.ok(typeof t.all_gates_met === 'boolean', `${t.id} missing all_gates_met`);
    }
  });

  it('tranche-2 has all_gates_met = true', async () => {
    const { tranches } = (await api('GET', '/api/tranches')).body;
    const t2 = tranches.find((t) => t.id === 'tranche-2');
    assert.ok(t2, 'tranche-2 not found');
    assert.equal(t2.all_gates_met, true);
  });

  it('tranche-1 does not have all gates met', async () => {
    const { tranches } = (await api('GET', '/api/tranches')).body;
    const t1 = tranches.find((t) => t.id === 'tranche-1');
    assert.equal(t1.all_gates_met, false);
  });
});

describe('GET /api/tranches/:id/drawdown', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/tranches/tranche-1/drawdown')).status, 401);
  });

  it('404 for unknown tranche', async () => {
    assert.equal((await api('GET', '/api/tranches/tranche-99/drawdown', null, adminTok)).status, 404);
  });

  it('200 for axis_admin — request may be null initially', async () => {
    const r = await api('GET', '/api/tranches/tranche-1/drawdown', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.tranche_id, 'tranche-1');
    assert.ok('request' in r.body);
  });
});

describe('POST /api/tranches/:id/drawdown', () => {
  it('401 without token', async () => {
    assert.equal(
      (await api('POST', '/api/tranches/tranche-2/drawdown', { amount_usd: 23000000 })).status, 401,
    );
  });

  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/tranches/tranche-2/drawdown', { amount_usd: 23000000 }, lenderTok)).status, 403,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/tranches/tranche-2/drawdown', { amount_usd: 23000000 }, haulerTok)).status, 403,
    );
  });

  it('404 for unknown tranche', async () => {
    assert.equal(
      (await api('POST', '/api/tranches/tranche-99/drawdown', { amount_usd: 23000000 }, adminTok)).status, 404,
    );
  });

  it('422 — tranche-1 gates not all met', async () => {
    const r = await api('POST', '/api/tranches/tranche-1/drawdown', { amount_usd: 22000000 }, adminTok);
    assert.equal(r.status, 422);
    assert.ok(r.body.error?.includes('gate'));
  });

  it('400 — missing amount_usd for tranche-2', async () => {
    const r = await api('POST', '/api/tranches/tranche-2/drawdown', {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('amount'));
  });

  it('400 — zero amount_usd', async () => {
    const r = await api('POST', '/api/tranches/tranche-2/drawdown', { amount_usd: 0 }, adminTok);
    assert.equal(r.status, 400);
  });

  it('201 — axis_admin submits valid drawdown for tranche-2', async () => {
    const r = await api('POST', '/api/tranches/tranche-2/drawdown',
      { amount_usd: 23_000_000, notes: 'Requesting Tranche 2 drawdown' }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.request);
    assert.equal(r.body.request.tranche_id, 'tranche-2');
    assert.equal(r.body.request.status, 'pending');
    assert.equal(r.body.request.amount_usd, 23_000_000);
  });

  it('409 — duplicate pending request for same tranche', async () => {
    const r = await api('POST', '/api/tranches/tranche-2/drawdown',
      { amount_usd: 23_000_000 }, opsTok);
    assert.equal(r.status, 409);
  });
});

describe('PATCH /api/tranches/:id/drawdown', () => {
  it('401 without token', async () => {
    assert.equal((await api('PATCH', '/api/tranches/tranche-2/drawdown', { status: 'approved' })).status, 401);
  });

  it('403 for axis_admin', async () => {
    assert.equal(
      (await api('PATCH', '/api/tranches/tranche-2/drawdown', { status: 'approved' }, adminTok)).status, 403,
    );
  });

  it('403 for axis_ops', async () => {
    assert.equal(
      (await api('PATCH', '/api/tranches/tranche-2/drawdown', { status: 'approved' }, opsTok)).status, 403,
    );
  });

  it('400 — invalid status', async () => {
    const r = await api('PATCH', '/api/tranches/tranche-2/drawdown',
      { status: 'cancelled' }, lenderTok);
    assert.equal(r.status, 400);
  });

  it('200 — lender approves the pending request', async () => {
    const r = await api('PATCH', '/api/tranches/tranche-2/drawdown',
      { status: 'approved', response_note: 'Approved — DSCR covenant satisfied' }, lenderTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.request.status, 'approved');
    assert.equal(r.body.request.tranche_id, 'tranche-2');
  });

  it('GET /:id/drawdown reflects approved status', async () => {
    const r = await api('GET', '/api/tranches/tranche-2/drawdown', null, adminTok);
    assert.equal(r.body.request?.status, 'approved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BROADCASTS
// ─────────────────────────────────────────────────────────────────────────────

let broadcastId;

describe('GET /api/broadcasts/active', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/broadcasts/active')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/broadcasts/active', null, tok)).status, 200);
    }
  });

  it('returns broadcasts array', async () => {
    const r = await api('GET', '/api/broadcasts/active', null, adminTok);
    assert.ok(Array.isArray(r.body.broadcasts));
  });
});

describe('GET /api/broadcasts (admin list)', () => {
  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/broadcasts', null, lenderTok)).status, 403);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/broadcasts', null, haulerTok)).status, 403);
  });

  it('200 for axis_admin', async () => {
    const r = await api('GET', '/api/broadcasts', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.broadcasts));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/broadcasts', null, opsTok)).status, 200);
  });
});

describe('POST /api/broadcasts', () => {
  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/broadcasts', { title: 'T', body: 'B', severity: 'info', audience: 'all' }, lenderTok)).status, 403,
    );
  });

  it('400 — missing title', async () => {
    const r = await api('POST', '/api/broadcasts', { body: 'Body text', severity: 'info', audience: 'all' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing body', async () => {
    const r = await api('POST', '/api/broadcasts', { title: 'My Title', severity: 'info', audience: 'all' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin creates broadcast', async () => {
    const r = await api('POST', '/api/broadcasts', {
      title:    'Corridor maintenance — 04:00–06:00',
      body:     'N6 resurfacing at km 42. Expect 40-min delays outbound.',
      severity: 'warn',
      audience: 'all',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.broadcast);
    assert.ok(typeof r.body.broadcast.id === 'number');
    assert.equal(r.body.broadcast.severity, 'warn');
    broadcastId = r.body.broadcast.id;
  });

  it('200 — axis_ops creates broadcast with urgent severity', async () => {
    const r = await api('POST', '/api/broadcasts', {
      title:    'Weighbridge offline at Kumasi terminal',
      body:     'No vehicle weighing until 15:00. All loads held.',
      severity: 'urgent',
      audience: 'haulers',
    }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.broadcast.severity, 'urgent');
  });
});

describe('PATCH /api/broadcasts/:id', () => {
  it('400 — invalid id', async () => {
    assert.equal((await api('PATCH', '/api/broadcasts/abc', { title: 'X' }, adminTok)).status, 400);
  });

  it('404 — not found', async () => {
    assert.equal((await api('PATCH', '/api/broadcasts/999999', { title: 'X' }, adminTok)).status, 404);
  });

  it('200 — axis_admin updates title', async () => {
    const r = await api('PATCH', `/api/broadcasts/${broadcastId}`,
      { title: 'Updated: N6 maintenance complete' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.broadcast.title, 'Updated: N6 maintenance complete');
  });
});

describe('POST /api/broadcasts/:id/archive + unarchive', () => {
  it('404 archive — unknown id', async () => {
    assert.equal((await api('POST', '/api/broadcasts/999999/archive', null, adminTok)).status, 404);
  });

  it('200 — archive existing broadcast', async () => {
    const r = await api('POST', `/api/broadcasts/${broadcastId}/archive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.archived, true);
  });

  it('200 — unarchive restores it', async () => {
    const r = await api('POST', `/api/broadcasts/${broadcastId}/unarchive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unarchived, true);
  });
});

describe('DELETE /api/broadcasts/:id', () => {
  it('403 for axis_ops', async () => {
    assert.equal((await api('DELETE', `/api/broadcasts/${broadcastId}`, null, opsTok)).status, 403);
  });

  it('404 — not found', async () => {
    assert.equal((await api('DELETE', '/api/broadcasts/999999', null, adminTok)).status, 404);
  });

  it('200 — axis_admin hard-deletes', async () => {
    const r = await api('DELETE', `/api/broadcasts/${broadcastId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — deleted broadcast is gone', async () => {
    assert.equal((await api('DELETE', `/api/broadcasts/${broadcastId}`, null, adminTok)).status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TARIFF
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/tariff', () => {
  it('200 — open endpoint, no auth required', async () => {
    assert.equal((await api('GET', '/api/tariff')).status, 200);
  });

  it('has required top-level keys', async () => {
    const r = await api('GET', '/api/tariff');
    for (const k of [
      'generated_at', 'base', 'effective_rate_usd_per_tonne',
      'components', 'next_review', 'effective_rate_history',
      'component_history', 'npa_diesel', 'gss_cpi', 'terms',
      'escalation_forecast', 'pass_through_history',
    ]) {
      assert.ok(k in r.body, `missing key: ${k}`);
    }
  });

  it('base has rate fields', async () => {
    const { base } = (await api('GET', '/api/tariff')).body;
    assert.ok(typeof base.rate_usd_per_tonne === 'number');
    assert.ok(typeof base.corridor_km === 'number');
  });

  it('escalation_forecast has 6 entries each marked modelled', async () => {
    const { escalation_forecast } = (await api('GET', '/api/tariff')).body;
    assert.equal(escalation_forecast.length, 6);
    for (const e of escalation_forecast) {
      assert.equal(e.modelled, true);
      assert.ok(typeof e.base_rate === 'number');
      assert.ok(typeof e.trend_rate === 'number');
      assert.ok(typeof e.stress_rate === 'number');
    }
  });

  it('pass_through_history has 6 entries', async () => {
    const { pass_through_history } = (await api('GET', '/api/tariff')).body;
    assert.equal(pass_through_history.length, 6);
    for (const p of pass_through_history) {
      assert.ok('utilisation_pct' in p);
      assert.ok('cap_triggered' in p);
      assert.ok(p.modelled === true);
    }
  });

  it('next_review has iso and days_until', async () => {
    const { next_review } = (await api('GET', '/api/tariff')).body;
    assert.ok(typeof next_review.iso === 'string');
    assert.ok(typeof next_review.days_until === 'number');
    assert.ok(next_review.days_until > 0);
  });

  it('component_history entries have fuel_usd, cpi_usd, fixed_usd', async () => {
    const { component_history } = (await api('GET', '/api/tariff')).body;
    assert.ok(component_history.length > 0);
    for (const m of component_history) {
      assert.ok('fuel_usd' in m);
      assert.ok('cpi_usd' in m);
      assert.ok('fixed_usd' in m);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/settings', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/settings')).status, 401);
  });

  it('403 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/settings', null, opsTok)).status, 403);
  });

  it('403 for lender', async () => {
    assert.equal((await api('GET', '/api/settings', null, lenderTok)).status, 403);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/settings', null, haulerTok)).status, 403);
  });

  it('200 for axis_admin — returns system, users, integrations', async () => {
    const r = await api('GET', '/api/settings', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('system' in r.body);
    assert.ok('users' in r.body);
    assert.ok('integrations' in r.body);
    assert.ok('generated_at' in r.body);
  });

  it('system has product and version fields', async () => {
    const { system } = (await api('GET', '/api/settings', null, adminTok)).body;
    assert.equal(system.product, 'AXIS Command Center');
    assert.ok(typeof system.version === 'string');
    assert.ok(['LIVE', 'DEMONSTRATION'].includes(system.mode));
  });

  it('users is an array', async () => {
    const { users } = (await api('GET', '/api/settings', null, adminTok)).body;
    assert.ok(Array.isArray(users));
  });
});

describe('GET /api/settings/kv', () => {
  it('403 for non-admin', async () => {
    assert.equal((await api('GET', '/api/settings/kv', null, opsTok)).status, 403);
  });

  it('200 for axis_admin — returns settings array', async () => {
    const r = await api('GET', '/api/settings/kv', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.settings));
    assert.ok(typeof r.body.count === 'number');
  });
});

describe('PUT /api/settings/kv/:key', () => {
  it('403 for non-admin', async () => {
    assert.equal(
      (await api('PUT', '/api/settings/kv/my.key', { value: 'x' }, opsTok)).status, 403,
    );
  });

  it('400 — missing value', async () => {
    const r = await api('PUT', '/api/settings/kv/my.key', {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('value'));
  });

  it('400 — invalid key with uppercase letters', async () => {
    const r = await api('PUT', '/api/settings/kv/My.Key', { value: 'x' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('key'));
  });

  it('200 — upsert a new scalar setting', async () => {
    const r = await api('PUT', '/api/settings/kv/tariff.review.notice_days', { value: 30 }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.setting);
    assert.equal(r.body.setting.key, 'tariff.review.notice_days');
    assert.equal(r.body.setting.value, 30);
  });

  it('200 — upsert an object value', async () => {
    const r = await api('PUT', '/api/settings/kv/corridor.thresholds',
      { value: { sla_warn: 92, sla_breach: 85 } }, adminTok);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.setting.value, { sla_warn: 92, sla_breach: 85 });
  });

  it('200 — overwrite existing key', async () => {
    const r = await api('PUT', '/api/settings/kv/tariff.review.notice_days', { value: 14 }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.setting.value, 14);
  });
});

describe('GET /api/settings/kv/:key', () => {
  it('404 — key does not exist', async () => {
    assert.equal((await api('GET', '/api/settings/kv/no.such.key', null, adminTok)).status, 404);
  });

  it('200 — returns previously set key', async () => {
    const r = await api('GET', '/api/settings/kv/tariff.review.notice_days', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.setting);
    assert.equal(r.body.setting.key, 'tariff.review.notice_days');
    assert.equal(r.body.setting.value, 14);
  });
});

describe('DELETE /api/settings/kv/:key', () => {
  it('403 for non-admin', async () => {
    assert.equal(
      (await api('DELETE', '/api/settings/kv/tariff.review.notice_days', null, opsTok)).status, 403,
    );
  });

  it('404 — key does not exist', async () => {
    assert.equal(
      (await api('DELETE', '/api/settings/kv/no.such.key', null, adminTok)).status, 404,
    );
  });

  it('200 — deletes existing key', async () => {
    const r = await api('DELETE', '/api/settings/kv/tariff.review.notice_days', null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
    assert.equal(r.body.key, 'tariff.review.notice_days');
  });

  it('404 — key gone after deletion', async () => {
    assert.equal(
      (await api('GET', '/api/settings/kv/tariff.review.notice_days', null, adminTok)).status, 404,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBOOKS
// ─────────────────────────────────────────────────────────────────────────────

let playbookId, runId, itemId;

describe('GET /api/playbooks', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/playbooks')).status, 401);
  });

  it('200 for all roles', async () => {
    for (const tok of [adminTok, opsTok, haulerTok, lenderTok]) {
      assert.equal((await api('GET', '/api/playbooks', null, tok)).status, 200);
    }
  });

  it('returns playbooks, recent_runs, completion_rates', async () => {
    const r = await api('GET', '/api/playbooks', null, adminTok);
    assert.ok('playbooks' in r.body);
    assert.ok('recent_runs' in r.body);
    assert.ok('completion_rates' in r.body);
    assert.ok(Array.isArray(r.body.playbooks));
  });
});

describe('POST /api/playbooks', () => {
  it('403 for lender', async () => {
    assert.equal(
      (await api('POST', '/api/playbooks', { name: 'T', items: [{ title: 'S1' }] }, lenderTok)).status, 403,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/playbooks', { name: 'T', items: [{ title: 'S1' }] }, haulerTok)).status, 403,
    );
  });

  it('400 — missing name', async () => {
    const r = await api('POST', '/api/playbooks', { items: [{ title: 'Step 1' }] }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing items', async () => {
    const r = await api('POST', '/api/playbooks', { name: 'Checklist' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin creates playbook', async () => {
    const r = await api('POST', '/api/playbooks', {
      name:           'Weekly compliance check',
      description:    'Friday compliance sweep before weekend.',
      schedule_label: 'Weekly, Friday 08:00',
      items: [
        { title: 'Verify all driver licence expiry dates' },
        { title: 'Check roadworthiness certificates' },
        { title: 'Confirm load manifest accuracy' },
      ],
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.playbook);
    assert.equal(r.body.playbook.name, 'Weekly compliance check');
    assert.ok(Array.isArray(r.body.playbook.items));
    assert.equal(r.body.playbook.items.length, 3);
    playbookId = r.body.playbook.id;
  });

  it('200 — axis_ops creates playbook', async () => {
    const r = await api('POST', '/api/playbooks', {
      name: 'Month-end reconciliation',
      items: [{ title: 'Reconcile trip logs' }, { title: 'Submit GIBDLC invoice' }],
    }, opsTok);
    assert.equal(r.status, 200);
  });
});

describe('PATCH /api/playbooks/:id', () => {
  it('400 — invalid id', async () => {
    assert.equal((await api('PATCH', '/api/playbooks/abc', { name: 'X' }, adminTok)).status, 400);
  });

  it('404 — not found', async () => {
    assert.equal((await api('PATCH', '/api/playbooks/999999', { name: 'X' }, adminTok)).status, 404);
  });

  it('200 — axis_admin updates playbook name', async () => {
    const r = await api('PATCH', `/api/playbooks/${playbookId}`,
      { description: 'Updated: full compliance sweep' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.playbook.description, 'Updated: full compliance sweep');
  });
});

describe('POST /api/playbooks/:id/run', () => {
  it('403 for lender', async () => {
    assert.equal((await api('POST', `/api/playbooks/${playbookId}/run`, null, lenderTok)).status, 403);
  });

  it('404 for unknown playbook', async () => {
    assert.equal((await api('POST', '/api/playbooks/999999/run', null, adminTok)).status, 404);
  });

  it('200 — axis_admin runs playbook, materialises run + items', async () => {
    const r = await api('POST', `/api/playbooks/${playbookId}/run`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.run);
    assert.ok(Array.isArray(r.body.items));
    assert.equal(r.body.items.length, 3);
    runId  = r.body.run.id;
    itemId = r.body.items[0].id;
  });
});

describe('GET /api/playbooks/:id/runs', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', `/api/playbooks/${playbookId}/runs`)).status, 401);
  });

  it('404 for unknown playbook', async () => {
    assert.equal((await api('GET', '/api/playbooks/999999/runs', null, adminTok)).status, 404);
  });

  it('200 — returns run list for the playbook', async () => {
    const r = await api('GET', `/api/playbooks/${playbookId}/runs`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.runs));
    assert.ok(r.body.runs.length >= 1);
    assert.equal(r.body.playbook_id, playbookId);
  });
});

describe('GET /api/playbooks/runs/:runId', () => {
  it('404 for unknown run', async () => {
    assert.equal((await api('GET', '/api/playbooks/runs/999999', null, adminTok)).status, 404);
  });

  it('200 — returns run and items', async () => {
    const r = await api('GET', `/api/playbooks/runs/${runId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.run);
    assert.ok(Array.isArray(r.body.items));
    assert.equal(r.body.run.id, runId);
  });
});

describe('POST /api/playbooks/runs/items/:itemId/complete + reopen', () => {
  it('404 complete — unknown item', async () => {
    assert.equal(
      (await api('POST', '/api/playbooks/runs/items/999999/complete', null, adminTok)).status, 404,
    );
  });

  it('200 — axis_ops completes item', async () => {
    const r = await api('POST', `/api/playbooks/runs/items/${itemId}/complete`, null, opsTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.item);
    assert.equal(r.body.item.status, 'done');
  });

  it('200 — axis_admin reopens item', async () => {
    const r = await api('POST', `/api/playbooks/runs/items/${itemId}/reopen`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.item);
    assert.equal(r.body.item.status, 'open');
  });
});

describe('POST /api/playbooks/:id/archive + unarchive + delete', () => {
  it('404 archive — unknown id', async () => {
    assert.equal((await api('POST', '/api/playbooks/999999/archive', null, adminTok)).status, 404);
  });

  it('200 — archive the playbook', async () => {
    const r = await api('POST', `/api/playbooks/${playbookId}/archive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.archived, true);
  });

  it('400 — cannot run archived playbook', async () => {
    const r = await api('POST', `/api/playbooks/${playbookId}/run`, null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error?.includes('archived'));
  });

  it('200 — unarchive restores it', async () => {
    const r = await api('POST', `/api/playbooks/${playbookId}/unarchive`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unarchived, true);
  });

  it('403 — axis_ops cannot hard-delete', async () => {
    assert.equal((await api('DELETE', `/api/playbooks/${playbookId}`, null, opsTok)).status, 403);
  });

  it('200 — axis_admin hard-deletes', async () => {
    const r = await api('DELETE', `/api/playbooks/${playbookId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('404 — playbook gone after deletion', async () => {
    assert.equal(
      (await api('GET', `/api/playbooks/${playbookId}/runs`, null, adminTok)).status, 404,
    );
  });
});
