'use strict';

/*
 * Corridor topology for the Nyinahin → Takoradi route (approx 300 km).
 * Waypoints are approximate and serve the schematic; the Map mode uses
 * lat/lng for a real polyline once a Mapbox token lands (Phase 9).
 *
 * Segment layout feeds the schematic's per-segment truck counts.
 */

const WAYPOINTS = [
  { id: 'nyinahin-gate',    label: 'Nyinahin mine gate',   km:   0, kind: 'depot',       lat:  6.599, lng: -2.110 },
  { id: 'nyinahin-wb',      label: 'Nyinahin weighbridge', km:   2, kind: 'weighbridge', lat:  6.585, lng: -2.098 },
  { id: 'kumasi-jct',       label: 'Kumasi junction',      km:  85, kind: 'junction',    lat:  6.688, lng: -1.623 },
  { id: 'fomena-rest',      label: 'Fomena rest stop',     km: 150, kind: 'rest',        lat:  6.289, lng: -1.483 },
  { id: 'mid-wb',           label: 'Bekwai weighbridge',   km: 152, kind: 'weighbridge', lat:  6.274, lng: -1.473 },
  { id: 'dunkwa-rest',      label: 'Dunkwa rest stop',     km: 235, kind: 'rest',        lat:  5.964, lng: -1.775 },
  { id: 'takoradi-wb',      label: 'Takoradi weighbridge', km: 298, kind: 'weighbridge', lat:  4.905, lng: -1.773 },
  { id: 'takoradi-port',    label: 'Takoradi port',        km: 300, kind: 'depot',       lat:  4.889, lng: -1.755 },
];

// Per-segment traffic. Sum of trucks across segments ≈ aggregator active_trucks.
// Laden = heading south to port. Empty = returning north to mine.
const SEGMENTS = [
  { id: 'seg-a', from: 'nyinahin-wb',  to: 'kumasi-jct',    laden: 12, empty: 11 },
  { id: 'seg-b', from: 'kumasi-jct',   to: 'mid-wb',        laden: 14, empty: 10 },
  { id: 'seg-c', from: 'mid-wb',       to: 'dunkwa-rest',   laden: 10, empty: 13 },
  { id: 'seg-d', from: 'dunkwa-rest',  to: 'takoradi-wb',   laden: 11, empty: 13 },
];

const CONDITIONS = {
  generated_at: new Date().toISOString(),
  weather: 'Clear to Kumasi; haze from Obuasi south. Trade wind 14 km/h.',
  advisories: [
    { id: 'adv-1', severity: 'info',  body: 'GHA advises intermittent single-lane between km 160 and km 175 for drainage works until 03 May.' },
    { id: 'adv-2', severity: 'warn',  body: 'Nyinahin weighbridge operating at reduced throughput — expect 15-minute queues on laden departures before 09:00.' },
  ],
  weighbridges: [
    { id: 'nyinahin-wb', status: 'open',     queue_minutes: 14, notes: 'Reduced throughput' },
    { id: 'mid-wb',      status: 'open',     queue_minutes:  6, notes: null },
    { id: 'takoradi-wb', status: 'open',     queue_minutes:  9, notes: null },
  ],
};

/*
 * ACTIVE_CONVOYS — demo anchored at 2026-04-21 (Tuesday).
 *
 * direction:
 *   southbound — laden run Nyinahin (0 km) → Takoradi (300 km)
 *   northbound — empty return Takoradi (300 km) → Nyinahin (0 km)
 * planned/actual departures let us show "Ran 18 min late" on the drawer.
 * last_ping_iso anchors the timeline — the route synthesises a ping trail
 * deterministically from (id, km, direction).
 */
const TODAY = '2026-04-21';
const ACTIVE_CONVOYS = [
  {
    id: 'CVY-0412', hauler_id: 'haul-01', trucks: 6, phase: 'laden',   km: 108, cycle_h: 24.2, on_schedule: true,  notes: 'Departed Nyinahin 05:40',
    direction: 'southbound', planned_departure_iso: `${TODAY}T05:30:00Z`, actual_departure_iso: `${TODAY}T05:40:00Z`, last_ping_iso: `${TODAY}T09:12:00Z`,
  },
  {
    id: 'CVY-0413', hauler_id: 'haul-02', trucks: 5, phase: 'laden',   km:  68, cycle_h: 25.1, on_schedule: true,  notes: 'Passing Kumasi junction',
    direction: 'southbound', planned_departure_iso: `${TODAY}T06:30:00Z`, actual_departure_iso: `${TODAY}T06:32:00Z`, last_ping_iso: `${TODAY}T09:05:00Z`,
  },
  {
    id: 'CVY-0414', hauler_id: 'haul-03', trucks: 8, phase: 'laden',   km: 184, cycle_h: 26.8, on_schedule: false, notes: 'Delayed 40 min at mid-wb',
    direction: 'southbound', planned_departure_iso: `${TODAY}T04:45:00Z`, actual_departure_iso: `${TODAY}T04:52:00Z`, last_ping_iso: `${TODAY}T10:18:00Z`,
  },
  {
    id: 'CVY-0415', hauler_id: 'haul-04', trucks: 4, phase: 'empty',   km: 245, cycle_h: 25.0, on_schedule: true,  notes: 'Returning to mine',
    direction: 'northbound', planned_departure_iso: `2026-04-20T22:10:00Z`, actual_departure_iso: `2026-04-20T22:14:00Z`, last_ping_iso: `${TODAY}T10:08:00Z`,
  },
  {
    id: 'CVY-0416', hauler_id: 'haul-01', trucks: 6, phase: 'loading', km:   0, cycle_h: null, on_schedule: true,  notes: 'Loading at Nyinahin',
    direction: 'southbound', planned_departure_iso: `${TODAY}T10:30:00Z`, actual_departure_iso: null, last_ping_iso: `${TODAY}T09:50:00Z`,
  },
  {
    id: 'CVY-0417', hauler_id: 'haul-05', trucks: 3, phase: 'laden',   km: 220, cycle_h: 27.9, on_schedule: false, notes: 'Manual update; last ping 13:30',
    direction: 'southbound', planned_departure_iso: `${TODAY}T03:30:00Z`, actual_departure_iso: `${TODAY}T03:44:00Z`, last_ping_iso: `${TODAY}T13:30:00Z`,
  },
  {
    id: 'CVY-0418', hauler_id: 'haul-02', trucks: 5, phase: 'empty',   km: 140, cycle_h: 25.4, on_schedule: true,  notes: null,
    direction: 'northbound', planned_departure_iso: `2026-04-20T20:45:00Z`, actual_departure_iso: `2026-04-20T20:48:00Z`, last_ping_iso: `${TODAY}T09:30:00Z`,
  },
  {
    id: 'CVY-0419', hauler_id: 'haul-03', trucks: 7, phase: 'offload', km: 300, cycle_h: 24.7, on_schedule: true,  notes: 'Offloading at Takoradi',
    direction: 'southbound', planned_departure_iso: `${TODAY}T02:15:00Z`, actual_departure_iso: `${TODAY}T02:18:00Z`, last_ping_iso: `${TODAY}T10:05:00Z`,
  },
];

module.exports = { WAYPOINTS, SEGMENTS, CONDITIONS, ACTIVE_CONVOYS };
