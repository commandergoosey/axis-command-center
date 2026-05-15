'use strict';

/*
 * Trip ledger — last 40 completed trips across the five active haulers.
 * Deterministic (seeded pseudo-random) so the UI is stable during demo.
 * Costs are USD, modelled off the base $24/tonne tariff and a ~$320 per-trip
 * cost stack (fuel + driver + maintenance + tolls). Delays are minutes.
 */

const HAULER_IDS = ['haul-01', 'haul-02', 'haul-03', 'haul-04', 'haul-05'];
const ROUTES = [
  { id: 'R-S', label: 'Nyinahin → Takoradi (S)', direction: 'southbound' },
  { id: 'R-N', label: 'Takoradi → Nyinahin (N)', direction: 'northbound' },
];

function seeded(i) {
  const x = Math.sin(i * 13127 + 7) * 100000;
  return x - Math.floor(x);
}

function buildTrips() {
  const trips = [];
  const now = Date.now();
  const DAY = 86_400_000;

  for (let i = 0; i < 40; i += 1) {
    const r = seeded(i);
    const hauler = HAULER_IDS[Math.floor(seeded(i + 101) * HAULER_IDS.length)];
    const route = ROUTES[Math.floor(seeded(i + 201) * ROUTES.length)];
    const hoursAgo = Math.floor(seeded(i + 301) * 168); // within last 7 days
    const departed_at  = new Date(now - hoursAgo * 3_600_000 - DAY);
    const cycleHours   = 22 + seeded(i + 401) * 8;
    const arrived_at   = new Date(departed_at.getTime() + cycleHours * 3_600_000);
    const tonnage      = route.direction === 'southbound'
      ? Math.round(38 + seeded(i + 501) * 3)    // laden
      : 0;                                      // empty return
    const delayMin     = Math.max(0, Math.round((seeded(i + 601) - 0.55) * 120));
    const fuelUsd      = Math.round(140 + seeded(i + 701) * 40);
    const driverUsd    = Math.round(55 + seeded(i + 801) * 12);
    const maintUsd     = Math.round(42 + seeded(i + 901) * 18);
    const tollsUsd     = Math.round(22 + seeded(i + 1001) * 8);
    const costUsd      = fuelUsd + driverUsd + maintUsd + tollsUsd;
    const revenueUsd   = route.direction === 'southbound'
      ? Math.round(tonnage * 24)               // base tariff; indexation applied monthly
      : 0;
    const status       = delayMin > 60 ? 'delayed' : 'completed';

    trips.push({
      id: `T-${String(1000 + i).padStart(4, '0')}`,
      hauler_id: hauler,
      route_id: route.id,
      route_label: route.label,
      direction: route.direction,
      departed_at: departed_at.toISOString(),
      arrived_at: arrived_at.toISOString(),
      cycle_h: Number(cycleHours.toFixed(1)),
      tonnage_t: tonnage,
      delay_min: delayMin,
      cost: {
        fuel_usd:   fuelUsd,
        driver_usd: driverUsd,
        maint_usd:  maintUsd,
        tolls_usd:  tollsUsd,
        total_usd:  costUsd,
      },
      revenue_usd: revenueUsd,
      status,
    });
  }

  return trips.sort((a, b) => new Date(b.departed_at) - new Date(a.departed_at));
}

const TRIPS = buildTrips();

function delayHeatmap(trips) {
  // 7 days × 24 hours grid of average delay minutes.
  const grid = Array.from({ length: 7 }, () => Array(24).fill(null));
  const counts = Array.from({ length: 7 }, () => Array(24).fill(0));
  const totals = Array.from({ length: 7 }, () => Array(24).fill(0));

  trips.forEach((t) => {
    const d = new Date(t.departed_at);
    // Monday = 0 ... Sunday = 6 (align to Africa/Accra local day-of-week)
    const dow = (d.getUTCDay() + 6) % 7;
    const hour = d.getUTCHours();
    counts[dow][hour] += 1;
    totals[dow][hour] += t.delay_min;
  });

  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      if (counts[d][h] > 0) grid[d][h] = Math.round(totals[d][h] / counts[d][h]);
    }
  }
  return grid;
}

module.exports = { TRIPS, delayHeatmap };
