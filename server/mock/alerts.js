'use strict';

/*
 * Alerts fixtures — prioritised action items (not a raw event log).
 * Severity drives presentation: CRITICAL and WARNING render as action
 * cards with a single CTA; INFO collapses into compact rows; RESOLVED
 * stacks into a one-line reference list.
 *
 * Alert types map to the spec in BRIEF §4:
 *   axle_load_breach · convoy_delay · payload_variance · weighbridge_hold
 *   sla_breach · payment_ageing · licence_expiry · hse_event
 *
 * New v2 fields — added for Phase 13 triage:
 *   link              — deep-link to the page/entity that originated the alert.
 *                       UI uses this to render a "Open source" button.
 *   default_owner_role — which role typically triages this type of alert
 *                        (axis_ops for operational, axis_admin for financial,
 *                         hauler_admin for hauler-specific).
 */

const ALERTS = [
  // ── Needs action ──────────────────────────────────────────────────
  {
    id: 'alt-901',
    opened_at: '2026-04-19T14:22:00Z',
    severity:  'CRITICAL',
    type:      'axle_load_breach',
    title:     'Axle-load breach · Hauler 02',
    hauler_id: 'haul-02',
    asset_ref: 'H02-0041',
    body:      'Fourth hold this month on Hauler 02. Today: 3.2 t overload, 52 min forced off-load. Quarterly trend rising.',
    impact:    'Takoradi cut-off slipped by 42 min. Risk to SLA offloading band if repeated.',
    action:    'Coach Hauler 02 dispatcher on pre-departure verification',
    status:    'NEEDS_ACTION',
    link:      { label: 'Open Hauler 02',  path: '/haulers' },
    default_owner_role: 'axis_ops',
  },
  {
    id: 'alt-902',
    opened_at: '2026-04-18T09:10:00Z',
    severity:  'CRITICAL',
    type:      'sla_breach',
    title:     'Offloading SLA below target',
    hauler_id: null,
    asset_ref: 'port-berth-2',
    body:      'Offloading on-time at 88.6% · target 90%. Berth queue Apr 07–11 drove 3.4 hours cumulative slip.',
    impact:    'SLA miss triggers monthly review clause with GIBDLC. Recovery path: 91% or better for three consecutive months.',
    action:    'Escalate berth-slot schedule with GPHA operations',
    status:    'NEEDS_ACTION',
    link:      { label: 'Open corridor view', path: '/corridor' },
    default_owner_role: 'axis_admin',
  },
  {
    id: 'alt-903',
    opened_at: '2026-04-17T16:40:00Z',
    severity:  'WARNING',
    type:      'licence_expiry',
    title:     'Class E licence expiring in 12 days',
    hauler_id: 'haul-02',
    asset_ref: 'Driver 02-117',
    body:      'Licence expires 02 May 2026. Renewal appointment not booked.',
    impact:    'Driver off-roster from 02 May until cleared. One-driver gap on Hauler 02 shift pattern.',
    action:    'Confirm DVLA appointment booked',
    status:    'NEEDS_ACTION',
    link:      { label: 'Open drivers',    path: '/drivers' },
    default_owner_role: 'hauler_admin',
  },
  {
    id: 'alt-904',
    opened_at: '2026-04-16T08:20:00Z',
    severity:  'WARNING',
    type:      'payment_ageing',
    title:     'Receivables 3.2% in 61–90 band',
    hauler_id: null,
    asset_ref: 'GIBDLC',
    body:      '$40k aged 61–90 days. Covenant ceiling 5%.',
    impact:    'Within covenant, but first breach-adjacent reading since contract signing. Clears by 15 May if April invoice settles on terms.',
    action:    'Confirm 18 Apr invoice acknowledgement with GIBDLC AP',
    status:    'NEEDS_ACTION',
    link:      { label: 'Open financials', path: '/financials' },
    default_owner_role: 'axis_admin',
  },

  // ── Monitoring ────────────────────────────────────────────────────
  {
    id: 'alt-810',
    opened_at: '2026-04-06T11:44:00Z',
    severity:  'INFO',
    type:      'hse_event',
    title:     'Category-A rollover · km 187',
    hauler_id: 'haul-02',
    asset_ref: 'H02-0028',
    body:      'Wet surface, no injury. Vehicle returned to service 14 Apr.',
    impact:    'Breaks 180-day Category-A clean streak. Resets Tranche 2 HSE gate clock.',
    action:    null,
    status:    'MONITORING',
    link:      { label: 'Open compliance', path: '/compliance' },
    default_owner_role: 'axis_ops',
  },
  {
    id: 'alt-811',
    opened_at: '2026-04-12T07:05:00Z',
    severity:  'INFO',
    type:      'convoy_delay',
    title:     'Convoy C-041 delayed 28 min',
    hauler_id: 'haul-04',
    asset_ref: 'convoy-041',
    body:      'Weighbridge hold + one tyre change added 28 min to northbound return. Single-event; not systemic.',
    impact:    'Cycle time within 7-day p95 band. No SLA impact.',
    action:    null,
    status:    'MONITORING',
    link:      { label: 'Open convoys',    path: '/convoys' },
    default_owner_role: 'axis_ops',
  },
  {
    id: 'alt-812',
    opened_at: '2026-04-08T13:12:00Z',
    severity:  'INFO',
    type:      'payload_variance',
    title:     'Payload variance · Hauler 03',
    hauler_id: 'haul-03',
    asset_ref: null,
    body:     'Average payload 39.1 t vs 40.0 t spec. Underfilling, not overloading — contract revenue impact $1,820 / month.',
    impact:    'Revenue side only. No compliance risk.',
    action:    null,
    status:    'MONITORING',
    link:      { label: 'Open trips',      path: '/trips' },
    default_owner_role: 'hauler_admin',
  },

  // ── Resolved today ────────────────────────────────────────────────
  {
    id: 'alt-720',
    opened_at:   '2026-04-15T09:40:00Z',
    resolved_at: '2026-04-20T08:12:00Z',
    severity:    'INFO',
    type:        'weighbridge_hold',
    title:       'Nyinahin weighbridge queue cleared',
    hauler_id:   null,
    body:        '40-min morning queue Apr 15–18. Cleared after GHA added second lane.',
    status:      'RESOLVED',
    link:        { label: 'Open corridor', path: '/corridor' },
    default_owner_role: 'axis_ops',
  },
  {
    id: 'alt-721',
    opened_at:   '2026-04-11T06:30:00Z',
    resolved_at: '2026-04-20T07:00:00Z',
    severity:    'WARNING',
    type:        'sla_breach',
    title:       'Port berth 2 queue (Apr 07–11)',
    hauler_id:   null,
    body:        'Berth unavailable 4 days. Recovered once berth rotation adjusted.',
    status:      'RESOLVED',
    link:        { label: 'Open corridor', path: '/corridor' },
    default_owner_role: 'axis_ops',
  },
  {
    id: 'alt-722',
    opened_at:   '2026-04-18T14:00:00Z',
    resolved_at: '2026-04-20T06:15:00Z',
    severity:    'INFO',
    type:        'licence_expiry',
    title:       'Medical cert renewed · Driver 05-012',
    hauler_id:   'haul-05',
    body:        'Cleared at Takoradi medical centre; back on-roster 20 Apr 05:00.',
    status:      'RESOLVED',
    link:        { label: 'Open drivers', path: '/drivers' },
    default_owner_role: 'hauler_admin',
  },
];

module.exports = { ALERTS };
