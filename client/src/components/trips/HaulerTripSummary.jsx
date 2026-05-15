/*
 * Phase 169 — per-hauler trip performance summary strip.
 * Horizontal scroll of hauler cards: trips, tonnes, avg cost/t, avg delay,
 * and margin %. Shown above the filter bar on the Trips page.
 */

const CORRIDOR_PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

function fmtUSD(v) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

export default function HaulerTripSummary({ haulerSummary }) {
  if (!haulerSummary?.length) return null;

  return (
    <div>
      <div style={{
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
        marginBottom: 'var(--space-2)',
      }}>
        Hauler performance · all trips
      </div>
      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        overflowX: 'auto',
        paddingBottom: 2,
      }}>
        {haulerSummary.map((h, i) => (
          <HaulerCard key={h.hauler_id} h={h} color={CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length]} />
        ))}
      </div>
    </div>
  );
}

function HaulerCard({ h, color }) {
  const marginPositive = (h.margin_pct ?? 0) >= 0;

  return (
    <div style={{
      minWidth: 200,
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      borderTop: `3px solid ${color}`,
      padding: 'var(--space-3)',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
        marginBottom: 'var(--space-2)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {h.hauler_display}
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
        <Stat label="Trips" value={h.trips} tabular />
        <Stat label="Tonnes" value={h.tonnes?.toLocaleString()} tabular />
        <Stat
          label="$/t avg"
          value={h.avg_cost_per_tonne != null ? `$${h.avg_cost_per_tonne}` : '—'}
          tabular
        />
        <Stat
          label="Avg delay"
          value={h.avg_delay_min > 0 ? `${h.avg_delay_min} min` : 'None'}
          tabular
          warn={h.avg_delay_min > 30}
        />
        <Stat
          label="Margin"
          value={fmtUSD(h.margin_usd)}
          tabular
          good={marginPositive}
          warn={!marginPositive}
        />
        <Stat
          label="Margin %"
          value={h.margin_pct != null ? `${h.margin_pct}%` : '—'}
          tabular
          good={marginPositive}
          warn={!marginPositive}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, tabular, good, warn }) {
  const color = good ? 'var(--signal-green)'
              : warn ? 'var(--bauxite-rust)'
              : 'var(--text)';
  return (
    <div>
      <div style={{
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--ts-body-sm-size)',
        fontVariantNumeric: tabular ? 'tabular-nums lining-nums' : 'normal',
        color,
        fontWeight: 'var(--fw-medium)',
      }}>
        {value ?? '—'}
      </div>
    </div>
  );
}
