'use strict';

require('dotenv').config();

/* ── LP-9: validate env before anything else boots ───────────────────── */
require('./services/startup').validate();

const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

/* ── LP-8: structured logger ─────────────────────────────────────────── */
const log = require('./services/logger');

/* ── DB migrations — must run before any module prepares statements ───── */
// state/* modules prepare SQLite statements at require() time. Migrations
// (including the telematics-core ones) must be applied first so every
// column they reference already exists when those modules are loaded.
try {
  require('./db/migrate').run(require('./db'));
} catch (err) {
  log.error('Migration runner failed — some columns may be missing', { err: err.message });
}

const telematics = require('@axis/telematics-core');

const webhooksRoute = require('./routes/webhooks');
const snapshotRoute = require('./routes/snapshot');
const haulersRoute  = require('./routes/haulers');
const todayRoute    = require('./routes/today');
const corridorRoute = require('./routes/corridor');
const convoysRoute  = require('./routes/convoys');
const tripsRoute    = require('./routes/trips');
const contractRoute   = require('./routes/contract');
const tariffRoute     = require('./routes/tariff');
const tranchesRoute   = require('./routes/tranches');
const financialsRoute   = require('./routes/financials');
const complianceRoute   = require('./routes/compliance');
const alertsRoute       = require('./routes/alerts');
const intelligenceRoute = require('./routes/intelligence');
const reportsRoute      = require('./routes/reports');
const authRoute         = require('./routes/auth');
const fleetRoute        = require('./routes/fleet');
const maintenanceRoute  = require('./routes/maintenance');
const coachingRoute     = require('./routes/coaching');
const driversRoute      = require('./routes/drivers');
const settingsRoute     = require('./routes/settings');
const auditRoute        = require('./routes/audit');
const notificationsRoute = require('./routes/notifications');
const lenderRoute        = require('./routes/lender');
const risksRoute         = require('./routes/risks');
const sensitivityRoute   = require('./routes/sensitivity');
const searchRoute        = require('./routes/search');
const meRoute            = require('./routes/me');
const playbooksRoute     = require('./routes/playbooks');
const broadcastsRoute    = require('./routes/broadcasts');
const settlementsRoute   = require('./routes/settlements');
const claimsRoute        = require('./routes/claims');
const dieselRoute        = require('./routes/diesel');
const analyticsRoute     = require('./routes/analytics');
const adminRoute         = require('./routes/admin');
const positionsRoute     = require('./routes/positions');
const eventsRoute        = require('./routes/events');
const { attachUser }    = require('./middleware/auth');

const app  = express();
const PROD = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3002', 10);

/* ── LP-6: Security headers (helmet) ─────────────────────────────────── */
// CSP is disabled because the API server and Vite dev server are on different
// origins in development. In production the Vite bundle is served statically
// from Express itself, so CSP can be re-enabled then if desired.
app.use(helmet({ contentSecurityPolicy: false }));

/* ── CORS ─────────────────────────────────────────────────────────────── */
const _corsAllowed = (process.env.CORS_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                      // same-origin / server-to-server
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (_corsAllowed.length === 0) return cb(null, true);    // open until CORS_ORIGIN is set
    if (_corsAllowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not in allowlist`));
  },
  credentials: true,
}));

// The `verify` callback captures the raw request body as a Buffer so that
// webhook routes can verify HMAC signatures without re-reading the stream.
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

/* ── LP-6: Request ID ─────────────────────────────────────────────────── */
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

/* ── LP-46: Per-user write rate limiting ─────────────────────────────── */
const userWriteLimit = require('./middleware/userWriteLimit');
app.use(userWriteLimit);

/* ── LP-6: Auth rate limiting (production only) ───────────────────────── */
// 20 requests per 15 minutes per IP on the auth endpoints most susceptible
// to brute-force or enumeration attacks.
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             20,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — please wait before trying again' },
  skip:            () => !PROD,    // rate-limit only in production
});
app.use('/api/auth/login',         authLimiter);
app.use('/api/auth/request-reset', authLimiter);

/* ── LP-8: HTTP request logger ───────────────────────────────────────── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log.http(`${req.method} ${req.path}`, {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      ms:         Date.now() - start,
      request_id: req.id,
    });
  });
  next();
});

// Permissive — attaches req.user if a valid bearer token is present, else
// continues unauthenticated. Write endpoints layer requireRole on top.
app.use(attachUser);

/* ── Public config — drives demo banner, corridor constants ── */
app.get('/api/config', (_req, res) => {
  res.json({
    product: 'AXIS Command Center',
    corridor: {
      name: 'Nyinahin–Takoradi',
      length_km: 300,
      counterparty: 'GIBDLC',
      timezone: 'Africa/Accra',
    },
    // demo_mode is true whenever at least one hauler has not provided an API token.
    // Phase 2 replaces this with a real hauler-registry check.
    demo_mode: !process.env.AXIS_LIVE_MODE,
    version: '0.1.0',
  });
});

/* ── Health — LP-8 enhanced ──────────────────────────────────────────── */
function healthPayload() {
  let dbOk = false;
  try {
    require('./db').prepare('SELECT 1').get();
    dbOk = true;
  } catch (_) {}
  return {
    status:    dbOk ? 'ok' : 'degraded',
    uptime_s:  Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    version:   '0.1.0',
    env:       PROD ? 'production' : 'development',
    db:        { ok: dbOk },
    mailer:    { demo: !process.env.SMTP_HOST },
  };
}
app.get('/health',      (_req, res) => res.json(healthPayload()));
app.get('/api/health',  (_req, res) => res.json(healthPayload()));

/* ── @axis/telematics-core — device-to-dashboard MQTT pipeline ───────── */
try {
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
} catch (err) {
  log.error('[telematics] init failed', { err: err.message });
}

/* ── Routes ── */
app.use('/api/auth',     authRoute);
app.use('/api/snapshot', snapshotRoute);
app.use('/api/haulers',  haulersRoute);
app.use('/api/today',    todayRoute);
app.use('/api/corridor', corridorRoute);
app.use('/api/convoys',  convoysRoute);
app.use('/api/trips',    tripsRoute);
app.use('/api/contract',   contractRoute);
app.use('/api/tariff',     tariffRoute);
app.use('/api/tranches',   tranchesRoute);
app.use('/api/financials',   financialsRoute);
app.use('/api/compliance',   complianceRoute);
app.use('/api/alerts',       alertsRoute);
app.use('/api/intelligence', intelligenceRoute);
app.use('/api/reports',      reportsRoute);
app.use('/api/fleet',        fleetRoute);
app.use('/api/maintenance',  maintenanceRoute);
app.use('/api/coaching',     coachingRoute);
app.use('/api/drivers',      driversRoute);
app.use('/api/settings',     settingsRoute);
app.use('/api/audit',        auditRoute);
app.use('/api/notifications', notificationsRoute);
app.use('/api/lender',       lenderRoute);
app.use('/api/risks',        risksRoute);
app.use('/api/sensitivity',  sensitivityRoute);
app.use('/api/search',       searchRoute);
app.use('/api/me',           meRoute);
app.use('/api/playbooks',    playbooksRoute);
app.use('/api/broadcasts',   broadcastsRoute);
app.use('/api/settlements',  settlementsRoute);
app.use('/api/claims',       claimsRoute);
app.use('/api/diesel',       dieselRoute);
app.use('/api/analytics',   analyticsRoute);
app.use('/api/admin',       adminRoute);
app.use('/api/positions',   positionsRoute);
app.use('/api/events',      eventsRoute);
app.use('/api/webhooks',    webhooksRoute);
app.use('/api/devices',     telematics.getDevicesRouter());

/* ── LP-10: Serve built Vite bundle in production ────────────────────── */
// In development the Vite dev server handles the frontend on a different port.
// In production (NODE_ENV=production) Express serves the built bundle from
// ../client/dist and handles SPA fallback (any non-/api path returns index.html).
if (PROD) {
  const distPath = path.resolve(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { maxAge: '1y', etag: true }));
    app.get(/^(?!\/api|\/health).*$/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    log.info('Serving Vite bundle from client/dist');
  } else {
    log.warn('Production mode but client/dist not found — run `npm run build` in client/');
  }
}

/* ── 404 ── */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

/* ── Error handler ── */
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Seed integration sync log on boot. Idempotent.
try {
  const integrationSyncLog = require('./state/integrationSyncLog');
  const roster = require('./state/roster');
  integrationSyncLog.ensureSeeded(roster.list());
} catch (err) {
  log.warn('Integration sync log seed skipped', { err: err.message });
}

// Start the report schedule runner.
try {
  require('./services/scheduleRunner').start();
} catch (err) {
  log.warn('Schedule runner failed to start', { err: err.message });
}

// LP-12 — FMS poller (Loconav + demo synthetic positions).
try {
  require('./services/fmsPoller').start();
} catch (err) {
  log.warn('FMS poller failed to start', { err: err.message });
}

// @axis/telematics-core — subscribe to device-sourced bus events.
try {
  const eventBus    = require('./services/eventBus');
  const alertEngine = require('./services/alertEngine');

  eventBus.on('fuel_level', (data) => {
    try {
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

// LP-11 — Event processor sweep: clear any backlog of unprocessed webhook_events
// every 60 seconds (catches events that failed inline processing).
try {
  const eventProcessor = require('./services/eventProcessor');
  const sweep = setInterval(() => {
    try { eventProcessor.processPending(); }
    catch (err) { log.error('Event processor sweep error', { err: err.message }); }
  }, 60_000);
  sweep.unref();
} catch (err) {
  log.warn('Event processor sweep failed to start', { err: err.message });
}

// LP-15 — Metrics aggregator: run nightly at 01:00 UTC using node-cron.
try {
  const cron       = require('node-cron');
  const aggregator = require('./services/metricsAggregator');
  cron.schedule('0 1 * * *', () => {
    log.info('Metrics aggregator: nightly run starting');
    try { aggregator.aggregate(); }
    catch (err) { log.error('Metrics aggregator error', { err: err.message }); }
  });
} catch (err) {
  log.warn('Metrics aggregator cron failed to schedule', { err: err.message });
}

// LP-31 — Maintenance due checker: run daily at 06:00 UTC.
try {
  const cron    = require('node-cron');
  const maintChecker = require('./services/maintenanceChecker');
  cron.schedule('0 6 * * *', () => {
    log.info('Maintenance checker: daily run starting');
    try { maintChecker.run(); }
    catch (err) { log.error('Maintenance checker error', { err: err.message }); }
  });
} catch (err) {
  log.warn('Maintenance checker cron failed to schedule', { err: err.message });
}

// LP-24 — Corridor health scorer: run nightly at 00:30 UTC.
try {
  const cron          = require('node-cron');
  const healthScorer  = require('./services/healthScorer');
  cron.schedule('30 0 * * *', () => {
    log.info('Health scorer: nightly run starting');
    try { healthScorer.run(); }
    catch (err) { log.error('Health scorer error', { err: err.message }); }
  });
  // Compute today's score on boot so the corridor route has data immediately.
  setImmediate(() => {
    try { healthScorer.run(); }
    catch (err) { log.warn('Health scorer: boot run failed', { err: err.message }); }
  });
} catch (err) {
  log.warn('Health scorer cron failed to schedule', { err: err.message });
}

// LP-35 — Alert escalation sweep: run hourly.
try {
  const cron      = require('node-cron');
  const escalation = require('./services/alertEscalation');
  cron.schedule('0 * * * *', () => {
    try { escalation.run(); }
    catch (err) { log.error('Alert escalation error', { err: err.message }); }
  });
} catch (err) {
  log.warn('Alert escalation cron failed to schedule', { err: err.message });
}

// LP-38 — Data retention: purge webhook_events older than 30 days, daily at 03:00 UTC.
try {
  const cron = require('node-cron');
  const RETENTION_DAYS = parseInt(process.env.WEBHOOK_RETENTION_DAYS ?? '30', 10);
  cron.schedule('0 3 * * *', () => {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
      const result = require('./db').prepare(
        'DELETE FROM webhook_events WHERE received_at < ?',
      ).run(cutoff);
      if (result.changes > 0) {
        log.info('Data retention: webhook_events purge', {
          deleted: result.changes, cutoff, retention_days: RETENTION_DAYS,
        });
      }
    } catch (err) { log.error('Data retention error', { err: err.message }); }
  });
} catch (err) {
  log.warn('Data retention cron failed to schedule', { err: err.message });
}

// LP-54 — Audit log retention: purge audit_log entries older than N days, daily at 04:00 UTC.
// Separate from LP-38 webhook retention to allow independent tuning. Default 365 days.
try {
  const cron = require('node-cron');
  const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '365', 10);
  cron.schedule('0 4 * * *', () => {
    try {
      const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
      const result = require('./db').prepare(
        'DELETE FROM audit_log WHERE ts < ?',
      ).run(cutoff);
      if (result.changes > 0) {
        log.info('Data retention: audit_log purge', {
          deleted: result.changes, cutoff, retention_days: AUDIT_RETENTION_DAYS,
        });
      }
    } catch (err) { log.error('Audit retention error', { err: err.message }); }
  });
} catch (err) {
  log.warn('Audit retention cron failed to schedule', { err: err.message });
}

// LP-50 — Startup hardening: verify required tables exist post-migration.
try {
  const _db = require('./db');
  const REQUIRED_TABLES = [
    'sessions', 'users', 'fleet_trucks', 'drivers', 'trips',
    'vehicle_positions', 'webhook_events', 'alert_state', 'alert_rules',
    'corridor_health', 'corridor_benchmarks', 'kv_settings',
    'notification_log', 'audit_log',
  ];
  const existing = new Set(
    _db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'",
    ).all().map((r) => r.name),
  );
  const missing = REQUIRED_TABLES.filter((t) => !existing.has(t));
  if (missing.length > 0) {
    log.error('Startup hardening: missing required tables', { missing });
  } else {
    log.info('Startup hardening: all required tables present', {
      checked: REQUIRED_TABLES.length,
    });
  }
} catch (err) {
  log.warn('Startup hardening check failed', { err: err.message });
}

/* ── Start listening ─────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  log.info('AXIS Command Center started', {
    port:    PORT,
    mode:    process.env.AXIS_LIVE_MODE ? 'LIVE' : 'DEMONSTRATION',
    env:     PROD ? 'production' : 'development',
    version: '0.1.0',
  });
});

/* ── LP-9: Graceful shutdown ─────────────────────────────────────────── */
function shutdown(signal) {
  log.info(`${signal} received — shutting down gracefully`);
  try { telematics.shutdown(); } catch (_) {}
  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
  // Force-exit if graceful shutdown takes more than 10 s.
  setTimeout(() => {
    log.warn('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`Port ${PORT} is already in use — is another instance running?`, { port: PORT });
  } else {
    log.error('Server error', { err: err.message });
  }
  process.exit(1);
});
