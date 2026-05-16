/*
 * Phase 219 — ConvoySpeedProfileChart
 * Horizontal BarChart showing the seeded average laden speed (km/h) for each
 * corridor segment southbound. Gross-weight trucks slow on hill sections;
 * this chart surfaces which segments are the throughput constraint.
 * Cell colour: green ≥ 65 km/h, amber 55–64, rust < 55.
 * MODELLED badge per §12.4 — all figures are seeded estimates.
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

function cellColor(kmh) {
  if (kmh >= 65) return 'var(--signal-green)';
  if (kmh >= 55) return 'var(--signal-amber)';
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
      {d.dist_km && (
        <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
          Distance · {d.dist_km} km
        </div>
      )}
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
        Active trucks · {d.laden} laden
      </div>
      <div style={{ fontWeight: 'var(--fw-medium)', color: cellColor(d.avg_kmh), marginTop: 4 }}>
        Avg speed · {d.avg_kmh} km/h
      </div>
    </div>
  );
};

export default function ConvoySpeedProfileChart({ speedProfile }) {
  if (!speedProfile?.length) return null;

  const corridorAvg = Math.round(
    speedProfile.reduce((s, seg) => s + seg.avg_kmh, 0) / speedProfile.length,
  );

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
            Segment speed profile{MODELLED}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Southbound laden avg · km/h per corridor segment
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: cellColor(corridorAvg),
            lineHeight: 1,
          }}>
            {corridorAvg} km/h
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            corridor avg
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(140, speedProfile.length * 48)}>
        <BarChart
          data={speedProfile}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
          barSize={20}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            tickFormatter={(v) => `${v} km/h`}
            domain={[40, 80]}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            width={220}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <ReferenceLine
            x={corridorAvg}
            stroke="var(--text-tertiary)"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <Bar dataKey="avg_kmh" name="Avg speed (km/h)" radius={[0, 3, 3, 0]}>
            {speedProfile.map((seg) => (
              <Cell key={seg.id} fill={cellColor(seg.avg_kmh)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
