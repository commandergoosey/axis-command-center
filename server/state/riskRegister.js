'use strict';

/*
 * Risk register — Phase 72.
 *
 * Forward-looking ledger of risks the corridor is tracking. Distinct
 * from alerts (alerts are reactive: something is wrong now) and
 * incidents (incidents are reactive: something already went wrong).
 * A risk is something that *might* happen and what we plan to do
 * about it if it does.
 *
 * Schema mirrors the typical credit-committee register: each entry
 * carries title + category + severity + likelihood + status + owner
 * + mitigation plan + last-reviewed timestamp. The last-reviewed
 * field drives the "stale review" nudge on Today: a risk that
 * hasn't been touched in 30+ days has gone cold, even if its other
 * fields look fine — the operator should re-read it and confirm
 * the assessment still holds.
 *
 * Idempotent CREATE so prod migrates without touching db/index.js.
 */

const db = require('../db');

const CATEGORIES = [
  'operational',     // truck capacity, driver supply, weather
  'commercial',     // counterparty payment, take-or-pay
  'financial',      // FX, diesel, interest rates
  'compliance',     // licences, environmental, axle load
  'reputational',   // accidents, community relations
  'strategic',      // supplier diversification, contract renewal
];

const SEVERITIES   = ['low', 'medium', 'high', 'critical'];
const LIKELIHOODS  = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'];
const STATUSES     = ['open', 'mitigating', 'monitoring', 'closed'];

db.exec(`
  CREATE TABLE IF NOT EXISTS risk_register (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    description         TEXT,
    category            TEXT NOT NULL,
    severity            TEXT NOT NULL,
    likelihood          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open',
    owner_user_id       TEXT,
    owner_display       TEXT,
    mitigation_plan     TEXT,
    last_reviewed_at    TEXT,
    last_reviewed_by    TEXT,
    archived_at         TEXT,
    created_at          TEXT NOT NULL,
    created_by_user_id  TEXT,
    created_by_display  TEXT,
    created_by_role     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_risk_register_active
    ON risk_register (archived_at, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_risk_register_review
    ON risk_register (last_reviewed_at)
    WHERE archived_at IS NULL AND status != 'closed';
`);

const insertStmt = db.prepare(`
  INSERT INTO risk_register (
    title, description, category, severity, likelihood, status,
    owner_user_id, owner_display,
    mitigation_plan, last_reviewed_at, last_reviewed_by,
    created_at, created_by_user_id, created_by_display, created_by_role
  ) VALUES (
    @title, @description, @category, @severity, @likelihood, @status,
    @owner_user_id, @owner_display,
    @mitigation_plan, @last_reviewed_at, @last_reviewed_by,
    @created_at, @created_by_user_id, @created_by_display, @created_by_role
  )
`);

const updateStmt = db.prepare(`
  UPDATE risk_register
     SET title           = COALESCE(@title, title),
         description     = COALESCE(@description, description),
         category        = COALESCE(@category, category),
         severity        = COALESCE(@severity, severity),
         likelihood      = COALESCE(@likelihood, likelihood),
         status          = COALESCE(@status, status),
         owner_user_id   = COALESCE(@owner_user_id, owner_user_id),
         owner_display   = COALESCE(@owner_display, owner_display),
         mitigation_plan = COALESCE(@mitigation_plan, mitigation_plan)
   WHERE id = @id
`);

const reviewStmt   = db.prepare(`
  UPDATE risk_register
     SET last_reviewed_at = ?, last_reviewed_by = ?
   WHERE id = ?
`);
const archiveStmt  = db.prepare('UPDATE risk_register SET archived_at = ? WHERE id = ?');
const unarchiveStmt= db.prepare('UPDATE risk_register SET archived_at = NULL WHERE id = ?');
const deleteStmt   = db.prepare('DELETE FROM risk_register WHERE id = ?');
const byIdStmt     = db.prepare('SELECT * FROM risk_register WHERE id = ?');
const activeStmt   = db.prepare(`
  SELECT * FROM risk_register
   WHERE archived_at IS NULL
   ORDER BY
     CASE severity
       WHEN 'critical' THEN 0
       WHEN 'high'     THEN 1
       WHEN 'medium'   THEN 2
       ELSE 3
     END,
     CASE status
       WHEN 'open'       THEN 0
       WHEN 'mitigating' THEN 1
       WHEN 'monitoring' THEN 2
       ELSE 3
     END,
     created_at DESC
`);
const allActiveCountsStmt = db.prepare(`
  SELECT
    COUNT(*) FILTER (WHERE status != 'closed')                                         AS open_count,
    COUNT(*) FILTER (WHERE status != 'closed' AND severity IN ('critical', 'high'))   AS high_open_count,
    COUNT(*) FILTER (WHERE status != 'closed' AND (
      last_reviewed_at IS NULL OR
      julianday('now') - julianday(last_reviewed_at) >= 30
    ))                                                                                AS stale_count
  FROM risk_register
  WHERE archived_at IS NULL
`);

function shape(row) {
  if (!row) return null;
  return {
    id:               row.id,
    title:            row.title,
    description:      row.description,
    category:         row.category,
    severity:         row.severity,
    likelihood:       row.likelihood,
    status:           row.status,
    owner: row.owner_user_id ? {
      user_id:      row.owner_user_id,
      display_name: row.owner_display,
    } : null,
    mitigation_plan:  row.mitigation_plan,
    last_reviewed_at: row.last_reviewed_at,
    last_reviewed_by: row.last_reviewed_by,
    archived_at:      row.archived_at,
    created_at:       row.created_at,
    created_by:       row.created_by_user_id ? {
      user_id:      row.created_by_user_id,
      display_name: row.created_by_display,
      role:         row.created_by_role,
    } : null,
  };
}

function add({
  title, description, category, severity, likelihood,
  status = 'open',
  owner_user_id, owner_display,
  mitigation_plan,
  by_user_id, by_display, by_role,
}) {
  const t = (title || '').trim();
  if (!t)                              throw new Error('Title required');
  if (t.length > 120)                  throw new Error('Title too long (max 120 chars)');
  if (!CATEGORIES.includes(category))  throw new Error(`Unknown category: ${category}`);
  if (!SEVERITIES.includes(severity))  throw new Error(`Unknown severity: ${severity}`);
  if (!LIKELIHOODS.includes(likelihood)) throw new Error(`Unknown likelihood: ${likelihood}`);
  if (!STATUSES.includes(status))      throw new Error(`Unknown status: ${status}`);

  const result = insertStmt.run({
    title:           t,
    description:     description ? description.trim().slice(0, 2000) : null,
    category, severity, likelihood, status,
    owner_user_id:   owner_user_id || null,
    owner_display:   owner_display || null,
    mitigation_plan: mitigation_plan ? mitigation_plan.trim().slice(0, 2000) : null,
    last_reviewed_at: new Date().toISOString(),
    last_reviewed_by: by_display || null,
    created_at:       new Date().toISOString(),
    created_by_user_id: by_user_id || null,
    created_by_display: by_display || null,
    created_by_role:    by_role    || null,
  });
  return shape(byIdStmt.get(result.lastInsertRowid));
}

function update(id, patch = {}) {
  const existing = byIdStmt.get(id);
  if (!existing) return null;
  if (patch.category   && !CATEGORIES.includes(patch.category))    throw new Error(`Unknown category: ${patch.category}`);
  if (patch.severity   && !SEVERITIES.includes(patch.severity))    throw new Error(`Unknown severity: ${patch.severity}`);
  if (patch.likelihood && !LIKELIHOODS.includes(patch.likelihood)) throw new Error(`Unknown likelihood: ${patch.likelihood}`);
  if (patch.status     && !STATUSES.includes(patch.status))        throw new Error(`Unknown status: ${patch.status}`);

  updateStmt.run({
    id,
    title:           patch.title           ?? null,
    description:     patch.description     ?? null,
    category:        patch.category        ?? null,
    severity:        patch.severity        ?? null,
    likelihood:      patch.likelihood      ?? null,
    status:          patch.status          ?? null,
    owner_user_id:   patch.owner_user_id   ?? null,
    owner_display:   patch.owner_display   ?? null,
    mitigation_plan: patch.mitigation_plan ?? null,
  });
  return shape(byIdStmt.get(id));
}

function review(id, by_display) {
  reviewStmt.run(new Date().toISOString(), by_display || null, id);
  return shape(byIdStmt.get(id));
}

function archive(id, ts = new Date().toISOString())   { archiveStmt.run(ts, id); }
function unarchive(id)                                { unarchiveStmt.run(id); }
function remove(id)                                   { deleteStmt.run(id); }
function findById(id)                                 { return shape(byIdStmt.get(id)); }
function listActive()                                 { return activeStmt.all().map(shape); }
function counts()                                     { return allActiveCountsStmt.get(); }

// Used by the stale-review observation on Today: list of risks
// that haven't been reviewed in the last 30 days, sorted oldest
// first. Closed/archived risks are excluded.
function staleReviews(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return listActive().filter((r) =>
    r.status !== 'closed' &&
    (!r.last_reviewed_at || r.last_reviewed_at < cutoff)
  );
}

module.exports = {
  CATEGORIES, SEVERITIES, LIKELIHOODS, STATUSES,
  add, update, review, archive, unarchive, remove,
  findById, listActive, counts, staleReviews,
};
