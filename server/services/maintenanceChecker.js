'use strict';

/*
 * Maintenance due checker — LP-31.
 *
 * Runs daily. Scans fleet_trucks for vehicles whose km_since_service
 * has crossed the service interval threshold. For each overdue truck,
 * inserts an alert_state row (INSERT OR IGNORE so repeated runs are safe).
 *
 * Threshold: SERVICE_KM_THRESHOLD env var (default 20 000 km).
 * Critical threshold: 2× the base threshold.
 */

const crypto = require('crypto');
const db     = require('../db');
const log    = require('./logger');

const KM_THRESHOLD  = parseInt(process.env.SERVICE_KM_THRESHOLD  ?? '20000', 10);
const KM_CRITICAL   = parseInt(process.env.SERVICE_KM_CRITICAL   ?? '40000', 10);

const stmts = {
  overdue: db.prepare(`
    SELECT id, plate, hauler_id,
           (total_km - last_service_km) AS km_since_service
    FROM fleet_trucks
    WHERE archived = 0
      AND (total_km - last_service_km) >= @threshold
    ORDER BY (total_km - last_service_km) DESC
  `),
  insertAlert: db.prepare(`
    INSERT OR IGNORE INTO alert_state (alert_id, status_override, notes_json, updated_at)
    VALUES (@alert_id, 'open', '[]', @updated_at)
  `),
};

function alertIdFor(truckId, severityBucket) {
  const week  = new Date().toISOString().slice(0, 7); // YYYY-MM (weekly dedup)
  const key   = `maint:${truckId}:${severityBucket}:${week}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 20);
}

function run() {
  const ts      = new Date().toISOString();
  const trucks  = stmts.overdue.all({ threshold: KM_THRESHOLD });
  let created   = 0;

  for (const truck of trucks) {
    const severity = truck.km_since_service >= KM_CRITICAL ? 'critical' : 'warning';
    const aid      = alertIdFor(truck.id, severity);
    const result   = stmts.insertAlert.run({ alert_id: aid, updated_at: ts });
    if (result.changes > 0) {
      created++;
      log.warn('Maintenance due alert created', {
        truck_id: truck.id, plate: truck.plate,
        hauler_id: truck.hauler_id, km_since_service: truck.km_since_service,
        severity, alert_id: aid,
      });
    }
  }

  if (trucks.length > 0) {
    log.info('Maintenance checker: run complete', {
      overdue: trucks.length, new_alerts: created, threshold_km: KM_THRESHOLD,
    });
  }
  return { overdue: trucks.length, new_alerts: created };
}

module.exports = { run };
