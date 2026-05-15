'use strict';

/*
 * Compliance fixtures — axle-load (LI 2180, 40-tonne payload cap), HSE
 * events per million tonne-km, driver licence / medical expiry pipeline,
 * and regulatory filing status (DVLA, GHA, Minerals Commission).
 *
 * Hauler IDs match server/mock/haulers.js — haul-01 … haul-05.
 */

// Axle-load weighbridge events — last 30 days. "hold" means forced
// off-load at Nyinahin weighbridge before release.
const AXLE_EVENTS = [
  { id: 'axl-241', timestamp: '2026-04-19T14:22:00Z', hauler_id: 'haul-02', truck: 'H02-0041', gvw_tonnes: 63.2, overload_kg: 3200, action: 'HOLD',     delay_min:  52, note: 'Off-loaded 3.2 t; released 15:14' },
  { id: 'axl-240', timestamp: '2026-04-19T09:08:00Z', hauler_id: 'haul-02', truck: 'H02-0017', gvw_tonnes: 61.8, overload_kg: 1800, action: 'HOLD',     delay_min:  38, note: 'Off-loaded 1.8 t; coaching issued' },
  { id: 'axl-238', timestamp: '2026-04-18T11:44:00Z', hauler_id: 'haul-04', truck: 'H04-0009', gvw_tonnes: 60.6, overload_kg:  600, action: 'WARNING',  delay_min:  12, note: 'Within tolerance; advisory only' },
  { id: 'axl-235', timestamp: '2026-04-17T07:18:00Z', hauler_id: 'haul-02', truck: 'H02-0033', gvw_tonnes: 62.4, overload_kg: 2400, action: 'HOLD',     delay_min:  46, note: 'Third incident this quarter' },
  { id: 'axl-232', timestamp: '2026-04-15T16:02:00Z', hauler_id: 'haul-03', truck: 'H03-0022', gvw_tonnes: 60.2, overload_kg:  200, action: 'WARNING',  delay_min:   8 },
  { id: 'axl-227', timestamp: '2026-04-13T10:55:00Z', hauler_id: 'haul-01', truck: 'H01-0054', gvw_tonnes: 61.1, overload_kg: 1100, action: 'HOLD',     delay_min:  28 },
  { id: 'axl-221', timestamp: '2026-04-11T08:30:00Z', hauler_id: 'haul-05', truck: 'H05-0008', gvw_tonnes: 59.9, overload_kg:    0, action: 'CLEARED',  delay_min:   4 },
  { id: 'axl-218', timestamp: '2026-04-09T13:17:00Z', hauler_id: 'haul-02', truck: 'H02-0011', gvw_tonnes: 60.8, overload_kg:  800, action: 'WARNING',  delay_min:  11 },
];

// Per-hauler overload summary for the trailing 30 days.
const OVERLOAD_BY_HAULER = [
  { hauler_id: 'haul-01', holds: 1, warnings: 2, delay_min_total:  34, cost_usd:   420 },
  { hauler_id: 'haul-02', holds: 4, warnings: 3, delay_min_total: 196, cost_usd: 2_840 },
  { hauler_id: 'haul-03', holds: 0, warnings: 2, delay_min_total:  14, cost_usd:   180 },
  { hauler_id: 'haul-04', holds: 0, warnings: 1, delay_min_total:  12, cost_usd:   140 },
  { hauler_id: 'haul-05', holds: 0, warnings: 0, delay_min_total:   4, cost_usd:    60 },
];

// HSE events per million tonne-km — target ≤ 2.0.
const HSE = {
  target_per_mtk: 2.0,
  current_per_mtk: 1.42,
  trailing_events_90d: 3,
  events: [
    { id: 'hse-012', date: '2026-04-06', hauler_id: 'haul-02', category: 'A', type: 'Rollover (no injury)',    km_marker: 187, note: 'Wet surface, driver cleared; vehicle repaired and returned to service Apr 14' },
    { id: 'hse-011', date: '2026-03-22', hauler_id: 'haul-04', category: 'B', type: 'Tyre burst',              km_marker:  64, note: 'Shoulder stop, no secondary incident' },
    { id: 'hse-010', date: '2026-02-18', hauler_id: 'haul-01', category: 'B', type: 'Minor off-corridor stop', km_marker: 241, note: 'Mechanical; recovered without payload loss' },
  ],
};

// Driver licence + medical expiry pipeline — next 90 days.
const LICENCE_EXPIRY = [
  { id: 'lic-1021', hauler_id: 'haul-02', driver: 'Driver 02-117', document: 'Class E licence',    expiry: '2026-05-02', days_remaining: 12 },
  { id: 'lic-1022', hauler_id: 'haul-01', driver: 'Driver 01-034', document: 'Medical certificate', expiry: '2026-05-18', days_remaining: 28 },
  { id: 'lic-1023', hauler_id: 'haul-03', driver: 'Driver 03-080', document: 'Class E licence',    expiry: '2026-06-04', days_remaining: 45 },
  { id: 'lic-1024', hauler_id: 'haul-02', driver: 'Driver 02-042', document: 'Medical certificate', expiry: '2026-06-11', days_remaining: 52 },
  { id: 'lic-1025', hauler_id: 'haul-04', driver: 'Driver 04-019', document: 'Class E licence',    expiry: '2026-06-28', days_remaining: 69 },
  { id: 'lic-1026', hauler_id: 'haul-01', driver: 'Driver 01-066', document: 'Medical certificate', expiry: '2026-07-09', days_remaining: 80 },
];

// Regulatory filing status — the three agencies AXIS tracks.
const FILINGS = [
  { id: 'flg-dvla-q1',  agency: 'DVLA',                due: '2026-04-30', status: 'DUE',       detail: 'Q1 fleet roadworthy renewal · 18 trucks across Hauler 02 and Hauler 04' },
  { id: 'flg-gha-levy', agency: 'GHA',                 due: '2026-05-15', status: 'ON_TRACK',  detail: 'Monthly axle-load levy reconciliation' },
  { id: 'flg-minc-q1',  agency: 'Minerals Commission', due: '2026-04-15', status: 'FILED',     detail: 'Q1 haulage activity return · submitted 11 April' },
  { id: 'flg-dvla-ann', agency: 'DVLA',                due: '2026-07-31', status: 'ON_TRACK',  detail: 'Annual fleet registry update' },
  { id: 'flg-epa-mon',  agency: 'EPA',                 due: '2026-05-07', status: 'DUE',       detail: 'Monthly dust-suppression compliance report (Nyinahin loading zone)' },
];

module.exports = {
  AXLE_EVENTS,
  OVERLOAD_BY_HAULER,
  HSE,
  LICENCE_EXPIRY,
  FILINGS,
};
