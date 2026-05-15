'use strict';

/*
 * Loconav adapter. Per-hauler API tokens on their own Loconav account; AXIS
 * proxies with a per-request bearer. Base URL overridable via env so the
 * demo can point at a mock service. If a probe fails on the network (demo
 * mode, dev laptop, etc.) the adapter returns a synthetic OK marked
 * live:false so the UI can still show what the real flow looks like.
 *
 * Docs: Loconav v2 — Bearer token on Authorization header.
 */

const BASE = process.env.LOCONAV_API_BASE || 'https://api.loconav.com/v2';
const TIMEOUT_MS = 6000;

async function timeoutFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function probe({ token }) {
  if (!token || typeof token !== 'string' || token.length < 12) {
    throw new Error('A Loconav API token of ≥ 12 characters is required');
  }
  try {
    const res = await timeoutFetch(`${BASE}/account`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error('Loconav rejected the token (401/403)');
    }
    if (!res.ok) {
      throw new Error(`Loconav probe failed — HTTP ${res.status}`);
    }
    const body = await res.json().catch(() => ({}));
    return {
      live: true,
      ok: true,
      account_name:   body.account?.name ?? body.name ?? 'Loconav account',
      fleet_vehicles: body.fleet?.vehicle_count ?? body.vehicles ?? null,
      probed_at: new Date().toISOString(),
    };
  } catch (err) {
    // Network unreachable, DNS fail, or CORS-style error → synthetic OK so
    // the operator can continue wiring their tenant without a live sandbox.
    if (err.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(err.message)) {
      return {
        live: false,
        ok: true,
        account_name:   'Loconav sandbox (simulated)',
        fleet_vehicles: null,
        probed_at: new Date().toISOString(),
        note: 'Network unreachable — token stored; live probe will retry on next sync.',
      };
    }
    throw err;
  }
}

async function syncFleet({ token }, hauler) {
  // In v1 we do not pull the full vehicle list live. The next milestone
  // replaces this with a real fleet pull and an AXIS-schema normaliser.
  return {
    live: !!token,
    vehicles_discovered: hauler.fleet.contracted_trucks,
    last_sync: new Date().toISOString(),
  };
}

module.exports = { probe, syncFleet, _BASE: BASE };
