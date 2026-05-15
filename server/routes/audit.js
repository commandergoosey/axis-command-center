'use strict';

/*
 * GET /api/audit             — unified audit feed across platform writes
 * GET /api/audit/export.csv  — same scope, streamed as CSV (Phase 55)
 *
 * Query params (Phase 55):
 *   entity_type — alert|filing|report|hauler|integration|...
 *   entity_id   — exact match
 *   q           — case-insensitive substring across summary, actor,
 *                 entity_id, and payload_json
 *   since       — ISO timestamp lower bound
 *   limit, offset — pagination (export ignores; caps at 5,000)
 *
 * Access: AXIS Admin only. Lenders and hauler admins don't see the
 * platform-wide write history.
 */

const express = require('express');
const router = express.Router();

const { requireRole } = require('../middleware/auth');
const { listAudit } = require('../db/audit');

const ADMIN_ROLES = ['axis_admin'];

router.get('/', requireRole(...ADMIN_ROLES), (req, res) => {
  const limit  = clamp(parseInt(req.query.limit,  10), 1, 200, 50);
  const offset = clamp(parseInt(req.query.offset, 10), 0, 1e9,  0);
  const entity_type   = req.query.entity_type   || null;
  const entity_id     = req.query.entity_id     || null;
  const q             = req.query.q             || null;
  const since         = req.query.since         || null;
  // Phase 66 — `until` upper bound + `actor_user_id` filter. Both
  // optional; both AND with the existing filter set.
  const until         = req.query.until         || null;
  const actor_user_id = req.query.actor_user_id || null;
  res.json(listAudit({ entity_type, entity_id, q, since, until, actor_user_id, limit, offset }));
});

// ── Phase 55 — CSV export ─────────────────────────────────────────
//
// Uses the same filter set as `GET /` but pulls up to 5,000 rows in a
// single shot. Streams as `text/csv` with a Content-Disposition that
// drops a sensibly-named file in the operator's downloads folder.
// Output columns mirror the JSON shape; payload is JSON-encoded
// inside the cell so a regulator opening the CSV in Excel still gets
// the full record.
router.get('/export.csv', requireRole(...ADMIN_ROLES), (req, res) => {
  const entity_type   = req.query.entity_type   || null;
  const entity_id     = req.query.entity_id     || null;
  const q             = req.query.q             || null;
  const since         = req.query.since         || null;
  const until         = req.query.until         || null;
  const actor_user_id = req.query.actor_user_id || null;
  const { rows } = listAudit({ entity_type, entity_id, q, since, until, actor_user_id, limit: 5000, offset: 0 });

  const filenameParts = ['axis-audit'];
  if (entity_type) filenameParts.push(entity_type);
  if (q)           filenameParts.push(q.replace(/\W+/g, '-').slice(0, 24));
  filenameParts.push(new Date().toISOString().slice(0, 10));
  const filename = `${filenameParts.join('-')}.csv`;

  res.setHeader('Content-Type',        'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // Explicit BOM so Excel auto-detects UTF-8 (regulators love Excel).
  res.write('﻿');

  const cols = ['ts', 'actor_display', 'actor_role', 'entity_type', 'entity_id', 'action', 'summary', 'payload_json'];
  res.write(cols.join(',') + '\n');

  for (const r of rows) {
    const cells = [
      r.ts,
      r.actor.display_name ?? '',
      r.actor.role ?? '',
      r.entity_type ?? '',
      r.entity_id ?? '',
      r.action ?? '',
      r.summary ?? '',
      r.payload ? JSON.stringify(r.payload) : '',
    ].map(csvCell);
    res.write(cells.join(',') + '\n');
  }
  res.end();
});

// CSV cell escaping: wrap in quotes and double internal quotes if the
// cell contains commas, newlines, or quotes itself. RFC 4180.
function csvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function clamp(n, lo, hi, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

module.exports = router;
