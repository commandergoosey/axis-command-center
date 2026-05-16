/*
 * Phase 215 — WaypointDwellChart
 * Horizontal BarChart showing seeded average dwell time (minutes) at each
 * active waypoint: weighbridges, rest stops, and the Kumasi junction.
 * Depots (mine gate, port) are excluded — they are origin/destination points.
 * Cell colour: green < 15 min, amber 15–30 min, rust > 30 min.
 * MODELLED badge shown per §12.4 — all dwell times are seeded estimates.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ReferenceLine, ResponsiveContainer,
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

const KIND_LABEL = {
  weighbridge: 'Weighbridge',
  junction:    'Junction',
  rest:        'Rest stop',
};

function cellColor(min) {
  if (min < 15) return 'var(--signal-green)';
  if (min <= 30) return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

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
        {d.label}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Kind · {KIND_LABEL[d.kind] ?? d.kind}
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        km {d.km}
      </div>
      <div style={{ fontWeight: 'var(--fw-medium)', color: cellColor(d.avg_min), marginTop: 4 }}>
        Avg dwell · {d.avg_min} min
      </div>
    </div>
  );
};

export default function WaypointDwellChart({ waypointDwell }) {
  if (!waypointDwell?.length) return null;

  // Order by km ascending (southbound direction)
  const data = [...waypointDwell].sort((a, b) => a.km - b.km);
  const avgDwell = Math.round(data.reduce((s, d) => s + d.avg_min, 0) / data.length);

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
            Waypoint average dwell{MODELLED}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Minutes stopped · weighbridges · rest stops · junction · southbound direction
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: 'var(--text)',
            lineHeight: 1,
          }}>
            {avgDwell} min
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            corridor avg
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
          barSize={18}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            tickFormatter={(v) => `${v} min`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            width={160}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine
            x={avgDwell}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <Bar dataKey="avg_min" name="Avg dwell (min)" radius={[0, 3, 3, 0]}>
            {data.map((d) => (
              <Cell key={d.id} fill={cellColor(d.avg_min)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
