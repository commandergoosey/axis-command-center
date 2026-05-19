'use strict';

/*
 * test/mock-publisher.js — mock Teltonika MQTT publisher
 *
 * Connects to your EMQX broker and publishes a simulated Nyinahin→Takoradi
 * run: ignition on at the mine gate, 10 position updates along the 300km
 * corridor, decreasing fuel, then ignition off at Takoradi port.
 *
 * Prerequisites:
 *   1. EMQX running:  docker compose -f docker-compose.emqx.yml up -d
 *   2. A device provisioned via POST /api/devices/:imei/provision
 *   3. MQTT credentials imported into EMQX for that device
 *
 * Usage:
 *   node test/mock-publisher.js
 *   node test/mock-publisher.js --imei 352093079660097 --interval 2000
 *   MQTT_HOST=my-broker.internal node test/mock-publisher.js
 *
 * Options (CLI flags or env vars):
 *   --imei      IMEI of the device to publish as          (default: 352093079660097)
 *   --username  MQTT username                              (default: same as IMEI)
 *   --password  MQTT password (from provision endpoint)   (default: test-password)
 *   --host      Broker hostname                            (default: localhost)
 *   --port      Broker port                                (default: 8883)
 *   --no-tls    Disable TLS (plain MQTT)                   (default: TLS on)
 *   --ca        Path to CA cert PEM                        (default: ./certs/ca.pem)
 *   --interval  Ms between position messages               (default: 3000)
 *   --scenario  Which scenario to run: 'run' | 'refuel' | 'drain' | 'loop'
 *               run    = one full laden trip Nyinahin→Takoradi (default)
 *               refuel = parked truck, fuel rises by 150L
 *               drain  = parked truck ignition off, fuel drops 80L
 *               loop   = run scenario on repeat forever
 */

const fs      = require('fs');
const path    = require('path');
const mqtt    = require('mqtt');

/* ── Parse args ──────────────────────────────────────────────────────────── */

function arg(flag, envKey, defaultVal) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (envKey && process.env[envKey]) return process.env[envKey];
  return defaultVal;
}

function hasFlag(flag) { return process.argv.includes(flag); }

const IMEI     = arg('--imei',     'DEVICE_IMEI',  '352093079660097');
const USERNAME = arg('--username', null,            IMEI);
const PASSWORD = arg('--password', 'DEVICE_PASSWORD', 'test-password');
const HOST     = arg('--host',     'MQTT_HOST',    'localhost');
const PORT     = parseInt(arg('--port', 'MQTT_PORT', '8883'), 10);
const NO_TLS   = hasFlag('--no-tls') || process.env.MQTT_TLS === 'false';
const CA_FILE  = arg('--ca', 'MQTT_CA_FILE', path.join(__dirname, '..', 'certs', 'ca.pem'));
const INTERVAL = parseInt(arg('--interval', null, '3000'), 10);
const SCENARIO = arg('--scenario', null, 'run');

const TOPIC = `devices/${IMEI}/data`;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const DIM   = '\x1b[2m';
const RED   = '\x1b[31m';

function log(msg)  { console.log(`  ${msg}`); }
function ok(msg)   { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function sent(msg) { console.log(`  ${CYAN}→${RESET} ${msg}`); }

let _ts = Date.now();
function nextTs(advanceMs = 30_000) { _ts += advanceMs; return _ts; }

/* ── Payload builder ─────────────────────────────────────────────────────── */

function buildPayload({
  lat, lng,
  speed     = 0,
  angle     = 180,
  satellites = 9,
  ignition  = null,
  fuel_mm   = null,
  signal    = 18,
  battery_mv = 12550,
  advanceMs  = 30_000,
} = {}) {
  const io = {};
  if (ignition !== null) io['1'] = ignition ? 1 : 0;
  if (fuel_mm  !== null) io['9'] = fuel_mm;
  io['21']    = signal;
  io['66']    = battery_mv;
  io['10060'] = 25_000_000 + Math.round(Math.random() * 1000);

  return {
    ident:      IMEI,
    timestamp:  nextTs(advanceMs),
    lat,
    lng,
    alt:        120 + Math.round(Math.random() * 20),
    angle,
    satellites,
    speed,
    io,
  };
}

/* ── Corridor waypoints: Nyinahin → Takoradi (approx 300 km) ────────────── */
// Fuel burn: ~42L/100km → ~12.6L per 30km segment. Starting at 250L.

const CORRIDOR = [
  { lat: 6.834, lng: -2.054, label: 'Nyinahin Mine Gate',  speed: 0,  fuel_mm: 1000, ignition: true  },
  { lat: 6.618, lng: -2.021, label: 'Heading south',        speed: 72, fuel_mm: 975                   },
  { lat: 6.402, lng: -1.988, label: 'Open highway',         speed: 88, fuel_mm: 949                   },
  { lat: 6.186, lng: -1.955, label: 'Approaching Kumasi',   speed: 65, fuel_mm: 924                   },
  { lat: 5.970, lng: -1.922, label: 'Past Kumasi',          speed: 80, fuel_mm: 898                   },
  { lat: 5.754, lng: -1.889, label: 'Mid-corridor',         speed: 83, fuel_mm: 873                   },
  { lat: 5.538, lng: -1.856, label: 'Weighbridge approach', speed: 45, fuel_mm: 847                   },
  { lat: 5.322, lng: -1.823, label: 'Post weighbridge',     speed: 76, fuel_mm: 822                   },
  { lat: 5.106, lng: -1.790, label: 'Approaching coast',    speed: 72, fuel_mm: 796                   },
  { lat: 4.892, lng: -1.755, label: 'Takoradi Port Gate',   speed: 0,  fuel_mm: 771, ignition: false  },
];

/* ── Scenarios ───────────────────────────────────────────────────────────── */

function buildRunScenario() {
  const messages = [];
  for (let i = 0; i < CORRIDOR.length; i++) {
    const wp = CORRIDOR[i];
    messages.push({
      label: wp.label,
      payload: buildPayload({
        lat:      wp.lat,
        lng:      wp.lng,
        speed:    wp.speed,
        fuel_mm:  wp.fuel_mm,
        ignition: wp.ignition ?? null,
        angle:    175 + Math.round(Math.random() * 10),
      }),
    });
  }
  return messages;
}

function buildRefuelScenario() {
  return [
    {
      label: 'Before refuel — 50L remaining (200mm)',
      payload: buildPayload({ lat: 4.892, lng: -1.755, fuel_mm: 200, ignition: false }),
    },
    {
      label: 'Tanker arrives — waiting',
      payload: buildPayload({ lat: 4.892, lng: -1.755, fuel_mm: 200, ignition: false }),
    },
    {
      label: 'Refuel complete — 240L (960mm)',
      payload: buildPayload({ lat: 4.892, lng: -1.755, fuel_mm: 960, ignition: false }),
    },
  ];
}

function buildDrainScenario() {
  return [
    {
      label: 'Parked — 200L (800mm), ignition off',
      payload: buildPayload({ lat: 5.322, lng: -1.823, fuel_mm: 800, ignition: false }),
    },
    {
      label: 'Still parked',
      payload: buildPayload({ lat: 5.322, lng: -1.823, fuel_mm: 797, ignition: false }),
    },
    {
      label: 'DRAIN detected — 60L remaining (240mm) — dropped 140L',
      payload: buildPayload({ lat: 5.322, lng: -1.823, fuel_mm: 240, ignition: false }),
    },
  ];
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`\n${BOLD}${CYAN}${'═'.repeat(62)}${RESET}`);
  console.log(`${BOLD}${CYAN}  @axis/telematics-core — mock MQTT publisher${RESET}`);
  console.log(`${CYAN}${'═'.repeat(62)}${RESET}\n`);

  log(`IMEI:     ${BOLD}${IMEI}${RESET}`);
  log(`Broker:   ${BOLD}${NO_TLS ? 'mqtt' : 'mqtts'}://${HOST}:${PORT}${RESET}`);
  log(`Topic:    ${BOLD}${TOPIC}${RESET}`);
  log(`Scenario: ${BOLD}${SCENARIO}${RESET}`);
  log(`Interval: ${BOLD}${INTERVAL}ms${RESET} between messages\n`);

  // Build connect options.
  const connectOpts = {
    username:        USERNAME,
    password:        PASSWORD,
    reconnectPeriod: 0,
    connectTimeout:  10_000,
    rejectUnauthorized: true,
  };

  if (!NO_TLS && fs.existsSync(CA_FILE)) {
    connectOpts.ca = fs.readFileSync(CA_FILE);
    ok(`CA cert loaded from ${CA_FILE}`);
  } else if (!NO_TLS) {
    log(`${DIM}CA cert not found at ${CA_FILE} — connecting without CA verification${RESET}`);
    connectOpts.rejectUnauthorized = false;
  }

  const url    = `${NO_TLS ? 'mqtt' : 'mqtts'}://${HOST}:${PORT}`;
  const client = mqtt.connect(url, connectOpts);

  await new Promise((resolve, reject) => {
    client.on('connect', () => {
      ok(`Connected to ${url}`);
      resolve();
    });
    client.on('error', (err) => {
      console.error(`\n  ${RED}Connection failed: ${err.message}${RESET}`);
      console.error(`  ${DIM}Is EMQX running? Try: docker compose -f docker-compose.emqx.yml up -d${RESET}\n`);
      reject(err);
    });
    setTimeout(() => reject(new Error('Connection timeout')), 12_000);
  });

  async function publish(messages) {
    for (const { label, payload } of messages) {
      const json = JSON.stringify(payload);
      sent(`${label}`);
      log(`  ${DIM}${json}${RESET}`);

      await new Promise((resolve, reject) => {
        client.publish(TOPIC, json, { qos: 1 }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await sleep(INTERVAL);
    }
  }

  if (SCENARIO === 'refuel') {
    console.log(`\n${BOLD}Scenario: Refuel${RESET}\n`);
    await publish(buildRefuelScenario());
  } else if (SCENARIO === 'drain') {
    console.log(`\n${BOLD}Scenario: Fuel drain${RESET}\n`);
    await publish(buildDrainScenario());
  } else if (SCENARIO === 'loop') {
    console.log(`\n${BOLD}Scenario: Loop (Ctrl+C to stop)${RESET}\n`);
    let run = 0;
    while (true) {
      run++;
      console.log(`\n${BOLD}Run #${run}${RESET}`);
      _ts = Date.now();
      await publish(buildRunScenario());
      log(`\nWaiting 5s before next run…`);
      await sleep(5_000);
    }
  } else {
    // Default: single laden run
    console.log(`\n${BOLD}Scenario: Full laden run — Nyinahin → Takoradi${RESET}\n`);
    await publish(buildRunScenario());
  }

  ok(`All messages published`);
  client.end();
  process.exit(0);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((err) => {
  console.error(`\n${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
