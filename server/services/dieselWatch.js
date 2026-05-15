'use strict';

/*
 * Diesel watch — Phase 92.
 *
 * Composes a forward-looking view of the corridor's #1 cost
 * variable. The Tariff page (Phase ~indexation) already shows
 * the *effect* of the current diesel reading on the headline
 * rate; Diesel watch is the *trajectory* — where has it been,
 * where is it going, and what does it mean for the next
 * monthly review?
 *
 * Read-side only. Composes from:
 *   - NPA_DIESEL series (mock/tariff)
 *   - Indexation components (services/indexation)
 *   - Trip ledger (mock/trips) — per-hauler fuel cost / tonne
 *   - Hauler roster (state/roster) — display names
 *
 * No new state.
 */

const { NPA_DIESEL, GSS_CPI, TARIFF_TERMS } = require('../mock/tariff');
const { CONTRACT } = require('./aggregator');
const indexation = require('./indexation');
const { TRIPS } = require('../mock/trips');
const roster = require('../state/roster');

function compose() {
  const series = NPA_DIESEL.series;
  const sortedSeries = [...series].sort((a, b) => a.month.localeCompare(b.month));
  const current = sortedSeries[sortedSeries.length - 1];
  const prior   = sortedSeries[sortedSeries.length - 2];
  const baseRow = sortedSeries.find((r) => r.month === NPA_DIESEL.base_month) || sortedSeries[0];

  const latestPct  = prior ? ((current.ghs_per_l - prior.ghs_per_l) / prior.ghs_per_l) * 100 : 0;
  const vsBasePct  = ((current.ghs_per_l - baseRow.ghs_per_l) / baseRow.ghs_per_l) * 100;

  // Trailing 3-month change (current vs reading 3 months prior).
  const t3 = sortedSeries[sortedSeries.length - 4];
  const trailing3mPct = t3 ? ((current.ghs_per_l - t3.ghs_per_l) / t3.ghs_per_l) * 100 : null;

  // Trailing 12-month change (year-over-year).
  const t12 = sortedSeries[sortedSeries.length - 13];
  const trailing12mPct = t12 ? ((current.ghs_per_l - t12.ghs_per_l) / t12.ghs_per_l) * 100 : null;

  // Indexation contribution from the fuel component.
  const components = indexation.computeComponents();
  const fuelComponent = components.find((c) => c.key === 'fuel');
  const effective     = indexation.computeEffectiveRate();

  // Pass-through cap — how much headroom is left before the cap binds?
  const capMult   = TARIFF_TERMS.pass_through_cap_pct   / 100;
  const floorMult = TARIFF_TERMS.pass_through_floor_pct / 100;
  const headroomPctPoints = (capMult - effective.multiplier) * 100;

  // Per-hauler fuel cost / tonne — laden trips only (southbound).
  // Field is `tonnage_t` (tonnes); empty northbound returns are 0.
  const ladenTrips = TRIPS.filter((t) => (t.tonnage_t || 0) > 0);
  const corridorFuel = ladenTrips.reduce((s, t) => s + t.cost.fuel_usd, 0);
  const corridorTons = ladenTrips.reduce((s, t) => s + t.tonnage_t, 0);
  const corridorFuelPerTonne = corridorTons > 0 ? corridorFuel / corridorTons : 0;

  const byHauler = new Map();
  for (const t of ladenTrips) {
    const cur = byHauler.get(t.hauler_id) || { hauler_id: t.hauler_id, fuel: 0, tons: 0, n: 0 };
    cur.fuel += t.cost.fuel_usd;
    cur.tons += t.tonnage_t;
    cur.n    += 1;
    byHauler.set(t.hauler_id, cur);
  }

  const perHaulerVariance = Array.from(byHauler.values()).map((h) => {
    const fuelPerTonne = h.tons > 0 ? h.fuel / h.tons : 0;
    const vsCorridorPct = corridorFuelPerTonne > 0
      ? ((fuelPerTonne - corridorFuelPerTonne) / corridorFuelPerTonne) * 100
      : 0;
    const haulerRow = roster.find(h.hauler_id);
    const display_name = haulerRow?.display_name || h.hauler_id;
    let signal = 'flat';
    if (vsCorridorPct > 2)  signal = 'worse';
    if (vsCorridorPct < -2) signal = 'better';
    return {
      hauler_id:           h.hauler_id,
      display_name,
      trips_n:             h.n,
      tons:                Number(h.tons.toFixed(1)),
      fuel_usd:            Math.round(h.fuel),
      fuel_usd_per_tonne:  Number(fuelPerTonne.toFixed(2)),
      vs_corridor_pct:     Number(vsCorridorPct.toFixed(1)),
      signal,
    };
  }).sort((a, b) => a.fuel_usd_per_tonne - b.fuel_usd_per_tonne);

  // Pending review — what *would* apply if the next monthly reset
  // ran today against the current reading. (In production this is
  // automatic on the 1st; for now it's a forward-looking preview.)
  const baseTariff = CONTRACT.base_tariff_usd_per_tonne;
  const wouldEffective = effective.effective_usd_per_tonne;
  const wouldDeltaPct  = effective.adjustment_pct;

  return {
    generated_at:           new Date().toISOString(),
    base_month:             NPA_DIESEL.base_month,
    base_ghs_per_l:         NPA_DIESEL.base_ghs_per_l,
    current_month:          current.month,
    current_ghs_per_l:      current.ghs_per_l,
    series:                 sortedSeries,
    summary: {
      latest_change_pct:    Number(latestPct.toFixed(2)),
      trailing_3m_pct:      trailing3mPct == null ? null : Number(trailing3mPct.toFixed(2)),
      trailing_12m_pct:     trailing12mPct == null ? null : Number(trailing12mPct.toFixed(2)),
      vs_base_pct:          Number(vsBasePct.toFixed(2)),
      fuel_index:           fuelComponent.index_current,
      fuel_contribution_pct: fuelComponent.contribution_pct,
    },
    pass_through: {
      cap_pct:              TARIFF_TERMS.pass_through_cap_pct,
      floor_pct:            TARIFF_TERMS.pass_through_floor_pct,
      multiplier:           effective.multiplier,
      clamped_at_cap:       effective.clamped_at_cap,
      clamped_at_floor:     effective.clamped_at_floor,
      headroom_pct_points:  Number(headroomPctPoints.toFixed(2)),
    },
    pending_review: {
      review_date:                TARIFF_TERMS.next_review_date,
      base_usd_per_tonne:         baseTariff,
      would_effective_usd_per_tonne: wouldEffective,
      would_delta_pct:            wouldDeltaPct,
    },
    fleet_burn: {
      corridor_avg_fuel_usd_per_tonne: Number(corridorFuelPerTonne.toFixed(2)),
      corridor_total_fuel_usd:         Math.round(corridorFuel),
      corridor_total_tons:             Number(corridorTons.toFixed(1)),
      laden_trips_n:                   ladenTrips.length,
      per_hauler:                      perHaulerVariance,
    },
    notes: TARIFF_TERMS.notes,
  };
}

module.exports = { compose };
