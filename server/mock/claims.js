'use strict';

/*
 * Insurance claims fixtures — Phase 90.
 *
 * Claims arising from HSE incidents (Phase 12) and rig workorders.
 * Mirrors the existing fixture-then-overlay pattern: this file is
 * the immutable seed; status transitions live in
 * state/claimsState.js.
 *
 * Insurers are stylised real Ghana market presences.
 */

const CLAIMS = [
  {
    id:            'clm-2026-04-001',
    type:          'third_party_liability',
    incident_ref:  'hse-012',                 // Phase 12 HSE event
    hauler_id:     'haul-02',
    insurer:       'Enterprise Insurance',
    policy_number: 'EI-CGL-2026-088',
    filed_at:      '2026-04-08T09:30:00Z',
    incident_date: '2026-04-06',
    description:   'Category-A rollover at km-187. Damage to verge fencing and adjacent farm property reported by community. Driver uninjured; vehicle recovered.',
    claim_amount_usd:    18500,
    approved_amount_usd: null,
    status:        'under_review',
    deductible_usd: 2500,
    notes_default: 'Loss adjuster site visit completed 11 Apr. Awaiting community settlement deed before insurer payout.',
  },
  {
    id:            'clm-2026-04-002',
    type:          'rig_damage',
    incident_ref:  'hse-012',
    hauler_id:     'haul-02',
    insurer:       'Enterprise Insurance',
    policy_number: 'EI-MOT-2026-088',
    filed_at:      '2026-04-09T14:00:00Z',
    incident_date: '2026-04-06',
    description:   'Same rollover — chassis frame deformation, cab roof damage. Vehicle workshop assessment $32k repair quote; in workshop Apr 6-14.',
    claim_amount_usd:    32000,
    approved_amount_usd: 28500,
    status:        'approved',
    deductible_usd: 3500,
    notes_default: 'Insurer approved $28,500 — full repair less $3,500 betterment. Awaiting payment to hauler workshop account.',
  },
  {
    id:            'clm-2026-03-001',
    type:          'cargo_loss',
    incident_ref:  'hse-011',
    hauler_id:     'haul-04',
    insurer:       'NIC (National Insurance Commission)',
    policy_number: 'NIC-CARGO-2026-024',
    filed_at:      '2026-03-23T10:00:00Z',
    incident_date: '2026-03-22',
    description:   'Tyre burst at km-64; ~3.2 t bauxite spilled before recovery. Cargo write-off + corridor cleanup costs.',
    claim_amount_usd:    4800,
    approved_amount_usd: 4800,
    status:        'paid',
    deductible_usd: 500,
    paid_at:       '2026-04-15T13:00:00Z',
    payment_ref:   'NIC-PAYOUT-2026-024',
    notes_default: 'Settled — payment cleared on 15 Apr. Hauler share net of deductible passed through on April settlement.',
  },
  {
    id:            'clm-2026-02-001',
    type:          'rig_damage',
    incident_ref:  'hse-010',
    hauler_id:     'haul-01',
    insurer:       'StarLife Assurance',
    policy_number: 'SL-MOT-2026-045',
    filed_at:      '2026-02-19T08:30:00Z',
    incident_date: '2026-02-18',
    description:   'Minor off-corridor stop — gearbox failure km-241. Workshop replacement; no third-party damage.',
    claim_amount_usd:    8200,
    approved_amount_usd: 6800,
    status:        'paid',
    deductible_usd: 1500,
    paid_at:       '2026-03-12T11:00:00Z',
    payment_ref:   'SL-PAYOUT-2026-045',
    notes_default: 'Insurer applied $1,400 betterment deduction (used parts vs OEM new). Hauler accepted; closed.',
  },
  {
    id:            'clm-2026-04-003',
    type:          'medical',
    incident_ref:  null,
    hauler_id:     'haul-03',
    insurer:       'Enterprise Insurance',
    policy_number: 'EI-MED-2026-091',
    filed_at:      '2026-04-22T16:45:00Z',
    incident_date: '2026-04-21',
    description:   'Driver medical claim — pre-existing condition follow-up under group hospitalization plan. Routine.',
    claim_amount_usd:    1200,
    approved_amount_usd: null,
    status:        'filed',
    deductible_usd: 100,
    notes_default: 'Routine. Group plan auto-approves under $2k.',
  },
  {
    id:            'clm-2026-01-001',
    type:          'third_party_liability',
    incident_ref:  null,
    hauler_id:     'haul-05',
    insurer:       'NIC (National Insurance Commission)',
    policy_number: 'NIC-CGL-2026-018',
    filed_at:      '2026-01-15T09:00:00Z',
    incident_date: '2026-01-12',
    description:   'Roadside vendor claim — convoy clipped market stall canopy at Nyinahin junction. No injury.',
    claim_amount_usd:    900,
    approved_amount_usd: null,
    status:        'denied',
    deductible_usd: 100,
    notes_default: 'Denied — Hauler 05 dashcam shows vendor canopy extending into roadway; documented violation. Hauler covered full repair direct.',
  },
];

module.exports = { CLAIMS };
