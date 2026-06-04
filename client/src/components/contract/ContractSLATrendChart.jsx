/*
 * Phase 223 — ContractSLATrendChart
 * LineChart showing 6-month SLA attainment % trend against the contract
 * target threshold (85%). Months below target are rendered in rust;
 * months at or above are green. A ReferenceLine at the SLA target makes
 * the floor immediately visible.
 * MODELLED badge per §12.4 — figures are seeded estimates.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(100,100,100,0.08)',
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 'var(--fw-medium)',
    textTransform: 'uppercase',
    verticalAlign: 'middle',
    marginLeft: 6,
  }}>
    MODELLED
  </span>
);

function shortMonth(iso) {
  const [y, m] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

const CustomDot = ({ cx, cy, payload }) => {
  const color = payload.attainment_pct >= payload.target_pct
    ? 'var(--signal-green)'
    : 'var(--bauxite-rust)';
  return <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface-raised)" strokeWidth={2} />;
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const pass = d.attainment_pct >= d.target_pct;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: 'var(--text-secondary)', marginBottom: 2 }}>
        <span>SLA attainment</span>
        <span className="mono" style={{ color: pass ? 'var(--signal-green)' : 'var(--bauxite-rust)', fontWeight: 'var(--fw-medium)' }}>
          {d.attainment_pct}%
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: 'var(--text-secondary)' }}>
        <span>Target</span>
        <span className="mono">{d.target_pct}%</span>
      </div>
      <div style={{ marginTop: 6, fontSize: 'var(--ts-caption-size)', color: pass ? 'var(--signal-green)' : 'var(--bauxite-rust)' }}>
        {pass ? 'Above SLA target' : `${d.target_pct - d.attainment_pct}pp below target`}
      </div>
    </div>
  );
};

export default function ContractSLATrendChart({ slaMonthlyTrend }) {
  if (!slaMonthlyTrend?.length) return null;

  const data = slaMonthlyTrend.map((m) => ({ ...m, month_label: shortMonth(m.month) }));
  const latest = slaMonthlyTrend[slaMonthlyTrend.length - 1];
  const target  = latest?.target_pct ?? 85;

  const aboveTarget = data.filter((d) => d.attainment_pct >= target).length;
  const trend6m     = data[data.length - 1]?.attainment_pct ?? 0;

  const axisTick = {
    fontSize: 'var(--ts-caption-size)',
    fill: 'var(--text-tertiary)',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
            marginBottom: 2,
          }}>
            SLA attainment trend{MODELLED}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            6 months · corridor delivery SLA · {target}% contract target
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: trend6m >= target ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            lineHeight: 1,
          }}>
            {trend6m}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            current month · {aboveTarget}/{data.length} above target
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="month_label"
            tick={axisTick}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            domain={[60, 100]}
            tickFormatter={(v) => `${v}%`}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={target}
            stroke="var(--bauxite-rust)"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{
              value: `SLA ${target}%`,
              position: 'insideTopRight',
              fontSize: 10,
              fill: 'var(--bauxite-rust)',
            }}
          />
          <Line
            type="monotone"
            dataKey="attainment_pct"
            name="SLA attainment"
            stroke="var(--charcoal)"
            strokeWidth={2}
            dot={<CustomDot />}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
