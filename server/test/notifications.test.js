'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
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
const ADMIN_PASS = 'adm-notif-xx9';
const OPS_PASS   = 'ops-notif-xx9';
const HAUL_PASS  = 'hau-notif-xx9';
const LEND_PASS  = 'len-notif-xx9';
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);
insertUser.run('u-adm',  'admin@notif.gh',  bcrypt.hashSync(ADMIN_PASS, 1), 'Test Admin',  'axis_admin',   null,      'AXIS',  NOW, NOW);
insertUser.run('u-ops',  'ops@notif.gh',    bcrypt.hashSync(OPS_PASS,   1), 'Test Ops',    'axis_ops',     null,      'AXIS',  NOW, NOW);
insertUser.run('u-hau',  'haul@notif.gh',   bcrypt.hashSync(HAUL_PASS,  1), 'Hauler One',  'hauler_admin', 'haul-01', 'TruckCo', NOW, NOW);
insertUser.run('u-len',  'lender@notif.gh', bcrypt.hashSync(LEND_PASS,  1), 'Test Lender', 'lender',       null,      'Finance', NOW, NOW);

// ── Stubs (before requiring any state/route modules) ──────────────────
const notifPushKey = require.resolve('../services/notifPush');
const pushCalls = [];
require.cache[notifPushKey] = {
  id: notifPushKey, filename: notifPushKey, loaded: true,
  exports: {
    pushToUser: (uid, event, data) => { pushCalls.push({ uid, event, data }); },
    add:    () => {},
    remove: () => {},
  },
};

const auditKey = require.resolve('../db/audit');
require.cache[auditKey] = {
  id: auditKey, filename: auditKey, loaded: true,
  exports: { writeAudit: () => {} },
};

// ── Load modules under test ───────────────────────────────────────────
// notifications state must be loaded AFTER db is set up (it runs CREATE TABLE
// at module load time which needs the :memory: db to be open).
delete require.cache[require.resolve('../state/notifications')];
const notifications = require('../state/notifications');

// ── HTTP server ───────────────────────────────────────────────────────
const express        = require('express');
const { attachUser } = require('../middleware/auth');
const app = express();
app.use(express.json());
app.use(attachUser);
app.use('/api/auth',          require('../routes/auth'));
app.use('/api/notifications', require('../routes/notifications'));

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

function clearNotifications() {
  db.exec('DELETE FROM notifications; DELETE FROM notification_prefs');
}

// ─────────────────────────────────────────────────────────────────────

describe('notifications state — emit()', () => {
  beforeEach(clearNotifications);

  it('returns a numeric id on success', () => {
    const id = notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Test notification' });
    assert.ok(typeof id === 'number' && id > 0);
  });

  it('stored notification appears in forUser()', () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Alert assigned to you' });
    const items = notifications.forUser('u-adm', 10);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].event_type, 'assignment');
    assert.strictEqual(items[0].body,       'Alert assigned to you');
    assert.strictEqual(items[0].read,       false);
  });

  it('returns null and inserts nothing for self-notification', () => {
    const result = notifications.emit({
      user_id:       'u-adm',
      event_type:    'comment',
      body:          'You commented',
      actor_user_id: 'u-adm',
    });
    assert.strictEqual(result, null);
    assert.strictEqual(notifications.forUser('u-adm', 10).length, 0);
  });

  it('returns null when user has opted out of that event_type', () => {
    notifications.setPref('u-adm', 'comment', false);
    const result = notifications.emit({ user_id: 'u-adm', event_type: 'comment', body: 'Opted-out event' });
    assert.strictEqual(result, null);
    assert.strictEqual(notifications.forUser('u-adm', 10).length, 0);
  });

  it('stores link path and label', () => {
    notifications.emit({
      user_id:    'u-adm',
      event_type: 'assignment',
      body:       'Test',
      link:       { path: '/alerts/al-001', label: 'View alert' },
    });
    const [item] = notifications.forUser('u-adm', 1);
    assert.ok(item.link);
    assert.strictEqual(item.link.path,  '/alerts/al-001');
    assert.strictEqual(item.link.label, 'View alert');
  });

  it('stores actor info', () => {
    notifications.emit({
      user_id:       'u-adm',
      event_type:    'assignment',
      body:          'Assigned by Ops',
      actor_user_id: 'u-ops',
      actor_display: 'Test Ops',
    });
    const [item] = notifications.forUser('u-adm', 1);
    assert.strictEqual(item.actor.user_id,      'u-ops');
    assert.strictEqual(item.actor.display_name, 'Test Ops');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications state — read / count', () => {
  beforeEach(clearNotifications);

  it('unreadCount returns 0 when there are no notifications', () => {
    assert.strictEqual(notifications.unreadCount('u-adm'), 0);
  });

  it('unreadCount increments on each emit', () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'A' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'B' });
    assert.strictEqual(notifications.unreadCount('u-adm'), 2);
  });

  it('markRead sets read_at on the specified notification', () => {
    const id = notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Mark me' });
    notifications.markRead(id, 'u-adm');
    const [item] = notifications.forUser('u-adm', 1);
    assert.strictEqual(item.read, true);
    assert.ok(item.read_at);
  });

  it('markRead only marks the target row — other rows stay unread', () => {
    const id1 = notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'First' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment', body: 'Second' });
    notifications.markRead(id1, 'u-adm');
    assert.strictEqual(notifications.unreadCount('u-adm'), 1);
  });

  it('markAllRead returns the number of rows changed', () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'A' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'B' });
    const changed = notifications.markAllRead('u-adm');
    assert.strictEqual(changed, 2);
    assert.strictEqual(notifications.unreadCount('u-adm'), 0);
  });

  it('markAllRead does not touch another user\'s notifications', () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Admin note' });
    notifications.emit({ user_id: 'u-ops', event_type: 'comment',    body: 'Ops note' });
    notifications.markAllRead('u-adm');
    assert.strictEqual(notifications.unreadCount('u-ops'), 1, 'ops unread should be unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications state — historyForUser()', () => {
  beforeEach(() => {
    clearNotifications();
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Assigned' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'Commented' });
    notifications.emit({ user_id: 'u-adm', event_type: 'escalation', body: 'Escalated' });
  });

  it('returns all notifications with total', () => {
    const { rows, total } = notifications.historyForUser('u-adm');
    assert.strictEqual(total, 3);
    assert.strictEqual(rows.length, 3);
  });

  it('filters by event_type', () => {
    const { rows, total } = notifications.historyForUser('u-adm', { event_type: 'comment' });
    assert.strictEqual(total, 1);
    assert.strictEqual(rows[0].event_type, 'comment');
  });

  it('unread_only filter excludes read items', () => {
    const all = notifications.forUser('u-adm', 10);
    notifications.markRead(all[0].id, 'u-adm');
    const { total } = notifications.historyForUser('u-adm', { unread_only: true });
    assert.strictEqual(total, 2);
  });

  it('limit and offset paginate correctly', () => {
    const { rows: page1 } = notifications.historyForUser('u-adm', { limit: 2, offset: 0 });
    const { rows: page2 } = notifications.historyForUser('u-adm', { limit: 2, offset: 2 });
    assert.strictEqual(page1.length, 2);
    assert.strictEqual(page2.length, 1);
    // No overlap
    const ids = [...page1.map((r) => r.id), ...page2.map((r) => r.id)];
    assert.strictEqual(new Set(ids).size, 3);
  });

  it('types_summary lists each event_type once', () => {
    const { types_summary } = notifications.historyForUser('u-adm');
    const types = types_summary.map((t) => t.event_type);
    assert.ok(types.includes('assignment'));
    assert.ok(types.includes('comment'));
    assert.ok(types.includes('escalation'));
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications state — preferences', () => {
  beforeEach(clearNotifications);

  it('isEnabledFor returns true by default (no row)', () => {
    assert.strictEqual(notifications.isEnabledFor('u-adm', 'assignment'), true);
  });

  it('setPref false → isEnabledFor returns false', () => {
    notifications.setPref('u-adm', 'comment', false);
    assert.strictEqual(notifications.isEnabledFor('u-adm', 'comment'), false);
  });

  it('setPref true re-enables a disabled type', () => {
    notifications.setPref('u-adm', 'comment', false);
    notifications.setPref('u-adm', 'comment', true);
    assert.strictEqual(notifications.isEnabledFor('u-adm', 'comment'), true);
  });

  it('prefsFor returns only explicit overrides', () => {
    notifications.setPref('u-adm', 'escalation', false);
    const prefs = notifications.prefsFor('u-adm');
    assert.ok('escalation' in prefs);
    assert.strictEqual(prefs.escalation.enabled, false);
    // Types with no override should not appear
    assert.ok(!('assignment' in prefs));
  });

  it('prefs are per-user and do not bleed across users', () => {
    notifications.setPref('u-adm', 'comment', false);
    assert.strictEqual(notifications.isEnabledFor('u-ops', 'comment'), true, 'ops should still be enabled');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — GET /', () => {
  before(clearNotifications);

  it('returns 401 when unauthenticated', async () => {
    const res = await api('GET', '/api/notifications');
    assert.strictEqual(res.status, 401);
  });

  it('returns items array and unread_count', async () => {
    const token = await login('admin@notif.gh', ADMIN_PASS);
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Test' });
    const res  = await api('GET', '/api/notifications', null, token);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(typeof body.unread_count === 'number');
    assert.ok(body.unread_count >= 1);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — mark read endpoints', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@notif.gh', ADMIN_PASS); });
  beforeEach(clearNotifications);

  it('POST /:id/read marks a notification as read', async () => {
    const notifId = notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'Read me' });
    const res  = await api('POST', `/api/notifications/${notifId}/read`, {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).marked_read, true);
    assert.strictEqual(notifications.unreadCount('u-adm'), 0);
  });

  it('POST /:id/read returns 400 for non-numeric id', async () => {
    const res = await api('POST', '/api/notifications/not-a-number/read', {}, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /read-all marks all user notifications as read', async () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'A' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'B' });
    const res  = await api('POST', '/api/notifications/read-all', {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).marked_read, 2);
    assert.strictEqual(notifications.unreadCount('u-adm'), 0);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — GET /unread-count', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@notif.gh', ADMIN_PASS); });
  beforeEach(clearNotifications);

  it('returns 0 with no notifications', async () => {
    const res  = await api('GET', '/api/notifications/unread-count', null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.unread_count, 0);
    assert.strictEqual(body.user_id,      'u-adm');
  });

  it('returns correct count after emits', async () => {
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'X' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'Y' });
    const res  = await api('GET', '/api/notifications/unread-count', null, adminToken);
    assert.strictEqual((await res.json()).unread_count, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — GET /inbox', () => {
  let adminToken;
  before(async () => {
    adminToken = await login('admin@notif.gh', ADMIN_PASS);
    clearNotifications();
    notifications.emit({ user_id: 'u-adm', event_type: 'assignment', body: 'A' });
    notifications.emit({ user_id: 'u-adm', event_type: 'comment',    body: 'B' });
    notifications.emit({ user_id: 'u-adm', event_type: 'escalation', body: 'C' });
  });

  it('returns rows, total, unread_count', async () => {
    const res  = await api('GET', '/api/notifications/inbox', null, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.rows));
    assert.ok('total' in body);
    assert.ok('unread_count' in body);
    assert.strictEqual(body.total, 3);
  });

  it('?event_type= filters to matching event_type', async () => {
    const res  = await api('GET', '/api/notifications/inbox?event_type=comment', null, adminToken);
    const body = await res.json();
    assert.strictEqual(body.total, 1);
    assert.strictEqual(body.rows[0].event_type, 'comment');
  });

  it('?unread_only=true returns only unread', async () => {
    // Mark one as read first
    const all = notifications.forUser('u-adm', 10);
    notifications.markRead(all[0].id, 'u-adm');
    const res  = await api('GET', '/api/notifications/inbox?unread_only=true', null, adminToken);
    const body = await res.json();
    assert.strictEqual(body.total, 2);
  });

  it('?limit=2 returns at most 2 rows', async () => {
    const res  = await api('GET', '/api/notifications/inbox?limit=2', null, adminToken);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.total, 3); // total unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — preferences', () => {
  let adminToken;
  before(async () => { adminToken = await login('admin@notif.gh', ADMIN_PASS); });
  beforeEach(() => db.exec('DELETE FROM notification_prefs'));

  it('GET /prefs returns all known event types with defaults', async () => {
    const res  = await api('GET', '/api/notifications/prefs', null, adminToken);
    assert.strictEqual(res.status, 200);
    const { prefs } = await res.json();
    assert.ok(Array.isArray(prefs));
    assert.ok(prefs.length >= 4, 'at least 4 known event types');
    assert.ok(prefs.every((p) => 'event_type' in p && 'enabled' in p && 'is_default' in p));
    // All are default-on with no overrides set
    assert.ok(prefs.every((p) => p.enabled === true));
    assert.ok(prefs.every((p) => p.is_default === true));
  });

  it('POST /prefs returns 400 when event_type is missing', async () => {
    const res = await api('POST', '/api/notifications/prefs', { enabled: false }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /prefs returns 400 when enabled is not boolean', async () => {
    const res = await api('POST', '/api/notifications/prefs', { event_type: 'comment', enabled: 'yes' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /prefs returns 400 for unknown event_type', async () => {
    const res = await api('POST', '/api/notifications/prefs', { event_type: 'made_up_type', enabled: false }, adminToken);
    assert.strictEqual(res.status, 400);
    assert.ok((await res.json()).error.includes('Unknown'));
  });

  it('POST /prefs disables an event type', async () => {
    const res = await api('POST', '/api/notifications/prefs', { event_type: 'comment', enabled: false }, adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.updated,    true);
    assert.strictEqual(body.enabled,    false);
    // Verify GET /prefs reflects the change
    const prefsRes = await api('GET', '/api/notifications/prefs', null, adminToken);
    const { prefs } = await prefsRes.json();
    const commentPref = prefs.find((p) => p.event_type === 'comment');
    assert.strictEqual(commentPref.enabled,    false);
    assert.strictEqual(commentPref.is_default, false);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('notifications route — compose', () => {
  let adminToken, haulerToken;
  before(async () => {
    adminToken  = await login('admin@notif.gh', ADMIN_PASS);
    haulerToken = await login('haul@notif.gh',  HAUL_PASS);
    clearNotifications();
  });

  it('GET /compose/recipients returns addressable users for axis_admin', async () => {
    const res  = await api('GET', '/api/notifications/compose/recipients', null, adminToken);
    assert.strictEqual(res.status, 200);
    const { recipients } = await res.json();
    // Should include ops, hauler, lender — but not self (u-adm)
    const ids = recipients.map((r) => r.id);
    assert.ok(!ids.includes('u-adm'), 'sender should not appear in recipients');
    assert.ok(ids.includes('u-ops'),  'axis_ops should be addressable by axis_admin');
  });

  it('GET /compose/recipients for hauler_admin returns only AXIS users', async () => {
    const res  = await api('GET', '/api/notifications/compose/recipients', null, haulerToken);
    const { recipients } = await res.json();
    // hauler_admin can only address AXIS roles
    assert.ok(recipients.every((r) => r.role === 'axis_admin' || r.role === 'axis_ops'),
      'hauler_admin must only see AXIS recipients');
  });

  it('POST /compose returns 400 when to_user_id is missing', async () => {
    const res = await api('POST', '/api/notifications/compose', { body: 'Hello' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /compose returns 400 when body is empty', async () => {
    const res = await api('POST', '/api/notifications/compose', { to_user_id: 'u-ops', body: '' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /compose returns 400 when sender === recipient', async () => {
    const res = await api('POST', '/api/notifications/compose', { to_user_id: 'u-adm', body: 'Hi me' }, adminToken);
    assert.strictEqual(res.status, 400);
  });

  it('POST /compose returns 404 for unknown recipient', async () => {
    const res = await api('POST', '/api/notifications/compose', { to_user_id: 'no-such-user', body: 'Hi' }, adminToken);
    assert.strictEqual(res.status, 404);
  });

  it('POST /compose sends a direct_message notification', async () => {
    const res  = await api('POST', '/api/notifications/compose', {
      to_user_id: 'u-ops',
      body:       'Please check the Takoradi gate',
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.sent,              true);
    assert.ok(typeof body.notification_id === 'number');
    // The ops user should now have an unread notification
    assert.ok(notifications.unreadCount('u-ops') >= 1);
    const opsItems = notifications.forUser('u-ops', 10);
    assert.ok(opsItems.some((n) => n.event_type === 'direct_message'));
  });

  it('hauler_admin cannot message another hauler_admin (non-AXIS recipient)', async () => {
    // Insert a second hauler_admin
    const NOW2 = new Date().toISOString();
    const insertUser2 = db.prepare(`
      INSERT OR IGNORE INTO users
        (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertUser2.run('u-hau2', 'haul2@notif.gh', bcrypt.hashSync('xx', 1), 'Hauler Two', 'hauler_admin', 'haul-02', 'Co2', NOW2, NOW2);
    const haul2Token = await login('haul2@notif.gh', 'xx');
    const res = await api('POST', '/api/notifications/compose', {
      to_user_id: 'u-hau',
      body:       'Peer message',
    }, haul2Token);
    assert.strictEqual(res.status, 403, 'hauler_admin must not be able to message other hauler_admin');
  });
});
