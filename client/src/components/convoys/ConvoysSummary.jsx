/*
 * ConvoysSummary — 4 KPI tiles + phase-count strip above the convoy table.
 * Numbers are live (not MODELLED) — they derive from active roster + mock
 * convoys that would be real telemetry under the live adapter in Phase 9.
 */

export default function ConvoysSummary({ summary }) {
  if (!summary) return null;
  const { active_convoys, trucks_moving, avg_cycle_h, on_schedule, delayed, phase_counts } = summary;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Stat label="Active convoys"  value={active_convoys} />
        <Stat label="Trucks moving"   value={trucks_moving} suffix="trk" />
        <Stat label="Avg cycle"       value={avg_cycle_h != null ? avg_cycle_h.toFixed(1) : '—'} suffix="h" />
        <Stat
          label="On schedule"
          value={`${on_schedule}`}
          suffix={`of ${on_schedule + delayed}`}
          tone={delayed > 0 ? 'warn' : 'ok'}
        />
      </div>

      <PhaseStrip counts={phase_counts} />
    </section>
  );
}

function Stat({ label, value, suffix, tone }) {
  const valueColor = tone === 'warn' ? 'var(--bauxite-rust)' : 'var(--text)';
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className="tabular" style={{
          fontSize: 'var(--ts-stat-size)',
          lineHeight: 'var(--ts-stat-lh)',
          fontWeight: 'var(--fw-medium)',
          color: valueColor,
        }}>
          {value}
        </span>
        {suffix && (
          <span style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

const PHASE_ORDER = ['laden', 'empty', 'loading', 'offload'];
const PHASE_COLOR = {
  laden:   'var(--bauxite-rust)',
  empty:   'var(--iron)',
  loading: 'var(--signal-amber)',
  offload: 'var(--charcoal)',
};

function PhaseStrip({ counts }) {
  const entries = PHASE_ORDER
    .map((p) => ({ phase: p, value: counts?.[p] ?? 0 }))
    .filter((e) => e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (!total) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="eyebrow">Fleet posture</div>
        <span className="mono" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {total} trucks
        </span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-sunk)' }}>
        {entries.map((e) => (
          <div
            key={e.phase}
            style={{
              flex: e.value,
              background: PHASE_COLOR[e.phase],
            }}
            title={`${e.phase} · ${e.value}`}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {entries.map((e) => (
          <span key={e.phase} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            textTransform: 'capitalize',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: PHASE_COLOR[e.phase],
              flexShrink: 0,
            }} />
            {e.phase} · <span className="tabular" style={{ color: 'var(--text)' }}>{e.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
