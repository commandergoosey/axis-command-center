'use strict';

/*
 * Device management API — Express router factory.
 *
 * Usage (consuming app):
 *   const telematics = require('@axis/telematics-core');
 *   telematics.init({ ..., middleware: { requireRole } });
 *   app.use('/api/devices', telematics.getDevicesRouter());
 *
 * All write endpoints require axis_admin or axis_ops role.
 * requireRole is injected via factory — this module never imports the
 * consuming app's auth middleware directly (no circular requires).
 *
 * If requireRole is not provided (e.g. in development / test setups),
 * a passthrough is used — all routes are open.
 */

const express = require('express');

const FUEL_HISTORY_DEFAULT  = 100;
const FUEL_HISTORY_MAX      = 1000;
const CAL_MIN_POINTS        = 2;
const DEVICES_PAGE_DEFAULT  = 50;
const DEVICES_PAGE_MAX      = 500;

/**
 * @param {object}   db           — better-sqlite3 instance (consuming app's)
 * @param {Function} requireRole  — role-guard middleware from consuming app, or null
 * @returns {express.Router}
 */
module.exports = function createDevicesRouter(db, requireRole) {
  const router   = express.Router();
  const registry = require('../state/deviceRegistry');

  // Fallback: no-op middleware if consuming app doesn't provide requireRole.
  const guard = requireRole
    ? requireRole('axis_admin', 'axis_ops')
    : (_req, _res, next) => next();

  const stmts = {
    heartbeat: db.prepare(
      'SELECT * FROM device_heartbeats WHERE imei = ?',
    ),

    latestPosition: db.prepare(
      'SELECT * FROM vehicle_positions WHERE vehicle_id = ?',
    ),

    latestFuel: db.prepare(`
      SELECT fuel_litres, fuel_mm, recorded_at FROM fuel_readings
      WHERE vehicle_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `),

    fuelHistory: db.prepare(`
      SELECT fuel_mm, fuel_litres, recorded_at FROM fuel_readings
      WHERE imei = ?
      ORDER BY recorded_at DESC
      LIMIT ?
    `),

    calibration: db.prepare(
      'SELECT id, mm, litres FROM fuel_calibrations WHERE vehicle_id = ? ORDER BY mm ASC',
    ),

    deleteCalibration: db.prepare(
      'DELETE FROM fuel_calibrations WHERE vehicle_id = ?',
    ),

    insertCalPoint: db.prepare(
      'INSERT INTO fuel_calibrations (vehicle_id, mm, litres) VALUES (?, ?, ?)',
    ),

    deviceEvents: db.prepare(`
      SELECT id, event_type, payload_json, recorded_at FROM device_events
      WHERE imei = ?
      ORDER BY recorded_at DESC
      LIMIT 50
    `),

    allDevices: db.prepare(
      'SELECT * FROM devices ORDER BY provisioned_at DESC LIMIT ? OFFSET ?',
    ),

    countDevices: db.prepare('SELECT COUNT(*) AS total FROM devices'),
  };

  /* ── GET /api/devices — list with health snapshot (paginated) ────── */
  router.get('/', guard, (req, res) => {
    const limit  = Math.min(
      parseInt(req.query.limit  ?? DEVICES_PAGE_DEFAULT, 10) || DEVICES_PAGE_DEFAULT,
      DEVICES_PAGE_MAX,
    );
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

    const { total } = stmts.countDevices.get();
    const devices   = stmts.allDevices.all(limit, offset);

    if (devices.length === 0) {
      return res.json({ total, limit, offset, devices: [] });
    }

    // Bulk-fetch heartbeats and positions — avoids N+1 per device.
    const imeis      = devices.map((d) => d.imei);
    const vehicleIds = [...new Set(devices.map((d) => d.vehicle_id).filter(Boolean))];

    const ph = (n) => Array.from({ length: n }, () => '?').join(',');

    const heartbeats = db.prepare(
      `SELECT * FROM device_heartbeats WHERE imei IN (${ph(imeis.length)})`,
    ).all(...imeis);

    const positions = vehicleIds.length > 0
      ? db.prepare(
          `SELECT * FROM vehicle_positions WHERE vehicle_id IN (${ph(vehicleIds.length)})`,
        ).all(...vehicleIds)
      : [];

    const hbMap  = Object.fromEntries(heartbeats.map((h) => [h.imei,       h]));
    const posMap = Object.fromEntries(positions.map((p)  => [p.vehicle_id, p]));

    const result = devices.map((d) => _formatDevice(
      d,
      hbMap[d.imei]                          ?? null,
      d.vehicle_id ? (posMap[d.vehicle_id] ?? null) : null,
      null,
    ));

    res.json({ total, limit, offset, devices: result });
  });

  /* ── GET /api/devices/:imei — single device detail ──────────────── */
  router.get('/:imei', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const hb   = stmts.heartbeat.get(device.imei);
    const pos  = device.vehicle_id ? stmts.latestPosition.get(device.vehicle_id) : null;
    const fuel = device.vehicle_id ? stmts.latestFuel.get(device.vehicle_id) : null;

    res.json(_formatDevice(device, hb, pos, fuel));
  });

  /* ── POST /api/devices/:imei/provision — provision + return credentials ── */
  router.post('/:imei/provision', guard, async (req, res, next) => {
    const { imei } = req.params;
    const { model, hauler_id, vehicle_id, sim_iccid, serial, notes } = req.body ?? {};

    let device;
    try {
      device = registry.provision(imei, { model, hauler_id, vehicle_id, sim_iccid, serial, notes });
    } catch (err) {
      return res.status(409).json({ error: err.message });
    }

    try {
      const credentials = await registry.generateMqttCredentials(imei);
      res.status(201).json({
        device,
        mqtt_credentials: {
          username: credentials.username,
          password: credentials.password,
          note: 'Password shown once — store it immediately and import into EMQX.',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /* ── PATCH /api/devices/:imei — update vehicle/hauler assignment ─── */
  router.patch('/:imei', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const { vehicle_id, hauler_id, notes } = req.body ?? {};
    const updated = registry.updateAssignment(req.params.imei, { vehicle_id, hauler_id, notes });

    res.json({ device: updated });
  });

  /* ── POST /api/devices/:imei/deactivate ─────────────────────────── */
  router.post('/:imei/deactivate', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    registry.deactivate(req.params.imei);
    res.json({ ok: true, imei: req.params.imei });
  });

  /* ── GET /api/devices/:imei/fuel — fuel reading history ─────────── */
  router.get('/:imei/fuel', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const limit = Math.min(
      parseInt(req.query.limit ?? FUEL_HISTORY_DEFAULT, 10) || FUEL_HISTORY_DEFAULT,
      FUEL_HISTORY_MAX,
    );

    const readings = stmts.fuelHistory.all(req.params.imei, limit);
    res.json({ imei: req.params.imei, readings });
  });

  /* ── GET /api/devices/:imei/calibration — get calibration table ──── */
  router.get('/:imei/calibration', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    if (!device.vehicle_id) {
      return res.status(422).json({ error: 'Device is not assigned to a vehicle' });
    }

    const points = stmts.calibration.all(device.vehicle_id);
    res.json({ vehicle_id: device.vehicle_id, points });
  });

  /* ── PUT /api/devices/:imei/calibration — upsert calibration table ── */
  router.put('/:imei/calibration', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    if (!device.vehicle_id) {
      return res.status(422).json({ error: 'Device is not assigned to a vehicle' });
    }

    const points = req.body?.points;
    if (!Array.isArray(points) || points.length < CAL_MIN_POINTS) {
      return res.status(400).json({
        error: `Calibration table requires at least ${CAL_MIN_POINTS} points`,
      });
    }

    for (const p of points) {
      const mm     = Number(p.mm);
      const litres = Number(p.litres);
      if (!Number.isFinite(mm) || !Number.isFinite(litres)) {
        return res.status(400).json({ error: 'Each calibration point must have numeric mm and litres' });
      }
      if (mm < 0 || litres < 0) {
        return res.status(400).json({ error: 'Calibration point mm and litres must be non-negative' });
      }
    }

    // Sort ascending by mm before storing.
    const sorted = [...points].sort((a, b) => Number(a.mm) - Number(b.mm));

    // Duplicate mm values would cause division-by-zero during interpolation.
    for (let i = 1; i < sorted.length; i++) {
      if (Number(sorted[i].mm) === Number(sorted[i - 1].mm)) {
        return res.status(400).json({ error: 'Calibration points must have unique mm values' });
      }
    }

    db.transaction(() => {
      stmts.deleteCalibration.run(device.vehicle_id);
      for (const p of sorted) {
        stmts.insertCalPoint.run(device.vehicle_id, Number(p.mm), Number(p.litres));
      }
    })();

    const saved = stmts.calibration.all(device.vehicle_id);
    res.json({ vehicle_id: device.vehicle_id, points: saved });
  });

  /* ── GET /api/devices/:imei/events — last 50 diagnostic events ───── */
  router.get('/:imei/events', guard, (req, res) => {
    const device = registry.findByImei(req.params.imei);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const events = stmts.deviceEvents.all(req.params.imei);
    res.json({ imei: req.params.imei, events });
  });

  return router;
};

/* ── Helpers ─────────────────────────────────────────────────────── */

function _formatDevice(device, heartbeat, position, fuelReading) {
  return {
    imei:           device.imei,
    serial:         device.serial         ?? null,
    model:          device.model          ?? null,
    hauler_id:      device.hauler_id      ?? null,
    vehicle_id:     device.vehicle_id     ?? null,
    sim_iccid:      device.sim_iccid      ?? null,
    active:         Boolean(device.active),
    provisioned_at: device.provisioned_at,
    notes:          device.notes          ?? null,
    health: heartbeat ? {
      signal:      heartbeat.signal      ?? null,
      battery_mv:  heartbeat.battery_mv  ?? null,
      firmware:    heartbeat.firmware    ?? null,
      last_seen_at: heartbeat.last_seen_at ?? null,
    } : null,
    last_position: position ? {
      latitude:    position.latitude    ?? null,
      longitude:   position.longitude   ?? null,
      speed_kmh:   position.speed_kmh   ?? null,
      heading_deg: position.heading_deg ?? null,
      position_at: position.position_at ?? null,
    } : null,
    current_fuel: fuelReading ? {
      fuel_litres: fuelReading.fuel_litres ?? null,
      fuel_mm:     fuelReading.fuel_mm     ?? null,
      recorded_at: fuelReading.recorded_at,
    } : null,
  };
}
