'use strict';

/*
 * Aggregator — rolls per-hauler records into the corridor-level view.
 * All financials and tonnage targets come from the business plan (BRIEF.md §12.4);
 * figures the UI presents with a MODELLED tag originate here.
 *
 * Contract constants are Tranche 1 (1.0 Mtpa target, 110 trucks).
 */

const CONTRACT = {
  target_mtpa: 1.0,
  take_or_pay_floor_pct: 0.80,
  base_tariff_usd_per_tonne:    24.00,
  base_tariff_usd_per_tonne_km:  0.08,
  corridor_km: 300,
  indexation: {
    fuel_pct_of_tariff:  0.40,
    cpi_pct_of_tariff:   0.30,
    fixed_pct_of_tariff: 0.30,
  },
  payment_terms_days: 30,
};

const TRANCHE_1 = {
  current: 1,
  target_mtpa: CONTRACT.target_mtpa,
  capex_committed_usd_m: 22,
};

function fractionOfMonthElapsed(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const elapsedDays = (now.getTime() - Date.UTC(y, m, 1)) / 86_400_000;
  return Math.min(Math.max(elapsedDays / daysInMonth, 0), 1);
}

function apiStatusOf(hauler) {
  if (hauler.status === 'pending') return 'pending';
  if (hauler.integration.type === 'manual') return 'manual';
  if ((hauler.integration.error_count_24h || 0) > 0) return 'degraded';
  return 'connected';
}

function summariseActive(hauler, { monthlyTonnes, fleetContracted, fraction }) {
  const contractShare = fleetContracted > 0
    ? hauler.fleet.contracted_trucks / fleetContracted
    : 0;
  const contractedMtd = monthlyTonnes * contractShare * fraction;
  const deliveredMtd  = contractedMtd * (hauler.run_rate ?? 0);
  return {
    id: hauler.id,
    display_name: hauler.display_name,
    onboarded_date: hauler.onboarded_date,
    status: hauler.status,
    integration: { ...hauler.integration },
    api_status: apiStatusOf(hauler),
    fleet:       { ...hauler.fleet },
    performance: { ...hauler.performance },
    contract_share: Number(contractShare.toFixed(3)),
    tonnes_delivered_mtd:  Math.round(deliveredMtd),
    tonnes_contracted_mtd: Math.round(contractedMtd),
  };
}

function summariseInactive(hauler) {
  return {
    id: hauler.id,
    display_name: hauler.display_name,
    onboarded_date: hauler.onboarded_date,
    status: hauler.status,
    integration: { ...hauler.integration },
    api_status: apiStatusOf(hauler),
    fleet:       { ...hauler.fleet },
    performance: { ...hauler.performance },
    contract_share: 0,
    tonnes_delivered_mtd:  0,
    tonnes_contracted_mtd: 0,
  };
}

function aggregate(haulers, now = new Date()) {
  const active   = haulers.filter((h) => h.status === 'active');
  const inactive = haulers.filter((h) => h.status !== 'active');

  const fleetContracted = active.reduce((s, h) => s + h.fleet.contracted_trucks, 0);
  const fleetActive     = active.reduce((s, h) => s + h.fleet.active_trucks,     0);
  const monthlyTonnes   = (CONTRACT.target_mtpa * 1_000_000) / 12;
  const fraction        = fractionOfMonthElapsed(now);

  const activeSummaries = active.map((h) =>
    summariseActive(h, { monthlyTonnes, fleetContracted, fraction }),
  );
  const inactiveSummaries = inactive.map(summariseInactive);

  const deliveredMtd  = activeSummaries.reduce((s, h) => s + h.tonnes_delivered_mtd,  0);
  const contractedMtd = activeSummaries.reduce((s, h) => s + h.tonnes_contracted_mtd, 0);

  const slaAttainmentPct = fleetActive > 0
    ? activeSummaries.reduce(
        (s, h) => s + h.performance.sla_attainment_pct * h.fleet.active_trucks,
        0,
      ) / fleetActive
    : 0;

  return {
    generated_at: now.toISOString(),
    fleet: {
      contracted_trucks: fleetContracted,
      active_trucks:     fleetActive,
    },
    tonnes: {
      delivered_mtd:      deliveredMtd,
      contracted_mtd:     contractedMtd,
      contracted_monthly: Math.round(monthlyTonnes),
    },
    sla_attainment_pct: Number(slaAttainmentPct.toFixed(1)),
    haulers: [...activeSummaries, ...inactiveSummaries],
  };
}

module.exports = {
  aggregate,
  apiStatusOf,
  fractionOfMonthElapsed,
  CONTRACT,
  TRANCHE_1,
};
