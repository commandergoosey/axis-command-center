'use strict';

/*
 * Device registry — CRUD for provisioned Teltonika devices.
 *
 * One row per IMEI in the `devices` table. Manages the mapping from
 * IMEI → (vehicle_id, hauler_id) so the ingestion pipeline can resolve
 * a device message to an AXIS vehicle without hitting Loconav.
 *
 * MQTT password hashes are stored with bcryptjs; plaintext passwords are
 * returned only from generateMqttCredentials() and never persisted.
 */

const crypto   = require('crypto');
const bcryptjs = require('bcryptjs');

let _db    = null;
let _stmts = null;

function init(db) {
  _db = db;

  _stmts = {
    byImei: db.prepare('SELECT * FROM devices WHERE imei = ?'),

    byVehicle: db.prepare(
      'SELECT * FROM devices WHERE vehicle_id = ? AND active = 1 LIMIT 1',
    ),

    byHauler: db.prepare(
      'SELECT * FROM devices WHERE hauler_id = ? ORDER BY provisioned_at DESC',
    ),

    list: db.prepare('SELECT * FROM devices ORDER BY provisioned_at DESC'),

    insert: db.prepare(`
      INSERT INTO devices
        (imei, serial, model, hauler_id, vehicle_id, sim_iccid,
         mqtt_password_hash, active, provisioned_at, notes)
      VALUES
        (@imei, @serial, @model, @hauler_id, @vehicle_id, @sim_iccid,
         @mqtt_password_hash, 1, @provisioned_at, @notes)
    `),

    deactivate: db.prepare('UPDATE devices SET active = 0 WHERE imei = ?'),

    updateAssignment: db.prepare(`
      UPDATE devices SET
        vehicle_id = COALESCE(@vehicle_id, vehicle_id),
        hauler_id  = COALESCE(@hauler_id,  hauler_id),
        notes      = COALESCE(@notes,      notes)
      WHERE imei = @imei
    `),

    updatePasswordHash: db.prepare(
      'UPDATE devices SET mqtt_password_hash = @hash WHERE imei = @imei',
    ),
  };
}

/** Find a device by IMEI. Returns null if not found. */
function findByImei(imei) {
  if (!_stmts) throw new Error('[telematics] deviceRegistry not initialised');
  return _stmts.byImei.get(imei) ?? null;
}

/** Find the active device assigned to a vehicle. Returns null if none. */
function findByVehicle(vehicle_id) {
  return _stmts.byVehicle.get(vehicle_id) ?? null;
}

/** List all devices assigned to a hauler, newest first. */
function listByHauler(hauler_id) {
  return _stmts.byHauler.all(hauler_id);
}

/** List all devices regardless of hauler. */
function list() {
  return _stmts.list.all();
}

/**
 * Provision a new device. Throws if the IMEI is already registered.
 *
 * @param {string} imei
 * @param {object} fields
 * @param {string} [fields.model]      — device model (e.g. 'FMB920-003')
 * @param {string} [fields.hauler_id]  — owning hauler
 * @param {string} [fields.vehicle_id] — assigned vehicle plate/id
 * @param {string} [fields.sim_iccid]  — SIM card ICCID
 * @param {string} [fields.serial]     — device serial number
 * @param {string} [fields.notes]
 * @returns {object} the created device row
 */
function provision(imei, { model, hauler_id, vehicle_id, sim_iccid, serial, notes } = {}) {
  if (!imei) throw new Error('imei is required');

  try {
    _stmts.insert.run({
      imei,
      serial:             serial     ?? null,
      model:              model      ?? null,
      hauler_id:          hauler_id  ?? null,
      vehicle_id:         vehicle_id ?? null,
      sim_iccid:          sim_iccid  ?? null,
      mqtt_password_hash: null,
      provisioned_at:     new Date().toISOString(),
      notes:              notes      ?? null,
    });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`Device ${imei} already provisioned`);
    }
    throw err;
  }

  return findByImei(imei);
}

/** Deactivate a device — it will be rejected by the ingestion pipeline. */
function deactivate(imei) {
  _stmts.deactivate.run(imei);
}

/**
 * Update the vehicle/hauler assignment for a device.
 * Pass null for a field to leave it unchanged.
 */
function updateAssignment(imei, { vehicle_id, hauler_id, notes } = {}) {
  _stmts.updateAssignment.run({
    imei,
    vehicle_id: vehicle_id ?? null,
    hauler_id:  hauler_id  ?? null,
    notes:      notes      ?? null,
  });
  return findByImei(imei);
}

/**
 * Generate MQTT credentials for a device.
 * The password is returned once in plaintext; only the bcrypt hash is stored.
 * Rotate by calling this function again — the old password is invalidated.
 *
 * @param {string} imei
 * @returns {Promise<{ username: string, password: string, password_hash: string }>}
 */
async function generateMqttCredentials(imei) {
  const device = findByImei(imei);
  if (!device) throw new Error(`Device ${imei} not found`);

  const password      = crypto.randomBytes(24).toString('hex');
  const password_hash = await bcryptjs.hash(password, 10);

  _stmts.updatePasswordHash.run({ hash: password_hash, imei });

  return { username: imei, password, password_hash };
}

module.exports = {
  init,
  provision,
  findByImei,
  findByVehicle,
  listByHauler,
  list,
  deactivate,
  updateAssignment,
  generateMqttCredentials,
};
