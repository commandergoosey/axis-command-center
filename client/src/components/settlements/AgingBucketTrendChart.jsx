/*
 * Phase 216 — AgingBucketTrendChart
 * Stacked area chart showing 8 weeks of outstanding receivables split across
 * aging buckets: current, 30–60d, 60–90d, and 90d+. A rising 90d+ tail
 * signals a collection deterioration before it hits the headline balance.
 * MODELLED badge per §12.4 — all figures are seeded estimates.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
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

const FMT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

function shortWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
      minWidth: 200,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6, color: 'var(--text)' }}>
        {label}
      </div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: 'var(--text-secondary)', marginBottom: 2,
        }}>
          <span>{p.name}</span>
          <span className="mono">{FMT_USD.format(p.value)}</span>
        </div>
      ))}
      <div style={{
        borderTop: '1px solid var(--border-hairline)', marginTop: 6, paddingTop: 6,
        display: 'flex', justifyContent: 'space-between', gap: 16,
        fontWeight: 'var(--fw-medium)', color: 'var(--text)',
      }}>
        <span>Total outstanding</span>
        <span className="mono">{FMT_USD.format(total)}</span>
      </div>
    </div>
  );
};

export default function AgingBucketTrendChart({ agingTrend }) {
  if (!agingTrend?.length) return null;

  const data = agingTrend.map((w) => ({
    ...w,
    week: shortWeek(w.week_of),
  }));

  const latest = agingTrend[agingTrend.length - 1];
  const latestTotal = (latest?.current_usd ?? 0) + (latest?.d30_usd ?? 0) +
                      (latest?.d60_usd ?? 0) + (latest?.d90plus_usd ?? 0);

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
            Aging bucket trend{MODELLED}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            8 weeks · outstanding receivables by age band · USD
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
            lineHeight: 1,
          }}>
            {FMT_USD.format(latestTotal)}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            current week
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <defs>
            <linearGradient id="agingCurrent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--signal-green)"  stopOpacity={0.30} />
              <stop offset="95%" stopColor="var(--signal-green)"  stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="aging30" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--signal-amber)"  stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--signal-amber)"  stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="aging60" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--bauxite-rust)"  stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--bauxite-rust)"  stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="aging90" x1="0" y1="0" x2="0" y2="1">
              <stop offset="10%" stopColor="var(--bauxite-rust)"  stopOpacity={0.60} />
              <stop offset="95%" stopColor="var(--bauxite-rust)"  stopOpacity={0.12} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="square"
            iconSize={10}
            wrapperStyle={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}
          />
          <Area
            type="monotone"
            dataKey="current_usd"
            name="Current"
            stackId="a"
            stroke="var(--signal-green)"
            strokeWidth={1.5}
            fill="url(#agingCurrent)"
          />
          <Area
            type="monotone"
            dataKey="d30_usd"
            name="30–60 d"
            stackId="a"
            stroke="var(--signal-amber)"
            strokeWidth={1.5}
            fill="url(#aging30)"
          />
          <Area
            type="monotone"
            dataKey="d60_usd"
            name="60–90 d"
            stackId="a"
            stroke="var(--bauxite-rust)"
            strokeWidth={1.5}
            fill="url(#aging60)"
          />
          <Area
            type="monotone"
            dataKey="d90plus_usd"
            name="90 d+"
            stackId="a"
            stroke="var(--bauxite-rust)"
            strokeWidth={2}
            fill="url(#aging90)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
