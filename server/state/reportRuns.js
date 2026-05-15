'use strict';

/*
 * Generated-report instance log. Every /api/reports/generate writes a
 * report_runs row; the Reports page lists fixture RECENT seed entries
 * prepended by any persisted runs so history survives across restarts.
 */

const db = require('../db');

const insertStmt = db.prepare(`
  INSERT INTO report_runs (
    id, type_id, title, period_label, period_from, period_to,
    status, generated_at, generated_by, recipients_json,
    size_kb, pages, filename
  ) VALUES (
    @id, @type_id, @title, @period_label, @period_from, @period_to,
    @status, @generated_at, @generated_by, @recipients_json,
    @size_kb, @pages, @filename
  )
`);

const listStmt = db.prepare('SELECT * FROM report_runs ORDER BY generated_at DESC LIMIT 200');
const maxSeqStmt = db.prepare(
  "SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS n FROM report_runs WHERE id LIKE 'rpt-%'",
);

function record(instance) {
  insertStmt.run({
    id:              instance.id,
    type_id:         instance.type_id,
    title:           instance.title,
    period_label:    instance.period_label ?? null,
    period_from:     instance.period_from  ?? null,
    period_to:       instance.period_to    ?? null,
    status:          instance.status,
    generated_at:    instance.generated_at,
    generated_by:    instance.generated_by ?? null,
    recipients_json: JSON.stringify(instance.recipients ?? []),
    size_kb:         instance.size_kb ?? null,
    pages:           instance.pages   ?? null,
    filename:        instance.filename ?? null,
  });
  return instance;
}

function list() {
  return listStmt.all().map((r) => ({
    id:           r.id,
    type_id:      r.type_id,
    title:        r.title,
    period_label: r.period_label,
    period_from:  r.period_from,
    period_to:    r.period_to,
    status:       r.status,
    generated_at: r.generated_at,
    generated_by: r.generated_by,
    recipients:   r.recipients_json ? JSON.parse(r.recipients_json) : [],
    size_kb:      r.size_kb,
    pages:        r.pages,
    filename:     r.filename,
  }));
}

function nextSeq(seedMax = 0) {
  const { n } = maxSeqStmt.get();
  return Math.max(seedMax, n) + 1;
}

module.exports = { record, list, nextSeq };
