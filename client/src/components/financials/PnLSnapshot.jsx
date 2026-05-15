/*
 * PnLSnapshot — two-column P&L (MTD · YTD). Plain table treatment; the
 * reader's eye falls on EBITDA and net-income rows. EBITDA margin gets a
 * small caption beside the dollar figure.
 */

import ModelledTag from '../primitives/ModelledTag';

const ROWS = [
  { key: 'revenue_usd',        label: 'Revenue',            emphasis: true  },
  { key: 'operating_costs_usd', label: 'Operating costs',    negative: true },
  { key: 'ebitda_usd',         label: 'EBITDA',             emphasis: true, marginKey: 'ebitda_margin_pct' },
  { key: 'depreciation_usd',   label: 'Depreciation',       negative: true },
  { key: 'interest_usd',       label: 'Interest',           negative: true },
  { key: 'ebit_usd',           label: 'EBIT',               emphasis: true },
  { key: 'net_income_usd',     label: 'Net income',         emphasis: true, last: true },
];

export default function PnLSnapshot({ pnl }) {
  if (!pnl) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Profit &amp; loss snapshot</div>
        <ModelledTag />
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 1fr 1fr',
        gap: 'var(--space-3)',
        alignItems: 'baseline',
      }}>
        <div />
        <HeaderCell label={pnl.mtd.period} />
        <HeaderCell label={pnl.ytd.period} />
      </div>

      <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column' }}>
        {ROWS.map((r) => (
          <Row
            key={r.key}
            label={r.label}
            mtd={pnl.mtd[r.key]}
            ytd={pnl.ytd[r.key]}
            mtdSub={r.marginKey ? `${pnl.mtd[r.marginKey].toFixed(1)}% margin` : null}
            ytdSub={r.marginKey ? `${pnl.ytd[r.marginKey].toFixed(1)}% margin` : null}
            emphasis={r.emphasis}
            negative={r.negative}
            last={r.last}
          />
        ))}
      </div>
    </section>
  );
}

function HeaderCell({ label }) {
  return (
    <div className="mono" style={{
      fontSize: 10,
      textAlign: 'right',
      color: 'var(--text-tertiary)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>
      {label}
    </div>
  );
}

function Row({ label, mtd, ytd, mtdSub, ytdSub, emphasis, negative, last }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr 1fr',
      gap: 'var(--space-3)',
      alignItems: 'baseline',
      padding: '10px 0',
      borderTop: '1px solid var(--border-hairline)',
      borderBottom: last ? '1px solid var(--border-hairline)' : 'none',
    }}>
      <span style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: emphasis ? 'var(--text)' : 'var(--text-secondary)',
        fontWeight: emphasis ? 'var(--fw-medium)' : 'var(--fw-regular)',
      }}>
        {label}
      </span>
      <Money value={mtd} sub={mtdSub} emphasis={emphasis} negative={negative} />
      <Money value={ytd} sub={ytdSub} emphasis={emphasis} negative={negative} />
    </div>
  );
}

function Money({ value, sub, emphasis, negative }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="tabular" style={{
        fontSize: emphasis ? 'var(--ts-body-size)' : 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: emphasis ? 'var(--fw-medium)' : 'var(--fw-regular)',
      }}>
        {negative ? '(' : ''}${(value / 1000).toFixed(1)}k{negative ? ')' : ''}
      </div>
      {sub && (
        <div className="mono" style={{
          fontSize: 10,
          color: 'var(--text-tertiary)',
          marginTop: 2,
          letterSpacing: '0.04em',
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}
