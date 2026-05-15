/*
 * Phase 174 — hauler fleet composition share chart.
 * Single segmented horizontal bar where each hauler occupies their
 * contracted-truck share of the corridor fleet. Stats grid below.
 */

const CORRIDOR_PALETTE = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

export default function HaulerFleetShareChart({ haulers }) {
  if (!haulers?.length) return null;

  const active = haulers.filter((h) => h.status === 'active' && h.share_pct > 0);
  if (!active.length) return null;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        fontSize: 'var(--ts-micro-size)',
        letterSpacing: 'var(--ts-micro-tracking)',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)',
        fontWeight: 'var(--fw-medium)',
        marginBottom: 'var(--space-3)',
      }}>
        Fleet composition · contracted trucks · corridor share
      </div>

      {/* Segmented share bar */}
      <div style={{
        display: 'flex',
        height: 28,
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        marginBottom: 'var(--space-3)',
      }}>
        {active.map((h, i) => (
          <div
            key={h.id}
            title={`${h.display_name} · ${h.share_pct}%`}
            style={{
              width: `${h.share_pct}%`,
              background: CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length],
              opacity: 0.82,
              transition: 'opacity 150ms',
              cursor: 'default',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.82'; }}
          />
        ))}
      </div>

      {/* Per-hauler legend + stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(active.length, 3)}, minmax(0, 1fr))`,
        gap: 'var(--space-3)',
      }}>
        {active.map((h, i) => {
          const color = CORRIDOR_PALETTE[i % CORRIDOR_PALETTE.length];
          return (
            <div key={h.id} style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              borderLeft: `3px solid ${color}`,
              paddingLeft: 'var(--space-2)',
            }}>
              <div style={{
                fontSize: 'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--text)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {h.display_name}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <Stat
                  label="Share"
                  value={`${h.share_pct}%`}
                  color={color}
                />
                <Stat
                  label="Trucks"
                  value={h.fleet?.contracted_trucks ?? '—'}
                />
                <Stat
                  label="Active"
                  value={h.fleet?.active_trucks ?? '—'}
                  good={(h.fleet?.active_trucks ?? 0) >= (h.fleet?.contracted_trucks ?? 0) * 0.75}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, color, good }) {
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
        fontSize: 'var(--ts-caption-size)',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 'var(--fw-medium)',
        color: color ?? (good ? 'var(--signal-green)' : 'var(--text)'),
      }}>
        {value}
      </div>
    </div>
  );
}
