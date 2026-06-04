'use strict';

/*
 * Tests for services/forecastAnomalies.js
 *
 * Three anomaly types, all tested via controlled inputs:
 *   1. Verdict transition   — projection moved into a worse bucket
 *   2. Sharp single-day drop — EOM fell ≥1.0% (code threshold; comment says 1.5% — this test pins the real value)
 *   3. Trend reversal        — was rising ≥⌈2/3⌉ of background days, then fell
 *
 * detect() depends on buildForecast, forecastSnapshots.recent, and roster.list.
 * All three are stubbed via require.cache so no DB or HTTP server is needed.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub helpers ──────────────────────────────────────────────────────

function stub(resolvedPath, exports) {
  require.cache[require.resolve(resolvedPath)] = {
    id: require.resolve(resolvedPath),
    filename: require.resolve(resolvedPath),
    loaded: true,
    exports,
  };
}

function freshDetect({ live, snaps, rosterList = [] } = {}) {
  stub('../services/forecast',       { buildForecast: () => live });
  stub('../state/forecastSnapshots', { recent: () => snaps });
  stub('../state/roster',            { list: () => rosterList });
  delete require.cache[require.resolve('../services/forecastAnomalies')];
  return require('../services/forecastAnomalies').detect;
}

after(() => {
  for (const p of [
    '../services/forecastAnomalies',
    '../services/forecast',
    '../state/forecastSnapshots',
    '../state/roster',
  ]) delete require.cache[require.resolve(p)];
});

// ── Shared fixture builders ───────────────────────────────────────────

function liveForecast({ verdict = 'above_floor', eom_tonnes = 65_000, days_remaining = 12 } = {}) {
  return { projection: { verdict, eom_tonnes }, horizon: { days_remaining } };
}

function makeSnaps(eomList, verdicts = []) {
  return eomList.map((t, i) => ({
    snapshot_date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    eom_tonnes:    t,
    verdict:       verdicts[i] ?? 'above_floor',
  }));
}

// ── Defensive guard-rails ─────────────────────────────────────────────

describe('forecastAnomalies — defensive', () => {
  it('returns [] when buildForecast throws', () => {
    stub('../services/forecast', { buildForecast: () => { throw new Error('no data'); } });
    stub('../state/forecastSnapshots', { recent: () => makeSnaps([60_000, 61_000]) });
    stub('../state/roster',            { list: () => [] });
    delete require.cache[require.resolve('../services/forecastAnomalies')];
    const detect = require('../services/forecastAnomalies').detect;
    assert.deepEqual(detect(), []);
  });

  it('returns [] when fewer than 2 snapshots exist', () => {
    const detect = freshDetect({ live: liveForecast(), snaps: [] });
    assert.deepEqual(detect(), []);
  });

  it('returns [] when exactly 1 snapshot exists', () => {
    const detect = freshDetect({ live: liveForecast(), snaps: makeSnaps([60_000]) });
    assert.deepEqual(detect(), []);
  });

  it('returns an array (never throws) when all inputs are present', () => {
    const detect = freshDetect({ live: liveForecast(), snaps: makeSnaps([60_000, 61_000]) });
    assert.ok(Array.isArray(detect()));
  });
});

// ── Anomaly 1: Verdict transition ─────────────────────────────────────

describe('forecastAnomalies — verdict transition', () => {
  it('fires when verdict moves to a worse bucket', () => {
    const snaps = makeSnaps([65_000, 65_000],
      ['above_floor', 'above_floor']); // yesterday=above_floor
    const live  = liveForecast({ verdict: 'below_floor_at_pace' }); // worse
    const detect = freshDetect({ live, snaps });

    const obs = detect();
    assert.ok(obs.some((o) => o.id === 'obs-forecast-verdict-decay'),
      'expected verdict-decay observation');
  });

  it('obs-forecast-verdict-decay has severity warn', () => {
    const snaps = makeSnaps([65_000, 65_000], ['on_pace_for_contracted', 'on_pace_for_contracted']);
    const detect = freshDetect({
      live: liveForecast({ verdict: 'below_floor_at_pace' }),
      snaps,
    });
    const obs = detect().find((o) => o.id === 'obs-forecast-verdict-decay');
    assert.equal(obs?.severity, 'warn');
  });

  it('does NOT fire when verdict is unchanged', () => {
    const snaps  = makeSnaps([65_000, 65_000], ['above_floor', 'above_floor']);
    const detect = freshDetect({ live: liveForecast({ verdict: 'above_floor' }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-verdict-decay'));
  });

  it('does NOT fire when verdict improves (moves to a better bucket)', () => {
    const snaps  = makeSnaps([65_000, 65_000], ['below_floor_at_pace', 'below_floor_at_pace']);
    const detect = freshDetect({ live: liveForecast({ verdict: 'above_floor' }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-verdict-decay'));
  });

  it('verdict rank order — on_pace(0) < above_floor(1) < banked_floor_drift(2) < below_floor_at_pace(3)', () => {
    // Test the full decay chain: each step to a worse bucket should fire
    const transitions = [
      ['on_pace_for_contracted', 'above_floor'],
      ['above_floor',            'banked_floor_drift'],
      ['banked_floor_drift',     'below_floor_at_pace'],
    ];
    for (const [prev, curr] of transitions) {
      const snaps  = makeSnaps([65_000, 65_000], [prev, prev]);
      const detect = freshDetect({ live: liveForecast({ verdict: curr }), snaps });
      assert.ok(detect().some((o) => o.id === 'obs-forecast-verdict-decay'),
        `${prev} → ${curr} should trigger verdict-decay`);
    }
  });
});

// ── Anomaly 2: Sharp single-day drop ─────────────────────────────────

describe('forecastAnomalies — sharp single-day drop', () => {
  // Code threshold is ≥1.0% (comment says 1.5% — this test pins the actual code value)

  it('fires when drop is exactly 1.0%', () => {
    const yest = 65_000;
    const now  = yest * 0.99; // exactly 1.0% drop
    const snaps  = makeSnaps([yest, yest]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: now }), snaps });
    assert.ok(detect().some((o) => o.id === 'obs-forecast-sharp-drop'),
      'should fire at exactly 1.0% drop');
  });

  it('fires when drop exceeds 1.0% (1.5% drop)', () => {
    const snaps  = makeSnaps([65_000, 65_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 64_025 }), snaps }); // ~1.5%
    assert.ok(detect().some((o) => o.id === 'obs-forecast-sharp-drop'));
  });

  it('does NOT fire when drop is just below 1.0%', () => {
    const yest = 65_000;
    const now  = yest * 0.991; // 0.9% drop
    const snaps  = makeSnaps([yest, yest]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: now }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-sharp-drop'),
      'should NOT fire at <1.0% drop');
  });

  it('does NOT fire when EOM is flat', () => {
    const snaps  = makeSnaps([65_000, 65_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 65_000 }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-sharp-drop'));
  });

  it('does NOT fire when EOM rises', () => {
    const snaps  = makeSnaps([65_000, 65_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 66_000 }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-sharp-drop'));
  });

  it('obs-forecast-sharp-drop has severity warn', () => {
    const snaps  = makeSnaps([65_000, 65_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 63_000 }), snaps });
    const obs    = detect().find((o) => o.id === 'obs-forecast-sharp-drop');
    assert.equal(obs?.severity, 'warn');
  });

  it('body text includes current and previous EOM tonnage', () => {
    const snaps  = makeSnaps([65_000, 65_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 63_000 }), snaps });
    const body   = detect().find((o) => o.id === 'obs-forecast-sharp-drop')?.body ?? '';
    assert.ok(body.includes('63'), 'body should mention current kt');
    assert.ok(body.includes('65'), 'body should mention previous kt');
  });
});

// ── Anomaly 3: Trend reversal ─────────────────────────────────────────

describe('forecastAnomalies — trend reversal', () => {
  // Requires ≥5 snapshots. Uses last 6 → 5 deltas.
  // background = first 3 deltas; recent = last delta.
  // Fires if recent < 0 AND ≥ ⌈2/3⌉ of background are ≥ 0.
  // With 3 background days: need ≥2 climbing.

  it('fires when 3/3 background days rising then a fall', () => {
    // eom: 60,62,64,66,68,66 → deltas: +2,+2,+2,+2,-2
    // background=[+2,+2,+2], recent=-2, climbing=3 ≥ 2 → TRIGGER
    const snaps  = makeSnaps([60_000, 62_000, 64_000, 66_000, 68_000, 66_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 66_000 }), snaps });
    assert.ok(detect().some((o) => o.id === 'obs-forecast-trend-reversal'),
      'expected trend-reversal observation');
  });

  it('fires when 2/3 background days rising then a fall', () => {
    // deltas: +2,-1,+3,+2,-2 → background=[+2,-1,+3], climbing=2 ≥ 2 → TRIGGER
    const snaps  = makeSnaps([60_000, 62_000, 61_000, 64_000, 66_000, 64_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 64_000 }), snaps });
    assert.ok(detect().some((o) => o.id === 'obs-forecast-trend-reversal'));
  });

  it('does NOT fire when background has only 1/3 rising days', () => {
    // deltas: -2,-2,+3,+2,-2 → background=[-2,-2,+3], climbing=1 < 2 → NO
    const snaps  = makeSnaps([60_000, 58_000, 56_000, 59_000, 61_000, 59_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 59_000 }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-trend-reversal'));
  });

  it('does NOT fire when last delta is non-negative (no reversal)', () => {
    // All rising — deltas: +2,+2,+2,+2,+2 → recent=+2 → NO
    const snaps  = makeSnaps([60_000, 62_000, 64_000, 66_000, 68_000, 70_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 70_000 }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-trend-reversal'));
  });

  it('does NOT fire when fewer than 5 snapshots provided', () => {
    const snaps  = makeSnaps([60_000, 62_000, 64_000, 62_000]); // only 4
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 62_000 }), snaps });
    assert.ok(!detect().some((o) => o.id === 'obs-forecast-trend-reversal'));
  });

  it('obs-forecast-trend-reversal has severity info', () => {
    const snaps  = makeSnaps([60_000, 62_000, 64_000, 66_000, 68_000, 66_000]);
    const detect = freshDetect({ live: liveForecast({ eom_tonnes: 66_000 }), snaps });
    const obs    = detect().find((o) => o.id === 'obs-forecast-trend-reversal');
    assert.equal(obs?.severity, 'info');
  });
});

// ── Multiple anomalies ────────────────────────────────────────────────

describe('forecastAnomalies — multiple anomalies in one call', () => {
  it('can return both verdict-decay and sharp-drop simultaneously', () => {
    // Verdict worsens AND EOM drops sharply in the same call
    const snaps  = makeSnaps([65_000, 65_000], ['above_floor', 'above_floor']);
    const detect = freshDetect({
      live: liveForecast({ verdict: 'below_floor_at_pace', eom_tonnes: 63_000 }),
      snaps,
    });
    const ids = detect().map((o) => o.id);
    assert.ok(ids.includes('obs-forecast-verdict-decay'), 'verdict-decay missing');
    assert.ok(ids.includes('obs-forecast-sharp-drop'),   'sharp-drop missing');
  });

  it('returns no anomalies when everything looks healthy', () => {
    const snaps  = makeSnaps([65_000, 65_000, 65_100, 65_200, 65_300, 65_500],
      Array(6).fill('above_floor'));
    const detect = freshDetect({
      live: liveForecast({ verdict: 'above_floor', eom_tonnes: 65_600 }),
      snaps,
    });
    assert.equal(detect().length, 0);
  });
});
