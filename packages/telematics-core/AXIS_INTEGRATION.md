# AXIS Integration Guide — `@axis/telematics-core`

This guide tells you exactly what to change in the AXIS Command Center server to wire up the telematics module and remove the Loconav dependency.

Do each step in order. The module is designed so the AXIS server continues to boot and serve normally at every step — nothing is broken until Loconav routes are explicitly disabled in Step 6.

---

## Step 1 — Install the package

From the AXIS server root (`Bauxite Haulage/`):

```bash
npm install file:../telematics-core
```

This adds `"@axis/telematics-core": "file:../telematics-core"` to the AXIS `package.json` and makes the module available as a normal `require`.

---

## Step 2 — Initialise the module in `server/index.js`

Add these three lines. Place them **after** the migration runner block (line ~238) and **before** `app.listen`.

```js
// @axis/telematics-core — device-to-dashboard MQTT pipeline.
const telematics = require('@axis/telematics-core');
telematics.init({
  mqtt: {
    host:   process.env.MQTT_HOST,
    port:   parseInt(process.env.MQTT_PORT ?? '8883', 10),
    tls:    process.env.MQTT_TLS !== 'false',
    caFile: process.env.MQTT_CA_FILE,
  },
  db:  require('./db'),
  bus: require('./services/eventBus'),
  middleware: {
    requireRole: require('./middleware/auth').requireRole,
  },
});
```

> **Why after migrations:** the telematics module runs its own migrations (009_device_tables.sql) inside `init()`, using the same `db` instance. They must run before the MQTT connection opens.

---

## Step 3 — Mount the devices router in `server/index.js`

Immediately after the `telematics.init()` block, add one line alongside the other route mounts:

```js
app.use('/api/devices', telematics.getDevicesRouter());
```

The router is already guarded by `requireRole('axis_admin', 'axis_ops')` — no extra auth needed here.

---

## Step 4 — Add new event handlers to `server/services/eventProcessor.js`

The module emits four new event types onto the bus. The existing `eventProcessor.js` processes webhook rows and is not the right place for bus-native event handlers. Instead, subscribe in `server/index.js` alongside the existing event processor setup (around line ~270):

```js
// @axis/telematics-core — subscribe to new device-sourced bus events.
try {
  const eventBus   = require('./services/eventBus');
  const alertEngine = require('./services/alertEngine');
  const log        = require('./services/logger');
  const db         = require('./db');

  // fuel_level — record to fuelLogs if desired; evaluate low-fuel alert.
  eventBus.on('fuel_level', (data) => {
    try {
      // Optional: store in fuelLogs state module.
      // require('./state/fuelLogs').record(data);

      // Evaluate a low_fuel alert rule if configured.
      if (data.fuel_litres != null) {
        alertEngine.evaluate({
          rule_type:  'low_fuel',
          value:      data.fuel_litres,
          hauler_id:  data.hauler_id,
          vehicle_id: data.vehicle_id,
          meta:       { fuel_mm: data.fuel_mm, position_at: data.position_at },
        });
      }
    } catch (err) { log.error('fuel_level handler error', { err: err.message }); }
  });

  // fuel_refuel — log the event; no alert needed.
  eventBus.on('fuel_refuel', (data) => {
    try {
      log.info('Fuel refuel detected', {
        vehicle_id: data.vehicle_id,
        hauler_id:  data.hauler_id,
        before_l:   data.before_l,
        after_l:    data.after_l,
        delta_l:    data.delta_l,
      });
    } catch (err) { log.error('fuel_refuel handler error', { err: err.message }); }
  });

  // fuel_drain — raise a fuel_theft alert.
  eventBus.on('fuel_drain', (data) => {
    try {
      alertEngine.evaluate({
        rule_type:  'fuel_theft',
        value:      Math.abs(data.delta_l),
        hauler_id:  data.hauler_id,
        vehicle_id: data.vehicle_id,
        meta:       { before_l: data.before_l, after_l: data.after_l, position_at: data.position_at },
      });
    } catch (err) { log.error('fuel_drain handler error', { err: err.message }); }
  });

  // device_heartbeat — update last-seen; evaluate offline alert.
  eventBus.on('device_heartbeat', (data) => {
    try {
      if (data.signal != null && data.signal < 5) {
        alertEngine.evaluate({
          rule_type:  'low_signal',
          value:      data.signal,
          hauler_id:  data.hauler_id,
          vehicle_id: data.vehicle_id,
          meta:       { imei: data.imei, battery_mv: data.battery_mv },
        });
      }
    } catch (err) { log.error('device_heartbeat handler error', { err: err.message }); }
  });

} catch (err) {
  log.warn('Telematics bus handlers failed to register', { err: err.message });
}
```

> The alert rule types `low_fuel`, `fuel_theft`, and `low_signal` need corresponding rows in the `alert_rules` table. Seed them via the admin panel or directly in SQL before enabling this.

---

## Step 5 — Run the migration

Migration `009_device_tables.sql` is run **automatically** by `telematics.init()` on the next server boot. You do not need to run it manually.

The migration creates five new tables: `devices`, `device_heartbeats`, `fuel_readings`, `fuel_calibrations`, and `device_events`. All use `CREATE TABLE IF NOT EXISTS` — they are safe to run against any existing database state.

To verify after boot, check the log for:
```
[telematics] applying migration 009_device_tables.sql
```

Or query directly:
```sql
SELECT version, filename, applied_at FROM schema_migrations WHERE version = 9;
```

---

## Step 6 — Environment variables

Add these to the AXIS `.env` file:

```dotenv
# ── @axis/telematics-core ─────────────────────────────────────────────────────

# MQTT broker (EMQX). Run docker compose -f ../telematics-core/docker-compose.emqx.yml up -d
MQTT_HOST=localhost
MQTT_PORT=8883
MQTT_TLS=true
MQTT_CA_FILE=/path/to/certs/ca.pem   # path to the CA cert used to sign the broker cert

# Fuel anomaly thresholds (defaults shown — adjust per tank capacity).
FUEL_REFUEL_MIN_L=20         # minimum rise (litres) to classify as a refuel event
FUEL_DRAIN_MIN_L=15          # minimum drop (litres, ignition off) to classify as drain
FUEL_MAX_INTERVAL_MIN=30     # max age of last reading for anomaly comparison to be valid

# Fuel ring buffer — max readings stored per vehicle.
FUEL_RING_MAX=2000

# Trip detection — how long ignition must stay OFF before a trip is closed.
IGNITION_IDLE_TIMEOUT_MS=180000   # 3 minutes
```

All variables have safe defaults; the module works without them set.

---

## Step 7 — Flagging redundant Loconav routes

Once at least one hauler's devices are live and sending MQTT data, the following become redundant:

### `server/routes/webhooks.js`

| Route | Redundant when... |
|-------|-------------------|
| `POST /api/webhooks/:hauler_id/loconav` | All trucks for `hauler_id` have live Teltonika devices |
| `POST /api/webhooks/:hauler_id/custom`  | Same — only needed for non-Teltonika adapters |

**Do not remove them yet.** Disable per-hauler by revoking the `api_token` on that hauler row via the admin panel. Once all haulers are migrated, these routes can be deleted entirely.

Mark them for removal by adding this comment at the top of `server/routes/webhooks.js`:

```js
// TODO(telematics-migration): Delete this file once all haulers have live
// Teltonika devices and MQTT data is confirmed flowing for 7+ days.
// Tracked: AXIS telematics-core Phase 7 completion.
```

### `server/services/fmsPoller.js`

The Loconav polling adapter (`fmsPoller.js`) generates synthetic position events for demo mode and polls Loconav for live haulers. Once devices are live:

1. Confirm position events are arriving via MQTT (check `vehicle_positions.position_at` freshness).
2. Comment out the `require('./services/fmsPoller').start()` call in `server/index.js`.
3. Delete `fmsPoller.js` in a follow-up cleanup PR once all haulers are confirmed live.

---

## Checklist — Before going live with a hauler

1. [ ] `npm install` complete and `@axis/telematics-core` appears in `node_modules/`
2. [ ] EMQX running: `docker compose -f ../telematics-core/docker-compose.emqx.yml ps`
3. [ ] TLS certs in place: `certs/ca.pem`, `certs/broker.pem`, `certs/broker.key`
4. [ ] At least one device provisioned: `POST /api/devices/:imei/provision`
5. [ ] MQTT credentials imported into EMQX for that device
6. [ ] Fuel calibration table uploaded: `PUT /api/devices/:imei/calibration`
7. [ ] Server restarted — migration 009 applied (check log)
8. [ ] Test message arrives: check `device_heartbeats` for the IMEI
9. [ ] `vehicle_positions` row updated for the assigned vehicle
10. [ ] Trip starts and closes correctly on ignition cycle
