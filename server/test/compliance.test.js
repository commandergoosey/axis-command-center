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
const PASS = 'test-comp-x7';
insertUser.run('u-adm', 'admin@comp.test', bcrypt.hashSync(PASS, 1), 'Admin', 'axis_admin', null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@comp.test',   bcrypt.hashSync(PASS, 1), 'Ops',   'axis_ops',   null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@comp.test',   bcrypt.hashSync(PASS, 1), 'H01',   'hauler_admin', 'haul-01', 'H01', NOW, NOW);
insertUser.run('u-len', 'len@comp.test',   bcrypt.hashSync(PASS, 1), 'Len',   'lender',     null,      'Fin',  NOW, NOW);

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
app.use('/api/auth',       require('../routes/auth'));
app.use('/api/compliance', require('../routes/compliance'));

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
  adminTok  = await login('admin@comp.test');
  opsTok    = await login('ops@comp.test');
  h01Tok    = await login('h01@comp.test');
  lenderTok = await login('len@comp.test');
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

// Known IDs from mock/compliance
const FILING_DUE       = 'flg-dvla-q1';   // status: DUE
const FILING_ON_TRACK  = 'flg-gha-levy';  // status: ON_TRACK
const FILING_FILED     = 'flg-minc-q1';   // status: FILED
const LICENCE_ID       = 'lic-1021';      // haul-02, Class E licence

// ─────────────────────────────────────────────────────────────────────

describe('GET /api/compliance', () => {
  it('returns 200 without auth (open endpoint)', async () => {
    const r = await api('GET', '/api/compliance');
    assert.equal(r.status, 200);
  });

  it('has expected top-level keys', async () => {
    const r = await api('GET', '/api/compliance');
    assert.ok(r.body.generated_at,                           'generated_at');
    assert.ok(typeof r.body.axle === 'object',               'axle object');
    assert.ok(typeof r.body.hse === 'object',                'hse object');
    assert.ok(Array.isArray(r.body.licence_expiry),          'licence_expiry array');
    assert.ok(Array.isArray(r.body.filings),                 'filings array');
    assert.ok(Array.isArray(r.body.upcoming_deadlines),      'upcoming_deadlines array');
    assert.ok(typeof r.body.health_score === 'object',       'health_score object');
    assert.ok(Array.isArray(r.body.axle_weekly_trend),       'axle_weekly_trend array');
    assert.ok(Array.isArray(r.body.violation_by_type),       'violation_by_type array');
  });

  it('axle object has required fields', async () => {
    const r = await api('GET', '/api/compliance');
    const axle = r.body.axle;
    assert.ok('window_days'     in axle, 'window_days');
    assert.ok('holds'           in axle, 'holds');
    assert.ok('warnings'        in axle, 'warnings');
    assert.ok('delay_min_total' in axle, 'delay_min_total');
    assert.ok(Array.isArray(axle.events),   'axle.events array');
    assert.ok(Array.isArray(axle.by_hauler),'axle.by_hauler array');
    assert.equal(axle.window_days, 30, 'window is 30 days');
  });

  it('hse object has target_per_mtk, current_per_mtk, open_count, events', async () => {
    const r = await api('GET', '/api/compliance');
    const hse = r.body.hse;
    assert.ok('target_per_mtk'      in hse, 'target_per_mtk');
    assert.ok('current_per_mtk'     in hse, 'current_per_mtk');
    assert.ok('trailing_events_90d' in hse, 'trailing_events_90d');
    assert.ok('open_count'          in hse, 'open_count');
    assert.ok(Array.isArray(hse.events),    'hse.events array');
  });

  it('health_score has current, status, compliant_items, total_items, trend', async () => {
    const r = await api('GET', '/api/compliance');
    const hs = r.body.health_score;
    assert.ok(typeof hs.current === 'number',          'current is number');
    assert.ok(['GOOD','WATCH','RISK'].includes(hs.status), 'status is GOOD/WATCH/RISK');
    assert.ok('compliant_items' in hs,                 'compliant_items');
    assert.ok('total_items'     in hs,                 'total_items');
    assert.ok(Array.isArray(hs.trend),                 'trend array');
    assert.equal(hs.trend.length, 8,                   '8 weeks of trend');
  });

  it('axle_weekly_trend has 8 entries with required fields', async () => {
    const r = await api('GET', '/api/compliance');
    assert.equal(r.body.axle_weekly_trend.length, 8, '8 weeks');
    const entry = r.body.axle_weekly_trend[0];
    assert.ok('week'     in entry, 'week');
    assert.ok('holds'    in entry, 'holds');
    assert.ok('warnings' in entry, 'warnings');
    assert.ok('total'    in entry, 'total');
  });

  it('filings array has at least 5 entries from the fixture', async () => {
    const r = await api('GET', '/api/compliance');
    assert.ok(r.body.filings.length >= 5, 'at least 5 filings');
  });

  it('upcoming_deadlines items have kind, label, days_remaining, status', async () => {
    const r = await api('GET', '/api/compliance');
    const d = r.body.upcoming_deadlines[0];
    if (d) {
      assert.ok('kind'           in d, 'kind');
      assert.ok('label'          in d, 'label');
      assert.ok('days_remaining' in d, 'days_remaining');
      assert.ok('status'         in d, 'status');
    }
  });
});

describe('GET /api/compliance/filings/:id', () => {
  it('returns filing detail with evidence_required and submission_history', async () => {
    const r = await api('GET', `/api/compliance/filings/${FILING_DUE}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, FILING_DUE);
    assert.ok(Array.isArray(r.body.evidence_required),    'evidence_required array');
    assert.ok(Array.isArray(r.body.submission_history),   'submission_history array');
    assert.equal(r.body.submission_history.length, 4,     '4 periods of history');
  });

  it('returns 404 for unknown filing id', async () => {
    const r = await api('GET', '/api/compliance/filings/flg-bogus');
    assert.equal(r.status, 404);
  });
});

describe('POST /api/compliance/filings/:id/mark-filed', () => {
  it('returns 403 for hauler_admin (write restricted to axis_admin/ops)', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_DUE}/mark-filed`, {}, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 403 for lender', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_DUE}/mark-filed`, {}, lenderTok);
    assert.equal(r.status, 403);
  });

  it('returns 401 without auth', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_DUE}/mark-filed`, {});
    assert.equal(r.status, 401);
  });

  it('marks a DUE filing as FILED for axis_admin', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_DUE}/mark-filed`, {}, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.submitted_at, 'submitted_at returned');
    assert.ok(r.body.submitted_by, 'submitted_by returned');
    assert.equal(r.body.filing.status, 'FILED', 'filing status is FILED');
  });

  it('returns 400 on double-file', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_DUE}/mark-filed`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('already'), 'error mentions already');
  });

  it('marks an ON_TRACK filing for axis_ops', async () => {
    const r = await api('POST', `/api/compliance/filings/${FILING_ON_TRACK}/mark-filed`, {}, opsTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.filing.status, 'FILED');
  });

  it('returns 404 for unknown filing id', async () => {
    const r = await api('POST', '/api/compliance/filings/flg-bogus/mark-filed', {}, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('POST /api/compliance/licences/:id/renew', () => {
  const futureExpiry = new Date(Date.now() + 2 * 365 * 86_400_000).toISOString().slice(0, 10);

  it('returns 403 for hauler_admin', async () => {
    const r = await api('POST', `/api/compliance/licences/${LICENCE_ID}/renew`,
      { expiry_iso: futureExpiry }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 400 when expiry_iso is missing', async () => {
    const r = await api('POST', `/api/compliance/licences/${LICENCE_ID}/renew`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('expiry_iso'), 'error mentions expiry_iso');
  });

  it('returns 400 when expiry_iso is in the past', async () => {
    const r = await api('POST', `/api/compliance/licences/${LICENCE_ID}/renew`,
      { expiry_iso: '2020-01-01' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('returns 404 for unknown licence id', async () => {
    const r = await api('POST', '/api/compliance/licences/lic-bogus/renew',
      { expiry_iso: futureExpiry }, adminTok);
    assert.equal(r.status, 404);
  });

  it('renews a licence and extends expiry for axis_admin', async () => {
    const r = await api('POST', `/api/compliance/licences/${LICENCE_ID}/renew`, {
      expiry_iso: futureExpiry,
      ref_number: 'DVLA-2026-88001',
      note: 'Annual renewal',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body.licence,               'licence returned');
    assert.ok(r.body.saved,                 'saved object returned');
    assert.equal(r.body.licence.renewed, true, 'renewed flag is true');
    assert.equal(r.body.licence.expiry.slice(0, 10), futureExpiry, 'expiry updated');
  });
});

describe('HSE incident lifecycle', () => {
  let incidentId;

  it('returns 403 for hauler_admin (axis_admin/ops only)', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      hauler_id: 'haul-01', type: 'Near miss', category: 'B',
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 400 when hauler_id is missing', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      type: 'Near miss', category: 'B',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('hauler_id'), 'error mentions hauler_id');
  });

  it('returns 400 when type is missing', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      hauler_id: 'haul-01', category: 'B',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('type'), 'error mentions type');
  });

  it('returns 400 for invalid category (not A or B)', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      hauler_id: 'haul-01', type: 'Near miss', category: 'C',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('category'), 'error mentions category');
  });

  it('creates a Cat B incident successfully', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      hauler_id: 'haul-01',
      truck: 'GH-0001-TK',
      driver: 'Kofi Mensah',
      category: 'B',
      type: 'Near miss — pedestrian proximity',
      km_marker: 42,
      note: 'No injury; speed exceeded in loading zone',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.incident.id,                        'incident id returned');
    assert.equal(r.body.incident.status, 'OPEN',         'status is OPEN');
    assert.equal(r.body.incident.category, 'B',          'category is B');
    assert.equal(r.body.incident.source, 'overlay',      'source is overlay');
    incidentId = r.body.incident.id;
  });

  it('creates a Cat A incident using axis_ops', async () => {
    const r = await api('POST', '/api/compliance/incidents', {
      hauler_id: 'haul-02',
      category: 'A',
      type: 'Vehicle rollover — loaded',
    }, opsTok);
    assert.equal(r.status, 201);
    assert.equal(r.body.incident.category, 'A');
  });

  it('closing incident returns 400 when corrective_action is missing', async () => {
    const r = await api('POST', `/api/compliance/incidents/${incidentId}/close`, {}, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('corrective_action'), 'error mentions corrective_action');
  });

  it('closes the incident with corrective_action', async () => {
    const r = await api('POST', `/api/compliance/incidents/${incidentId}/close`, {
      corrective_action: 'Speed limiters recalibrated; driver re-briefed on zone limits',
    }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.incident.status, 'CLOSED',  'status is CLOSED');
    assert.ok(r.body.incident.closed_at,             'closed_at set');
    assert.ok(r.body.incident.corrective_action,     'corrective_action saved');
  });

  it('returns 404 when closing an unknown incident', async () => {
    const r = await api('POST', '/api/compliance/incidents/inc-bogus/close', {
      corrective_action: 'N/A',
    }, adminTok);
    assert.equal(r.status, 404);
  });
});

describe('POST /api/compliance/weighbridge', () => {
  it('returns 403 for hauler_admin (axis_admin/ops only)', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0001-TK', gross_weight_t: 65,
    }, h01Tok);
    assert.equal(r.status, 403);
  });

  it('returns 401 without auth', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0001-TK', gross_weight_t: 65,
    });
    assert.equal(r.status, 401);
  });

  it('returns 400 when plate is missing', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      gross_weight_t: 65,
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('plate'), 'error mentions plate');
  });

  it('returns 400 when gross_weight_t is missing', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0001-TK',
    }, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('gross_weight_t'), 'error mentions gross_weight_t');
  });

  it('returns 400 for non-positive gross_weight_t', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0001-TK', gross_weight_t: -5,
    }, adminTok);
    assert.equal(r.status, 400);
  });

  it('creates a weighbridge event successfully', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0031-TK',
      gross_weight_t: 67.5,
      hauler_id: 'haul-02',
      limit_t: 60,
      hold_minutes: 45,
      weighbridge: 'Takoradi Port · WB-3',
      notes: 'Loaded with excess bauxite',
    }, adminTok);
    assert.equal(r.status, 201);
    assert.ok(r.body.event.id,                      'event id returned');
    assert.equal(r.body.event.plate, 'GH-0031-TK',  'plate matches (uppercased)');
    assert.equal(r.body.event.gross_weight_t, 67.5, 'gross_weight_t stored');
    assert.ok(r.body.event.overage_t > 0,           'overage_t computed');
  });

  it('axis_ops can log a weighbridge event', async () => {
    const r = await api('POST', '/api/compliance/weighbridge', {
      plate: 'GH-0001-TK', gross_weight_t: 62,
    }, opsTok);
    assert.equal(r.status, 201);
  });

  it('live event appears in GET /api/compliance axle.events', async () => {
    const r = await api('GET', '/api/compliance');
    const liveEvents = r.body.axle.events.filter((e) => e.is_live === true);
    assert.ok(liveEvents.length >= 2, 'at least 2 live weighbridge events in axle.events');
  });
});
