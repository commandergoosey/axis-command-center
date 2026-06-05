'use strict';

/*
 * Tests for adapters/manual.js
 * Exports: { probe, parseCsv, syncFleet }
 * No DB, no network — pure functions only.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { probe, parseCsv, syncFleet } = require('../adapters/manual');

// ── parseCsv ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('empty string returns { rows: [], errors: [...] }', () => {
    const { rows, errors } = parseCsv('');
    assert.deepEqual(rows, []);
    assert.ok(errors.length > 0, 'should have at least one error');
  });

  it('missing required columns returns error', () => {
    const { rows, errors } = parseCsv('foo,bar\n1,2');
    assert.deepEqual(rows, []);
    assert.ok(errors.some((e) => /date.*truck.*tonnes/i.test(e)), `unexpected errors: ${errors}`);
  });

  it('missing date column returns error', () => {
    const { rows, errors } = parseCsv('truck,tonnes\nTR-01,10');
    assert.deepEqual(rows, []);
    assert.ok(errors.length > 0);
  });

  it('valid CSV with header and one data row returns correct row object', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,125.5';
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, 'manual-1');
    assert.equal(row.date, '2026-01-15');
    assert.equal(row.truck_id, 'TR-01');
    assert.equal(row.tonnes, 125.5);
    assert.equal(row.delay_min, 0);
    assert.equal(row.note, '');
  });

  it('valid CSV with multiple rows returns correct row objects', () => {
    const csv = [
      'date,truck,tonnes',
      '2026-01-15,TR-01,100',
      '2026-01-16,TR-02,200',
    ].join('\n');
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'manual-1');
    assert.equal(rows[1].id, 'manual-2');
  });

  it('ISO date YYYY-MM-DD is preserved as-is', () => {
    const csv = 'date,truck,tonnes\n2026-06-01,TR-01,50';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].date, '2026-06-01');
  });

  it('DD/MM/YYYY date is converted to YYYY-MM-DD', () => {
    const csv = 'date,truck,tonnes\n15/03/2026,TR-01,75';
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows[0].date, '2026-03-15');
  });

  it('invalid date produces an error entry and row is skipped', () => {
    const csv = 'date,truck,tonnes\nnot-a-date,TR-01,50';
    const { rows, errors } = parseCsv(csv);
    assert.equal(rows.length, 0);
    assert.ok(errors.length > 0, 'expected an error for invalid date');
  });

  it('missing truck produces an error and row is skipped', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,,50';
    const { rows, errors } = parseCsv(csv);
    assert.equal(rows.length, 0);
    assert.ok(errors.length > 0, 'expected an error for missing truck');
  });

  it('non-numeric tonnes produces an error and row is skipped', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,abc';
    const { rows, errors } = parseCsv(csv);
    assert.equal(rows.length, 0);
    assert.ok(errors.length > 0, 'expected an error for non-numeric tonnes');
  });

  it('optional delay_min and note are included when columns present', () => {
    const csv = 'date,truck,tonnes,delay_min,note\n2026-01-15,TR-01,100,30,breakdown';
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows[0].delay_min, 30);
    assert.equal(rows[0].note, 'breakdown');
  });

  it('delay_min defaults to 0 when column absent', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,100';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].delay_min, 0);
  });

  it('note defaults to empty string when column absent', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,100';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].note, '');
  });

  it('tonnes are rounded to 2 decimal places', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,99.9999';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].tonnes, 100);
  });

  it('tonnes with exactly 2 dp are unchanged', () => {
    const csv = 'date,truck,tonnes\n2026-01-15,TR-01,12.34';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].tonnes, 12.34);
  });

  it('id is manual-N with 1-based index', () => {
    const csv = [
      'date,truck,tonnes',
      '2026-01-01,TR-01,10',
      '2026-01-02,TR-02,20',
      '2026-01-03,TR-03,30',
    ].join('\n');
    const { rows } = parseCsv(csv);
    assert.equal(rows[0].id, 'manual-1');
    assert.equal(rows[1].id, 'manual-2');
    assert.equal(rows[2].id, 'manual-3');
  });

  it('mixed valid and invalid rows — only valid rows are returned', () => {
    const csv = [
      'date,truck,tonnes',
      '2026-01-01,TR-01,100',
      'bad-date,TR-02,200',
      '2026-01-03,TR-03,300',
    ].join('\n');
    const { rows, errors } = parseCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(errors.length, 1);
    // IDs reflect original row position (1-indexed from data rows)
    assert.equal(rows[0].id, 'manual-1');
    assert.equal(rows[1].id, 'manual-3');
  });

  it('CRLF line endings are handled', () => {
    const csv = 'date,truck,tonnes\r\n2026-01-01,TR-01,50\r\n';
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 1);
  });

  it('header columns are case-insensitive', () => {
    const csv = 'Date,Truck,Tonnes\n2026-01-01,TR-01,50';
    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 1);
  });
});

// ── probe ─────────────────────────────────────────────────────────────────────

describe('probe', () => {
  it('always returns live: false', async () => {
    const result = await probe({ csv_text: 'date,truck,tonnes\n2026-01-01,TR-01,100' });
    assert.equal(result.live, false);
  });

  it('returns ok: true when CSV has valid rows', async () => {
    const result = await probe({ csv_text: 'date,truck,tonnes\n2026-01-01,TR-01,100' });
    assert.equal(result.ok, true);
  });

  it('returns rows_parsed count matching the number of valid rows', async () => {
    const csv = [
      'date,truck,tonnes',
      '2026-01-01,TR-01,100',
      '2026-01-02,TR-02,200',
    ].join('\n');
    const result = await probe({ csv_text: csv });
    assert.equal(result.rows_parsed, 2);
  });

  it('returns errors array', async () => {
    const result = await probe({ csv_text: 'date,truck,tonnes\n2026-01-01,TR-01,100' });
    assert.ok(Array.isArray(result.errors));
  });

  it('empty csv_text returns ok: false (no rows, has errors)', async () => {
    const result = await probe({ csv_text: '' });
    assert.equal(result.ok, false);
    assert.equal(result.rows_parsed, 0);
    assert.ok(result.errors.length > 0);
  });

  it('undefined csv_text is treated as empty', async () => {
    const result = await probe({});
    assert.equal(result.live, false);
    assert.equal(result.rows_parsed, 0);
  });

  it('account_name is "Manual CSV"', async () => {
    const result = await probe({ csv_text: '' });
    assert.equal(result.account_name, 'Manual CSV');
  });

  it('probed_at is a valid ISO date string', async () => {
    const before = Date.now();
    const result = await probe({ csv_text: '' });
    const after = Date.now();
    const ts = new Date(result.probed_at).getTime();
    assert.ok(typeof result.probed_at === 'string');
    assert.ok(ts >= before && ts <= after, 'probed_at should be current time');
  });
});

// ── syncFleet ─────────────────────────────────────────────────────────────────

describe('syncFleet', () => {
  const fakeHauler = { id: 'h1', fleet: { contracted_trucks: 7 } };

  it('returns live: false', async () => {
    const result = await syncFleet({}, fakeHauler);
    assert.equal(result.live, false);
  });

  it('returns vehicles_discovered equal to hauler.fleet.contracted_trucks', async () => {
    const result = await syncFleet({}, fakeHauler);
    assert.equal(result.vehicles_discovered, 7);
  });

  it('returns last_sync as a valid ISO date string', async () => {
    const before = Date.now();
    const result = await syncFleet({}, fakeHauler);
    const after = Date.now();
    const ts = new Date(result.last_sync).getTime();
    assert.ok(typeof result.last_sync === 'string');
    assert.ok(ts >= before && ts <= after, 'last_sync should be current time');
  });
});
