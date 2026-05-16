/*
 * EbitdaBridgeChart — Phase 200.
 * Waterfall-style chart showing the movement from the prior full month's
 * EBITDA to the current MTD figure, decomposed into revenue change and
 * cost change contributions. Helps the lender see at a glance whether
 * a margin shift is demand-driven or cost-driven.
 *
 * Data: data.ebitda_bridge from GET /api/financials.
 * Shape: { prior_month, current_month, prior_ebitda, current_ebitda,
 *          revenue_delta, cost_delta, net_delta, is_partial, modelled }
 *
 * Note on cost_delta: a *positive* cost_delta means costs rose (EBITDA hurt),
 * so EBITDA impact = −cost_delta. We render it that way in the bridge.
 */

const MODELLED_BADGE = (
  <span style={{
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(139,46,26,0.10)',
    color: 'var(--bauxite-rust)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    textTransform: 'uppercase',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function fmt(n) {
  if (n == null) return '—';
  const abs = Math.abs(Math.round(n));
  return `${n < 0 ? '−' : ''}$${abs.toLocaleString()}`;
}

function shortMonth(m) {
  if (!m) return '—';
  const [y, mo] = m.split('-');
  return new Date(Date.UTC(+y, +mo - 1, 1))
    .toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function BridgeBar({ label, value, sub, isStart, isEnd }) {
  const isPositive = value >= 0;
  const absVal     = Math.abs(value);
  const color = isStart || isEnd
    ? 'var(--bauxite-rust)'
    : isPositive
      ? 'var(--signal-green)'
      : 'var(--signal-red, var(--bauxite-rust))';
  const bgColor = isStart || isEnd
    ? 'rgba(139,46,26,0.12)'
    : isPositive
      ? 'rgba(22,163,74,0.10)'
      : 'rgba(139,46,26,0.08)';
  const prefix = (isStart || isEnd) ? '' : isPositive ? '+' : '−';

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 6,
    }}>
      <div className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        color,
      }}>
        {prefix}{fmt(absVal)}
      </div>
      <div style={{
        width: '100%',
        minHeight: 48,
        background: bgColor,
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-sm)',
        opacity: 0.9,
      }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          {label}
        </div>
        {sub && (
          <div style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            marginTop: 2,
          }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div style={{
      alignSelf: 'center',
      paddingBottom: 32,
      color: 'var(--text-tertiary)',
      fontSize: 14,
      fontWeight: 400,
    }}>
      →
    </div>
  );
}

export default function EbitdaBridgeChart({ ebitdaBridge }) {
  if (!ebitdaBridge) return null;

  const {
    prior_month, current_month,
    prior_ebitda, current_ebitda,
    revenue_delta, cost_delta, net_delta,
    is_partial,
  } = ebitdaBridge;

  // EBITDA impact of cost: rising costs hurt EBITDA (negate)
  const costImpact = -(cost_delta ?? 0);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span className="eyebrow">EBITDA bridge</span>
          {MODELLED_BADGE}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          {shortMonth(prior_month)} → {shortMonth(current_month)}{is_partial ? ' (MTD)' : ''}
        </span>
      </header>

      <div style={{ padding: 'var(--space-4)' }}>
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          alignItems: 'stretch',
        }}>
          <BridgeBar
            label={shortMonth(prior_month)}
            value={prior_ebitda}
            sub="Prior month"
            isStart
          />
          <Arrow />
          <BridgeBar
            label="Revenue"
            value={revenue_delta}
            sub={revenue_delta > 0 ? 'Volume / rate ↑' : 'Volume / rate ↓'}
          />
          <Arrow />
          <BridgeBar
            label="Costs"
            value={costImpact}
            sub={costImpact >= 0 ? 'Cost reduction' : 'Cost pressure'}
          />
          <Arrow />
          <BridgeBar
            label={`${shortMonth(current_month)}${is_partial ? ' MTD' : ''}`}
            value={current_ebitda}
            sub={`Net ${net_delta >= 0 ? '+' : ''}${fmt(net_delta)}`}
            isEnd
          />
        </div>

        {/* Summary line */}
        <div style={{
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          gap: 'var(--space-5)',
          flexWrap: 'wrap',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        }}>
          <span style={{ color: 'var(--text-tertiary)' }}>
            Revenue delta <span style={{ color: revenue_delta >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)', fontWeight: 500 }}>
              {revenue_delta >= 0 ? '+' : ''}{fmt(revenue_delta)}
            </span>
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            Cost delta <span style={{ color: cost_delta > 0 ? 'var(--bauxite-rust)' : 'var(--signal-green)', fontWeight: 500 }}>
              {cost_delta > 0 ? '+' : ''}{fmt(cost_delta)}
            </span>
          </span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            Net EBITDA movement <span style={{ color: net_delta >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)', fontWeight: 500 }}>
              {net_delta >= 0 ? '+' : ''}{fmt(net_delta)}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
