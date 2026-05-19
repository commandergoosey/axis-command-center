'use strict';

/*
 * test/harness.js — standalone test harness for @axis/telematics-core
 *
 * No MQTT broker needed. Creates an in-memory SQLite database, wires the
 * full pipeline (decoder → normaliser → trip detector), and feeds a scripted
 * sequence of mock Teltonika payloads through it.
 *
 * Run:
 *   cd /Users/commandergoosey/Projects/telematics-core
 *   npm install
 *   node test/harness.js
 *
 * Each scenario prints the bus events it triggers and the final DB state
 * is dumped at the end so you can verify writes.
 */

// ── Shorten timeouts so the harness completes in seconds, not minutes ──────
process.env.IGNITION_IDLE_TIMEOUT_MS = '400';   // 400ms idle before trip closes
process.env.FUEL_REFUEL_MIN_L        = '20';
process.env.FUEL_DRAIN_MIN_L         = '15';
process.env.FUEL_MAX_INTERVAL_MIN    = '30';
process.env.FUEL_RING_MAX            = '2000';

const Database         = require('better-sqlite3');
const { EventEmitter } = require('events');
const path             = require('path');

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';

function header(text) {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${BOLD}${CYAN}  ${text}${RESET}`);
  console.log(`${CYAN}${'═'.repeat(60)}${RESET}`);
}

function scenario(n, title) {
  console.log(`\n${BOLD}${YELLOW}── Scenario ${n}: ${title} ${RESET}`);
}

function ok(msg)   { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function info(msg) { console.log(`  ${DIM}↳ ${msg}${RESET}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); process.exitCode = 1; }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ── In-memory SQLite database ────────────────────────────────────────────── */

const db = new Database(':memory:');

// Consuming-app tables that the module writes to directly.
db.exec(`
  CREATE TABLE IF NOT EXISTS vehicle_positions (
    vehicle_id  TEXT PRIMARY KEY,
    hauler_id   TEXT,
    latitude    REAL,
    longitude   REAL,
    speed_kmh   REAL,
    heading_deg REAL,
    position_at TEXT,
    updated_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS trips (
    id              TEXT PRIMARY KEY,
    hauler_id       TEXT,
    vehicle_id      TEXT,
    driver_id       TEXT,
    status          TEXT NOT NULL DEFAULT 'in_progress',
    direction       TEXT,
    origin          TEXT,
    destination     TEXT,
    route_id        TEXT,
    departed_at     TEXT,
    arrived_at      TEXT,
    duration_min    INTEGER,
    distance_km     REAL,
    tonnage_t       REAL,
    axle_load_pct   REAL,
    source          TEXT,
    raw_event_id    TEXT,
    created_at      TEXT,
    updated_at      TEXT,
    estimated_fuel_l    REAL,
    estimated_cost_usd  REAL,
    convoy_id       TEXT
  );
`);

/* ── Mock event bus ───────────────────────────────────────────────────────── */

const _emitter = new EventEmitter();
_emitter.setMaxListeners(50);

const capturedEvents = [];

const ALL_EVENTS = [
  'position_update', 'ignition_on', 'ignition_off',
  'fuel_level', 'fuel_refuel', 'fuel_drain',
  'trip_started', 'trip_completed', 'device_heartbeat',
];

for (const name of ALL_EVENTS) {
  _emitter.on(name, (data) => {
    capturedEvents.push({ name, data, ts: Date.now() });
    let icon = '📡';
    if (name.startsWith('trip'))    icon = '🚛';
    if (name.startsWith('fuel'))    icon = '⛽';
    if (name === 'ignition_on')     icon = '🔑';
    if (name === 'ignition_off')    icon = '🔒';
    if (name === 'device_heartbeat') icon = '💓';
    console.log(`  ${icon} ${BOLD}${name}${RESET}  ${DIM}${JSON.stringify(data)}${RESET}`);
  });
}

// Bus shape expected by the module: { emit, on, off }
const bus = {
  emit: (type, data) => _emitter.emit(type, data),
  on:   _emitter.on.bind(_emitter),
  off:  _emitter.off.bind(_emitter),
};

/* ── Init module (no MQTT) ────────────────────────────────────────────────── */

header('@axis/telematics-core — test harness');
console.log('  Initialising module with in-memory DB (no MQTT broker)…');

const telematics = require('..');

telematics.init({ db, bus });

// Access internal modules directly — they are already initialised.
const deviceRegistry   = require('../src/state/deviceRegistry');
const teltonikaDecoder = require('../src/decoders/teltonikaDecoder');
const normaliser       = require('../src/services/deviceEventNormaliser');

ok('Module initialised');

/* ── Test fixtures ────────────────────────────────────────────────────────── */

const IMEI       = '352093079660097';
const VEHICLE_ID = 'GR-5432-23';
const HAULER_ID  = 'haul-01';

// Provision test device.
const device = deviceRegistry.provision(IMEI, {
  model:      'FMB920-003',
  hauler_id:  HAULER_ID,
  vehicle_id: VEHICLE_ID,
  sim_iccid:  '8923410012345678901',
  notes:      'Test device — harness only',
});
ok(`Device provisioned: IMEI ${IMEI} → vehicle ${VEHICLE_ID}`);

// Load a 3-point calibration curve for the test vehicle.
// Tank: 1200mm = 300L capacity.  Points: 0mm=0L, 600mm=150L, 1200mm=300L.
db.prepare('INSERT INTO fuel_calibrations (vehicle_id, mm, litres) VALUES (?, ?, ?)').run(VEHICLE_ID, 0,    0);
db.prepare('INSERT INTO fuel_calibrations (vehicle_id, mm, litres) VALUES (?, ?, ?)').run(VEHICLE_ID, 600,  150);
db.prepare('INSERT INTO fuel_calibrations (vehicle_id, mm, litres) VALUES (?, ?, ?)').run(VEHICLE_ID, 1200, 300);
ok('Calibration table loaded  (0mm=0L, 600mm=150L, 1200mm=300L)');

/* ── Payload builder ──────────────────────────────────────────────────────── */

let _ts = Date.now() - 10 * 60_000; // start 10 min in the past

function payload({
  ignition = null,
  lat = 6.834, lng = -2.054,
  speed = 0, angle = 180, satellites = 8,
  fuel_mm = null,
  signal = 17, battery_mv = 12400,
} = {}) {
  _ts += 30_000; // advance 30s per message
  const io = {};
  if (ignition !== null) io['1']     = ignition ? 1 : 0;
  if (fuel_mm  !== null) io['9']     = fuel_mm;
  io['21']    = signal;
  io['66']    = battery_mv;
  io['10060'] = 25_000_000;

  return {
    ident:      IMEI,
    timestamp:  _ts,
    lat, lng,
    alt:        120,
    angle,
    satellites,
    speed,
    io,
  };
}

function fire(raw) {
  const decoded = teltonikaDecoder.decode(raw);
  normaliser.handle(decoded, device);
}

/* ════════════════════════════════════════════════════════════════════════════
   SCENARIOS
   ════════════════════════════════════════════════════════════════════════════ */

async function main() {

  /* ── Scenario 1: Cold boot — heartbeat + first position ──────────────── */
  scenario(1, 'Cold boot — heartbeat + first position');
  info('Payload: no ignition signal, just signal/battery/position');

  fire(payload({ lat: 6.834, lng: -2.054, signal: 20, battery_mv: 12600 }));

  const pos1 = db.prepare('SELECT * FROM vehicle_positions WHERE vehicle_id = ?').get(VEHICLE_ID);
  if (pos1) ok(`vehicle_positions row created: (${pos1.latitude}, ${pos1.longitude})`);
  else       fail('vehicle_positions row missing');

  const hb1 = db.prepare('SELECT * FROM device_heartbeats WHERE imei = ?').get(IMEI);
  if (hb1) ok(`device_heartbeats row created: signal=${hb1.signal} battery_mv=${hb1.battery_mv}`);
  else      fail('device_heartbeats row missing');

  /* ── Scenario 2: Ignition ON → trip starts ────────────────────────────── */
  scenario(2, 'Ignition ON → trip_started');
  info('Payload: ignition=true, truck at mine gate');

  const before2 = capturedEvents.length;
  fire(payload({ ignition: true, lat: 6.834, lng: -2.054, speed: 0 }));
  await sleep(50); // let bus callbacks settle

  const tripStarted = capturedEvents.slice(before2).find((e) => e.name === 'trip_started');
  if (tripStarted) {
    ok(`trip_started emitted: tripId=${tripStarted.data.trip.id} source=${tripStarted.data.trip.source}`);
    if (tripStarted.data.trip.source !== 'device') fail('Expected source="device"');
    else ok('source = "device" ✓');
  } else {
    fail('trip_started not emitted');
  }

  const openTrip = db.prepare("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'in_progress'").get(VEHICLE_ID);
  if (openTrip) ok(`Open trip in DB: id=${openTrip.id} departed_at=${openTrip.departed_at}`);
  else           fail('No open trip found in DB');

  /* ── Scenario 3: En-route — position updates heading south ───────────── */
  scenario(3, 'En-route — 3 position updates along corridor');
  const waypoints = [
    { lat: 6.618, lng: -2.021, speed: 72, angle: 175 },
    { lat: 6.402, lng: -1.988, speed: 85, angle: 178 },
    { lat: 6.186, lng: -1.955, speed: 68, angle: 172 },
  ];

  let beforePos = capturedEvents.length;
  for (const wp of waypoints) {
    fire(payload({ ignition: true, ...wp }));
  }
  await sleep(20);

  const posUpdates = capturedEvents.slice(beforePos).filter((e) => e.name === 'position_update');
  ok(`${posUpdates.length}/3 position_update events emitted`);

  const lastPos = db.prepare('SELECT * FROM vehicle_positions WHERE vehicle_id = ?').get(VEHICLE_ID);
  ok(`Latest position in DB: (${lastPos.latitude.toFixed(3)}, ${lastPos.longitude.toFixed(3)}) speed=${lastPos.speed_kmh}`);

  /* ── Scenario 4: Fuel reading — calibration and level event ─────────── */
  scenario(4, 'Fuel reading — calibrated level emitted');
  info('Payload: fuel_mm=800 → should calibrate to 200L  (midpoint interpolation)');

  const before4 = capturedEvents.length;
  fire(payload({ ignition: true, lat: 6.186, lng: -1.955, speed: 0, fuel_mm: 800 }));
  await sleep(20);

  const fuelEvt = capturedEvents.slice(before4).find((e) => e.name === 'fuel_level');
  if (fuelEvt) {
    const expected = 200; // (800-600)/(1200-600)*150 + 150 = 200
    const got      = fuelEvt.data.fuel_litres;
    ok(`fuel_level emitted: fuel_litres=${got} fuel_mm=${fuelEvt.data.fuel_mm}`);
    if (Math.abs(got - expected) < 0.2) ok(`Calibration correct: 800mm → ${got}L (expected ${expected}L)`);
    else fail(`Calibration wrong: got ${got}L expected ${expected}L`);
  } else {
    fail('fuel_level not emitted');
  }

  /* ── Scenario 5: Brief stop — ignition OFF then back ON (no trip end) ── */
  scenario(5, 'Brief stop — ignition OFF then ON cancels idle timer');
  info(`Idle timeout = ${process.env.IGNITION_IDLE_TIMEOUT_MS}ms. Will send ignition_on after 150ms.`);

  const before5 = capturedEvents.length;
  fire(payload({ ignition: false, lat: 5.970, lng: -1.922, speed: 0 }));
  await sleep(150); // wait — but less than the 400ms timer

  fire(payload({ ignition: true, lat: 5.970, lng: -1.922, speed: 0 }));
  await sleep(500); // wait past what the old timer would have been

  const tripCompleted5 = capturedEvents.slice(before5).find((e) => e.name === 'trip_completed');
  if (!tripCompleted5) ok('trip_completed NOT fired — timer correctly cancelled by ignition_on ✓');
  else                 fail('trip_completed fired unexpectedly during brief stop');

  const newTripStarted5 = capturedEvents.slice(before5).find((e) => e.name === 'trip_started');
  if (!newTripStarted5) ok('trip_started NOT fired — existing trip resumed, no new trip opened ✓');
  else                  fail(`New trip started unexpectedly during brief stop: ${newTripStarted5.data.trip.id}`);

  const allOpen5 = db.prepare("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'in_progress'").all(VEHICLE_ID);
  if (allOpen5.length === 1) ok(`Exactly one open trip in DB (id=${allOpen5[0].id}) ✓`);
  else fail(`Expected 1 open trip, found ${allOpen5.length}`);

  /* ── Scenario 6: Ignition OFF → idle timer fires → trip closes ───────── */
  scenario(6, 'Destination reached — ignition OFF → idle timer → trip_completed');
  info(`Sending ignition_off. Waiting ${parseInt(process.env.IGNITION_IDLE_TIMEOUT_MS) + 100}ms for timer…`);

  const before6 = capturedEvents.length;
  fire(payload({ ignition: false, lat: 4.892, lng: -1.755, speed: 0, angle: 180 }));

  await sleep(parseInt(process.env.IGNITION_IDLE_TIMEOUT_MS) + 150);

  const tripCompleted6 = capturedEvents.slice(before6).find((e) => e.name === 'trip_completed');
  if (tripCompleted6) {
    const t = tripCompleted6.data.trip;
    ok(`trip_completed emitted: id=${t.id} duration_min=${t.duration_min}`);
    if (t.status === 'completed') ok('Trip status = "completed" ✓');
    else fail(`Trip status unexpected: ${t.status}`);
    if (t.arrived_at) ok(`arrived_at set: ${t.arrived_at}`);
    else fail('arrived_at missing');
  } else {
    fail('trip_completed not emitted after idle timeout');
  }

  const closedTrip = db.prepare("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'completed' ORDER BY arrived_at DESC LIMIT 1").get(VEHICLE_ID);
  if (closedTrip) ok(`Closed trip in DB: duration_min=${closedTrip.duration_min}`);

  /* ── Scenario 7: Refuel detection ───────────────────────────────────── */
  scenario(7, 'Refuel detection (fuel rises +140L while parked)');
  info('Seeding last fuel_reading at 50L, then sending payload that calibrates to 200L');

  // Seed a "previous" fuel reading — 5 minutes ago, 50L (200mm).
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  db.prepare(
    'INSERT INTO fuel_readings (imei, vehicle_id, hauler_id, fuel_mm, fuel_litres, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(IMEI, VEHICLE_ID, HAULER_ID, 200, 50, fiveMinAgo);
  info('Previous reading seeded: 200mm → 50L');

  const before7 = capturedEvents.length;
  fire(payload({ ignition: false, lat: 4.892, lng: -1.755, fuel_mm: 800 }));
  await sleep(50);

  const refuelEvt = capturedEvents.slice(before7).find((e) => e.name === 'fuel_refuel');
  if (refuelEvt) {
    const d = refuelEvt.data;
    ok(`fuel_refuel emitted: before=${d.before_l}L after=${d.after_l}L delta=+${d.delta_l.toFixed(1)}L`);
    if (d.delta_l > 20) ok(`Delta ${d.delta_l.toFixed(1)}L > 20L threshold ✓`);
  } else {
    fail('fuel_refuel not emitted');
  }

  /* ── Scenario 8: Drain detection ────────────────────────────────────── */
  scenario(8, 'Drain detection (fuel drops −150L while ignition off)');
  info('Seeding last fuel_reading at 240L, sending payload at 90L with ignition=false');

  // Seed a recent 240L reading.
  const twoMinAgo = new Date(Date.now() - 2 * 60_000).toISOString();
  db.prepare(
    'INSERT INTO fuel_readings (imei, vehicle_id, hauler_id, fuel_mm, fuel_litres, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(IMEI, VEHICLE_ID, HAULER_ID, 960, 240, twoMinAgo);
  info('Previous reading seeded: 960mm → 240L');

  const before8 = capturedEvents.length;
  // 360mm → (360-0)/(600-0)*150 = 90L
  fire(payload({ ignition: false, lat: 4.892, lng: -1.755, fuel_mm: 360 }));
  await sleep(50);

  const drainEvt = capturedEvents.slice(before8).find((e) => e.name === 'fuel_drain');
  if (drainEvt) {
    const d = drainEvt.data;
    ok(`fuel_drain emitted: before=${d.before_l}L after=${d.after_l}L delta=${d.delta_l.toFixed(1)}L`);
    if (-d.delta_l > 15) ok(`Drop ${(-d.delta_l).toFixed(1)}L > 15L threshold ✓`);
  } else {
    fail('fuel_drain not emitted');
  }

  /* ── DB state dump ────────────────────────────────────────────────────── */
  header('DB STATE AFTER ALL SCENARIOS');

  console.log(`\n${BOLD}devices${RESET}`);
  console.table(db.prepare('SELECT imei, model, vehicle_id, hauler_id, active FROM devices').all());

  console.log(`\n${BOLD}device_heartbeats${RESET}`);
  console.table(db.prepare('SELECT imei, signal, battery_mv, last_seen_at FROM device_heartbeats').all());

  console.log(`\n${BOLD}vehicle_positions${RESET}`);
  console.table(db.prepare('SELECT vehicle_id, latitude, longitude, speed_kmh, position_at FROM vehicle_positions').all());

  console.log(`\n${BOLD}trips${RESET}`);
  console.table(db.prepare('SELECT id, vehicle_id, status, source, departed_at, arrived_at, duration_min FROM trips').all());

  console.log(`\n${BOLD}fuel_readings (last 5)${RESET}`);
  console.table(db.prepare(
    'SELECT id, vehicle_id, fuel_mm, fuel_litres, recorded_at FROM fuel_readings ORDER BY id DESC LIMIT 5',
  ).all());

  /* ── Summary ──────────────────────────────────────────────────────────── */
  header('SUMMARY');
  const total  = capturedEvents.length;
  const byType = {};
  for (const e of capturedEvents) byType[e.name] = (byType[e.name] ?? 0) + 1;
  console.log(`\n  Total events emitted: ${BOLD}${total}${RESET}`);
  for (const [name, count] of Object.entries(byType)) {
    console.log(`    ${GREEN}${count.toString().padStart(3)}${RESET}  ${name}`);
  }

  if (process.exitCode === 1) {
    console.log(`\n  ${RED}${BOLD}FAILURES detected — see ✗ above${RESET}`);
  } else {
    console.log(`\n  ${GREEN}${BOLD}All checks passed ✓${RESET}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n${RED}${BOLD}Harness crashed:${RESET}`, err);
  process.exit(1);
});
