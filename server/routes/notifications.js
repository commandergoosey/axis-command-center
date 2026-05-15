'use strict';

/*
 * GET    /api/notifications              — current user's feed (50 most recent)
 * POST   /api/notifications/:id/read    — mark one as read
 * POST   /api/notifications/read-all   — mark all as read
 * GET    /api/notifications/inbox       — paginated + filtered history (Phase 82)
 * GET    /api/notifications/prefs       — per-user preferences (Phase 63)
 * POST   /api/notifications/prefs       — update preference (Phase 63)
 * GET    /api/notifications/compose/recipients — addressable users (Phase 99)
 * POST   /api/notifications/compose    — send a direct message (Phase 99)
 * GET    /api/notifications/stream      — SSE live push (Phase 100)
 *
 * Per-user feed; all roles can have notifications (lender too).
 * Self-notification is filtered at the emit layer in state/notifications.js.
 */

const express = require('express');
const router = express.Router();

const { requireAuth }    = require('../middleware/auth');
const notifications      = require('../state/notifications');
const notifPush          = require('../services/notifPush');
const { findById, list } = require('../state/users');
const { writeAudit }     = require('../db/audit');

router.get('/', requireAuth, (req, res) => {
  const items  = notifications.forUser(req.user.id, 50);
  const unread = notifications.unreadCount(req.user.id);
  res.json({ items, unread_count: unread });
});

router.post('/:id/read', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
  notifications.markRead(id, req.user.id);
  res.json({ marked_read: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  const changed = notifications.markAllRead(req.user.id);
  res.json({ marked_read: changed });
});

// ── Phase 100 — SSE live push ─────────────────────────────────────
//
// GET /api/notifications/stream
//
// Keeps a persistent HTTP connection open (text/event-stream). The client
// is added to the notifPush registry; whenever notifications.emit() fires
// for this user, the registry pushes a `notification` event down the wire.
//
// Auth is via ?token= query param because the EventSource API cannot set
// custom request headers. The query-string fallback in middleware/auth.js
// resolves and attaches req.user before requireAuth checks it.
//
// Heartbeat comment (':heartbeat\n\n') every 25 seconds keeps the
// connection alive through load-balancer / proxy idle timeouts. Browser
// EventSource auto-reconnects on drop — the reconnect picks up current
// state via the `connected` event sent on each fresh handshake.

const HEARTBEAT_MS = 25_000;

router.get('/stream', requireAuth, (req, res) => {
  const userId = req.user.id;

  res.set({
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',   // disable Nginx buffering if proxied
  });
  res.flushHeaders();

  // Register this connection.
  notifPush.add(userId, res);

  // Send the current feed immediately so the client is up-to-date
  // on each (re)connect without a separate REST call.
  const initial = JSON.stringify({
    unread_count: notifications.unreadCount(userId),
    items:        notifications.forUser(userId, 50),
  });
  res.write(`event: connected\ndata: ${initial}\n\n`);

  // Heartbeat to keep the TCP connection alive.
  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { /* socket gone */ }
  }, HEARTBEAT_MS);

  // Cleanup on disconnect.
  req.on('close', () => {
    clearInterval(hb);
    notifPush.remove(userId, res);
  });
});

// ── Phase 82 — Notifications inbox ───────────────────────────────

router.get('/inbox', requireAuth, (req, res) => {
  const limit  = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const opts = {
    event_type:  req.query.event_type || null,
    unread_only: req.query.unread_only === 'true' || req.query.unread_only === '1',
    since:       req.query.since || null,
    until:       req.query.until || null,
    limit,
    offset,
  };
  const data = notifications.historyForUser(req.user.id, opts);
  res.json({
    ...data,
    unread_count: notifications.unreadCount(req.user.id),
  });
});

// ── Phase 63 — Per-user notification preferences ──────────────────

const KNOWN_EVENT_TYPES = [
  { event_type: 'assignment',        label: 'Assigned to you' },
  { event_type: 'comment',           label: 'Comment on your item' },
  { event_type: 'bulk_reassign',     label: 'Bulk reassignment' },
  { event_type: 'escalation',        label: 'Escalation' },
  { event_type: 'handover',          label: 'Shift handover note' },
  { event_type: 'direct_message',    label: 'Direct message' },       // Phase 99
  { event_type: 'convoy_dispatch',   label: 'Convoy dispatched' },    // Phase 101
];

router.get('/prefs', requireAuth, (req, res) => {
  const overrides = notifications.prefsFor(req.user.id);
  res.json({
    user_id: req.user.id,
    prefs: KNOWN_EVENT_TYPES.map((k) => ({
      event_type:  k.event_type,
      label:       k.label,
      enabled:     overrides[k.event_type] ? overrides[k.event_type].enabled : true,
      updated_at:  overrides[k.event_type]?.updated_at ?? null,
      is_default:  !overrides[k.event_type],
    })),
  });
});

router.post('/prefs', requireAuth, (req, res) => {
  const { event_type, enabled } = req.body ?? {};
  if (!event_type || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'event_type and enabled (boolean) required' });
  }
  if (!KNOWN_EVENT_TYPES.find((k) => k.event_type === event_type)) {
    return res.status(400).json({ error: `Unknown event_type: ${event_type}` });
  }
  notifications.setPref(req.user.id, event_type, enabled);
  res.json({ updated: true, event_type, enabled });
});

// ── Phase 99 — Direct message compose ────────────────────────────
//
// Role-gated addressable recipients. AXIS roles can message anyone;
// hauler_admin and lender can only address AXIS operators (axis_admin,
// axis_ops). This keeps the platform from becoming a peer-to-peer
// hauler messaging channel that bypasses the operator.
//
// The self-notification guard in state/notifications emit() already
// prevents sending to yourself, but we also reject it here for a
// clear error response.

const AXIS_ROLES = new Set(['axis_admin', 'axis_ops']);

function addressableUsers(senderRole, senderId) {
  const all = list();
  return all
    .filter((u) => u.id !== senderId)                              // no self-messages
    .filter((u) => {
      if (AXIS_ROLES.has(senderRole)) return true;                 // AXIS → anyone
      return AXIS_ROLES.has(u.role);                               // others → AXIS only
    })
    .map(({ id, display_name, role, organisation }) => ({
      id, display_name, role, organisation,
    }));
}

router.get('/compose/recipients', requireAuth, (req, res) => {
  res.json({ recipients: addressableUsers(req.user.role, req.user.id) });
});

router.post('/compose', requireAuth, (req, res) => {
  const { to_user_id, body, link_path, link_label } = req.body ?? {};

  if (!to_user_id || !body?.trim()) {
    return res.status(400).json({ error: 'to_user_id and body are required' });
  }
  if (String(body).trim().length > 1000) {
    return res.status(400).json({ error: 'Message too long (max 1,000 chars)' });
  }
  if (to_user_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot send a message to yourself' });
  }

  // Role check — hauler_admin and lender can only address AXIS.
  const recipient = findById(to_user_id);
  if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

  if (!AXIS_ROLES.has(req.user.role) && !AXIS_ROLES.has(recipient.role)) {
    return res.status(403).json({ error: 'You can only message AXIS operators' });
  }

  const notifId = notifications.emit({
    user_id:       to_user_id,
    event_type:    'direct_message',
    body:          String(body).trim(),
    link:          link_path ? { path: link_path, label: link_label || 'Open' } : null,
    actor_user_id: req.user.id,
    actor_display: req.user.display_name,
  });

  writeAudit({
    req,
    entity_type: 'direct_message',
    entity_id:   String(notifId ?? 'skipped'),
    action:      'create',
    summary:     `Direct message to ${recipient.display_name}: ${String(body).trim().slice(0, 60)}`,
  });

  res.status(201).json({
    sent: notifId !== null,
    notification_id: notifId,
    to: { id: recipient.id, display_name: recipient.display_name },
  });
});

module.exports = router;
