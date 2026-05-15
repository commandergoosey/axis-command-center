'use strict';

/*
 * notifPush — Phase 100.
 *
 * In-memory registry of open SSE response streams, keyed by user_id.
 * Kept separate from routes/notifications.js and state/notifications.js
 * to avoid a circular-require cycle:
 *
 *   state/notifications  →  services/notifPush  ←  routes/notifications
 *
 * No state is persisted here — if the server restarts, connections
 * simply re-open on the next browser EventSource reconnect.
 */

// Map<userId, Set<res>>
const clients = new Map();

/**
 * Register an SSE response stream for a user.
 * Call this once, immediately after setting SSE response headers.
 */
function add(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

/**
 * Deregister a stream (call in the 'close' handler).
 */
function remove(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

/**
 * Push a named SSE event to all open streams for a user.
 * Returns the number of streams the event was written to.
 */
function pushToUser(userId, eventName, data) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return 0;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of set) {
    try {
      res.write(payload);
      sent++;
    } catch {
      // The write will fail if the socket is already gone; the 'close'
      // handler will remove it from the registry.  Safe to ignore here.
    }
  }
  return sent;
}

/** How many open connections exist for a user (diagnostic / test). */
function connectionCount(userId) {
  return clients.get(userId)?.size ?? 0;
}

module.exports = { add, remove, pushToUser, connectionCount };
