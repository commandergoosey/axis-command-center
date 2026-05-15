'use strict';

/*
 * Demo user directory — Phase 10 auth.
 *
 * Four roles exist (per BRIEF.md §11 Phase 10):
 *   axis_admin   — AXIS Admin. Full access, including Settings.
 *   axis_ops     — AXIS Ops. Operational access, no Settings.
 *   hauler_admin — Hauler admin. Own hauler only. `hauler_id` scope.
 *   lender       — Lender (GIBDLC). Read-only counterparty view.
 *
 * Passwords are demo placeholders — Phase 11 will add a real identity
 * provider. We compare in plain text because this is demonstration data
 * and rotation cost is zero.
 */

const USERS = [
  {
    id:           'u-axis-admin',
    email:        'admin@axis.gh',
    password:     'axis',
    display_name: 'Akosua Mensah',
    role:         'axis_admin',
    hauler_id:    null,
    organisation: 'AXIS (NewCo Logistics JV)',
  },
  {
    id:           'u-axis-ops',
    email:        'ops@axis.gh',
    password:     'axis',
    display_name: 'Kwame Boateng',
    role:         'axis_ops',
    hauler_id:    null,
    organisation: 'AXIS Operations',
  },
  {
    id:           'u-haul-01',
    email:        'admin@haul-01.gh',
    password:     'hauler',
    display_name: 'Ama Darko',
    role:         'hauler_admin',
    hauler_id:    'haul-01',
    organisation: 'Hauler 01',
  },
  {
    id:           'u-lender',
    email:        'analyst@gibdlc.com',
    password:     'lender',
    display_name: 'Yaw Osei',
    role:         'lender',
    hauler_id:    null,
    organisation: 'GIBDLC — Lender desk',
  },
];

function findByCredentials(email, password) {
  if (!email || !password) return null;
  const u = USERS.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
  if (!u || u.password !== password) return null;
  return u;
}

function findById(id) {
  return USERS.find((u) => u.id === id) || null;
}

function publicShape(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

function list() {
  return USERS.map(publicShape);
}

module.exports = { USERS, findByCredentials, findById, publicShape, list };
