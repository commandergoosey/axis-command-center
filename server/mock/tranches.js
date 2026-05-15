'use strict';

/*
 * Tranche programme — four-tranche CAPEX deployment from 1.0 Mtpa to 5.0 Mtpa.
 * Totals reconcile to the business plan: 550 trucks, $90M CAPEX,
 * $120M annual revenue at steady state. Tranche 1 is ACTIVE; the rest
 * carry gates that must close before drawdown.
 */

const PROGRAMME = {
  total_trucks: 550,
  total_capex_usd: 90_000_000,
  target_mtpa_steady: 5.0,
  current_tranche_id: 'tranche-1',
};

const TRANCHES = [
  {
    id: 'tranche-1',
    name: 'Tranche 1',
    status: 'ACTIVE',
    status_detail: 'Fleet mobilised; ramp to 1.0 Mtpa in progress',
    target_mtpa: 1.0,
    trucks: 110,
    capex_usd: 22_000_000,
    capex_drawn_usd: 22_000_000,
    start_date: '2026-01-01',
    steady_state_date: '2026-07-01',
    gates: [
      { id: 't1-g1', body: 'Mobilise 110 trucks on corridor',                 met: true },
      { id: 't1-g2', body: 'Establish weighbridge and FMS integration',        met: true },
      { id: 't1-g3', body: 'Hit 80% take-or-pay floor in 3 consecutive months', met: false },
      { id: 't1-g4', body: 'Close maiden GIBDLC monthly report pack',          met: false },
    ],
  },
  {
    id: 'tranche-2',
    name: 'Tranche 2',
    status: 'PENDING',
    // Phase 97 demo — all gates closed so the drawdown request workflow is visible.
    // Represents the scenario where T1 has hit steady-state and gate conditions satisfied.
    status_detail: 'All gates closed — drawdown request eligible',
    target_mtpa: 2.5,
    trucks: 140,
    capex_usd: 23_000_000,
    capex_drawn_usd: 0,
    start_date: '2026-10-01',
    steady_state_date: '2027-04-01',
    gates: [
      { id: 't2-g1', body: 'Tranche 1 validated at 1.0 Mtpa run-rate (3 consecutive months)', met: true },
      { id: 't2-g2', body: 'DSCR ≥ 1.3× on Tranche 1 steady-state P&L',                      met: true },
      { id: 't2-g3', body: 'HSE record clean — no Category-A incident in 180 days',          met: true },
      { id: 't2-g4', body: 'Hauler roster expanded to ≥ 6 onboarded counterparties',         met: true },
    ],
  },
  {
    id: 'tranche-3',
    name: 'Tranche 3',
    status: 'PENDING',
    status_detail: 'Engineering and PPE under planning',
    target_mtpa: 4.0,
    trucks: 150,
    capex_usd: 23_000_000,
    capex_drawn_usd: 0,
    start_date: '2027-07-01',
    steady_state_date: '2028-01-01',
    gates: [
      { id: 't3-g1', body: 'Tranche 2 validated at 2.5 Mtpa run-rate',               met: false },
      { id: 't3-g2', body: 'Port berth capacity secured for 4.0 Mtpa',               met: false },
      { id: 't3-g3', body: 'Senior debt covenant revisited; DSCR ≥ 1.5×',            met: false },
      { id: 't3-g4', body: 'N6 corridor dualisation to km 85 confirmed with GHA',    met: false },
    ],
  },
  {
    id: 'tranche-4',
    name: 'Tranche 4',
    status: 'PENDING',
    status_detail: 'Steady-state 5.0 Mtpa; final 150 trucks',
    target_mtpa: 5.0,
    trucks: 150,
    capex_usd: 22_000_000,
    capex_drawn_usd: 0,
    start_date: '2028-04-01',
    steady_state_date: '2028-10-01',
    gates: [
      { id: 't4-g1', body: 'Tranche 3 validated at 4.0 Mtpa run-rate',                    met: false },
      { id: 't4-g2', body: 'Contract extension executed (renewal option exercised)',       met: false },
      { id: 't4-g3', body: 'Weighbridge and rest-stop upgrades operational at full scale', met: false },
    ],
  },
];

// Cumulative capital drawdown (monthly) — debt and equity at a 70/30 split.
const CAPITAL_SERIES = [
  { month: '2026-01', debt_drawn_usd:  9_800_000, equity_drawn_usd: 4_200_000 },
  { month: '2026-02', debt_drawn_usd: 12_600_000, equity_drawn_usd: 5_400_000 },
  { month: '2026-03', debt_drawn_usd: 14_000_000, equity_drawn_usd: 6_000_000 },
  { month: '2026-04', debt_drawn_usd: 15_400_000, equity_drawn_usd: 6_600_000 },
];

const CAPITAL_STRUCTURE = {
  debt_committed_usd:   63_000_000,
  equity_committed_usd: 27_000_000,
  debt_drawn_usd:       15_400_000,
  equity_drawn_usd:      6_600_000,
  dscr_target:          1.3,
  dscr_steady_state:    2.5,
  series:               CAPITAL_SERIES,
};

module.exports = { PROGRAMME, TRANCHES, CAPITAL_STRUCTURE };
