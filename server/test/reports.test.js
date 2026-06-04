'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-reports';
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
insertUser.run('u-adm', 'admin@rpt.test',  bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@rpt.test',    bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-hul', 'hauler@rpt.test', bcrypt.hashSync(PASS, 1), 'Hauler', 'hauler_admin', 'haul-01', 'H01',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Stub reportAI (avoids real Anthropic API calls) ───────────────────────────
const aiKey = require.resolve('../services/reportAI');
const _aiJobs = new Map();
require.cache[aiKey] = {
  id: aiKey, filename: aiKey, loaded: true,
  exports: {
    generate: async (prompt) => {
      const jobId = `job-test-${Date.now()}`;
      _aiJobs.set(jobId, Buffer.from('%PDF-1.4 stub'));
      return { jobId, title: `AI Report: ${prompt.slice(0, 30)}` };
    },
    stream: (jobId, res) => {
      if (!_aiJobs.has(jobId)) return false;
      res.setHeader('Content-Type', 'application/pdf');
      res.end(_aiJobs.get(jobId));
      return true;
    },
  },
};

// ── Stub scheduleRunner (avoids cron setup) ───────────────────────────────────
const runnerKey = require.resolve('../services/scheduleRunner');
require.cache[runnerKey] = {
  id: runnerKey, filename: runnerKey, loaded: true,
  exports: { start: () => {}, tick: async () => {}, runOne: async () => {} },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',    require('../routes/auth'));
app.use('/api/reports', require('../routes/reports'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, haulerTok;

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
  adminTok  = await login('admin@rpt.test');
  opsTok    = await login('ops@rpt.test');
  haulerTok = await login('hauler@rpt.test');
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
  const ct = r.headers.get('content-type') ?? '';
  const parsed = ct.includes('application/json') ? await r.json().catch(() => null) : null;
  return { status: r.status, headers: r.headers, body: parsed };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reports', () => {
  it('200 — open endpoint', async () => {
    assert.equal((await api('GET', '/api/reports')).status, 200);
  });

  it('returns library, live_exports, recent, generated_at', async () => {
    const r = await api('GET', '/api/reports');
    assert.ok(Array.isArray(r.body.library), 'library missing');
    assert.ok(Array.isArray(r.body.live_exports), 'live_exports missing');
    assert.ok(Array.isArray(r.body.recent), 'recent missing');
    assert.ok(typeof r.body.generated_at === 'string', 'generated_at missing');
  });

  it('library has at least 4 entries', async () => {
    const r = await api('GET', '/api/reports');
    assert.ok(r.body.library.length >= 4, `expected ≥4 library entries, got ${r.body.library.length}`);
  });

  it('live_exports includes lender_pack and today_digest', async () => {
    const r = await api('GET', '/api/reports');
    const ids = r.body.live_exports.map((e) => e.id);
    assert.ok(ids.includes('lender_pack'), 'missing lender_pack');
    assert.ok(ids.includes('today_digest'), 'missing today_digest');
  });

  it('live_exports includes hauler scorecard entries', async () => {
    const r = await api('GET', '/api/reports');
    const haulerEntry = r.body.live_exports.find((e) => e.id.startsWith('hauler_scorecard_'));
    assert.ok(haulerEntry, 'no hauler scorecard in live_exports');
    assert.ok(haulerEntry.path.startsWith('/haulers/'));
  });

  it('recent includes fixture entries on fresh DB', async () => {
    const r = await api('GET', '/api/reports');
    assert.ok(r.body.recent.length > 0, 'recent should have fixture entries');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reports/metrics', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/reports/metrics')).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/reports/metrics', null, haulerTok)).status, 403);
  });

  it('200 for axis_admin with metrics object', async () => {
    const r = await api('GET', '/api/reports/metrics', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.metrics != null, 'missing metrics');
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/reports/metrics', null, opsTok)).status, 200);
  });

  it('accepts type_id and period_from/to query params', async () => {
    const r = await api('GET', '/api/reports/metrics?type_id=ops_weekly&period_from=2026-04-01&period_to=2026-04-30', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok('metrics' in r.body);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reports/download/:typeId', () => {
  it('404 for unknown typeId', async () => {
    assert.equal((await api('GET', '/api/reports/download/not-a-real-report')).status, 404);
  });

  it('200 with application/pdf Content-Type for valid typeId', async () => {
    const r = await fetch(`${base}/api/reports/download/shift_handover`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type').includes('application/pdf'));
    await r.body?.cancel?.();
  });

  it('Content-Disposition contains typeId in filename', async () => {
    const r = await fetch(`${base}/api/reports/download/gibdlc_monthly`);
    assert.equal(r.status, 200);
    const cd = r.headers.get('content-disposition');
    assert.ok(cd, 'Content-Disposition missing');
    assert.ok(cd.includes('gibdlc_monthly'), `filename missing typeId: ${cd}`);
    await r.body?.cancel?.();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reports/generate', () => {
  it('401 without token', async () => {
    const r = await api('POST', '/api/reports/generate', { type_id: 'shift_handover', label: 'Test' });
    assert.equal(r.status, 401);
  });

  it('403 for hauler_admin', async () => {
    const r = await api('POST', '/api/reports/generate',
      { type_id: 'shift_handover', label: 'Test' }, haulerTok);
    assert.equal(r.status, 403);
  });

  it('400 — unknown type_id', async () => {
    const r = await api('POST', '/api/reports/generate',
      { type_id: 'invalid_type', label: 'Test' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('Unknown report type'));
  });

  it('400 — missing label', async () => {
    const r = await api('POST', '/api/reports/generate',
      { type_id: 'shift_handover' }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('label'));
  });

  it('201 — axis_admin generates a report', async () => {
    const r = await api('POST', '/api/reports/generate', {
      type_id:     'shift_handover',
      period_from: '2026-05-01',
      period_to:   '2026-05-14',
      label:       'May 1–14 handover',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.instance);
    assert.ok(r.body.download_url);
    assert.equal(r.body.instance.type_id, 'shift_handover');
    assert.equal(r.body.instance.status, 'DELIVERED');
    assert.ok(r.body.instance.id.startsWith('rpt-'));
    assert.ok(r.body.instance.pages > 0);
  });

  it('201 — axis_ops generates a lender_quarterly report', async () => {
    const r = await api('POST', '/api/reports/generate', {
      type_id: 'lender_quarterly',
      label:   'Q1 2026',
    }, opsTok);
    assert.equal(r.status, 201);
    assert.equal(r.body.instance.pages, 11);
  });

  it('GET /reports after generate includes the new run in recent', async () => {
    const list = await api('GET', '/api/reports');
    const hasNew = list.body.recent.some((r) => r.type_id === 'shift_handover');
    assert.ok(hasNew, 'newly generated report should appear in recent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reports/schedules', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/reports/schedules')).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/reports/schedules', null, haulerTok)).status, 403);
  });

  it('200 for axis_admin — schedules array', async () => {
    const r = await api('GET', '/api/reports/schedules', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.schedules));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/reports/schedules', null, opsTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reports/schedules', () => {
  it('401 without token', async () => {
    assert.equal(
      (await api('POST', '/api/reports/schedules', { type_id: 'ops_weekly', frequency: 'weekly' })).status, 401,
    );
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/reports/schedules', { type_id: 'ops_weekly', frequency: 'weekly' }, haulerTok)).status, 403,
    );
  });

  it('400 — missing type_id', async () => {
    const r = await api('POST', '/api/reports/schedules', { frequency: 'weekly' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing frequency', async () => {
    const r = await api('POST', '/api/reports/schedules', { type_id: 'ops_weekly' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('201 — axis_admin creates daily schedule', async () => {
    const r = await api('POST', '/api/reports/schedules', {
      type_id:    'shift_handover',
      frequency:  'daily',
      hour:       7,
      recipients: ['ops@axis.test'],
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.schedule.id.startsWith('sch-'));
    assert.ok(r.body.schedule.frequency_human.toLowerCase().includes('daily'));
    assert.ok(r.body.schedule.next_run_at, 'next_run_at should be set');
  });

  it('201 — axis_ops creates weekly schedule', async () => {
    const r = await api('POST', '/api/reports/schedules', {
      type_id:     'gibdlc_monthly',
      frequency:   'weekly',
      day_of_week: 1,
      hour:        8,
    }, opsTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.schedule.frequency_human.includes('Monday'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /api/reports/schedules/:id', () => {
  let schedId;

  before(async () => {
    const r = await api('POST', '/api/reports/schedules', {
      type_id: 'filings_pack', frequency: 'monthly', day_of_month: 15,
    }, adminTok);
    schedId = r.body.schedule.id;
  });

  it('401 without token', async () => {
    assert.equal((await api('PATCH', `/api/reports/schedules/${schedId}`, { hour: 9 })).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('PATCH', `/api/reports/schedules/${schedId}`, { hour: 9 }, haulerTok)).status, 403);
  });

  it('404 for unknown id', async () => {
    assert.equal((await api('PATCH', '/api/reports/schedules/sch-999', { hour: 9 }, adminTok)).status, 404);
  });

  it('200 — axis_admin patches schedule', async () => {
    const r = await api('PATCH', `/api/reports/schedules/${schedId}`, { hour: 9 }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.hour, 9);
  });

  it('200 — axis_ops patches schedule', async () => {
    const r = await api('PATCH', `/api/reports/schedules/${schedId}`,
      { active: false }, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.schedule.active, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/reports/schedules/:id', () => {
  let delId;

  before(async () => {
    const r = await api('POST', '/api/reports/schedules', {
      type_id: 'shift_handover', frequency: 'daily',
    }, adminTok);
    delId = r.body.schedule.id;
  });

  it('401 without token', async () => {
    assert.equal((await api('DELETE', `/api/reports/schedules/${delId}`)).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('DELETE', `/api/reports/schedules/${delId}`, null, haulerTok)).status, 403);
  });

  it('404 for unknown id', async () => {
    assert.equal((await api('DELETE', '/api/reports/schedules/sch-999', null, adminTok)).status, 404);
  });

  it('204 — axis_admin deletes schedule', async () => {
    assert.equal((await api('DELETE', `/api/reports/schedules/${delId}`, null, adminTok)).status, 204);
  });

  it('404 — schedule gone after deletion', async () => {
    assert.equal((await api('DELETE', `/api/reports/schedules/${delId}`, null, adminTok)).status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reports/schedules/:id/run', () => {
  let runId;

  before(async () => {
    const r = await api('POST', '/api/reports/schedules', {
      type_id: 'gibdlc_monthly', frequency: 'monthly', day_of_month: 1,
    }, adminTok);
    runId = r.body.schedule.id;
  });

  it('401 without token', async () => {
    assert.equal((await api('POST', `/api/reports/schedules/${runId}/run`)).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal((await api('POST', `/api/reports/schedules/${runId}/run`, null, haulerTok)).status, 403);
  });

  it('404 for unknown schedule id', async () => {
    assert.equal((await api('POST', '/api/reports/schedules/sch-999/run', null, adminTok)).status, 404);
  });

  it('200 — axis_admin triggers run', async () => {
    const r = await api('POST', `/api/reports/schedules/${runId}/run`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.schedule);
    assert.equal(r.body.message, 'Run triggered');
  });

  it('200 — axis_ops triggers run', async () => {
    assert.equal((await api('POST', `/api/reports/schedules/${runId}/run`, null, opsTok)).status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/reports/ai/generate', () => {
  it('401 without token', async () => {
    assert.equal((await api('POST', '/api/reports/ai/generate', { prompt: 'Weekly ops summary' })).status, 401);
  });

  it('403 for hauler_admin', async () => {
    assert.equal(
      (await api('POST', '/api/reports/ai/generate', { prompt: 'Weekly ops summary' }, haulerTok)).status, 403,
    );
  });

  it('400 — missing prompt', async () => {
    assert.equal((await api('POST', '/api/reports/ai/generate', {}, adminTok)).status, 400);
  });

  it('400 — prompt too short (< 3 chars)', async () => {
    assert.equal((await api('POST', '/api/reports/ai/generate', { prompt: 'ok' }, adminTok)).status, 400);
  });

  it('202 — axis_admin generates AI report', async () => {
    const r = await api('POST', '/api/reports/ai/generate', {
      prompt: 'Summarise last week corridor performance',
    }, adminTok);
    assert.equal(r.status, 202);
    assert.ok(r.body.jobId, 'missing jobId');
    assert.ok(r.body.title, 'missing title');
    assert.ok(r.body.download_url.includes(r.body.jobId), 'download_url should include jobId');
  });

  it('202 — axis_ops generates AI report', async () => {
    assert.equal(
      (await api('POST', '/api/reports/ai/generate', { prompt: 'Hauler rankings this month' }, opsTok)).status, 202,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/reports/ai/download/:jobId', () => {
  let knownJobId;

  before(async () => {
    const r = await api('POST', '/api/reports/ai/generate', {
      prompt: 'Corridor throughput report for download',
    }, adminTok);
    knownJobId = r.body.jobId;
  });

  it('404 for unknown jobId', async () => {
    assert.equal((await api('GET', '/api/reports/ai/download/job-unknown-xyz')).status, 404);
  });

  it('200 with PDF content for known jobId', async () => {
    const r = await fetch(`${base}/api/reports/ai/download/${knownJobId}`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get('content-type').includes('application/pdf'));
    await r.body?.cancel?.();
  });
});
