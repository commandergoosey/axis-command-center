/*
 * Phase 222 — HaulerCostRankChart
 * Horizontal BarChart ranking haulers by average cost per tonne (USD/t).
 * Sorted cheapest-first so the most efficient hauler leads. A corridor
 * average ReferenceLine lets ops spot which haulers are above/below the mean.
 * Cell colour: green at or below corridor avg, amber within +10%, rust above.
 * Derived from TRIPS mock — no MODELLED badge (real trip cost data).
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function shortName(display) {
  return display?.replace(/\s+(Haulage|Transport|Logistics|Ltd\.?|Limited)$/i, '') ?? display;
}

const FMT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
        {d.hauler_display}
      </div>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
        {d.trips} trip{d.trips !== 1 ? 's' : ''} analysed
      </div>
      <div style={{ fontWeight: 'var(--fw-medium)', color: payload[0].fill, marginTop: 4 }}>
        {FMT_USD.format(d.avg_cost_per_tonne)} / t
      </div>
    </div>
  );
};

export default function HaulerCostRankChart({ costPerTonneRank }) {
  if (!costPerTonneRank?.length) return null;

  const corridorAvg = costPerTonneRank.length > 0
    ? Number((costPerTonneRank.reduce((s, h) => s + h.avg_cost_per_tonne, 0) / costPerTonneRank.length).toFixed(2))
    : 0;

  function cellColor(cost) {
    if (cost <= corridorAvg) return 'var(--signal-green)';
    if (cost <= corridorAvg * 1.10) return 'var(--signal-amber)';
    return 'var(--bauxite-rust)';
  }

  const data = costPerTonneRank.map((h) => ({
    ...h,
    name: shortName(h.hauler_display),
  }));

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
            Hauler cost efficiency
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Avg cost per tonne · all trips · USD/t · cheapest-first
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
            lineHeight: 1,
          }}>
            {FMT_USD.format(corridorAvg)}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            corridor avg / t
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 48)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
          barSize={20}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            tickFormatter={(v) => `$${v.toFixed(2)}`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={axisTick}
            width={100}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine
            x={corridorAvg}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            strokeWidth={1}
            label={{
              value: 'avg',
              position: 'insideTopRight',
              fontSize: 10,
              fill: 'var(--text-tertiary)',
            }}
          />
          <Bar dataKey="avg_cost_per_tonne" name="Cost / tonne (USD)" radius={[0, 3, 3, 0]}>
            {data.map((h) => (
              <Cell key={h.hauler_id} fill={cellColor(h.avg_cost_per_tonne)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
