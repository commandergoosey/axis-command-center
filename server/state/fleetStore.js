'use strict';

/*
 * LP-3 — Fleet truck store backed by SQLite.
 *
 * On first boot the fleet_trucks table is seeded from the deterministic mock
 * generator (server/mock/fleet.js) so the app has data immediately.
 * After that, records are managed via the CRUD API (/api/admin/fleet/*).
 *
 * Exposes the same read interface the routes previously got from the FLEET
 * mock array so route-level changes are surgical.
 */

const crypto = require('crypto');
const db     = require('../db');

/* ── Prepared statements ─────────────────────────────────────────── */
const stmts = {
  count:   db.prepare('SELECT COUNT(*) AS n FROM fleet_trucks'),
  list:    db.prepare(`
    SELECT *, (total_km - last_service_km) AS km_since_service
      FROM fleet_trucks WHERE archived = 0
      ORDER BY hauler_id, id
  `),
  byHauler: db.prepare(`
    SELECT *, (total_km - last_service_km) AS km_since_service
      FROM fleet_trucks WHERE archived = 0 AND hauler_id = ?
      ORDER BY id
  `),
  byId:    db.prepare(`
    SELECT *, (total_km - last_service_km) AS km_since_service
      FROM fleet_trucks WHERE id = ? AND archived = 0
  `),
  insert:  db.prepare(`
    INSERT INTO fleet_trucks
      (id, plate, hauler_id, hauler_display, make, model, axle_config,
       year_of_manufacture, empty_weight_t, gross_weight_t, payload_capacity_t,
       status, total_km, last_service_km, next_service_km_due,
       efficiency_l_per_100km, trips_this_week, maintenance_flag,
       road_worthy_expiry_days, last_position_ping_iso, archived, created_at, updated_at)
    VALUES
      (@id, @plate, @hauler_id, @hauler_display, @make, @model, @axle_config,
       @year_of_manufacture, @empty_weight_t, @gross_weight_t, @payload_capacity_t,
       @status, @total_km, @last_service_km, @next_service_km_due,
       @efficiency_l_per_100km, @trips_this_week, @maintenance_flag,
       @road_worthy_expiry_days, @last_position_ping_iso, 0, @created_at, @updated_at)
  `),
  update: db.prepare(`
    UPDATE fleet_trucks SET
      plate = @plate, hauler_id = @hauler_id, hauler_display = @hauler_display,
      make = @make, model = @model, axle_config = @axle_config,
      year_of_manufacture = @year_of_manufacture,
      empty_weight_t = @empty_weight_t, gross_weight_t = @gross_weight_t,
      payload_capacity_t = @payload_capacity_t,
      total_km = @total_km, last_service_km = @last_service_km,
      next_service_km_due = @next_service_km_due,
      efficiency_l_per_100km = @efficiency_l_per_100km,
      maintenance_flag = @maintenance_flag,
      road_worthy_expiry_days = @road_worthy_expiry_days,
      updated_at = @updated_at
    WHERE id = @id
  `),
  archive:   db.prepare('UPDATE fleet_trucks SET archived = 1, updated_at = ? WHERE id = ?'),
  unarchive: db.prepare('UPDATE fleet_trucks SET archived = 0, updated_at = ? WHERE id = ?'),

  // LP-27: status sync from event pipeline.
  byPlate:   db.prepare(`
    SELECT *, (total_km - last_service_km) AS km_since_service
      FROM fleet_trucks WHERE plate = ? AND archived = 0 LIMIT 1
  `),
  setStatus: db.prepare('UPDATE fleet_trucks SET status = @status, updated_at = @updated_at WHERE id = @id'),
};

/* ── Seed from mock on first boot ───────────────────────────────── */
function seed() {
  const { n } = stmts.count.get();
  if (n > 0) return;

  console.log('[fleetStore] Seeding fleet_trucks from mock generator…');
  const { buildFleet } = require('../mock/fleet');
  const trucks = buildFleet();
  const now    = new Date().toISOString();

  const insertMany = db.transaction((rows) => {
    for (const t of rows) {
      stmts.insert.run({
        id:                     t.id,
        plate:                  t.plate,
        hauler_id:              t.hauler_id,
        hauler_display:         t.hauler_display ?? null,
        make:                   t.make ?? null,
        model:                  t.model ?? null,
        axle_config:            t.axle_config ?? '6x4',
        year_of_manufacture:    t.year_of_manufacture ?? null,
        empty_weight_t:         t.empty_weight_t ?? null,
        gross_weight_t:         t.gross_weight_t ?? 40,
        payload_capacity_t:     t.payload_capacity_t ?? null,
        status:                 t.status ?? 'idle',
        total_km:               t.total_km ?? 0,
        last_service_km:        t.last_service_km ?? 0,
        next_service_km_due:    t.next_service_km_due ?? 0,
        efficiency_l_per_100km: t.efficiency_l_per_100km ?? 38,
        trips_this_week:        t.trips_this_week ?? 0,
        maintenance_flag:       t.maintenance_flag ?? null,
        road_worthy_expiry_days: t.road_worthy_expiry_days ?? 365,
        last_position_ping_iso:  t.last_position_ping_iso ?? null,
        created_at:             now,
        updated_at:             now,
      });
    }
  });

  insertMany(trucks);
  console.log(`[fleetStore] Seeded ${trucks.length} trucks.`);
}

seed();

/* ── Public API ──────────────────────────────────────────────────── */

/**
 * Return all active (non-archived) trucks, optionally filtered by hauler_id.
 * Result shape matches the mock FLEET array entries.
 */
function list({ hauler_id = null } = {}) {
  if (hauler_id) return stmts.byHauler.all(hauler_id);
  return stmts.list.all();
}

/** Find a single truck by id. Returns null if not found or archived. */
function findById(id) {
  if (!id) return null;
  return stmts.byId.get(id) ?? null;
}

/**
 * Create a new truck record. Returns the created row.
 * Required: plate, hauler_id.
 */
function create(fields) {
  const { plate, hauler_id, hauler_display, make, model, axle_config,
    year_of_manufacture, empty_weight_t, gross_weight_t, payload_capacity_t } = fields;

  if (!plate || !hauler_id) throw new Error('plate and hauler_id are required');

  const now = new Date().toISOString();
  const id  = `rig-${crypto.randomBytes(6).toString('hex')}`;

  stmts.insert.run({
    id,
    plate:                  String(plate).trim().toUpperCase(),
    hauler_id,
    hauler_display:         hauler_display ?? null,
    make:                   make?.trim() ?? null,
    model:                  model?.trim() ?? null,
    axle_config:            axle_config ?? '6x4',
    year_of_manufacture:    year_of_manufacture ? Number(year_of_manufacture) : null,
    empty_weight_t:         empty_weight_t ? Number(empty_weight_t) : null,
    gross_weight_t:         gross_weight_t ? Number(gross_weight_t) : 40,
    payload_capacity_t:     payload_capacity_t ? Number(payload_capacity_t) : null,
    status:                 'idle',
    total_km:               0,
    last_service_km:        0,
    next_service_km_due:    0,
    efficiency_l_per_100km: 38,
    trips_this_week:        0,
    maintenance_flag:       null,
    road_worthy_expiry_days: 365,
    last_position_ping_iso:  null,
    created_at:             now,
    updated_at:             now,
  });

  return findById(id);
}

/**
 * Update editable fields on a truck. Returns the updated row.
 */
function update(id, fields) {
  const existing = findById(id);
  if (!existing) throw new Error(`Truck ${id} not found`);

  const now = new Date().toISOString();
  stmts.update.run({
    id,
    plate:                  fields.plate                  !== undefined ? String(fields.plate).trim().toUpperCase()  : existing.plate,
    hauler_id:              fields.hauler_id              !== undefined ? fields.hauler_id               : existing.hauler_id,
    hauler_display:         fields.hauler_display         !== undefined ? fields.hauler_display           : existing.hauler_display,
    make:                   fields.make                   !== undefined ? fields.make?.trim() ?? null     : existing.make,
    model:                  fields.model                  !== undefined ? fields.model?.trim() ?? null    : existing.model,
    axle_config:            fields.axle_config            !== undefined ? fields.axle_config              : existing.axle_config,
    year_of_manufacture:    fields.year_of_manufacture    !== undefined ? Number(fields.year_of_manufacture) || null : existing.year_of_manufacture,
    empty_weight_t:         fields.empty_weight_t         !== undefined ? Number(fields.empty_weight_t) || null      : existing.empty_weight_t,
    gross_weight_t:         fields.gross_weight_t         !== undefined ? Number(fields.gross_weight_t) || 40        : existing.gross_weight_t,
    payload_capacity_t:     fields.payload_capacity_t     !== undefined ? Number(fields.payload_capacity_t) || null  : existing.payload_capacity_t,
    total_km:               fields.total_km               !== undefined ? Number(fields.total_km) || 0               : existing.total_km,
    last_service_km:        fields.last_service_km        !== undefined ? Number(fields.last_service_km) || 0        : existing.last_service_km,
    next_service_km_due:    fields.next_service_km_due    !== undefined ? Number(fields.next_service_km_due) || 0    : existing.next_service_km_due,
    efficiency_l_per_100km: fields.efficiency_l_per_100km !== undefined ? Number(fields.efficiency_l_per_100km) || 38 : existing.efficiency_l_per_100km,
    maintenance_flag:       fields.maintenance_flag       !== undefined ? fields.maintenance_flag ?? null            : existing.maintenance_flag,
    road_worthy_expiry_days: fields.road_worthy_expiry_days !== undefined ? Number(fields.road_worthy_expiry_days) || 365 : existing.road_worthy_expiry_days,
    updated_at:             now,
  });

  return findById(id);
}

function archive(id) {
  stmts.archive.run(new Date().toISOString(), id);
}

function unarchive(id) {
  stmts.unarchive.run(new Date().toISOString(), id);
}

/** Find a truck by registration plate (case-insensitive). */
function findByPlate(plate) {
  if (!plate) return null;
  return stmts.byPlate.get(String(plate).trim().toUpperCase()) ?? null;
}

/** Set a truck's operational status ('idle', 'en_route', 'maintenance', etc.). */
function setStatus(id, status) {
  stmts.setStatus.run({ id, status, updated_at: new Date().toISOString() });
}

module.exports = { list, findById, findByPlate, setStatus, create, update, archive, unarchive };
