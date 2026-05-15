'use strict';

/*
 * Truck roster — one record per rig across all five haulers, deterministically
 * generated so the same plate always belongs to the same hauler. 110 contracted
 * trucks total (matches Tranche 1 target). Each row is the shape a hauler FMS
 * would hand back after the aggregator's normalisation pass.
 *
 * Plate format follows Ghana DVLA convention: "GR 1234-26" — two-letter
 * regional prefix, four digits, year suffix. We fix the prefix to GR
 * (Greater Accra) for the demo.
 *
 * status = {
 *   active    — moving on the corridor today
 *   idle      — at yard, shift not started
 *   garage    — in workshop, not available
 *   in_transit— currently on route (laden or empty)
 * }
 *
 * maintenance_flag tiers the Maintenance page:
 *   service_due       — next_service_km_due crossed
 *   road_worthy_30d   — DVLA road-worthy certificate expires within 30 days
 *   critical          — axle/brake issue, pulled from service
 *   null              — nothing outstanding
 */

const haulers = require('./haulers');

const MAKES = [
  { make: 'Sinotruk HOWO',       model: 'T7H 400 6x4',   empty_t: 13.2, year_min: 2022, year_max: 2025 },
  { make: 'Shacman',             model: 'X3000 6x4',     empty_t: 13.0, year_min: 2021, year_max: 2024 },
  { make: 'FAW',                 model: 'J6P 6x4',       empty_t: 13.4, year_min: 2020, year_max: 2024 },
  { make: 'Mercedes-Benz Actros',model: '3341 6x4',      empty_t: 13.6, year_min: 2018, year_max: 2022 },
  { make: 'DAF',                 model: 'CF 440 6x4',    empty_t: 13.5, year_min: 2019, year_max: 2023 },
];

// Tiny seedable PRNG so the roster is stable across restarts without needing
// a DB. Same hauler → same trucks → same plates → same flags.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

function plate(rand) {
  const digits = String(Math.floor(1000 + rand() * 9000));
  return `GR ${digits}-26`;
}

function buildFleet() {
  const rows = [];
  let seq = 1;
  for (const h of haulers) {
    const rand = mulberry32(hashSeed(h.id));
    for (let i = 0; i < h.fleet.contracted_trucks; i++) {
      const spec = pick(rand, MAKES);
      const year = spec.year_min + Math.floor(rand() * (spec.year_max - spec.year_min + 1));
      const isActiveToday = i < h.fleet.active_trucks;
      // Distribute a plausible mix of running/idle/garage across active trucks.
      let status;
      const r = rand();
      if (!isActiveToday) status = r < 0.4 ? 'garage' : 'idle';
      else if (r < 0.55)  status = 'in_transit';
      else if (r < 0.88)  status = 'active';
      else                status = 'idle';

      const lastServiceKm = 42_000 + Math.floor(rand() * 58_000);
      const serviceInterval = 20_000;
      const totalKm = lastServiceKm + Math.floor(rand() * (serviceInterval + 4_000));
      const dueIn = (lastServiceKm + serviceInterval) - totalKm;
      const efficiency = 36 + rand() * 8; // L/100km — realistic for 6x4 tippers
      const tripsThisWeek = isActiveToday
        ? 4 + Math.floor(rand() * 5)
        : Math.floor(rand() * 3);

      // Flags surface onto Maintenance page.
      let maintenance_flag = null;
      if (status === 'garage' && r < 0.7)   maintenance_flag = 'critical';
      else if (dueIn < 0)                   maintenance_flag = 'service_due';
      const roadWorthyExpiryDays = Math.floor(10 + rand() * 360);
      if (roadWorthyExpiryDays <= 30 && !maintenance_flag) maintenance_flag = 'road_worthy_30d';

      rows.push({
        id:                      `rig-${String(seq).padStart(4, '0')}`,
        plate:                   plate(rand),
        hauler_id:               h.id,
        hauler_display:          h.display_name,
        make:                    spec.make,
        model:                   spec.model,
        axle_config:             '6x4',
        year_of_manufacture:     year,
        empty_weight_t:          round1(spec.empty_t + (rand() - 0.5) * 0.4),
        gross_weight_t:          40,
        payload_capacity_t:      round1(40 - spec.empty_t - (rand() - 0.5) * 0.4),
        status,
        total_km:                totalKm,
        last_service_km:         lastServiceKm,
        next_service_km_due:     lastServiceKm + serviceInterval,
        km_since_service:        totalKm - lastServiceKm,
        efficiency_l_per_100km:  round1(efficiency),
        trips_this_week:         tripsThisWeek,
        maintenance_flag,
        road_worthy_expiry_days: roadWorthyExpiryDays,
        last_position_ping_iso:  new Date(Date.now() - Math.floor(rand() * 8) * 60 * 60 * 1000).toISOString(),
      });
      seq++;
    }
  }
  return rows;
}

function hashSeed(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function round1(n) { return Math.round(n * 10) / 10; }

const FLEET = buildFleet();

module.exports = { FLEET, buildFleet };
