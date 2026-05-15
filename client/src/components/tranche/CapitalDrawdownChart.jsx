/*
 * Phase 177 — capital drawdown chart.
 * ComposedChart: stacked bars (debt drawn + equity drawn per month),
 * plus reference lines for total committed and total drawdown target.
 * Uses data?.capital?.series from /api/tranches — no server change needed.
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function monthLabel(iso) {
  const [y, m] = iso.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function fmtM(v) {
  if (v == null) return '—';
  return `$${(v / 1_000_000).toFixed(1)}M`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const total = (d?.debt_drawn_usd ?? 0) + (d?.equity_drawn_usd ?? 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>{monthLabel(label)}</div>
      <Row label="Debt drawn"   value={fmtM(d?.debt_drawn_usd)}   color="var(--bauxite-rust)" />
      <Row label="Equity drawn" value={fmtM(d?.equity_drawn_usd)} color="var(--signal-amber)" />
      <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 4, marginTop: 4 }}>
        <Row label="Month total" value={fmtM(total)} color="var(--text)" bold />
      </div>
    </div>
  );
}

function Row({ label, value, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 'var(--fw-medium)' : 'normal', color }}>
        {value}
      </span>
    </div>
  );
}

export default function CapitalDrawdownChart({ capital }) {
  const series = capital?.series;
  if (!series?.length) return null;

  const debtCommitted   = capital?.debt_committed_usd ?? 0;
  const equityCommitted = capital?.equity_committed_usd ?? 0;
  const totalCommitted  = debtCommitted + equityCommitted;
  const totalDrawn      = (capital?.debt_drawn_usd ?? 0) + (capital?.equity_drawn_usd ?? 0);
  const drawPct         = totalCommitted > 0
    ? Math.round(totalDrawn / totalCommitted * 100) : 0;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Capital drawdown · Tranche 1 · debt + equity
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <span style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-black)', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtM(totalDrawn)}
            </span>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              drawn of {fmtM(totalCommitted)} committed · {drawPct}% utilisation
            </span>
          </div>
        </div>
        {/* Progress pill */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 4 }}>Utilisation</div>
          <div style={{
            width: 120,
            height: 6,
            background: 'var(--border-soft)',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${drawPct}%`,
              height: '100%',
              background: drawPct >= 80 ? 'var(--bauxite-rust)' : drawPct >= 50 ? 'var(--signal-amber)' : 'var(--signal-green)',
              borderRadius: 3,
            }} />
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={monthLabel}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${Math.round(v / 1_000_000)}M`}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={38}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={totalCommitted / series.length}
            stroke="var(--border-soft)"
            strokeDasharray="4 3"
            strokeOpacity={0.5}
          />
          <Bar dataKey="debt_drawn_usd"   stackId="drawn" fill="var(--bauxite-rust)" fillOpacity={0.75} name="Debt" barSize={24} />
          <Bar dataKey="equity_drawn_usd" stackId="drawn" fill="var(--signal-amber)" fillOpacity={0.75} name="Equity" barSize={24} radius={[3,3,0,0]} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Footer stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
      }}>
        <FooterStat label="Debt committed"   value={fmtM(debtCommitted)}   sub={`Drawn: ${fmtM(capital?.debt_drawn_usd)}`}   color="var(--bauxite-rust)" />
        <FooterStat label="Equity committed" value={fmtM(equityCommitted)} sub={`Drawn: ${fmtM(capital?.equity_drawn_usd)}`} color="var(--signal-amber)" />
        <FooterStat label="Remaining"        value={fmtM(totalCommitted - totalDrawn)} sub="Available to draw" color="var(--signal-green)" />
      </div>
    </div>
  );
}

function FooterStat({ label, value, sub, color }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--ts-micro-size)', letterSpacing: 'var(--ts-micro-tracking)', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}
