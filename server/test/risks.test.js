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

const NOW = new Date().toISOString();
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
const PASS = 'test-risk-x7';
insertUser.run('u-adm', 'admin@risk.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@risk.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@risk.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'len@risk.test',   bcrypt.hashSync(PASS, 1), 'Len',   'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ───────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {}, listAudit: () => ({ rows: [], total: 0 }) },
};

// ── Minimal Express app ───────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',  require('../routes/auth'));
app.use('/api/risks', require('../routes/risks'));

// ── Lifecycle ─────────────────────────────────────────────────────────
let base;
let adminTok, opsTok, h01Tok, lenderTok;
const server = http.createServer(app);

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
  adminTok  = await login('admin@risk.test');
  opsTok    = await login('ops@risk.test');
  h01Tok    = await login('h01@risk.test');
  lenderTok = await login('len@risk.test');
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

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/risks', () => {
  it('returns 401 without auth', async () => {
    const r = await api('GET', '/api/risks');
    assert.equal(r.status, 401);
  });

  it('returns 200 with risks, counts, matrix, and trend fields', async () => {
    const r = await api('GET', '/api/risks', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.risks),              'risks array');
    assert.ok(typeof r.body.counts === 'object',        'counts object');
    assert.ok(Array.isArray(r.body.matrix),             'matrix array');
    assert.ok(Array.isArray(r.body.exposure_trend),     'exposure_trend array');
    assert.ok(Array.isArray(r.body.category_breakdown), 'category_breakdown array');
    assert.ok(Array.isArray(r.body.velocity_trend),     'velocity_trend array');
    assert.ok(Array.isArray(r.body.risk_age_profile),   'risk_age_profile array');
  });

  it('exposure_trend has 8 weeks', async () => {
    const r = await api('GET', '/api/risks', null, adminTok);
    assert.equal(r.body.exposure_trend.length, 8, '8 weeks of exposure trend');
    const entry = r.body.exposure_trend[0];
    assert.ok('week'  in entry, 'week');
    assert.ok('score' in entry, 'score');
  });

  it('matrix rows have likelihood and cells', async () => {
    const r = await api('GET', '/api/risks', null, adminTok);
    assert.equal(r.body.matrix.length, 5, '5 likelihood rows');
    const row = r.body.matrix[0];
    assert.ok('likelihood' in row, 'likelihood');
    assert.ok(Array.isArray(row.cells), 'cells array');
    assert.equal(row.cells.length, 4, '4 severity columns');
  });

  it('risks each have steps_summary and comments_summary', async () => {
    // Seed a risk first so we have data to check
    await api('POST', '/api/risks', {
      title: 'Seed risk for GET test',
      category: 'operational',
      severity: 'medium',
      likelihood: 'possible',
    }, adminTok);
    const r = await api('GET', '/api/risks', null, adminTok);
    const risk = r.body.risks[0];
    assert.ok('steps_summary'    in risk, 'steps_summary present');
    assert.ok('comments_summary' in risk, 'comments_summary present');
    assert.ok('done_count'  in risk.steps_summary,   'done_count');
    assert.ok('total_count' in risk.steps_summary,   'total_count');
  });

  it('lender can read risks (auth only, no role gate)', async () => {
    const r = await api('GET', '/api/risks', null, lenderTok);
    assert.equal(r.status, 200);
  });
});

describe('GET /api/risks/options', () => {
  it('returns categories, severities, likelihoods, statuses', async () => {
    const r = await api('GET', '/api/risks/options', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.categories),  'categories array');
    assert.ok(Array.isArray(r.body.severities),  'severities array');
    assert.ok(Array.isArray(r.body.likelihoods), 'likelihoods array');
    assert.ok(Array.isArray(r.body.statuses),    'statuses array');
    assert.ok(r.body.categories.includes('operational'),    'operational category');
    assert.ok(r.body.severities.includes('critical'),       'critical severity');
    assert.ok(r.body.likelihoods.includes('almost_certain'),'almost_certain likelihood');
    assert.ok(r.body.statuses.includes('open'),             'open status');
  });
});

describe('Risk CRUD (create / update / archive / delete)', () => {
  let riskId;
  let opsRiskId;

  it('returns 403 for hauler_admin trying to create', async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Test', category: 'operational', severity: 'low', likelihood: 'rare',
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for lender trying to create', async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Test', category: 'operational', severity: 'low', likelihood: 'rare',
    }, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 400 when title is missing', async () => {
    const r = await api('POST', '/api/risks', {
      category: 'operational', severity: 'low', likelihood: 'rare',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.toLowerCase().includes('title'), 'error mentions title');
  });

  it('returns 400 for invalid category', async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Bad cat', category: 'alien', severity: 'low', likelihood: 'rare',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('category'), 'error mentions category');
  });

  it('returns 400 for invalid severity', async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Bad sev', category: 'operational', severity: 'extreme', likelihood: 'rare',
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('creates a risk successfully for axis_admin', async () => {
    const r = await api('POST', '/api/risks', {
      title:           'Diesel price spike — Q3 corridor',
      category:        'financial',
      severity:        'high',
      likelihood:      'possible',
      status:          'open',
      mitigation_plan: 'Hedge 30% of monthly volume via forward contracts',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.risk.id,                                  'id returned');
    assert.equal(r.body.risk.title, 'Diesel price spike — Q3 corridor');
    assert.equal(r.body.risk.category, 'financial',            'category matches');
    assert.equal(r.body.risk.severity, 'high',                 'severity matches');
    assert.equal(r.body.risk.status, 'open',                   'status is open');
    riskId = r.body.risk.id;
  });

  it('axis_ops can create a risk', async () => {
    const r = await api('POST', '/api/risks', {
      title:      'Driver shortage — Kumasi hiring pool',
      category:   'operational',
      severity:   'medium',
      likelihood: 'likely',
    }, opsTok);
    assert.equal(r.status, 200);
    opsRiskId = r.body.risk.id;
  });

  it('PATCH updates risk fields', async () => {
    const r = await api('PATCH', `/api/risks/${riskId}`, {
      severity:   'critical',
      likelihood: 'likely',
      status:     'mitigating',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.risk.severity,   'critical',   'severity updated');
    assert.equal(r.body.risk.likelihood, 'likely',     'likelihood updated');
    assert.equal(r.body.risk.status,     'mitigating', 'status updated');
  });

  it('PATCH returns 404 for unknown id', async () => {
    const r = await api('PATCH', '/api/risks/99999', { severity: 'low' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('PATCH returns 400 for invalid severity', async () => {
    const r = await api('PATCH', `/api/risks/${riskId}`, { severity: 'extreme' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('review bumps last_reviewed_at', async () => {
    const r = await api('POST', `/api/risks/${riskId}/review`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.risk.last_reviewed_at, 'last_reviewed_at set');
  });

  it('review returns 404 for unknown risk', async () => {
    const r = await api('POST', '/api/risks/99999/review', {}, adminTok);
    assert.equal(r.status, 404);
  });

  it('archive soft-deletes the risk', async () => {
    const r = await api('POST', `/api/risks/${opsRiskId}/archive`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.archived, true);
  });

  it('archived risk no longer appears in the list', async () => {
    const r = await api('GET', '/api/risks', null, adminTok);
    const found = r.body.risks.find((x) => x.id === opsRiskId);
    assert.ok(!found, 'archived risk absent from active list');
  });

  it('unarchive restores the risk', async () => {
    const r = await api('POST', `/api/risks/${opsRiskId}/unarchive`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unarchived, true);
  });

  it('restored risk reappears in the list', async () => {
    const r = await api('GET', '/api/risks', null, adminTok);
    const found = r.body.risks.find((x) => x.id === opsRiskId);
    assert.ok(found, 'unarchived risk back in list');
  });

  it('DELETE returns 403 for axis_ops (admin only)', async () => {
    const r = await api('DELETE', `/api/risks/${opsRiskId}`, null, opsTok);
    assert.equal(r.status, 403);
  });

  it('DELETE hard-deletes for axis_admin', async () => {
    const r = await api('DELETE', `/api/risks/${opsRiskId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('DELETE returns 404 after risk is gone', async () => {
    const r = await api('DELETE', `/api/risks/${opsRiskId}`, null, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('Risk mitigation steps', () => {
  let riskId;
  let stepId;
  let stepId2;

  before(async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Steps test risk', category: 'compliance', severity: 'high', likelihood: 'unlikely',
    }, adminTok);
    riskId = r.body.risk.id;
  });

  it('GET /steps returns 401 without auth', async () => {
    const r = await api('GET', `/api/risks/${riskId}/steps`);
    assert.equal(r.status, 401);
  });

  it('GET /steps returns empty steps list initially', async () => {
    const r = await api('GET', `/api/risks/${riskId}/steps`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.steps), 'steps array');
    assert.equal(r.body.steps.length, 0, 'no steps initially');
    assert.equal(r.body.risk_id, riskId, 'risk_id matches');
  });

  it('POST /steps returns 403 for hauler_admin', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps`, { title: 'Check X' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('POST /steps returns 400 when title is missing', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps`, {}, adminTok);
    assert.equal(r.status, 400);
  });

  it('creates a step successfully', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps`, {
      title: 'File monthly levy return',
      due_date: '2026-06-30',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.step.id,                                'step id returned');
    assert.equal(r.body.step.title, 'File monthly levy return');
    assert.equal(r.body.step.status, 'open',                 'initial status is open');
    stepId = r.body.step.id;
  });

  it('creates a second step for reopen testing', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps`, {
      title: 'Verify GHA reconciliation',
    }, opsTok);
    assert.equal(r.status, 200);
    stepId2 = r.body.step.id;
  });

  it('PATCH updates step title', async () => {
    const r = await api('PATCH', `/api/risks/${riskId}/steps/${stepId}`, {
      title: 'File monthly levy return — updated',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.step.title, 'File monthly levy return — updated');
  });

  it('PATCH returns 404 for unknown step', async () => {
    const r = await api('PATCH', `/api/risks/${riskId}/steps/99999`, { title: 'X' }, adminTok);
    assert.equal(r.status, 404);
  });

  it('complete marks step as done', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps/${stepId}/complete`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.step.status, 'done',    'status is done');
    assert.ok(r.body.step.completed_at,          'completed_at set');
    assert.ok(r.body.step.completed_by,          'completed_by set');
  });

  it('complete returns 404 for wrong risk', async () => {
    // stepId belongs to riskId, not to risk 99999
    const r = await api('POST', `/api/risks/99999/steps/${stepId}/complete`, {}, adminTok);
    assert.equal(r.status, 404);
  });

  it('reopen restores step to open', async () => {
    const r = await api('POST', `/api/risks/${riskId}/steps/${stepId}/reopen`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.step.status, 'open', 'status reverted to open');
    assert.ok(!r.body.step.completed_at, 'completed_at cleared');
  });

  it('GET /steps lists both steps', async () => {
    const r = await api('GET', `/api/risks/${riskId}/steps`, null, adminTok);
    assert.equal(r.body.steps.length, 2, '2 steps returned');
  });

  it('DELETE /steps/:stepId removes the step', async () => {
    const r = await api('DELETE', `/api/risks/${riskId}/steps/${stepId2}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('step count reduced after delete', async () => {
    const r = await api('GET', `/api/risks/${riskId}/steps`, null, adminTok);
    assert.equal(r.body.steps.length, 1, '1 step left after delete');
  });

  it('GET /steps returns 404 for unknown risk', async () => {
    const r = await api('GET', '/api/risks/99999/steps', null, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('Risk comments', () => {
  let riskId;
  let adminCommentId;
  let opsCommentId;

  before(async () => {
    const r = await api('POST', '/api/risks', {
      title: 'Comment test risk', category: 'strategic', severity: 'low', likelihood: 'rare',
    }, adminTok);
    riskId = r.body.risk.id;
  });

  it('GET /comments returns 401 without auth', async () => {
    const r = await api('GET', `/api/risks/${riskId}/comments`);
    assert.equal(r.status, 401);
  });

  it('GET /comments returns empty list initially', async () => {
    const r = await api('GET', `/api/risks/${riskId}/comments`, null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.comments), 'comments array');
    assert.equal(r.body.comments.length, 0,   'no comments initially');
  });

  it('POST /comments returns 403 for hauler_admin', async () => {
    const r = await api('POST', `/api/risks/${riskId}/comments`, { body: 'Test' }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('POST /comments returns 400 when body is missing', async () => {
    const r = await api('POST', `/api/risks/${riskId}/comments`, {}, adminTok);
    assert.equal(r.status, 400);
  });

  it('admin posts a comment successfully', async () => {
    const r = await api('POST', `/api/risks/${riskId}/comments`, {
      body: 'Reviewing with legal team next week',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.comment.id,    'comment id returned');
    assert.ok(r.body.comment.body,  'body present');
    assert.ok(r.body.comment.author,'author present');
    adminCommentId = r.body.comment.id;
  });

  it('ops posts a comment', async () => {
    const r = await api('POST', `/api/risks/${riskId}/comments`, {
      body: 'Confirmed hedge terms with FX desk',
    }, opsTok);
    assert.equal(r.status, 200);
    opsCommentId = r.body.comment.id;
  });

  it('GET /comments lists both comments', async () => {
    const r = await api('GET', `/api/risks/${riskId}/comments`, null, lenderTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.comments.length, 2, '2 comments returned');
  });

  it('hauler_admin cannot delete an admin comment (not author, not admin)', async () => {
    const r = await api('DELETE', `/api/risks/${riskId}/comments/${adminCommentId}`, null, h01Tok);
    assert.equal(r.status, 403);
  });

  it('ops (as author) can delete their own comment', async () => {
    const r = await api('DELETE', `/api/risks/${riskId}/comments/${opsCommentId}`, null, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('axis_admin can delete any comment', async () => {
    const r = await api('DELETE', `/api/risks/${riskId}/comments/${adminCommentId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
  });

  it('returns 404 for deleted comment', async () => {
    const r = await api('DELETE', `/api/risks/${riskId}/comments/${adminCommentId}`, null, adminTok);
    assert.equal(r.status, 404);
  });

  it('GET /comments returns 404 for unknown risk', async () => {
    const r = await api('GET', '/api/risks/99999/comments', null, adminTok);
    assert.equal(r.status, 404);
  });
});
