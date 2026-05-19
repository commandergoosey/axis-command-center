'use strict';

/*
 * LP-3 — Driver store backed by SQLite.
 *
 * Seeded from mock/drivers.js on first boot; managed via CRUD API thereafter.
 * Computes licence_expiry_months dynamically at read time so it stays accurate
 * without needing a daily cron to update the column.
 */

const crypto = require('crypto');
const db     = require('../db');

/* ── Helper: compute months until expiry from an ISO date ─────────── */
function monthsUntil(isoDate) {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.round(diff / (30 * 24 * 60 * 60 * 1000)));
}

/* ── Prepared statements ─────────────────────────────────────────── */
const stmts = {
  count:   db.prepare('SELECT COUNT(*) AS n FROM fleet_drivers'),
  list:    db.prepare('SELECT * FROM fleet_drivers WHERE archived = 0 ORDER BY hauler_id, full_name'),
  byHauler: db.prepare('SELECT * FROM fleet_drivers WHERE archived = 0 AND hauler_id = ? ORDER BY full_name'),
  byId:    db.prepare('SELECT * FROM fleet_drivers WHERE id = ? AND archived = 0'),
  byRig:   db.prepare('SELECT * FROM fleet_drivers WHERE assigned_rig_id = ? AND archived = 0 LIMIT 1'),
  insert:  db.prepare(`
    INSERT INTO fleet_drivers
      (id, hauler_id, hauler_display, full_name, licence_number, licence_class,
       licence_expiry_iso, psv_expiry_days, phone, years_experience,
       assigned_rig_id, assigned_plate, shift, hours_this_week, rest_status,
       trips_this_week, safety_score, harsh_events_7d, flag,
       archived, created_at, updated_at)
    VALUES
      (@id, @hauler_id, @hauler_display, @full_name, @licence_number, @licence_class,
       @licence_expiry_iso, @psv_expiry_days, @phone, @years_experience,
       @assigned_rig_id, @assigned_plate, @shift, @hours_this_week, @rest_status,
       @trips_this_week, @safety_score, @harsh_events_7d, @flag,
       0, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE fleet_drivers SET
      hauler_id = @hauler_id, hauler_display = @hauler_display,
      full_name = @full_name, licence_number = @licence_number,
      licence_class = @licence_class, licence_expiry_iso = @licence_expiry_iso,
      psv_expiry_days = @psv_expiry_days, phone = @phone,
      years_experience = @years_experience,
      assigned_rig_id = @assigned_rig_id, assigned_plate = @assigned_plate,
      shift = @shift, updated_at = @updated_at
    WHERE id = @id
  `),
  archive:   db.prepare('UPDATE fleet_drivers SET archived = 1, updated_at = ? WHERE id = ?'),
  unarchive: db.prepare('UPDATE fleet_drivers SET archived = 0, updated_at = ? WHERE id = ?'),
  setAssignment: db.prepare(`
    UPDATE fleet_drivers SET assigned_rig_id = @rig_id, assigned_plate = @plate, updated_at = @now
    WHERE id = @id
  `),
  clearAssignment: db.prepare(`
    UPDATE fleet_drivers SET assigned_rig_id = NULL, assigned_plate = NULL, updated_at = ?
    WHERE assigned_rig_id = ?
  `),
  // LP-39: increment trips_this_week and hours_this_week on trip completion.
  bumpScorecard: db.prepare(`
    UPDATE fleet_drivers
    SET trips_this_week = trips_this_week + @trips_delta,
        hours_this_week = ROUND(hours_this_week + @hours_delta, 2),
        rest_status     = @rest_status,
        updated_at      = @now
    WHERE id = @id AND archived = 0
  `),
};

/* ── Enrich a row with computed fields ───────────────────────────── */
function enrich(row) {
  if (!row) return null;
  return {
    ...row,
    licence_expiry_months: monthsUntil(row.licence_expiry_iso),
  };
}

/* ── Seed from mock on first boot ───────────────────────────────── */
function seed() {
  const { n } = stmts.count.get();
  if (n > 0) return;

  console.log('[driverStore] Seeding fleet_drivers from mock generator…');
  const { buildDrivers } = require('../mock/drivers');
  const drivers = buildDrivers();
  const now     = new Date().toISOString();

  const insertMany = db.transaction((rows) => {
    for (const d of rows) {
      stmts.insert.run({
        id:                 d.id,
        hauler_id:          d.hauler_id,
        hauler_display:     d.hauler_display ?? null,
        full_name:          d.full_name,
        licence_number:     d.licence_number ?? null,
        licence_class:      d.licence_class ?? 'E',
        licence_expiry_iso: d.licence_expiry_iso ?? null,
        psv_expiry_days:    d.psv_expiry_days ?? 365,
        phone:              d.phone ?? null,
        years_experience:   d.years_experience ?? 0,
        assigned_rig_id:    d.assigned_rig_id ?? null,
        assigned_plate:     d.assigned_plate ?? null,
        shift:              d.shift ?? 'day',
        hours_this_week:    d.hours_this_week ?? 0,
        rest_status:        d.rest_status ?? 'compliant',
        trips_this_week:    d.trips_this_week ?? 0,
        safety_score:       d.safety_score ?? 80,
        harsh_events_7d:    d.harsh_events_7d ?? 0,
        flag:               d.flag ?? null,
        created_at:         now,
        updated_at:         now,
      });
    }
  });

  insertMany(drivers);
  console.log(`[driverStore] Seeded ${drivers.length} drivers.`);
}

seed();

/* ── Public API ──────────────────────────────────────────────────── */

function list({ hauler_id = null } = {}) {
  const rows = hauler_id ? stmts.byHauler.all(hauler_id) : stmts.list.all();
  return rows.map(enrich);
}

function findById(id) {
  if (!id) return null;
  return enrich(stmts.byId.get(id) ?? null);
}

function findByRig(rig_id) {
  if (!rig_id) return null;
  return enrich(stmts.byRig.get(rig_id) ?? null);
}

/**
 * Create a new driver. Required: hauler_id, full_name.
 */
function create(fields) {
  const { hauler_id, full_name } = fields;
  if (!hauler_id || !full_name) throw new Error('hauler_id and full_name are required');

  const now = new Date().toISOString();
  const id  = `drv-${crypto.randomBytes(6).toString('hex')}`;

  stmts.insert.run({
    id,
    hauler_id,
    hauler_display:     fields.hauler_display ?? null,
    full_name:          String(full_name).trim(),
    licence_number:     fields.licence_number?.trim() ?? null,
    licence_class:      fields.licence_class ?? 'E',
    licence_expiry_iso: fields.licence_expiry_iso ?? null,
    psv_expiry_days:    fields.psv_expiry_days ? Number(fields.psv_expiry_days) : 365,
    phone:              fields.phone?.trim() ?? null,
    years_experience:   fields.years_experience ? Number(fields.years_experience) : 0,
    assigned_rig_id:    null,
    assigned_plate:     null,
    shift:              fields.shift ?? 'day',
    hours_this_week:    0,
    rest_status:        'compliant',
    trips_this_week:    0,
    safety_score:       80,
    harsh_events_7d:    0,
    flag:               null,
    created_at:         now,
    updated_at:         now,
  });

  return findById(id);
}

/**
 * Update editable fields on a driver.
 */
function update(id, fields) {
  const existing = findById(id);
  if (!existing) throw new Error(`Driver ${id} not found`);

  const now = new Date().toISOString();
  stmts.update.run({
    id,
    hauler_id:          fields.hauler_id          !== undefined ? fields.hauler_id                         : existing.hauler_id,
    hauler_display:     fields.hauler_display      !== undefined ? fields.hauler_display                    : existing.hauler_display,
    full_name:          fields.full_name           !== undefined ? String(fields.full_name).trim()          : existing.full_name,
    licence_number:     fields.licence_number      !== undefined ? fields.licence_number?.trim() ?? null    : existing.licence_number,
    licence_class:      fields.licence_class       !== undefined ? fields.licence_class                     : existing.licence_class,
    licence_expiry_iso: fields.licence_expiry_iso  !== undefined ? fields.licence_expiry_iso ?? null        : existing.licence_expiry_iso,
    psv_expiry_days:    fields.psv_expiry_days     !== undefined ? Number(fields.psv_expiry_days) || 365    : existing.psv_expiry_days,
    phone:              fields.phone               !== undefined ? fields.phone?.trim() ?? null             : existing.phone,
    years_experience:   fields.years_experience    !== undefined ? Number(fields.years_experience) || 0     : existing.years_experience,
    assigned_rig_id:    fields.assigned_rig_id     !== undefined ? fields.assigned_rig_id ?? null           : existing.assigned_rig_id,
    assigned_plate:     fields.assigned_plate      !== undefined ? fields.assigned_plate ?? null            : existing.assigned_plate,
    shift:              fields.shift               !== undefined ? fields.shift                             : existing.shift,
    updated_at:         now,
  });

  return findById(id);
}

function archive(id) {
  stmts.archive.run(new Date().toISOString(), id);
}

function unarchive(id) {
  stmts.unarchive.run(new Date().toISOString(), id);
}

/** Called by rigAssignments when a live assignment changes. */
function syncAssignment(driverId, rigId, plate) {
  stmts.setAssignment.run({ id: driverId, rig_id: rigId, plate: plate ?? null, now: new Date().toISOString() });
}

/** Clear any driver currently recorded as assigned to this rig. */
function clearRigAssignment(rigId) {
  stmts.clearAssignment.run(new Date().toISOString(), rigId);
}

/**
 * LP-39 — Bump a driver's weekly scorecard counters on trip completion.
 * @param {string} driverId
 * @param {{ duration_min?: number }} tripFields — completed trip fields
 */
function updateScorecard(driverId, tripFields) {
  if (!driverId) return;
  const hoursThisWeek = (findById(driverId)?.hours_this_week ?? 0)
    + ((tripFields.duration_min ?? 0) / 60);
  const REST_CAP_H = 60;
  const rest_status = hoursThisWeek >= REST_CAP_H        ? 'breach'
                    : hoursThisWeek >= REST_CAP_H * 0.85  ? 'warning'
                    : 'compliant';
  stmts.bumpScorecard.run({
    id:          driverId,
    trips_delta: 1,
    hours_delta: Number(((tripFields.duration_min ?? 0) / 60).toFixed(4)),
    rest_status,
    now:         new Date().toISOString(),
  });
}

module.exports = {
  list, findById, findByRig, create, update, archive, unarchive,
  syncAssignment, clearRigAssignment, updateScorecard,
};
