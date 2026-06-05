'use strict';

/*
 * Tests for adapters/loconav.js
 * Exports: { probe, syncFleet, _BASE }
 * Network is mocked via global.fetch.
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const loconav = require('../adapters/loconav');

// A token that satisfies the ≥ 12 character check
const VALID_TOKEN = 'validtoken-1234';

// ── _BASE ─────────────────────────────────────────────────────────────────────

describe('_BASE', () => {
  it('exports _BASE as a non-empty string', () => {
    assert.ok(typeof loconav._BASE === 'string');
    assert.ok(loconav._BASE.length > 0);
  });

  it('_BASE contains loconav when using default', () => {
    // Only check default when env var is not set
    if (!process.env.LOCONAV_API_BASE) {
      assert.ok(loconav._BASE.includes('loconav.com'));
    }
  });
});

// ── probe — validation (no network) ──────────────────────────────────────────

describe('probe — validation', () => {
  it('throws when token is undefined', async () => {
    await assert.rejects(
      () => loconav.probe({}),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/token/i.test(err.message));
        return true;
      },
    );
  });

  it('throws when token is null', async () => {
    await assert.rejects(
      () => loconav.probe({ token: null }),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it('throws when token is an empty string', async () => {
    await assert.rejects(
      () => loconav.probe({ token: '' }),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it('throws when token is shorter than 12 characters', async () => {
    await assert.rejects(
      () => loconav.probe({ token: 'short-tok' }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/token/i.test(err.message) || /12/i.test(err.message));
        return true;
      },
    );
  });

  it('throws for an 11-character token', async () => {
    await assert.rejects(
      () => loconav.probe({ token: '12345678901' }),
      Error,
    );
  });

  it('exactly 11 chars also throws', async () => {
    await assert.rejects(
      () => loconav.probe({ token: 'abcdefghijk' }), // 11 chars
      Error,
    );
  });
});

// ── probe — mocked network ────────────────────────────────────────────────────

describe('probe — successful response', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        account: { name: 'Test Account' },
        fleet: { vehicle_count: 12 },
      }),
    });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('returns live: true on successful probe', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.live, true);
  });

  it('returns ok: true on successful probe', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.ok, true);
  });

  it('returns account_name from body.account.name', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.account_name, 'Test Account');
  });

  it('returns fleet_vehicles from body.fleet.vehicle_count', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.fleet_vehicles, 12);
  });

  it('returns probed_at as a valid ISO string', async () => {
    const before = Date.now();
    const result = await loconav.probe({ token: VALID_TOKEN });
    const after = Date.now();
    const ts = new Date(result.probed_at).getTime();
    assert.ok(typeof result.probed_at === 'string');
    assert.ok(ts >= before && ts <= after);
  });
});

describe('probe — 401 response', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 401 });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('throws on 401 (rejected token)', async () => {
    await assert.rejects(
      () => loconav.probe({ token: VALID_TOKEN }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/401|403|rejected/i.test(err.message), `unexpected: ${err.message}`);
        return true;
      },
    );
  });
});

describe('probe — 403 response', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 403 });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('throws on 403 (rejected token)', async () => {
    await assert.rejects(
      () => loconav.probe({ token: VALID_TOKEN }),
      Error,
    );
  });
});

describe('probe — non-auth HTTP error', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('throws on generic HTTP error', async () => {
    await assert.rejects(
      () => loconav.probe({ token: VALID_TOKEN }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/500|failed/i.test(err.message));
        return true;
      },
    );
  });
});

describe('probe — network error (fallback)', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => {
      throw Object.assign(new Error('fetch failed'), {});
    };
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('returns live: false on network error', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.live, false);
  });

  it('returns ok: true on network error (fallback mode)', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.ok, true);
  });

  it('returns a note field explaining the fallback', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.ok(typeof result.note === 'string' && result.note.length > 0, 'note should be a non-empty string');
  });

  it('returns probed_at as a valid ISO string in fallback', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.ok(typeof result.probed_at === 'string');
    assert.ok(!Number.isNaN(new Date(result.probed_at).getTime()));
  });
});

describe('probe — account_name fallback when body.account.name absent', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    // body.name fallback (no .account.name)
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ name: 'Fallback Name', fleet: { vehicle_count: 3 } }),
    });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('uses body.name when body.account.name is absent', async () => {
    const result = await loconav.probe({ token: VALID_TOKEN });
    assert.equal(result.account_name, 'Fallback Name');
  });
});

// ── syncFleet ─────────────────────────────────────────────────────────────────

describe('syncFleet', () => {
  const fakeHauler = { id: 'h1', fleet: { contracted_trucks: 6 } };

  it('returns vehicles_discovered matching hauler.fleet.contracted_trucks', async () => {
    const result = await loconav.syncFleet({ token: VALID_TOKEN }, fakeHauler);
    assert.equal(result.vehicles_discovered, 6);
  });

  it('returns last_sync as a valid ISO date string', async () => {
    const before = Date.now();
    const result = await loconav.syncFleet({ token: VALID_TOKEN }, fakeHauler);
    const after = Date.now();
    const ts = new Date(result.last_sync).getTime();
    assert.ok(typeof result.last_sync === 'string');
    assert.ok(ts >= before && ts <= after);
  });

  it('returns live: true when token provided', async () => {
    const result = await loconav.syncFleet({ token: VALID_TOKEN }, fakeHauler);
    assert.equal(result.live, true);
  });

  it('returns live: false when token is falsy', async () => {
    const result = await loconav.syncFleet({ token: '' }, fakeHauler);
    assert.equal(result.live, false);
  });

  it('returns live: false when no creds token', async () => {
    const result = await loconav.syncFleet({}, fakeHauler);
    assert.equal(result.live, false);
  });
});
