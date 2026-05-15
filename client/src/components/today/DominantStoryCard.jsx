/*
 * DominantStoryCard — the one thing worth knowing this morning.
 * Headline, body, metric bar (delivered% vs floor%), named action.
 * Severity "warn" adds a left Bauxite Rust accent strip; "info" stays neutral.
 */

import { ArrowRight } from 'lucide-react';

export default function DominantStoryCard({ story }) {
  if (!story) return null;

  const accent = story.severity === 'warn';
  const { value_pct, floor_pct, label } = story.metric;
  const gap = Number((value_pct - floor_pct).toFixed(1));

  return (
    <section
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderLeft: accent ? '3px solid var(--bauxite-rust)' : '3px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div
        className="eyebrow"
        style={{
          color: accent ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
        }}
      >
        {accent ? 'Attention' : 'Corridor note'}
      </div>

      <h2
        style={{
          margin: 0,
          fontSize: 'var(--ts-h2-size)',
          lineHeight: 'var(--ts-h2-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}
      >
        {story.headline}
      </h2>

      <p
        style={{
          margin: 0,
          fontSize: 'var(--ts-body-size)',
          lineHeight: 'var(--ts-body-lh)',
          color: 'var(--text-secondary)',
          maxWidth: '72ch',
        }}
      >
        {story.body}
      </p>

      <div style={{ marginTop: 'var(--space-2)' }}>
        <MetricBar label={label} valuePct={value_pct} floorPct={floor_pct} />
        <div
          className="mono"
          style={{
            marginTop: 8,
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}
        >
          {value_pct.toFixed(1)}% delivered · Floor {floor_pct.toFixed(0)}% · {gap > 0 ? '+' : ''}{gap} pts
        </div>
      </div>

      <div
        style={{
          marginTop: 'var(--space-2)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
        }}
      >
        <ArrowRight size={16} strokeWidth={1.5} color="var(--bauxite-rust)" />
        <span style={{ fontWeight: 'var(--fw-medium)' }}>{story.action}</span>
      </div>
    </section>
  );
}

function MetricBar({ label, valuePct, floorPct }) {
  const width = Math.max(0, Math.min(100, valuePct));
  const floorPos = Math.max(0, Math.min(100, floorPct));
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          fontWeight: 'var(--fw-medium)',
          marginBottom: 6,
        }}
      >
        <span>{label}</span>
        <span>0% – 100%</span>
      </div>
      <div
        style={{
          position: 'relative',
          height: 8,
          background: 'var(--ash)',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: '0 auto 0 0',
            width: `${width}%`,
            background: width < floorPos ? 'var(--bauxite-rust)' : 'var(--signal-green)',
            transition: 'width 280ms ease-out',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${floorPos}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: 'var(--charcoal)',
          }}
        />
      </div>
    </div>
  );
}
