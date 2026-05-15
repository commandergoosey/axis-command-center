'use strict';

/*
 * Driver roster — ~1.55 drivers per contracted rig (BRIEF.md §7.6 target),
 * covering shift rotation, leave and training. Deterministically seeded per
 * hauler so the roster is stable across restarts and matches the fleet mock.
 *
 * Driver assignment: every first driver for a hauler is primary on the first
 * rig of that hauler, second primary on the second rig, etc. Remaining drivers
 * are relief pool — unassigned rig_id, rotated in when a primary is on leave.
 *
 * Compliance model follows Ghana DVLA heavy-goods regime:
 *   licence_class   — 'E' (articulated ≥9t) required for 6x4 tippers
 *   licence_expiry  — 5-year cycle, per-driver stagger
 *   rest_status     — 'compliant' | 'warning' (approaching 56h/week) | 'breach'
 *
 * hours_this_week rolls over every Monday at 00:00 Africa/Accra; we bake in a
 * plausible mid-week distribution — the demo date is Tuesday 2026-04-21.
 */

const haulers = require('./haulers');
const { FLEET } = require('./fleet');

// Stable name pool — Akan / Ga / Ewe / Hausa / Dagbani spread that reads as
// the actual Ghanaian haulage labour market. No duplicates intra-hauler.
const FIRST_NAMES = [
  'Kwame', 'Kofi', 'Kwabena', 'Kwaku', 'Yaw', 'Kojo', 'Kwasi',
  'Ato', 'Ebo', 'Fiifi', 'Mensah', 'Nana',
  'Ibrahim', 'Musa', 'Abdul', 'Mohammed', 'Issah', 'Yakubu', 'Salifu',
  'Emmanuel', 'Samuel', 'Daniel', 'Francis', 'Michael', 'Joseph',
  'Prince', 'Kelvin', 'Isaac', 'Bright', 'Desmond',
];
const SURNAMES = [
  'Mensah', 'Owusu', 'Boateng', 'Asante', 'Agyemang', 'Appiah', 'Darko',
  'Osei', 'Amoah', 'Frimpong', 'Adjei', 'Bawumia', 'Mahama',
  'Addo', 'Obeng', 'Nyarko', 'Asamoah', 'Anane', 'Dapaah', 'Tagoe',
  'Alhassan', 'Seidu', 'Abubakar', 'Mumuni', 'Iddrisu',
  'Mensa-Bonsu', 'Nkrumah', 'Atta', 'Kwarteng', 'Opoku',
];

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
function round1(n) { return Math.round(n * 10) / 10; }

// Deterministic licence number: GH-D-NNNNNN — six-digit stable per driver.
function licenceNumber(rand) {
  const n = 100000 + Math.floor(rand() * 900000);
  return `GH-D-${n}`;
}

// Ghana mobile format: +233 (2|5)X XXX XXXX — 024/054/055/059 are common MNOs.
function phone(rand) {
  const prefix = pick(rand, ['024', '054', '055', '059', '020']);
  const a = String(Math.floor(100 + rand() * 900));
  const b = String(Math.floor(1000 + rand() * 9000));
  return `+233 ${prefix.slice(1)}${a.slice(0, 1)} ${a.slice(1)} ${b}`;
}

function buildDrivers() {
  const rows = [];
  const today = new Date('2026-04-21T00:00:00Z').getTime();
  let seq = 1;

  for (const h of haulers) {
    const rand = mulberry32(hashSeed(`drv-${h.id}`));
    const haulerRigs = FLEET.filter((t) => t.hauler_id === h.id);
    // 1.55× driver factor rounded to nearest integer; minimum = rig count.
    const driverCount = Math.max(
      haulerRigs.length,
      Math.round(haulerRigs.length * 1.55),
    );
    const usedNames = new Set();

    for (let i = 0; i < driverCount; i++) {
      // Unique first+last combination per hauler.
      let full;
      do {
        full = `${pick(rand, FIRST_NAMES)} ${pick(rand, SURNAMES)}`;
      } while (usedNames.has(full));
      usedNames.add(full);

      // First N drivers = primary on N rigs; rest are relief pool.
      const assignedRig = i < haulerRigs.length ? haulerRigs[i] : null;

      // Licence expiry: 5-year cycle, stagger 0-60 months out — some about to lapse.
      const monthsUntilExpiry = Math.floor(rand() * 60);
      const licenceExpiry = new Date(today + monthsUntilExpiry * 30 * 24 * 60 * 60 * 1000);

      // DVLA PSV (commercial endorsement) is reviewed annually.
      const psvExpiryDays = Math.floor(rand() * 360);

      const yearsExperience = 2 + Math.floor(rand() * 18);

      // Hours this week: shape varies by day-of-week. Tuesday 2026-04-21 → ~1 day in.
      // Bimodal: ~85% normal (8-24h), ~15% heavy (carrying over from Saturday run
      // or double-shifting). The heavy bucket is where rest-compliance bites.
      const heavy = rand() < 0.15;
      const baseHours = heavy
        ? 44 + rand() * 18  // 44-62h — into warning/breach territory
        : 8 + rand() * 16;  // 8-24h
      const relief = assignedRig ? 0 : -6;
      const hoursThisWeek = Math.max(0, round1(baseHours + relief + (rand() - 0.5) * 4));

      let restStatus;
      if (hoursThisWeek > 56)      restStatus = 'breach';
      else if (hoursThisWeek > 48) restStatus = 'warning';
      else                         restStatus = 'compliant';

      const safetyScore = 65 + Math.floor(rand() * 33); // 65-97
      const harshEvents = Math.floor(rand() * rand() * 8); // skewed low
      const tripsThisWeek = assignedRig
        ? Math.max(0, (assignedRig.trips_this_week ?? 0) + Math.floor((rand() - 0.5) * 2))
        : Math.floor(rand() * 3);

      // Coaching flag surfaces when both safety and compliance drift.
      let flag = null;
      if (restStatus === 'breach')                       flag = 'rest_breach';
      else if (monthsUntilExpiry <= 2)                   flag = 'licence_expiring';
      else if (psvExpiryDays <= 30)                      flag = 'psv_expiring';
      else if (safetyScore < 72 && harshEvents >= 4)     flag = 'coaching_due';

      // Shift pattern reflects rotation: day/night/rest.
      const shiftPool = assignedRig ? ['day', 'night', 'rest'] : ['relief'];
      const shift = pick(rand, shiftPool);

      rows.push({
        id: `drv-${String(seq).padStart(4, '0')}`,
        full_name: full,
        hauler_id: h.id,
        hauler_display: h.display_name,
        licence_number: licenceNumber(rand),
        licence_class: 'E',
        licence_expiry_iso: licenceExpiry.toISOString(),
        licence_expiry_months: monthsUntilExpiry,
        psv_expiry_days: psvExpiryDays,
        phone: phone(rand),
        years_experience: yearsExperience,
        assigned_rig_id:  assignedRig?.id   ?? null,
        assigned_plate:   assignedRig?.plate ?? null,
        shift,
        hours_this_week:  hoursThisWeek,
        rest_status:      restStatus,
        trips_this_week:  tripsThisWeek,
        safety_score:     safetyScore,
        harsh_events_7d:  harshEvents,
        flag,
      });
      seq++;
    }
  }
  return rows;
}

const DRIVERS = buildDrivers();

module.exports = { DRIVERS, buildDrivers };
