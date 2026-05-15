/*
 * TrancheTimeline — horizontal timeline of the four tranches with status
 * chips, scaled stacks for trucks and CAPEX. Active tranche gets a
 * Bauxite Rust accent stripe; pending tranches stay neutral. Hover surfaces
 * gate progress. Click cycles selection so the gate checklist below jumps
 * to the matching tranche.
 */

const STATUS_TONE = {
  ACTIVE:  { bg: 'rgba(46, 107, 63, 0.12)',  fg: 'var(--signal-green)' },
  RAMP:    { bg: 'rgba(184, 134, 11, 0.12)', fg: 'var(--signal-amber)' },
  STEADY:  { bg: 'rgba(46, 107, 63, 0.12)',  fg: 'var(--signal-green)' },
  PENDING: { bg: 'var(--ash)',               fg: 'var(--iron)' },
};

export default function TrancheTimeline({ tranches, selectedId, onSelect }) {
  if (!tranches?.length) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow">Tranche programme</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          1.0 → 5.0 Mtpa across four CAPEX tranches. Drawdown is gated on the prior tranche's run-rate and DSCR.
        </div>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${tranches.length}, minmax(0, 1fr))`,
        gap: 'var(--space-3)',
      }}>
        {tranches.map((t, idx) => (
          <TrancheCard
            key={t.id}
            tranche={t}
            selected={t.id === selectedId}
            onSelect={() => onSelect?.(t.id)}
            isLast={idx === tranches.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

function TrancheCard({ tranche, selected, onSelect }) {
  const tone = STATUS_TONE[tranche.status] ?? STATUS_TONE.PENDING;
  const drawnPct = tranche.capex_usd > 0 ? (tranche.capex_drawn_usd / tranche.capex_usd) * 100 : 0;
  const accent = tranche.status === 'ACTIVE' ? 'var(--bauxite-rust)' : 'transparent';

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: selected ? 'var(--surface-sunk)' : 'var(--surface-raised)',
        border: '1px solid',
        borderColor: selected ? 'var(--border-strong)' : 'var(--border-hairline)',
        borderTopWidth: 3,
        borderTopColor: accent,
        borderRadius: 'var(--radius-md)',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="eyebrow">{tranche.name}</div>
        <span style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          background: tone.bg,
          color: tone.fg,
          fontSize: 'var(--ts-micro-size)',
          letterSpacing: 'var(--ts-micro-tracking)',
          textTransform: 'uppercase',
          fontWeight: 'var(--fw-medium)',
        }}>
          {tranche.status}
        </span>
      </div>

      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size)',
        lineHeight: 1,
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        {tranche.target_mtpa.toFixed(1)} <span className="mono" style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>Mtpa</span>
      </div>

      <Row label="Trucks"   value={`${tranche.trucks}`} />
      <Row label="CAPEX"    value={`$${(tranche.capex_usd / 1_000_000).toFixed(0)}M`} />
      <Row label="Drawn"    value={`$${(tranche.capex_drawn_usd / 1_000_000).toFixed(1)}M`} sub={`${drawnPct.toFixed(0)}%`} />
      <Row label="Gates"    value={`${tranche.gates_met} / ${tranche.gates_total}`} />

      <div style={{
        height: 4,
        background: 'var(--surface-sunk)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${(tranche.gates_met / tranche.gates_total) * 100}%`,
          height: 4,
          background: tranche.all_gates_met ? 'var(--signal-green)' : 'var(--bauxite-rust)',
        }} />
      </div>

      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        lineHeight: 1.4,
      }}>
        {tranche.status_detail}
      </div>
    </button>
  );
}

function Row({ label, value, sub }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        {label}
      </span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
        {sub && <span className="mono" style={{ marginLeft: 6, color: 'var(--text-tertiary)', fontSize: 10 }}>{sub}</span>}
      </span>
    </div>
  );
}
