/*
 * RunRatePanel — Phase 135.
 * Required daily run-rate to stay above the take-or-pay floor.
 * Reads data.mtd fields added in Phase 135 (server):
 *   required_daily_rate, current_daily_rate, days_remaining,
 *   tonnes_needed, projected_total, pace (AHEAD | ON_TRACK | AT_RISK)
 */

const PACE_META = {
  AHEAD:    {
    label:  'Ahead of pace',
    color:  'var(--signal-green)',
    bg:     'rgba(74,222,128,0.08)',
    border: 'rgba(74,222,128,0.28)',
  },
  ON_TRACK: {
    label:  'On track',
    color:  'var(--signal-amber)',
    bg:     'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.28)',
  },
  AT_RISK:  {
    label:  'At risk',
    color:  'var(--bauxite-rust)',
    bg:     'rgba(139,46,26,0.08)',
    border: 'rgba(139,46,26,0.28)',
  },
};

export default function RunRatePanel({ mtd }) {
  if (!mtd) return null;

  const {
    required_daily_rate = 0,
    current_daily_rate  = 0,
    days_remaining      = 0,
    tonnes_needed       = 0,
    projected_total     = 0,
    pace                = 'ON_TRACK',
  } = mtd;

  const meta   = PACE_META[pace] ?? PACE_META.ON_TRACK;
  const maxRate = Math.max(required_daily_rate, current_daily_rate, 1);
  const reqPct  = Number(((required_daily_rate / maxRate) * 100).toFixed(1));
  const curPct  = Number(((current_daily_rate  / maxRate) * 100).toFixed(1));

  return (
    <div
      style={{
        background:   'var(--surface-raised)',
        border:       `1px solid ${meta.border}`,
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
        display:      'flex',
        flexDirection:'column',
        gap:          'var(--space-4)',
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div className="eyebrow">Daily run-rate to floor</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: '3px 8px',
              background: meta.bg,
              border: `1px solid ${meta.border}`,
              borderRadius: 3,
              color: meta.color,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            {meta.label}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: '2px 6px',
              border: '1px solid rgba(245,241,236,0.18)',
              borderRadius: 3,
              color: 'var(--text-tertiary)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            MODELLED
          </span>
        </div>
      </div>

      {/* ── Rate comparison bars ────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <RateBar
          label="Current run-rate"
          value={current_daily_rate}
          pct={curPct}
          color={meta.color}
        />
        <RateBar
          label="Required to clear floor"
          value={required_daily_rate}
          pct={reqPct}
          color="var(--text-tertiary)"
          dashed
        />
      </div>

      {/* ── Stat tiles ─────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
      }}>
        <Stat
          label="Days remaining"
          value={days_remaining}
          unit="d"
        />
        <Stat
          label="Tonnes still needed"
          value={tonnes_needed > 0
            ? new Intl.NumberFormat('en-GB').format(tonnes_needed)
            : '—'}
          unit={tonnes_needed > 0 ? 't' : ''}
        />
        <Stat
          label="Projected at pace"
          value={new Intl.NumberFormat('en-GB').format(projected_total)}
          unit="t"
        />
      </div>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────── */

function RateBar({ label, value, pct, color, dashed }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {label}
        </span>
        <span
          className="tabular"
          style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color,
          }}
        >
          {value.toLocaleString('en-GB')} t/day
        </span>
      </div>
      <div style={{
        height: 4,
        background: 'var(--border-hairline)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: dashed
            ? `repeating-linear-gradient(
                90deg,
                var(--text-tertiary) 0,
                var(--text-tertiary) 4px,
                transparent 4px,
                transparent 8px
              )`
            : color,
          borderRadius: 2,
          transition: 'width 600ms ease',
        }} />
      </div>
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        {value}
        {unit && (
          <span style={{
            marginLeft: 2,
            fontWeight: 'var(--fw-normal)',
            color: 'var(--text-secondary)',
            fontSize: 11,
          }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
