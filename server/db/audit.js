'use strict';

/*
 * Unified audit logger. Every platform write routes through writeAudit so
 * the Settings audit panel has a single, authoritative feed.
 *
 *   writeAudit({ req, entity_type, entity_id, action, summary, payload })
 *
 * `req` is optional — if omitted, actor fields fall back to null. Routes
 * that already require auth always pass it.
 */

const db = require('./index');

const insert = db.prepare(`
  INSERT INTO audit_log (
    ts, actor_user_id, actor_email, actor_display, actor_role, actor_org,
    entity_type, entity_id, action, summary, payload_json
  ) VALUES (
    @ts, @actor_user_id, @actor_email, @actor_display, @actor_role, @actor_org,
    @entity_type, @entity_id, @action, @summary, @payload_json
  )
`);

function writeAudit({ req, entity_type, entity_id, action, summary = null, payload = null }) {
  const u = req?.user ?? null;
  insert.run({
    ts:             new Date().toISOString(),
    actor_user_id:  u?.id ?? null,
    actor_email:    u?.email ?? null,
    actor_display:  u?.display_name ?? null,
    actor_role:     u?.role ?? null,
    actor_org:      u?.organisation ?? null,
    entity_type,
    entity_id,
    action,
    summary,
    payload_json:   payload ? JSON.stringify(payload) : null,
  });
}

// Phase 55 — `q` parameter is a case-insensitive substring match against
// summary, actor display, entity_id, and the raw payload_json. SQLite
// LIKE with `%term%` is plenty fast at our row count and saves us
// adding FTS5. Caller passes `q` as a normal string; the prep layer
// wraps it in `%…%` so route handlers don't need to know.
//
// Phase 66 — added `until` (upper bound on ts) + `actor_user_id`
// filters. All four predicates AND together; null = no filter on
// that dimension. Same filter set is shared between SELECT and
// COUNT so pagination totals stay correct.
const listStmt = db.prepare(`
  SELECT id, ts,
         actor_user_id, actor_email, actor_display, actor_role, actor_org,
         entity_type, entity_id, action, summary, payload_json
    FROM audit_log
   WHERE (@entity_type    IS NULL OR entity_type    = @entity_type)
     AND (@entity_id      IS NULL OR entity_id      = @entity_id)
     AND (@since          IS NULL OR ts             >= @since)
     AND (@until          IS NULL OR ts             <= @until)
     AND (@actor_user_id  IS NULL OR actor_user_id  = @actor_user_id)
     AND (@q_like         IS NULL OR (
            COALESCE(summary,        '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(actor_display,  '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(entity_id,      '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(payload_json,   '') LIKE @q_like COLLATE NOCASE
     ))
   ORDER BY ts DESC, id DESC
   LIMIT @limit OFFSET @offset
`);

const countStmt = db.prepare(`
  SELECT COUNT(*) AS n
    FROM audit_log
   WHERE (@entity_type    IS NULL OR entity_type    = @entity_type)
     AND (@entity_id      IS NULL OR entity_id      = @entity_id)
     AND (@since          IS NULL OR ts             >= @since)
     AND (@until          IS NULL OR ts             <= @until)
     AND (@actor_user_id  IS NULL OR actor_user_id  = @actor_user_id)
     AND (@q_like         IS NULL OR (
            COALESCE(summary,        '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(actor_display,  '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(entity_id,      '') LIKE @q_like COLLATE NOCASE
         OR COALESCE(payload_json,   '') LIKE @q_like COLLATE NOCASE
     ))
`);

function listAudit({
  entity_type = null, entity_id = null,
  since = null, until = null,
  actor_user_id = null,
  q = null,
  limit = 50, offset = 0,
} = {}) {
  const q_like = q && q.trim() ? `%${q.trim()}%` : null;
  const params = { entity_type, entity_id, since, until, actor_user_id, q_like };
  const rows = listStmt.all({ ...params, limit, offset });
  const { n } = countStmt.get(params);
  return {
    total: n,
    limit,
    offset,
    rows: rows.map((r) => ({
      id:            r.id,
      ts:            r.ts,
      actor: {
        user_id:      r.actor_user_id,
        email:        r.actor_email,
        display_name: r.actor_display,
        role:         r.actor_role,
        organisation: r.actor_org,
      },
      entity_type: r.entity_type,
      entity_id:   r.entity_id,
      action:      r.action,
      summary:     r.summary,
      payload:     r.payload_json ? JSON.parse(r.payload_json) : null,
    })),
  };
}

module.exports = { writeAudit, listAudit };
