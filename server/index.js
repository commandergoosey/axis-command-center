'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');

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
const { attachUser }    = require('./middleware/auth');

const app = express();
const PORT = parseInt(process.env.PORT || '3002', 10);

// CORS — localhost is always allowed for local dev.
// In production, set CORS_ORIGIN to a comma-separated list of allowed origins
// (e.g. your Vercel URL). If unset, all origins are permitted (safe for a
// bearer-token-gated API, but tighten once the Vercel URL is known).
const _corsAllowed = (process.env.CORS_ORIGIN || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / server-to-server
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (_corsAllowed.length === 0) return cb(null, true); // open until CORS_ORIGIN is set
    if (_corsAllowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: ${origin} not in allowlist`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path}`);
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

/* ── Health ── */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime_s: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

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

/* ── 404 ── */
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

/* ── Error handler ── */
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Phase 88 — seed integration sync log on boot. Idempotent
// (skips if rows exist), so this is a one-shot population for
// fresh databases.
try {
  const integrationSyncLog = require('./state/integrationSyncLog');
  const roster = require('./state/roster');
  integrationSyncLog.ensureSeeded(roster.list());
} catch (err) {
  console.warn('[boot] integration sync log seed skipped:', err.message);
}

// Phase 105 — start the report schedule runner.
try {
  require('./services/scheduleRunner').start();
} catch (err) {
  console.warn('[boot] schedule runner failed to start:', err.message);
}

app.listen(PORT, () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  AXIS Command Center — bridge server');
  console.log(`  Port  : ${PORT}`);
  console.log(`  Mode  : ${process.env.AXIS_LIVE_MODE ? 'LIVE' : 'DEMONSTRATION'}`);
  console.log('  Endpoints:');
  console.log('    GET  /api/config');
  console.log('    GET  /api/snapshot');
  console.log('    GET  /api/today');
  console.log('    GET  /api/corridor');
  console.log('    GET  /api/convoys');
  console.log('    GET  /api/trips');
  console.log('    GET  /api/contract');
  console.log('    GET  /api/tariff');
  console.log('    GET  /api/tranches');
  console.log('    GET  /api/financials');
  console.log('    GET  /api/compliance');
  console.log('    GET  /api/alerts');
  console.log('    GET  /api/intelligence/observe?page=…');
  console.log('    POST /api/intelligence/chat');
  console.log('    GET  /api/intelligence/status');
  console.log('    GET  /api/reports');
  console.log('    GET  /api/reports/download/:typeId');
  console.log('    POST /api/reports/generate');
  console.log('    GET  /api/haulers');
  console.log('    GET  /api/haulers/:id');
  console.log('    POST /api/haulers');
  console.log('    GET  /api/haulers/:id/integration');
  console.log('    POST /api/haulers/:id/integration/probe');
  console.log('    POST /api/haulers/:id/integration/csv');
  console.log('    DELETE /api/haulers/:id/integration/token');
  console.log('    GET  /api/fleet');
  console.log('    GET  /api/fleet/summary');
  console.log('    GET  /api/maintenance');
  console.log('    POST /api/coaching/sessions');
  console.log('    GET  /api/coaching/sessions');
  console.log('    GET  /api/drivers');
  console.log('    GET  /api/drivers/summary');
  console.log('    GET  /api/drivers/by-rig/:rigId');
  console.log('    GET  /api/drivers/:id');
  console.log('    POST /api/auth/login');
  console.log('    POST /api/auth/logout');
  console.log('    GET  /api/auth/me');
  console.log('    GET  /api/auth/demo');
  console.log('    GET  /api/audit');
  console.log('    GET  /health');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});
