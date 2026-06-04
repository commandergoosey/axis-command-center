'use strict';

/*
 * Tests for services/scheduleRunner.js — runOne, tick
 * + periodMeta (tested indirectly via the meta arg passed to writeReport)
 *
 * Stubs: db (auditInsert), state/reportSchedules (list, markRan),
 *        services/reportBuilder (writeReport), services/mailer (sendReport, DEMO).
 * node-cron is a real dep but only used in start() — not tested here.
 *
 * Covers:
 *   - periodMeta (daily): period_from === period_to; YYYY-MM-DD; label 'Daily ·'
 *   - periodMeta (weekly): period_from is Monday; 6-day span; label 'Week ·'
 *   - periodMeta (monthly): period_from ends '-01'; same year-month; label 'Month ·'
 *   - periodMeta (quarterly): label /^Q[1-4] \d{4}/; first day of quarter; from ≤ to
 *   - runOne: return value, PDF buffer, filename, subject, recipients default/override, error propagation
 *   - tick: empty list; non-due (future/null/inactive); due schedule triggers sendReport
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helper ───────────────────────────────────────────────────

function stub(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

// ── Fixtures ──────────────────────────────────────────────────────

/** Build a schedule object with sensible defaults (already due). */
function mockSchedule(overrides = {}) {
  return {
    id:          'sched-test-01',
    title:       'Test Digest',
    type_id:     'test_digest',
    frequency:   'daily',
    recipients:  ['ops@test.local'],
    active:      true,
    next_run_at: new Date(Date.now() - 60_000).toISOString(), // 1 min ago → due
    ...overrides,
  };
}

const DEFAULT_ADVANCED = {
  id:          'sched-test-01',
  next_run_at: '2026-06-01T00:00:00Z',
  last_run_at: new Date().toISOString(),
};

/**
 * Load a fresh scheduleRunner with all side-effectful deps stubbed.
 *
 * @param {object} opts
 *   sendReportFn  — replaces mailer.sendReport (default: no-op async)
 *   markRanFn     — replaces reportSchedules.markRan
 *   scheduleListFn— replaces reportSchedules.list
 *   writeReportFn — replaces reportBuilder.writeReport
 */
function freshRunner({
  sendReportFn    = async () => ({ demo: true }),
  markRanFn       = () => DEFAULT_ADVANCED,
  scheduleListFn  = () => [],
  writeReportFn   = null,
} = {}) {
  stub('../db', { prepare: () => ({ run: () => {} }) });
  stub('../state/reportSchedules', {
    list:    scheduleListFn,
    markRan: markRanFn,
  });
  stub('../services/reportBuilder', {
    writeReport: writeReportFn ?? ((_typeId, _meta, sink) => {
      sink.write(Buffer.from('%PDF-1.4 stub'));
      sink.end();
    }),
  });
  stub('../services/mailer', {
    sendReport: sendReportFn,
    DEMO: true,
  });
  delete require.cache[require.resolve('../services/scheduleRunner')];
  return require('../services/scheduleRunner');
}

/**
 * Flush the event loop: process.nextTick fires stream 'finish',
 * which resolves pending Promises, all before the first setImmediate fires.
 * One round is sufficient for the runOne async chain.
 */
async function flushAsync() {
  await new Promise((r) => setImmediate(r));
}

// ── periodMeta — daily ────────────────────────────────────────────

describe('scheduleRunner — periodMeta (daily)', () => {
  async function runDaily(schedOverrides = {}) {
    let meta = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { meta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
    });
    await runner.runOne(mockSchedule({ frequency: 'daily', ...schedOverrides }));
    return meta;
  }

  it('period_from equals period_to', async () => {
    const m = await runDaily();
    assert.equal(m.period_from, m.period_to,
      'daily: period_from and period_to should be the same date');
  });

  it('period_from matches YYYY-MM-DD format', async () => {
    const m = await runDaily();
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.period_from),
      `period_from should be YYYY-MM-DD, got: ${m.period_from}`);
  });

  it('period_label starts with "Daily ·"', async () => {
    const m = await runDaily();
    assert.ok(m.period_label.startsWith('Daily · '),
      `period_label should start with 'Daily · ', got: ${m.period_label}`);
  });
});

// ── periodMeta — weekly ───────────────────────────────────────────

describe('scheduleRunner — periodMeta (weekly)', () => {
  async function runWeekly() {
    let meta = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { meta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
    });
    await runner.runOne(mockSchedule({ frequency: 'weekly' }));
    return meta;
  }

  it('period_from is a Monday (UTCDay === 1)', async () => {
    const m = await runWeekly();
    const day = new Date(m.period_from).getUTCDay();
    assert.equal(day, 1, `period_from should be Monday (UTCDay 1), got UTCDay ${day}`);
  });

  it('period_to is exactly 6 days after period_from (Mon–Sun span)', async () => {
    const m = await runWeekly();
    const diffDays =
      (new Date(m.period_to).getTime() - new Date(m.period_from).getTime()) /
      (24 * 60 * 60 * 1000);
    assert.equal(diffDays, 6,
      `weekly range should span 6 days (Mon–Sun), got ${diffDays}`);
  });

  it('period_label starts with "Week ·"', async () => {
    const m = await runWeekly();
    assert.ok(m.period_label.startsWith('Week · '),
      `period_label should start with 'Week · ', got: ${m.period_label}`);
  });
});

// ── periodMeta — monthly ──────────────────────────────────────────

describe('scheduleRunner — periodMeta (monthly)', () => {
  async function runMonthly() {
    let meta = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { meta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
    });
    await runner.runOne(mockSchedule({ frequency: 'monthly' }));
    return meta;
  }

  it('period_from is the first day of the month (ends in -01)', async () => {
    const m = await runMonthly();
    assert.ok(m.period_from.endsWith('-01'),
      `period_from should end in '-01', got: ${m.period_from}`);
  });

  it('period_from and period_to share the same year-month', async () => {
    const m = await runMonthly();
    assert.equal(
      m.period_from.slice(0, 7),
      m.period_to.slice(0, 7),
      'period_from and period_to should fall in the same calendar month',
    );
  });

  it('period_label starts with "Month ·"', async () => {
    const m = await runMonthly();
    assert.ok(m.period_label.startsWith('Month · '),
      `period_label should start with 'Month · ', got: ${m.period_label}`);
  });
});

// ── periodMeta — quarterly ────────────────────────────────────────

describe('scheduleRunner — periodMeta (quarterly)', () => {
  async function runQuarterly() {
    let meta = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { meta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
    });
    await runner.runOne(mockSchedule({ frequency: 'quarterly' }));
    return meta;
  }

  it('period_label starts with Q[1-4] followed by a 4-digit year', async () => {
    const m = await runQuarterly();
    assert.ok(/^Q[1-4] \d{4}/.test(m.period_label),
      `period_label should start with Qn YYYY, got: ${m.period_label}`);
  });

  it('period_from is the first day of a calendar quarter (Jan/Apr/Jul/Oct)', async () => {
    const m = await runQuarterly();
    const d = new Date(m.period_from);
    assert.equal(d.getUTCDate(), 1,
      `period_from should be the 1st day of a month, got day ${d.getUTCDate()}`);
    assert.ok([0, 3, 6, 9].includes(d.getUTCMonth()),
      `period_from month should be 0/3/6/9 (Jan/Apr/Jul/Oct), got ${d.getUTCMonth()}`);
  });

  it('period_from is not after period_to', async () => {
    const m = await runQuarterly();
    assert.ok(
      new Date(m.period_from).getTime() <= new Date(m.period_to).getTime(),
      `period_from (${m.period_from}) should not be after period_to (${m.period_to})`,
    );
  });
});

// ── runOne ────────────────────────────────────────────────────────

describe('scheduleRunner — runOne', () => {
  it('resolves with the value returned by schedules.markRan()', async () => {
    const advanced = { id: 'sched-test-01', next_run_at: '2026-07-01T00:00:00Z', last_run_at: new Date().toISOString() };
    const runner = freshRunner({ markRanFn: () => advanced });
    const result = await runner.runOne(mockSchedule());
    assert.deepEqual(result, advanced);
  });

  it('pdfBuffer passed to sendReport is a non-empty Buffer', async () => {
    let capturedBuf = null;
    const runner = freshRunner({
      sendReportFn: async (opts) => { capturedBuf = opts.pdfBuffer; return { demo: true }; },
    });
    await runner.runOne(mockSchedule());
    assert.ok(capturedBuf instanceof Buffer, 'pdfBuffer should be a Buffer instance');
    assert.ok(capturedBuf.length > 0, 'pdfBuffer should not be empty');
  });

  it('filename is {type_id}_{period_from}.pdf', async () => {
    let capturedMeta = null;
    let capturedFile = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { capturedMeta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
      sendReportFn: async (opts) => { capturedFile = opts.filename; return { demo: true }; },
    });
    const s = mockSchedule({ type_id: 'daily_digest' });
    await runner.runOne(s);
    assert.equal(capturedFile, `daily_digest_${capturedMeta.period_from}.pdf`);
  });

  it('email subject is "[AXIS] {title} · {period_label}"', async () => {
    let capturedMeta = null;
    let capturedSubject = null;
    const runner = freshRunner({
      writeReportFn: (_t, m, sink) => { capturedMeta = m; sink.write(Buffer.from('%PDF-1')); sink.end(); },
      sendReportFn: async (opts) => { capturedSubject = opts.subject; return { demo: true }; },
    });
    await runner.runOne(mockSchedule({ title: 'Corridor Summary' }));
    assert.equal(capturedSubject, `[AXIS] Corridor Summary · ${capturedMeta.period_label}`);
  });

  it('uses the provided recipients list', async () => {
    let capturedTo = null;
    const runner = freshRunner({
      sendReportFn: async (opts) => { capturedTo = opts.to; return { demo: true }; },
    });
    const recips = ['alice@test.local', 'bob@test.local'];
    await runner.runOne(mockSchedule({ recipients: recips }));
    assert.deepEqual(capturedTo, recips);
  });

  it('defaults to axis-ops@axis-command.com when recipients is an empty array', async () => {
    let capturedTo = null;
    const runner = freshRunner({
      sendReportFn: async (opts) => { capturedTo = opts.to; return { demo: true }; },
    });
    await runner.runOne(mockSchedule({ recipients: [] }));
    assert.deepEqual(capturedTo, ['axis-ops@axis-command.com']);
  });

  it('defaults to axis-ops@axis-command.com when recipients is undefined', async () => {
    let capturedTo = null;
    const runner = freshRunner({
      sendReportFn: async (opts) => { capturedTo = opts.to; return { demo: true }; },
    });
    await runner.runOne(mockSchedule({ recipients: undefined }));
    assert.deepEqual(capturedTo, ['axis-ops@axis-command.com']);
  });

  it('rejects when writeReport throws (error propagates from generatePdfBuffer)', async () => {
    const runner = freshRunner({
      writeReportFn: (_t, _m, _sink) => { throw new Error('pdf generation failed'); },
    });
    await assert.rejects(
      () => runner.runOne(mockSchedule()),
      /pdf generation failed/,
      'runOne should reject when writeReport throws',
    );
  });
});

// ── tick ──────────────────────────────────────────────────────────

describe('scheduleRunner — tick', () => {
  it('resolves without throwing when the schedule list is empty', async () => {
    const runner = freshRunner({ scheduleListFn: () => [] });
    await assert.doesNotReject(() => runner.tick());
  });

  it('does not call sendReport for a schedule with a future next_run_at', async () => {
    let called = false;
    const runner = freshRunner({
      scheduleListFn: () => [mockSchedule({
        next_run_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(), // 1 hour ahead
      })],
      sendReportFn: async () => { called = true; return { demo: true }; },
    });
    await runner.tick();
    await flushAsync();
    assert.equal(called, false, 'sendReport should not be called for a non-due schedule');
  });

  it('does not call sendReport for an inactive schedule', async () => {
    let called = false;
    const runner = freshRunner({
      scheduleListFn: () => [mockSchedule({ active: false })],
      sendReportFn: async () => { called = true; return { demo: true }; },
    });
    await runner.tick();
    await flushAsync();
    assert.equal(called, false, 'inactive schedules should not be run by tick');
  });

  it('does not call sendReport for a schedule with null next_run_at', async () => {
    let called = false;
    const runner = freshRunner({
      scheduleListFn: () => [mockSchedule({ next_run_at: null })],
      sendReportFn: async () => { called = true; return { demo: true }; },
    });
    await runner.tick();
    await flushAsync();
    assert.equal(called, false, 'schedule with null next_run_at should not be run');
  });

  it('calls sendReport for a due schedule (next_run_at in the past)', async () => {
    let called = false;
    const runner = freshRunner({
      scheduleListFn: () => [mockSchedule()], // default: 1 min ago → due
      sendReportFn: async () => { called = true; return { demo: true }; },
    });
    await runner.tick();
    await flushAsync();
    assert.equal(called, true, 'sendReport should be called for a schedule that is due');
  });
});
