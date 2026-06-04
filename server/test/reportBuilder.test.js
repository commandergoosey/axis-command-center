'use strict';

/*
 * Tests for services/reportBuilder.js — writeReport() and RENDERERS
 *
 * writeReport(typeId, meta, stream) pipes a PDF to the supplied stream.
 * Collects the output into a Buffer via PassThrough to verify:
 *   - Output begins with "%PDF" header (valid PDF)
 *   - All 4 known report types generate non-empty output
 *   - Unknown typeId throws synchronously
 *   - RENDERERS export has expected keys
 *
 * Stubs: roster.list, alertState.getState (only state deps)
 * Mock files load from disk.
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

function freshModule() {
  stub('../state/roster',     { list: () => [], find: () => null });
  stub('../state/alertState', { getState: () => ({}) });
  delete require.cache[require.resolve('../services/reportBuilder')];
  return require('../services/reportBuilder');
}

after(() => {
  for (const p of ['../services/reportBuilder', '../state/roster', '../state/alertState'])
    delete require.cache[require.resolve(p)];
});

// Helper: collect writeReport output into a Buffer
function reportToBuffer(writeReport, typeId, meta = {}) {
  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    try {
      writeReport(typeId, meta, stream);
    } catch (err) {
      reject(err);
    }
  });
}

// ── RENDERERS export ──────────────────────────────────────────────

describe('reportBuilder — RENDERERS', () => {
  it('RENDERERS is exported', () => {
    const { RENDERERS } = freshModule();
    assert.ok(RENDERERS != null && typeof RENDERERS === 'object');
  });

  it('RENDERERS has expected keys', () => {
    const { RENDERERS } = freshModule();
    for (const k of ['shift_handover', 'gibdlc_monthly', 'lender_quarterly', 'filings_pack']) {
      assert.ok(k in RENDERERS, `RENDERERS missing key: ${k}`);
    }
  });

  it('each RENDERERS value is a function', () => {
    const { RENDERERS } = freshModule();
    for (const [k, fn] of Object.entries(RENDERERS)) {
      assert.equal(typeof fn, 'function', `RENDERERS.${k} should be a function`);
    }
  });
});

// ── writeReport — error handling ──────────────────────────────────

describe('reportBuilder — writeReport error handling', () => {
  it('throws for unknown typeId', () => {
    const { writeReport } = freshModule();
    const stream = new PassThrough();
    assert.throws(
      () => writeReport('unknown_report_type', {}, stream),
      /Unknown report type/,
    );
  });
});

// ── writeReport — PDF output ──────────────────────────────────────

describe('reportBuilder — PDF output', () => {
  const REPORT_TYPES = ['shift_handover', 'gibdlc_monthly', 'lender_quarterly', 'filings_pack'];

  for (const typeId of REPORT_TYPES) {
    it(`${typeId}: generates non-empty output`, async () => {
      const { writeReport } = freshModule();
      const buf = await reportToBuffer(writeReport, typeId, {});
      assert.ok(buf.length > 0, `${typeId}: output buffer should not be empty`);
    });

    it(`${typeId}: output starts with PDF header (%PDF)`, async () => {
      const { writeReport } = freshModule();
      const buf = await reportToBuffer(writeReport, typeId, {});
      assert.ok(buf.slice(0, 4).toString() === '%PDF',
        `${typeId}: expected %PDF header, got ${buf.slice(0, 4).toString()}`);
    });

    it(`${typeId}: output exceeds 1kB (confirms multi-section content)`, async () => {
      const { writeReport } = freshModule();
      const buf = await reportToBuffer(writeReport, typeId, {});
      assert.ok(buf.length > 1024,
        `${typeId}: output ${buf.length} bytes — expected > 1kB`);
    });
  }
});

// ── writeReport — meta passthrough ───────────────────────────────

describe('reportBuilder — meta passthrough', () => {
  it('shift_handover with meta.prepared_by does not throw', async () => {
    const { writeReport } = freshModule();
    const buf = await reportToBuffer(writeReport, 'shift_handover', {
      prepared_by: 'Test Operator',
      date:        '2026-05-21',
    });
    assert.ok(buf.length > 0);
  });

  it('gibdlc_monthly with meta.month does not throw', async () => {
    const { writeReport } = freshModule();
    const buf = await reportToBuffer(writeReport, 'gibdlc_monthly', {
      month: '2026-05',
    });
    assert.ok(buf.length > 0);
  });
});
