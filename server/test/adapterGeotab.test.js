'use strict';

/*
 * Tests for adapters/geotab.js
 * Exports: { probe, syncFleet, _BASE }
 * Network is mocked via global.fetch.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const geotab = require('../adapters/geotab');

// Valid credentials for use across tests
const VALID_CREDS = { database: 'mydb', username: 'user@example.com', password: 'secret123' };

// ── _BASE ─────────────────────────────────────────────────────────────────────

describe('_BASE', () => {
  it('exports _BASE as a non-empty string', () => {
    assert.ok(typeof geotab._BASE === 'string');
    assert.ok(geotab._BASE.length > 0);
  });

  it('_BASE contains geotab when using default', () => {
    if (!process.env.GEOTAB_API_BASE) {
      assert.ok(geotab._BASE.includes('geotab.com'));
    }
  });
});

// ── probe — validation (no network) ──────────────────────────────────────────

describe('probe — validation', () => {
  it('throws when database is missing', async () => {
    await assert.rejects(
      () => geotab.probe({ username: 'u', password: 'p' }),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/database|username|password/i.test(err.message));
        return true;
      },
    );
  });

  it('throws when username is missing', async () => {
    await assert.rejects(
      () => geotab.probe({ database: 'db', password: 'p' }),
      Error,
    );
  });

  it('throws when password is missing', async () => {
    await assert.rejects(
      () => geotab.probe({ database: 'db', username: 'u' }),
      Error,
    );
  });

  it('throws when all credentials are absent', async () => {
    await assert.rejects(
      () => geotab.probe({}),
      Error,
    );
  });

  it('throws when database is an empty string', async () => {
    await assert.rejects(
      () => geotab.probe({ database: '', username: 'u', password: 'p' }),
      Error,
    );
  });

  it('throws when username is an empty string', async () => {
    await assert.rejects(
      () => geotab.probe({ database: 'db', username: '', password: 'p' }),
      Error,
    );
  });

  it('throws when password is an empty string', async () => {
    await assert.rejects(
      () => geotab.probe({ database: 'db', username: 'u', password: '' }),
      Error,
    );
  });
});

// ── probe — successful authentication ────────────────────────────────────────

describe('probe — successful authentication', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: { path: 'my.geotab.com', vehicles: 5 },
      }),
    });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('returns live: true on successful probe', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.live, true);
  });

  it('returns ok: true on successful probe', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.ok, true);
  });

  it('account_name is set to the database name', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.account_name, VALID_CREDS.database);
  });

  it('fleet_vehicles is taken from result.vehicles', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.fleet_vehicles, 5);
  });

  it('session_path is taken from result.path', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.session_path, 'my.geotab.com');
  });

  it('probed_at is a valid ISO date string', async () => {
    const before = Date.now();
    const result = await geotab.probe(VALID_CREDS);
    const after = Date.now();
    const ts = new Date(result.probed_at).getTime();
    assert.ok(typeof result.probed_at === 'string');
    assert.ok(ts >= before && ts <= after);
  });
});

// ── probe — API error in response body ───────────────────────────────────────

describe('probe — API error in response body', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        error: { message: 'Invalid credentials' },
      }),
    });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('throws when response body contains error', async () => {
    await assert.rejects(
      () => geotab.probe(VALID_CREDS),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      },
    );
  });

  it('error message contains the API-provided message', async () => {
    await assert.rejects(
      () => geotab.probe(VALID_CREDS),
      (err) => {
        assert.ok(/Invalid credentials/i.test(err.message), `unexpected: ${err.message}`);
        return true;
      },
    );
  });
});

// ── probe — HTTP error ────────────────────────────────────────────────────────

describe('probe — HTTP error', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 });
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('throws on non-ok HTTP status', async () => {
    await assert.rejects(
      () => geotab.probe(VALID_CREDS),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/500|failed/i.test(err.message));
        return true;
      },
    );
  });
});

// ── probe — network failure (fallback) ───────────────────────────────────────

describe('probe — network failure (fallback)', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('fetch failed');
    };
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('returns live: false on network failure', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.live, false);
  });

  it('returns ok: true on network failure (fallback mode)', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.ok, true);
  });

  it('returns a non-empty note field in fallback', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.ok(typeof result.note === 'string' && result.note.length > 0);
  });

  it('returns probed_at as a valid ISO string in fallback', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.ok(typeof result.probed_at === 'string');
    assert.ok(!Number.isNaN(new Date(result.probed_at).getTime()));
  });
});

// ── probe — AbortError fallback ───────────────────────────────────────────────

describe('probe — AbortError fallback', () => {
  let origFetch;

  before(() => {
    origFetch = global.fetch;
    global.fetch = async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };
  });

  after(() => {
    global.fetch = origFetch;
  });

  it('returns live: false on AbortError (timeout)', async () => {
    const result = await geotab.probe(VALID_CREDS);
    assert.equal(result.live, false);
    assert.equal(result.ok, true);
  });
});

// ── syncFleet ─────────────────────────────────────────────────────────────────

describe('syncFleet', () => {
  const fakeHauler = { id: 'h2', fleet: { contracted_trucks: 4 } };

  it('returns live: false', async () => {
    const result = await geotab.syncFleet({}, fakeHauler);
    assert.equal(result.live, false);
  });

  it('returns vehicles_discovered equal to hauler.fleet.contracted_trucks', async () => {
    const result = await geotab.syncFleet({}, fakeHauler);
    assert.equal(result.vehicles_discovered, 4);
  });

  it('returns last_sync as a valid ISO date string', async () => {
    const before = Date.now();
    const result = await geotab.syncFleet({}, fakeHauler);
    const after = Date.now();
    const ts = new Date(result.last_sync).getTime();
    assert.ok(typeof result.last_sync === 'string');
    assert.ok(ts >= before && ts <= after);
  });

  it('different contracted_trucks value is reflected correctly', async () => {
    const hauler = { id: 'h3', fleet: { contracted_trucks: 12 } };
    const result = await geotab.syncFleet({}, hauler);
    assert.equal(result.vehicles_discovered, 12);
  });
});
