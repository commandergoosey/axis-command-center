'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// ── In-memory DB ──────────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
const db = require('../db');
require('../db/migrate').run(db);

// Insert test users before requiring users.js (bypasses cost-12 seed).
const NOW = new Date().toISOString();
const insertUser = db.prepare(`
  INSERT INTO users
    (id, email, password_hash, display_name, role, hauler_id, organisation, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertUser.run('u-adm',  'adm@test.gh',  bcrypt.hashSync('x', 1), 'Admin',  'axis_admin',   null, 'Org', 1, NOW, NOW);
insertUser.run('u-haul', 'hau@test.gh',  bcrypt.hashSync('x', 1), 'Hauler', 'hauler_admin', 'h1', 'Org', 1, NOW, NOW);
insertUser.run('u-inact','inact@test.gh',bcrypt.hashSync('x', 1), 'Inact',  'axis_admin',   null, 'Org', 0, NOW, NOW);

// ── Stub notifications — spy on emit() calls ──────────────────────────
const emitted = [];
const notifKey = require.resolve('../state/notifications');
require.cache[notifKey] = {
  id: notifKey, filename: notifKey, loaded: true,
  exports: { emit: (n) => { emitted.push(n); return 1; } },
};

// ── Helper timestamps ─────────────────────────────────────────────────
// THRESHOLD defaults to 2 h. Make an alert look 3 h old so it's stale.
function staleTs() {
  return new Date(Date.now() - 3 * 3_600_000).toISOString();
}
function freshTs() {
  return new Date(Date.now() - 30 * 60_000).toISOString(); // 30 min — under threshold
}

let alertSeq = 0;
function insertAlert({ status_override = 'NEEDS_ACTION', updated_at = staleTs(), resolved_at_iso = null } = {}) {
  alertSeq++;
  db.prepare(`
    INSERT INTO alert_state (alert_id, status_override, notes_json, updated_at, severity, resolved_at_iso)
    VALUES (?, ?, '[]', ?, 'critical', ?)
  `).run(`esc-${alertSeq}`, status_override, updated_at, resolved_at_iso);
  return `esc-${alertSeq}`;
}

function clearAlerts() { db.exec('DELETE FROM alert_state'); }

// Re-require escalation before each test to reset the module-level
// `lastEscalated` Map (dedup state from previous tests doesn't bleed through).
let escalation;
beforeEach(() => {
  emitted.length = 0;
  clearAlerts();
  delete require.cache[require.resolve('../services/alertEscalation')];
  escalation = require('../services/alertEscalation');
});

// ─────────────────────────────────────────────────────────────────────

describe('alertEscalation — basic sweep', () => {
  it('returns { escalated: 0, checked: 0 } when no alerts exist', () => {
    const result = escalation.run();
    assert.strictEqual(result.escalated, 0);
    assert.strictEqual(result.checked,   0);
  });

  it('escalates a stale NEEDS_ACTION alert and notifies axis_admin', () => {
    insertAlert({ status_override: 'NEEDS_ACTION' });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 1);
    assert.strictEqual(emitted.length,   1, 'exactly one notification should be emitted');
    assert.strictEqual(emitted[0].user_id,    'u-adm');
    assert.strictEqual(emitted[0].event_type, 'escalation');
  });

  it('escalates a stale legacy "open" alert (backward compatibility)', () => {
    insertAlert({ status_override: 'open' });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 1);
    assert.strictEqual(emitted.length,   1);
  });

  it('escalates a stale MONITORING alert', () => {
    insertAlert({ status_override: 'MONITORING' });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 1);
  });

  it('does not escalate a recently-updated alert (under threshold)', () => {
    insertAlert({ status_override: 'NEEDS_ACTION', updated_at: freshTs() });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 0);
    assert.strictEqual(emitted.length,   0);
  });

  it('does not escalate a RESOLVED alert', () => {
    insertAlert({ status_override: 'RESOLVED', resolved_at_iso: NOW });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 0);
  });

  it('does not escalate a SNOOZED alert', () => {
    insertAlert({ status_override: 'SNOOZED' });
    const result = escalation.run();
    assert.strictEqual(result.escalated, 0);
  });

  it('escalates multiple stale open alerts', () => {
    insertAlert();
    insertAlert();
    insertAlert();
    const result = escalation.run();
    assert.strictEqual(result.escalated, 3);
    assert.strictEqual(emitted.length,   3);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alertEscalation — deduplication (cooldown)', () => {
  it('does not re-escalate the same alert within the cooldown window', () => {
    insertAlert();
    const first  = escalation.run();
    const second = escalation.run(); // same alert, same run — cooldown active
    assert.strictEqual(first.escalated,  1);
    assert.strictEqual(second.escalated, 0, 'second run must be suppressed by cooldown');
    assert.strictEqual(emitted.length,   1, 'only one notification should be sent');
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('alertEscalation — role and active-status filtering', () => {
  it('only notifies axis_admin users — not hauler_admin', () => {
    insertAlert();
    escalation.run();
    const recipientRoles = emitted.map((n) => {
      // Determine role from user_id
      if (n.user_id === 'u-adm')  return 'axis_admin';
      if (n.user_id === 'u-haul') return 'hauler_admin';
      return 'unknown';
    });
    assert.ok(!recipientRoles.includes('hauler_admin'), 'hauler_admin must not receive escalation');
    assert.ok( recipientRoles.includes('axis_admin'),   'axis_admin must receive escalation');
  });

  it('does not notify deactivated axis_admin users', () => {
    insertAlert();
    escalation.run();
    const recipients = emitted.map((n) => n.user_id);
    assert.ok(!recipients.includes('u-inact'), 'inactive admin must not receive escalation');
  });

  it('returns { escalated: 0 } when no stale alerts exist even if admins are present', () => {
    // Admins exist (seeded) but nothing to escalate
    const result = escalation.run();
    assert.strictEqual(result.escalated, 0);
  });
});
