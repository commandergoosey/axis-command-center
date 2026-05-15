/*
 * SLAMeter — three stacked meters for loading, offloading, and cycle
 * completion attainment. Target is 90% on all three (BRIEF); bars below
 * target tint Bauxite Rust, above Signal Green.
 */

const TARGET_PCT = 90;

export default function SLAMeter({ sla }) {
  if (!sla) return null;
  const rows = [
    { label: 'Loading on-time',     value: sla.loading_on_time_pct },
    { label: 'Offloading on-time',  value: sla.offloading_on_time_pct },
    { label: 'Cycle completion',    value: sla.cycle_completion_pct },
  ];

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow">SLA attainment</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          Target {TARGET_PCT}% on each measure.
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {rows.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
      </div>

      {sla.notes && (
        <div style={{
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
        }}>
          {sla.notes}
        </div>
      )}
    </section>
  );
}

function Row({ label, value }) {
  const hit = value >= TARGET_PCT;
  const color = hit ? 'var(--signal-green)' : 'var(--bauxite-rust)';
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
          {label}
        </span>
        <span className="tabular" style={{
          fontSize: 'var(--ts-body-size)',
          fontWeight: 'var(--fw-medium)',
          color,
        }}>
          {value.toFixed(1)}%
        </span>
      </div>
      <div style={{
        position: 'relative',
        height: 6,
        background: 'var(--surface-sunk)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: color,
        }} />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -2, bottom: -2,
            left: `${TARGET_PCT}%`,
            width: 1,
            background: 'var(--charcoal)',
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}
