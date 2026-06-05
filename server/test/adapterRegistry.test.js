'use strict';

/*
 * Tests for adapters/registry.js
 * Exports: { ADAPTERS, adapterFor, probe, syncFleet }
 * No DB, no network — uses manual adapter for integration smoke tests.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../adapters/registry');
const { ADAPTERS, adapterFor, probe, syncFleet } = registry;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeHauler(type, adapter) {
  return {
    id: 'test-hauler',
    fleet: { contracted_trucks: 5 },
    integration: { type, adapter },
  };
}

// ── adapterFor ────────────────────────────────────────────────────────────────

describe('adapterFor', () => {
  it('loconav integration type returns the loconav adapter', () => {
    const hauler = makeHauler('loconav');
    assert.equal(adapterFor(hauler), ADAPTERS.loconav);
  });

  it('manual integration type returns the manual adapter', () => {
    const hauler = makeHauler('manual');
    assert.equal(adapterFor(hauler), ADAPTERS.manual);
  });

  it('custom type with geotab adapter returns the geotab adapter', () => {
    const hauler = makeHauler('custom', 'geotab');
    assert.equal(adapterFor(hauler), ADAPTERS.geotab);
  });

  it('unknown integration type returns null', () => {
    const hauler = makeHauler('unknown_system');
    assert.equal(adapterFor(hauler), null);
  });

  it('custom type without matching adapter name returns null', () => {
    const hauler = makeHauler('custom', 'other_system');
    assert.equal(adapterFor(hauler), null);
  });

  it('null hauler returns null', () => {
    assert.equal(adapterFor(null), null);
  });

  it('undefined hauler returns null', () => {
    assert.equal(adapterFor(undefined), null);
  });

  it('hauler with no integration property returns null', () => {
    const hauler = { id: 'h1', fleet: { contracted_trucks: 3 } };
    assert.equal(adapterFor(hauler), null);
  });

  it('hauler with empty integration object returns null', () => {
    const hauler = { id: 'h1', fleet: { contracted_trucks: 3 }, integration: {} };
    assert.equal(adapterFor(hauler), null);
  });

  it('ADAPTERS object contains loconav, geotab, and manual keys', () => {
    assert.ok('loconav' in ADAPTERS);
    assert.ok('geotab'  in ADAPTERS);
    assert.ok('manual'  in ADAPTERS);
  });
});

// ── probe ─────────────────────────────────────────────────────────────────────

describe('probe', () => {
  it('throws when no adapter is registered for the hauler', async () => {
    const hauler = { id: 'unknown', fleet: {}, integration: { type: 'unknown_type' } };
    await assert.rejects(
      () => probe(hauler, {}),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/No adapter/i.test(err.message), `unexpected message: ${err.message}`);
        return true;
      },
    );
  });

  it('with manual adapter (no network), returns a result object (smoke test)', async () => {
    const hauler = makeHauler('manual');
    const result = await probe(hauler, { csv_text: '' });
    assert.ok(typeof result === 'object' && result !== null);
    assert.equal(result.live, false);
    assert.ok('ok' in result);
    assert.ok('rows_parsed' in result);
  });

  it('manual probe smoke test with valid CSV returns ok: true', async () => {
    const hauler = makeHauler('manual');
    const result = await probe(hauler, {
      csv_text: 'date,truck,tonnes\n2026-01-01,TR-01,100',
    });
    assert.equal(result.ok, true);
    assert.equal(result.rows_parsed, 1);
  });
});

// ── syncFleet ─────────────────────────────────────────────────────────────────

describe('syncFleet', () => {
  it('throws when no adapter is registered for the hauler', async () => {
    const hauler = { id: 'unknown', fleet: { contracted_trucks: 3 }, integration: { type: 'unknown_type' } };
    await assert.rejects(
      () => syncFleet(hauler, {}),
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(/No adapter/i.test(err.message));
        return true;
      },
    );
  });

  it('with manual adapter, returns { live, vehicles_discovered, last_sync }', async () => {
    const hauler = makeHauler('manual');
    const result = await syncFleet(hauler, {});
    assert.ok('live' in result, 'result should have live');
    assert.ok('vehicles_discovered' in result, 'result should have vehicles_discovered');
    assert.ok('last_sync' in result, 'result should have last_sync');
  });

  it('manual syncFleet vehicles_discovered matches contracted_trucks', async () => {
    const hauler = makeHauler('manual');
    hauler.fleet.contracted_trucks = 9;
    const result = await syncFleet(hauler, {});
    assert.equal(result.vehicles_discovered, 9);
  });

  it('manual syncFleet returns live: false', async () => {
    const hauler = makeHauler('manual');
    const result = await syncFleet(hauler, {});
    assert.equal(result.live, false);
  });

  it('last_sync is a valid ISO date string', async () => {
    const hauler = makeHauler('manual');
    const result = await syncFleet(hauler, {});
    assert.ok(typeof result.last_sync === 'string');
    assert.ok(!Number.isNaN(new Date(result.last_sync).getTime()));
  });
});
