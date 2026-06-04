'use strict';

/*
 * Tests for services/liveExportBuilder.js — writeLiveExport(exportId, stream)
 *
 * writeLiveExport pipes a PDF to the supplied stream.
 * Collects output via PassThrough to verify:
 *   - All 3 export types produce valid %PDF output, non-empty, > 1kB
 *   - Unknown exportId throws synchronously
 *   - hauler_scorecard_<unknown> throws (hauler not found)
 *
 * Stubs: roster.list, roster.find, alertState.getState
 * Mock files (financials, alerts, trips, fleet, corridor, drivers) load from disk.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');

// ── Stub helpers ──────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id:       require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded:   true,
    exports,
  };
}

// ── Mock hauler (matches aggregator's expected shape) ─────────────

const MOCK_HAULER = {
  id:            'haul-01',
  display_name:  'Alpha Haulage Ltd',
  status:        'active',
  onboarded_date: '2026-01-01',
  run_rate:       1.0,
  fleet: { contracted_trucks: 10, active_trucks: 8 },
  performance:   { on_time_pct: 88, sla_attainment_pct: 92, safety_score: 90 },
  integration:   { type: 'api', error_count_24h: 0, last_sync: null, adapter: null },
  contract_share: 1.0,
  api_status:    'connected',
};

function freshModule() {
  stub('../state/roster', {
    list: () => [MOCK_HAULER],
    find: (id) => (id === 'haul-01' ? MOCK_HAULER : null),
  });
  stub('../state/alertState', { getState: () => ({}) });
  delete require.cache[require.resolve('../services/liveExportBuilder')];
  return require('../services/liveExportBuilder');
}

after(() => {
  for (const p of [
    '../services/liveExportBuilder',
    '../state/roster',
    '../state/alertState',
  ]) delete require.cache[require.resolve(p)];
});

// ── Helper: collect writeLiveExport output into a Buffer ──────────

function exportToBuffer(writeLiveExport, exportId) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data',  (chunk) => chunks.push(chunk));
    stream.on('end',   () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    try {
      writeLiveExport(exportId, stream);
    } catch (err) {
      reject(err);
    }
  });
}

// ── Exports ───────────────────────────────────────────────────────

describe('liveExportBuilder — exports', () => {
  it('writeLiveExport is exported as a function', () => {
    const { writeLiveExport } = freshModule();
    assert.equal(typeof writeLiveExport, 'function');
  });
});

// ── Error handling ────────────────────────────────────────────────

describe('liveExportBuilder — error handling', () => {
  it('throws synchronously for unknown exportId', () => {
    const { writeLiveExport } = freshModule();
    const stream = new PassThrough();
    assert.throws(
      () => writeLiveExport('unknown_export_type', stream),
      /Unknown live export/,
    );
  });

  it('hauler_scorecard with unknown haulerId throws "Hauler not found"', async () => {
    const { writeLiveExport } = freshModule();
    await assert.rejects(
      () => exportToBuffer(writeLiveExport, 'hauler_scorecard_nonexistent'),
      /Hauler not found/,
    );
  });
});

// ── PDF output — all export types ────────────────────────────────

describe('liveExportBuilder — PDF output', () => {
  const EXPORT_TYPES = [
    'today_digest',
    'lender_pack',
    'hauler_scorecard_haul-01',
  ];

  for (const exportId of EXPORT_TYPES) {
    it(`${exportId}: generates non-empty output`, async () => {
      const { writeLiveExport } = freshModule();
      const buf = await exportToBuffer(writeLiveExport, exportId);
      assert.ok(buf.length > 0,
        `${exportId}: output buffer should not be empty`);
    });

    it(`${exportId}: output starts with %PDF header`, async () => {
      const { writeLiveExport } = freshModule();
      const buf = await exportToBuffer(writeLiveExport, exportId);
      assert.ok(
        buf.slice(0, 4).toString() === '%PDF',
        `${exportId}: expected %PDF header, got "${buf.slice(0, 4).toString()}"`,
      );
    });

    it(`${exportId}: output exceeds 1 kB (multi-section content)`, async () => {
      const { writeLiveExport } = freshModule();
      const buf = await exportToBuffer(writeLiveExport, exportId);
      assert.ok(
        buf.length > 1024,
        `${exportId}: output is only ${buf.length} bytes — expected > 1 kB`,
      );
    });
  }
});
