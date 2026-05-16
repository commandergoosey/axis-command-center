/*
 * DieselMonthlyCostChart — Phase 227.
 * 6-month corridor total diesel cost trend (USD). Combines modelled
 * monthly fuel price with fleet size and average burn rate to estimate
 * total corridor diesel spend per month. Useful for spotting seasonal
 * cost spikes and tracking budget vs actual over the half-year.
 * MODELLED — all months use seeded estimates.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: '0.07em',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(184,134,11,0.10)',
    color: 'var(--signal-amber)',
    border: '1px solid rgba(184,134,11,0.22)',
    verticalAlign: 'middle',
    marginLeft: 6,
  }}>MODELLED</span>
);

function fmtMonth(iso) {
  // iso = "2026-04"
  const [year, mon] = iso.split('-');
  const d = new Date(Date.UTC(+year, +mon - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function fmtUsd(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 2 }}>{fmtMonth(d.month)}</div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Total diesel cost: <strong>{fmtUsd(d.cost_usd)}</strong>
      </div>
      {d.modelled && (
        <div style={{ color: 'var(--text-tertiary)', marginTop: 2, fontSize: 10 }}>Modelled estimate</div>
      )}
    </div>
  );
};

export default function DieselMonthlyCostChart({ monthlyCostTrend }) {
  if (!monthlyCostTrend?.length) return null;

  const max = Math.max(...monthlyCostTrend.map((m) => m.cost_usd));
  const min = Math.min(...monthlyCostTrend.map((m) => m.cost_usd));
  const avg = Math.round(monthlyCostTrend.reduce((s, m) => s + m.cost_usd, 0) / monthlyCostTrend.length);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 'var(--ts-body-size)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--text)',
            }}>
              6-month corridor diesel cost
            </span>
            {MODELLED}
          </div>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            Estimated total monthly diesel spend across all contracted trucks. Combines
            NPA pump price, fleet L/100km efficiency, and trip volume.
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 2 }}>6-MO AVG</div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
          }}>
            {fmtUsd(avg)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            range {fmtUsd(min)}–{fmtUsd(max)}
          </div>
        </div>
      </header>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={monthlyCostTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="dieselCostGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--bauxite-rust)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="var(--bauxite-rust)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonth}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtUsd}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="cost_usd"
            stroke="var(--bauxite-rust)"
            strokeWidth={2}
            fill="url(#dieselCostGrad)"
            dot={false}
            activeDot={{ r: 4, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
