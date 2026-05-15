/*
 * ForecastAnomalyStrip — Phase 151.
 * Surfaces forecast anomaly alerts detected by the server-side
 * forecastAnomalies service. Three anomaly classes:
 *   - Verdict transition   (warn)  — projection moved into a worse bucket
 *   - Sharp single-day drop (warn) — EOM fell ≥3% in 24h
 *   - Trend reversal       (info)  — was climbing, now falling
 *
 * Returns null when the anomalies array is empty (baseline, no history,
 * or everything looks healthy). Shown on the Contract page beneath
 * the RunRatePanel so ops sees contract stress signals in one scroll.
 *
 * Props:
 *   anomalies — anomalies array from /api/contract
 */

import { AlertTriangle, Info } from 'lucide-react';

const SEVERITY_META = {
  warn: {
    color:  'var(--signal-amber)',
    bg:     'rgba(251,191,36,0.05)',
    border: 'rgba(251,191,36,0.25)',
    Icon:   AlertTriangle,
  },
  info: {
    color:  'var(--text-secondary)',
    bg:     'var(--surface-raised)',
    border: 'var(--border-hairline)',
    Icon:   Info,
  },
};

export default function ForecastAnomalyStrip({ anomalies }) {
  if (!anomalies || anomalies.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Forecast anomalies</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {anomalies.length} signal{anomalies.length !== 1 ? 's' : ''} detected
        </span>
      </div>

      <div style={{
        display:       'flex',
        flexDirection: 'column',
        gap:           'var(--space-2)',
      }}>
        {anomalies.map((a) => {
          const meta = SEVERITY_META[a.severity] ?? SEVERITY_META.info;
          const { Icon } = meta;
          return (
            <div
              key={a.id}
              style={{
                display:      'flex',
                gap:          'var(--space-3)',
                padding:      'var(--space-3) var(--space-4)',
                background:   meta.bg,
                border:       `1px solid ${meta.border}`,
                borderLeft:   `3px solid ${meta.color}`,
                borderRadius: 'var(--radius-md)',
                alignItems:   'flex-start',
              }}
            >
              <Icon
                size={13}
                strokeWidth={1.8}
                color={meta.color}
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <p style={{
                margin:     0,
                fontSize:   'var(--ts-body-sm-size)',
                color:      'var(--text)',
                lineHeight: 1.5,
              }}>
                {a.body}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
