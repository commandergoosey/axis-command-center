'use strict';

/*
 * Tests for state/fleetStore.js —
 *   list, findById, findByPlate, setStatus, create, update, archive, unarchive
 *
 * Uses an in-memory SQLite DB. mock/fleet is stubbed with
 * { buildFleet: () => [] } so seed() runs a no-op transaction.
 *
 * Notable: all SELECT statements compute
 *   (total_km - last_service_km) AS km_since_service
 * so every returned row carries this derived field.
 *
 * Covers:
 *   - list: empty initially; active trucks returned; hauler_id filter;
 *     archived excluded; km_since_service present
 *   - findById: falsy/unknown → null; returns row; archived → null
 *   - findByPlate: null → null; unknown → null; normalised to uppercase;
 *     archived → null
 *   - create: plate/hauler_id required; id prefix; plate uppercased+trimmed;
 *     defaults (status, km fields, efficiency, gross_weight_t, axle_config,
 *     road_worthy_expiry_days); km_since_service = 0 on creation
 *   - update: throws for unknown; patches plate/make/model/total_km/
 *     gross_weight_t; unpatched preserved; km_since_service updates
 *   - archive / unarchive: excluded from list/findById/findByPlate;
 *     restored after unarchive
 *   - setStatus: changes status; other fields unaffected
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── In-memory DB ──────────────────────────────────────────────────
process.env.DB_PATH = ':memory:';
delete require.cache[require.resolve('../db')];
require('../db');

// ── Stub helper ───────────────────────────────────────────────────
function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Stub mock/fleet → empty so seed() inserts nothing ─────────────
stub('../mock/fleet', { buildFleet: () => [] });

delete require.cache[require.resolve('../state/fleetStore')];
const fs = require('../state/fleetStore');

// ── Fixture helpers ───────────────────────────────────────────────
let _seq = 0;

function newTruck(overrides = {}) {
  _seq += 1;
  return {
    plate:     `GH-T${String(_seq).padStart(4, '0')}`,
    hauler_id: `haul-f${String(_seq).padStart(2, '0')}`,
    ...overrides,
  };
}

// ── list ──────────────────────────────────────────────────────────

describe('fleetStore — list', () => {
  it('returns an empty array on a fresh in-memory DB', () => {
    assert.ok(Array.isArray(fs.list()));
    assert.equal(fs.list().length, 0);
  });

  it('returns active trucks after creation', () => {
    fs.create(newTruck());
    assert.ok(fs.list().length >= 1);
  });

  it('hauler_id filter returns only that hauler\'s trucks', () => {
    const h = `haul-lf-${++_seq}`;
    fs.create({ plate: `GH-LF${_seq}`, hauler_id: h });
    const result = fs.list({ hauler_id: h });
    assert.ok(result.length >= 1);
    assert.ok(result.every((t) => t.hauler_id === h));
  });

  it('archived trucks are excluded from list()', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    assert.ok(!fs.list().some((x) => x.id === t.id));
  });

  it('every list item has a km_since_service field', () => {
    fs.create(newTruck());
    for (const t of fs.list()) {
      assert.ok('km_since_service' in t,
        `truck ${t.id} missing km_since_service`);
    }
  });
});

// ── findById ──────────────────────────────────────────────────────

describe('fleetStore — findById', () => {
  it('returns null for null id', () => {
    assert.equal(fs.findById(null), null);
  });

  it('returns null for undefined id', () => {
    assert.equal(fs.findById(undefined), null);
  });

  it('returns null for an unknown id', () => {
    assert.equal(fs.findById('rig-does-not-exist'), null);
  });

  it('returns the row for a known id', () => {
    const t = fs.create(newTruck());
    const result = fs.findById(t.id);
    assert.ok(result !== null);
    assert.equal(result.id, t.id);
  });

  it('returns null for an archived truck', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    assert.equal(fs.findById(t.id), null);
  });
});

// ── findByPlate ───────────────────────────────────────────────────

describe('fleetStore — findByPlate', () => {
  it('returns null for null plate', () => {
    assert.equal(fs.findByPlate(null), null);
  });

  it('returns null for an unknown plate', () => {
    assert.equal(fs.findByPlate('GH-XXXX'), null);
  });

  it('returns the row for a known plate', () => {
    const t = fs.create(newTruck({ plate: 'GH-PLATE1' }));
    const result = fs.findByPlate('GH-PLATE1');
    assert.ok(result !== null);
    assert.equal(result.id, t.id);
  });

  it('plate lookup is case-insensitive (stored uppercase, queried lower)', () => {
    fs.create(newTruck({ plate: 'GH-UPPER1' }));
    const result = fs.findByPlate('gh-upper1');
    assert.ok(result !== null,
      'plate lookup should be case-insensitive (normalised to uppercase)');
  });

  it('returns null for an archived truck', () => {
    const t = fs.create(newTruck({ plate: 'GH-ARCH01' }));
    fs.archive(t.id);
    assert.equal(fs.findByPlate('GH-ARCH01'), null);
  });
});

// ── create ────────────────────────────────────────────────────────

describe('fleetStore — create', () => {
  it('throws when plate is missing', () => {
    assert.throws(
      () => fs.create({ hauler_id: 'haul-01' }),
      /required/i,
    );
  });

  it('throws when hauler_id is missing', () => {
    assert.throws(
      () => fs.create({ plate: 'GH-0001' }),
      /required/i,
    );
  });

  it('id starts with "rig-"', () => {
    const t = fs.create(newTruck());
    assert.ok(t.id.startsWith('rig-'), `expected "rig-" prefix, got: ${t.id}`);
  });

  it('plate is trimmed and uppercased', () => {
    const t = fs.create(newTruck({ plate: '  gh-lower  ' }));
    assert.equal(t.plate, 'GH-LOWER');
  });

  it('status defaults to "idle"', () => {
    const t = fs.create(newTruck());
    assert.equal(t.status, 'idle');
  });

  it('total_km defaults to 0', () => {
    const t = fs.create(newTruck());
    assert.equal(t.total_km, 0);
  });

  it('last_service_km defaults to 0', () => {
    const t = fs.create(newTruck());
    assert.equal(t.last_service_km, 0);
  });

  it('efficiency_l_per_100km defaults to 38', () => {
    const t = fs.create(newTruck());
    assert.equal(t.efficiency_l_per_100km, 38);
  });

  it('gross_weight_t defaults to 40', () => {
    const t = fs.create(newTruck());
    assert.equal(t.gross_weight_t, 40);
  });

  it('axle_config defaults to "6x4"', () => {
    const t = fs.create(newTruck());
    assert.equal(t.axle_config, '6x4');
  });

  it('road_worthy_expiry_days defaults to 365', () => {
    const t = fs.create(newTruck());
    assert.equal(t.road_worthy_expiry_days, 365);
  });

  it('km_since_service is 0 on a new truck (total_km = last_service_km = 0)', () => {
    const t = fs.create(newTruck());
    assert.equal(t.km_since_service, 0);
  });

  it('accepts explicit make, model, and axle_config', () => {
    const t = fs.create(newTruck({ make: 'Volvo', model: 'FH16', axle_config: '8x4' }));
    assert.equal(t.make,        'Volvo');
    assert.equal(t.model,       'FH16');
    assert.equal(t.axle_config, '8x4');
  });

  it('archived flag is 0 on a new truck', () => {
    const t = fs.create(newTruck());
    assert.equal(t.archived, 0);
  });
});

// ── update ────────────────────────────────────────────────────────

describe('fleetStore — update', () => {
  it('throws for an unknown truck id', () => {
    assert.throws(
      () => fs.update('rig-does-not-exist', { make: 'X' }),
      /not found/i,
    );
  });

  it('patches plate (trimmed and uppercased)', () => {
    const t = fs.create(newTruck());
    const patched = fs.update(t.id, { plate: '  gh-new-plate  ' });
    assert.equal(patched.plate, 'GH-NEW-PLATE');
  });

  it('patches make and model', () => {
    const t = fs.create(newTruck());
    const patched = fs.update(t.id, { make: 'Mercedes', model: 'Actros' });
    assert.equal(patched.make,  'Mercedes');
    assert.equal(patched.model, 'Actros');
  });

  it('patches total_km (numeric coerce)', () => {
    const t = fs.create(newTruck());
    const patched = fs.update(t.id, { total_km: 50000 });
    assert.equal(patched.total_km, 50000);
  });

  it('patches gross_weight_t', () => {
    const t = fs.create(newTruck());
    const patched = fs.update(t.id, { gross_weight_t: 45 });
    assert.equal(patched.gross_weight_t, 45);
  });

  it('km_since_service reflects updated total_km − last_service_km', () => {
    const t = fs.create(newTruck());
    fs.update(t.id, { total_km: 10000, last_service_km: 8000 });
    const row = fs.findById(t.id);
    assert.equal(row.km_since_service, 2000);
  });

  it('unpatched fields are preserved', () => {
    const t = fs.create(newTruck({ axle_config: '8x4' }));
    // Set efficiency via update, then patch only make — efficiency should survive
    fs.update(t.id, { efficiency_l_per_100km: 42 });
    fs.update(t.id, { make: 'DAF' });
    const row = fs.findById(t.id);
    assert.equal(row.axle_config,            '8x4');
    assert.equal(row.efficiency_l_per_100km, 42);
  });

  it('returns the updated row', () => {
    const t = fs.create(newTruck());
    const result = fs.update(t.id, { make: 'Scania' });
    assert.ok(result !== null);
    assert.equal(result.id, t.id);
  });
});

// ── archive / unarchive ───────────────────────────────────────────

describe('fleetStore — archive / unarchive', () => {
  it('archived truck is excluded from list()', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    assert.ok(!fs.list().some((x) => x.id === t.id));
  });

  it('findById returns null after archive', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    assert.equal(fs.findById(t.id), null);
  });

  it('findByPlate returns null after archive', () => {
    const t = fs.create(newTruck({ plate: 'GH-ARCH02' }));
    fs.archive(t.id);
    assert.equal(fs.findByPlate('GH-ARCH02'), null);
  });

  it('unarchived truck reappears in list()', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    fs.unarchive(t.id);
    assert.ok(fs.list().some((x) => x.id === t.id));
  });

  it('findById returns the row after unarchive', () => {
    const t = fs.create(newTruck());
    fs.archive(t.id);
    fs.unarchive(t.id);
    assert.ok(fs.findById(t.id) !== null);
  });
});

// ── setStatus ─────────────────────────────────────────────────────

describe('fleetStore — setStatus', () => {
  it('changes the truck status', () => {
    const t = fs.create(newTruck());
    assert.equal(t.status, 'idle');
    fs.setStatus(t.id, 'en_route');
    assert.equal(fs.findById(t.id).status, 'en_route');
  });

  it('other fields are unaffected by setStatus', () => {
    const t = fs.create(newTruck({ axle_config: '6x4' }));
    fs.setStatus(t.id, 'maintenance');
    const row = fs.findById(t.id);
    assert.equal(row.axle_config, '6x4');
    assert.equal(row.total_km,    0);
  });

  it('can cycle through multiple statuses', () => {
    const t = fs.create(newTruck());
    for (const s of ['en_route', 'idle', 'maintenance', 'idle']) {
      fs.setStatus(t.id, s);
      assert.equal(fs.findById(t.id).status, s);
    }
  });
});
