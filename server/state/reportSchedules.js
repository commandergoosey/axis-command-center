'use strict';

/*
 * Report schedule persistence — Phase 104.
 *
 * Stores recurring report schedules. Each row represents one automated
 * report: what type, how often, when, and who receives it.
 *
 *   frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
 *   day_of_week:   0–6 (Sun–Sat), used for weekly
 *   day_of_month:  1–28, used for monthly/quarterly
 *   hour:          0–23 UTC
 */

const db = require('../db');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── helpers ──────────────────────────────────────────────────────────────────

function nextRunAt(row) {
  const now = new Date();
  const h   = row.hour ?? 8;

  if (row.frequency === 'daily') {
    const d = new Date(now);
    d.setUTCHours(h, 0, 0, 0);
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  if (row.frequency === 'weekly') {
    const target = row.day_of_week ?? 1; // Monday
    const d = new Date(now);
    d.setUTCHours(h, 0, 0, 0);
    const diff = (target - d.getUTCDay() + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString();
  }

  if (row.frequency === 'monthly') {
    const dom = row.day_of_month ?? 1;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dom, h));
    if (d <= now) d.setUTCMonth(d.getUTCMonth() + 1);
    return d.toISOString();
  }

  if (row.frequency === 'quarterly') {
    const dom = row.day_of_month ?? 1;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dom, h));
    while (d <= now) d.setUTCMonth(d.getUTCMonth() + 3);
    return d.toISOString();
  }

  return null;
}

function humanFreq(row) {
  const h = `${String(row.hour ?? 8).padStart(2, '0')}:00 UTC`;
  if (row.frequency === 'daily')   return `Daily at ${h}`;
  if (row.frequency === 'weekly')  return `Weekly · ${DAY_NAMES[row.day_of_week ?? 1]} at ${h}`;
  if (row.frequency === 'monthly') return `Monthly · day ${row.day_of_month ?? 1} at ${h}`;
  if (row.frequency === 'quarterly') return `Quarterly · day ${row.day_of_month ?? 1} at ${h}`;
  return row.frequency;
}

function deserialise(row) {
  return {
    id:             row.id,
    type_id:        row.type_id,
    title:          row.title,
    label_template: row.label_template,
    frequency:      row.frequency,
    day_of_week:    row.day_of_week,
    day_of_month:   row.day_of_month,
    hour:           row.hour,
    recipients:     row.recipients_json ? JSON.parse(row.recipients_json) : [],
    active:         row.active === 1,
    created_at:     row.created_at,
    created_by:     row.created_by,
    last_run_at:    row.last_run_at,
    next_run_at:    row.next_run_at,
    frequency_human: humanFreq(row),
  };
}

// ── prepared statements ───────────────────────────────────────────────────────

const insertStmt = db.prepare(`
  INSERT INTO report_schedules
    (id, type_id, title, label_template, frequency, day_of_week, day_of_month,
     hour, recipients_json, active, created_at, created_by, next_run_at)
  VALUES
    (@id, @type_id, @title, @label_template, @frequency, @day_of_week, @day_of_month,
     @hour, @recipients_json, 1, @created_at, @created_by, @next_run_at)
`);

const listStmt = db.prepare('SELECT * FROM report_schedules ORDER BY created_at DESC');
const getStmt  = db.prepare('SELECT * FROM report_schedules WHERE id = ?');

const updateStmt = db.prepare(`
  UPDATE report_schedules
  SET type_id = @type_id,
      title = @title,
      label_template = @label_template,
      frequency = @frequency,
      day_of_week = @day_of_week,
      day_of_month = @day_of_month,
      hour = @hour,
      recipients_json = @recipients_json,
      active = @active,
      next_run_at = @next_run_at
  WHERE id = ?
`);

const deleteStmt  = db.prepare('DELETE FROM report_schedules WHERE id = ?');
const toggleStmt  = db.prepare('UPDATE report_schedules SET active = @active, next_run_at = @next_run_at WHERE id = ?');

// ── counter ───────────────────────────────────────────────────────────────────
const maxSeqStmt = db.prepare(
  "SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS n FROM report_schedules WHERE id LIKE 'sch-%'",
);

function nextSeq() {
  return (maxSeqStmt.get()?.n ?? 0) + 1;
}

// ── public API ────────────────────────────────────────────────────────────────

function create({ type_id, title, label_template, frequency, day_of_week, day_of_month, hour, recipients, created_by }) {
  const id = `sch-${String(nextSeq()).padStart(3, '0')}`;
  const row = {
    id,
    type_id,
    title:          title     ?? type_id,
    label_template: label_template ?? null,
    frequency:      frequency  ?? 'monthly',
    day_of_week:    day_of_week  ?? null,
    day_of_month:   day_of_month ?? null,
    hour:           hour ?? 8,
    recipients_json: JSON.stringify(recipients ?? []),
    created_at: new Date().toISOString(),
    created_by: created_by ?? null,
    next_run_at: null,
  };
  row.next_run_at = nextRunAt(row);
  insertStmt.run(row);
  return deserialise(getStmt.get(id));
}

function list() {
  return listStmt.all().map(deserialise);
}

function get(id) {
  const row = getStmt.get(id);
  return row ? deserialise(row) : null;
}

function update(id, patch) {
  const existing = getStmt.get(id);
  if (!existing) return null;
  const merged = {
    type_id:        patch.type_id         ?? existing.type_id,
    title:          patch.title           ?? existing.title,
    label_template: patch.label_template  ?? existing.label_template,
    frequency:      patch.frequency       ?? existing.frequency,
    day_of_week:    patch.day_of_week     !== undefined ? patch.day_of_week  : existing.day_of_week,
    day_of_month:   patch.day_of_month    !== undefined ? patch.day_of_month : existing.day_of_month,
    hour:           patch.hour            !== undefined ? patch.hour         : existing.hour,
    recipients_json: JSON.stringify(patch.recipients ?? JSON.parse(existing.recipients_json)),
    active:         patch.active !== undefined ? (patch.active ? 1 : 0) : existing.active,
    next_run_at:    null,
  };
  merged.next_run_at = merged.active ? nextRunAt(merged) : null;
  updateStmt.run({ ...merged, id }, id);
  return deserialise(getStmt.get(id));
}

function toggle(id, active) {
  const existing = getStmt.get(id);
  if (!existing) return null;
  const next = active
    ? nextRunAt({ ...existing, active: 1 })
    : null;
  toggleStmt.run({ active: active ? 1 : 0, next_run_at: next }, id);
  return deserialise(getStmt.get(id));
}

function remove(id) {
  const existing = getStmt.get(id);
  if (!existing) return false;
  deleteStmt.run(id);
  return true;
}

const markRanStmt = db.prepare(`
  UPDATE report_schedules
  SET last_run_at = @last_run_at,
      next_run_at = @next_run_at
  WHERE id = ?
`);

/**
 * markRan(id) — called by the schedule runner after a successful delivery.
 * Stamps last_run_at = now and advances next_run_at.
 */
function markRan(id) {
  const existing = getStmt.get(id);
  if (!existing) return null;
  const last_run_at = new Date().toISOString();
  const next_run_at = existing.active ? nextRunAt(existing) : null;
  markRanStmt.run({ last_run_at, next_run_at }, id);
  return deserialise(getStmt.get(id));
}

module.exports = { create, list, get, update, toggle, remove, markRan, nextRunAt };
