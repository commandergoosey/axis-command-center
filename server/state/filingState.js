'use strict';

/*
 * Filing mark-filed overlay. The FILINGS fixture provides the baseline
 * roster; this module persists every mark-filed action so submissions
 * survive a server restart. Merge on read: if filing_state has a row for
 * an id, its status wins; otherwise the fixture baseline applies.
 */

const db = require('../db');

const upsertStmt = db.prepare(`
  INSERT INTO filing_state (filing_id, status, submitted_at, submitted_by, updated_at)
  VALUES (@filing_id, @status, @submitted_at, @submitted_by, @updated_at)
  ON CONFLICT(filing_id) DO UPDATE SET
    status       = excluded.status,
    submitted_at = excluded.submitted_at,
    submitted_by = excluded.submitted_by,
    updated_at   = excluded.updated_at
`);

const selectStmt = db.prepare('SELECT * FROM filing_state WHERE filing_id = ?');
const listStmt   = db.prepare('SELECT * FROM filing_state');

function getState(filingId) {
  return selectStmt.get(filingId) ?? null;
}

function all() {
  return listStmt.all();
}

function markFiled(filingId, { submitted_by }) {
  const submitted_at = new Date().toISOString();
  upsertStmt.run({
    filing_id:    filingId,
    status:       'FILED',
    submitted_at,
    submitted_by,
    updated_at:   submitted_at,
  });
  return { status: 'FILED', submitted_at, submitted_by };
}

module.exports = { getState, all, markFiled };
