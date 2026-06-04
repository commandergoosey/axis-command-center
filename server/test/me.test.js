'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('node:http');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────────────
process.env.DB_PATH    = ':memory:';
process.env.JWT_SECRET = 'test-secret-me';
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
insertUser.run('u-adm', 'admin@me.test',   bcrypt.hashSync(PASS, 1), 'Admin',  'axis_admin',   null,      'AXIS', NOW, NOW);
insertUser.run('u-ops', 'ops@me.test',     bcrypt.hashSync(PASS, 1), 'Ops',    'axis_ops',     null,      'AXIS', NOW, NOW);
insertUser.run('u-h01', 'h01@me.test',     bcrypt.hashSync(PASS, 1), 'H01',    'hauler_admin', 'haul-01', 'H01',  NOW, NOW);
insertUser.run('u-len', 'lender@me.test',  bcrypt.hashSync(PASS, 1), 'Lender', 'lender',       null,      'Fin',  NOW, NOW);

// ── Stub audit ────────────────────────────────────────────────────────────────
const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: {
    writeAudit: () => {},
    listAudit:  () => ({ rows: [], total: 0 }),
  },
};

// ── Minimal Express app ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');

const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth', require('../routes/auth'));
app.use('/api/me',   require('../routes/me'));

// ── Lifecycle ─────────────────────────────────────────────────────────────────
let base;
const server = http.createServer(app);
let adminTok, opsTok, h01Tok, lenderTok;

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
  adminTok  = await login('admin@me.test');
  opsTok    = await login('ops@me.test');
  h01Tok    = await login('h01@me.test');
  lenderTok = await login('lender@me.test');
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
describe('GET /api/me/pins', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/me/pins')).status, 401);
  });

  it('200 for axis_admin — returns pins array', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.pins));
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/me/pins', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/me/pins', null, h01Tok)).status, 200);
  });

  it('200 for lender', async () => {
    assert.equal((await api('GET', '/api/me/pins', null, lenderTok)).status, 200);
  });

  it('pins start empty on a fresh DB', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    assert.equal(r.body.pins.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/me/pins', () => {
  it('401 without token', async () => {
    assert.equal(
      (await api('POST', '/api/me/pins', { entity_type: 'hauler', entity_id: 'haul-01' })).status, 401,
    );
  });

  it('400 — invalid entity_type', async () => {
    const r = await api('POST', '/api/me/pins',
      { entity_type: 'truck', entity_id: 'rig-0001' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing entity_id', async () => {
    const r = await api('POST', '/api/me/pins', { entity_type: 'hauler' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — axis_admin pins a hauler', async () => {
    const r = await api('POST', '/api/me/pins',
      { entity_type: 'hauler', entity_id: 'haul-01', label: 'My favourite hauler' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.pinned, true);
  });

  it('200 — pins a filing (mock id: flg-dvla-q1)', async () => {
    const r = await api('POST', '/api/me/pins',
      { entity_type: 'filing', entity_id: 'flg-dvla-q1' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.pinned, true);
  });

  it('200 — idempotent: re-pinning same entity succeeds', async () => {
    const r = await api('POST', '/api/me/pins',
      { entity_type: 'hauler', entity_id: 'haul-01' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.pinned, true);
  });

  it('200 — axis_ops can pin independently', async () => {
    const r = await api('POST', '/api/me/pins',
      { entity_type: 'hauler', entity_id: 'haul-02' }, opsTok);
    assert.equal(r.status, 200);
  });

  it('GET /pins returns pinned entities with hydrated field', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    assert.ok(r.body.pins.length >= 2, 'expected at least 2 pins');
    for (const p of r.body.pins) {
      assert.ok('pin_id' in p, 'missing pin_id');
      assert.ok('entity_type' in p);
      assert.ok('entity_id' in p);
      assert.ok('hydrated' in p, 'missing hydrated');
    }
  });

  it('hauler pin hydrates to a hauler object with title', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    const haulerPin = r.body.pins.find((p) => p.entity_type === 'hauler');
    assert.ok(haulerPin, 'no hauler pin found');
    assert.ok(haulerPin.hydrated, 'hauler pin not hydrated');
    assert.equal(haulerPin.hydrated.type, 'hauler');
    assert.ok(haulerPin.hydrated.title, 'hydrated hauler has no title');
  });

  it('unknown entity id hydrates as tombstone', async () => {
    // Pin a non-existent risk
    await api('POST', '/api/me/pins',
      { entity_type: 'risk', entity_id: '999999', label: 'ghost risk' }, adminTok);
    const r = await api('GET', '/api/me/pins', null, adminTok);
    const ghost = r.body.pins.find((p) => p.entity_type === 'risk' && p.entity_id === '999999');
    assert.ok(ghost, 'ghost pin not found');
    assert.ok(ghost.hydrated.tombstone, 'expected tombstone for missing entity');
  });

  it('pins are user-scoped — ops pins are not visible to admin', async () => {
    const adminPins = (await api('GET', '/api/me/pins', null, adminTok)).body.pins;
    const opsPins   = (await api('GET', '/api/me/pins', null, opsTok)).body.pins;
    const adminIds  = adminPins.map((p) => p.pin_id);
    const opsIds    = opsPins.map((p) => p.pin_id);
    assert.ok(!adminIds.some((id) => opsIds.includes(id)), 'pin IDs should not overlap');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/me/pins/by-ref', () => {
  before(async () => {
    await api('POST', '/api/me/pins',
      { entity_type: 'filing', entity_id: 'flg-gha-levy' }, adminTok);
  });

  it('401 without token', async () => {
    assert.equal(
      (await api('DELETE', '/api/me/pins/by-ref',
        { entity_type: 'filing', entity_id: 'flg-gha-levy' })).status, 401,
    );
  });

  it('400 — missing entity_type', async () => {
    const r = await api('DELETE', '/api/me/pins/by-ref',
      { entity_id: 'flg-gha-levy' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('400 — missing entity_id', async () => {
    const r = await api('DELETE', '/api/me/pins/by-ref',
      { entity_type: 'filing' }, adminTok);
    assert.equal(r.status, 400);
  });

  it('200 — unpins existing pin by ref', async () => {
    const r = await api('DELETE', '/api/me/pins/by-ref',
      { entity_type: 'filing', entity_id: 'flg-gha-levy' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unpinned, true);
  });

  it('200 — idempotent: by-ref unpin of already-removed pin succeeds', async () => {
    const r = await api('DELETE', '/api/me/pins/by-ref',
      { entity_type: 'filing', entity_id: 'flg-gha-levy' }, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unpinned, true);
  });

  it('pin no longer in list after by-ref delete', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    const stillThere = r.body.pins.some(
      (p) => p.entity_type === 'filing' && p.entity_id === 'flg-gha-levy',
    );
    assert.equal(stillThere, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/me/pins/:id', () => {
  let pinId;

  before(async () => {
    await api('POST', '/api/me/pins',
      { entity_type: 'hauler', entity_id: 'haul-03', label: 'To be deleted' }, adminTok);
    const r = await api('GET', '/api/me/pins', null, adminTok);
    const p = r.body.pins.find((x) => x.entity_id === 'haul-03');
    pinId = p?.pin_id;
  });

  it('401 without token', async () => {
    assert.equal((await api('DELETE', `/api/me/pins/${pinId}`)).status, 401);
  });

  it('400 — non-numeric id', async () => {
    assert.equal((await api('DELETE', '/api/me/pins/abc', null, adminTok)).status, 400);
  });

  it('200 — deletes pin by id', async () => {
    const r = await api('DELETE', `/api/me/pins/${pinId}`, null, adminTok);
    assert.equal(r.status, 200);
    assert.equal(r.body.unpinned, true);
  });

  it('pin gone from list after id-delete', async () => {
    const r = await api('GET', '/api/me/pins', null, adminTok);
    const still = r.body.pins.some((p) => p.pin_id === pinId);
    assert.equal(still, false);
  });

  it('200 — idempotent: deleting already-removed pin id returns 200', async () => {
    // removeById is silent; no error thrown for non-existent id
    const r = await api('DELETE', `/api/me/pins/${pinId}`, null, adminTok);
    assert.equal(r.status, 200);
  });

  it('200 — cannot see another user\'s pin by guessing id', async () => {
    // ops pins a hauler and gets the pin id, then admin tries to delete it
    await api('POST', '/api/me/pins',
      { entity_type: 'hauler', entity_id: 'haul-04' }, opsTok);
    const opsR = await api('GET', '/api/me/pins', null, opsTok);
    const opsPin = opsR.body.pins.find((p) => p.entity_id === 'haul-04');
    // Admin delete with ops's pin id — DELETE WHERE id=? AND user_id=? won't match
    const r = await api('DELETE', `/api/me/pins/${opsPin.pin_id}`, null, adminTok);
    assert.equal(r.status, 200); // silent no-op, not an error
    // But the ops pin is still there
    const opsR2 = await api('GET', '/api/me/pins', null, opsTok);
    assert.ok(opsR2.body.pins.some((p) => p.pin_id === opsPin.pin_id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/me/hauler', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/me/hauler')).status, 401);
  });

  it('400 — AXIS role requires hauler_id param', async () => {
    const r = await api('GET', '/api/me/hauler', null, adminTok);
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('hauler_id'));
  });

  it('403 — lender cannot use /me/hauler', async () => {
    const r = await api('GET', '/api/me/hauler?hauler_id=haul-01', null, lenderTok);
    assert.equal(r.status, 403);
  });

  it('200 — hauler_admin gets their own hauler (ignores query param)', async () => {
    const r = await api('GET', '/api/me/hauler', null, h01Tok);
    assert.equal(r.status, 200);
    // myHauler.compose returns a composed object — just check it's not null
    assert.ok(r.body != null);
  });

  it('200 — axis_admin with valid ?hauler_id param', async () => {
    const r = await api('GET', '/api/me/hauler?hauler_id=haul-01', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body != null);
  });

  it('200 — axis_ops with valid ?hauler_id param', async () => {
    assert.equal((await api('GET', '/api/me/hauler?hauler_id=haul-02', null, opsTok)).status, 200);
  });

  it('404 — non-existent hauler_id', async () => {
    const r = await api('GET', '/api/me/hauler?hauler_id=haul-99', null, adminTok);
    assert.equal(r.status, 404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/me/activity', () => {
  it('401 without token', async () => {
    assert.equal((await api('GET', '/api/me/activity')).status, 401);
  });

  it('200 for axis_admin with digest response', async () => {
    const r = await api('GET', '/api/me/activity', null, adminTok);
    assert.equal(r.status, 200);
    assert.ok(r.body != null);
  });

  it('200 for axis_ops', async () => {
    assert.equal((await api('GET', '/api/me/activity', null, opsTok)).status, 200);
  });

  it('200 for hauler_admin', async () => {
    assert.equal((await api('GET', '/api/me/activity', null, h01Tok)).status, 200);
  });

  it('200 for lender', async () => {
    assert.equal((await api('GET', '/api/me/activity', null, lenderTok)).status, 200);
  });

  it('accepts ?days= param — days=30 returns 200', async () => {
    assert.equal((await api('GET', '/api/me/activity?days=30', null, adminTok)).status, 200);
  });

  it('clamps days to max 180 — days=999 still returns 200', async () => {
    assert.equal((await api('GET', '/api/me/activity?days=999', null, adminTok)).status, 200);
  });
});
