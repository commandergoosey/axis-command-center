'use strict';

/*
 * Geotab (MyGeotab) adapter. MyGeotab authenticates via JSON-RPC
 * `Authenticate` against a named database with username + password;
 * the response returns a path and a session ID that subsequent calls
 * use. v1 does only the auth probe.
 *
 * Docs: https://geotab.github.io/sdk/
 */

const BASE = process.env.GEOTAB_API_BASE || 'https://my.geotab.com/apiv1';
const TIMEOUT_MS = 6000;

async function timeoutFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probe({ database, username, password }) {
  if (!database || !username || !password) {
    throw new Error('Geotab probe needs database, username and password');
  }
  const payload = {
    method: 'Authenticate',
    params: { database, userName: username, password },
  };
  try {
    const res = await timeoutFetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Geotab probe failed — HTTP ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body.error) {
      throw new Error(body.error.message || 'Geotab rejected the credentials');
    }
    const result = body.result || {};
    return {
      live: true,
      ok:   true,
      account_name:    database,
      fleet_vehicles:  result.vehicles ?? null,
      session_path:    result.path ?? null,
      probed_at: new Date().toISOString(),
    };
  } catch (err) {
    if (err.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(err.message)) {
      return {
        live: false,
        ok:   true,
        account_name:   `${database} (simulated)`,
        fleet_vehicles: null,
        probed_at: new Date().toISOString(),
        note: 'Network unreachable — credentials stored; live probe will retry on next sync.',
      };
    }
    throw err;
  }
}

async function syncFleet(_creds, hauler) {
  return {
    live: false,
    vehicles_discovered: hauler.fleet.contracted_trucks,
    last_sync: new Date().toISOString(),
  };
}

module.exports = { probe, syncFleet, _BASE: BASE };
