/*
 * Phase 221 — CompositeScoreHistogram
 * Bar histogram showing how many drivers fall in each composite score band
 * (0–20, 20–40, 40–60, 60–80, 80–100). Derived client-side from the
 * existing `rankings` array — no server change required.
 * Colour: top two bands (60–80, 80–100) in green; middle (40–60) amber;
 * bottom two (0–40) rust. Gives ops an instant read of fleet health distribution.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const BANDS = [
  { label: '0–20',  min: 0,  max: 20,  fill: 'var(--bauxite-rust)'  },
  { label: '20–40', min: 20, max: 40,  fill: 'var(--bauxite-rust)'  },
  { label: '40–60', min: 40, max: 60,  fill: 'var(--signal-amber)'  },
  { label: '60–80', min: 60, max: 80,  fill: 'var(--signal-green)'  },
  { label: '80–100',min: 80, max: 101, fill: 'var(--signal-green)'  },
];

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
        Score band · {d.label}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {d.count} driver{d.count !== 1 ? 's' : ''}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        {d.pct}% of roster
      </div>
    </div>
  );
};

export default function CompositeScoreHistogram({ rankings }) {
  if (!rankings?.length) return null;

  const total = rankings.length;
  const data = BANDS.map((b) => {
    const count = rankings.filter((d) => d.composite >= b.min && d.composite < b.max).length;
    return { ...b, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
  });

  const corridorAvg = Math.round(rankings.reduce((s, d) => s + d.composite, 0) / total);

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
            Composite score distribution
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Drivers by composite score band · safety / trips / hours equally weighted
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: corridorAvg >= 60 ? 'var(--signal-green)'
                 : corridorAvg >= 40 ? 'var(--signal-amber)'
                 : 'var(--bauxite-rust)',
            lineHeight: 1,
          }}>
            {corridorAvg}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            corridor avg
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barSize={36}>
          <CartesianGrid vertical={false} stroke="var(--border-hairline)" />
          <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="count" name="Drivers" radius={[3, 3, 0, 0]}>
            {data.map((b) => (
              <Cell key={b.label} fill={b.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
