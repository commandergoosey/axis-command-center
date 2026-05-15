'use strict';

/*
 * Anonymised hauler roster for v1 demo mode (per BRIEF.md §12.1).
 * Legal names arrive only when real onboarding begins.
 * Each record is the shape a hauler-adapter would return after normalisation.
 *
 * Fleet contribution totals: 110 contracted, 94 active — matches Tranche 1 target.
 * run_rate is the fraction of the hauler's pro-rata contracted tonnage they
 * actually deliver; used by the aggregator to derive tonnes_delivered_mtd.
 */

module.exports = [
  {
    id: 'haul-01',
    display_name: 'Hauler 01',
    onboarded_date: '2026-03-02',
    status: 'active',
    integration: {
      type: 'loconav',
      adapter: null,
      last_sync: '2026-04-20T06:00:00Z',
      error_count_24h: 0,
    },
    fleet:       { contracted_trucks: 30, active_trucks: 28 },
    performance: { on_time_pct: 94.0, sla_attainment_pct: 94.0, safety_score: 91 },
    run_rate: 0.88,
  },
  {
    id: 'haul-02',
    display_name: 'Hauler 02',
    onboarded_date: '2026-03-09',
    status: 'active',
    integration: {
      type: 'loconav',
      adapter: null,
      last_sync: '2026-04-20T06:12:00Z',
      error_count_24h: 0,
    },
    fleet:       { contracted_trucks: 25, active_trucks: 22 },
    performance: { on_time_pct: 88.0, sla_attainment_pct: 89.5, safety_score: 85 },
    run_rate: 0.82,
  },
  {
    id: 'haul-03',
    display_name: 'Hauler 03',
    onboarded_date: '2026-03-16',
    status: 'active',
    integration: {
      type: 'custom',
      adapter: 'geotab',
      last_sync: '2026-04-20T04:44:00Z',
      error_count_24h: 4,
    },
    fleet:       { contracted_trucks: 25, active_trucks: 24 },
    performance: { on_time_pct: 91.0, sla_attainment_pct: 92.1, safety_score: 88 },
    run_rate: 0.84,
  },
  {
    id: 'haul-04',
    display_name: 'Hauler 04',
    onboarded_date: '2026-03-23',
    status: 'active',
    integration: {
      type: 'loconav',
      adapter: null,
      last_sync: '2026-04-20T05:50:00Z',
      error_count_24h: 0,
    },
    fleet:       { contracted_trucks: 15, active_trucks: 12 },
    performance: { on_time_pct: 86.0, sla_attainment_pct: 87.4, safety_score: 82 },
    run_rate: 0.74,
  },
  {
    id: 'haul-05',
    display_name: 'Hauler 05',
    onboarded_date: '2026-04-06',
    status: 'active',
    integration: {
      type: 'manual',
      adapter: null,
      last_sync: '2026-04-19T18:00:00Z',
      error_count_24h: null,
    },
    fleet:       { contracted_trucks: 15, active_trucks: 8 },
    performance: { on_time_pct: 79.0, sla_attainment_pct: 81.0, safety_score: 76 },
    run_rate: 0.55,
  },
];
