/*
 * HaulerRadarChart — Phase 160.
 * Per-hauler 5-axis performance radar using recharts RadarChart.
 * Axes: Throughput, Safety, Hours utilisation, Fatigue compliance,
 *       Corridor contribution — all normalised 0–100.
 *
 * Gives ops an immediate multi-dimensional comparison across haulers:
 * a hauler may be strong on throughput but weak on fatigue compliance.
 *
 * Props:
 *   haulerRadar — hauler_radar array from /api/drivers
 */

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

// Corridor palette — same ordering as HaulerThroughputChart
const HAULER_COLORS = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',
  'rgba(16,185,129,0.85)',
  'rgba(139,92,246,0.85)',
];

const AXES = [
  { key: 'throughput_score',       label: 'Throughput'    },
  { key: 'safety_score',           label: 'Safety'        },
  { key: 'hours_score',            label: 'Hours util.'   },
  { key: 'fatigue_compliance',     label: 'Fatigue comp.' },
  { key: 'corridor_contribution',  label: 'Corridor share'},
];

function buildChartData(haulerRadar) {
  return AXES.map(({ key, label }) => {
    const point = { axis: label };
    haulerRadar.forEach((h) => { point[h.hauler_id] = h[key] ?? 0; });
    return point;
  });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload ?? {};
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     140,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6 }}>
        {point.axis}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: p.stroke }}>{p.name}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function HaulerRadarChart({ haulerRadar }) {
  if (!haulerRadar || haulerRadar.length === 0) return null;

  const chartData = buildChartData(haulerRadar);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Hauler performance radar</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          5-axis · 0–100 normalised · this week
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={chartData} outerRadius={100}>
            <PolarGrid stroke="var(--border-hairline)" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fontSize: 10, fill: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
            />
            <PolarRadiusAxis
              domain={[0, 100]}
              tick={{ fontSize: 8, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickCount={4}
            />
            <Tooltip content={<CustomTooltip />} />
            {haulerRadar.map((h, i) => (
              <Radar
                key={h.hauler_id}
                name={h.display_name}
                dataKey={h.hauler_id}
                stroke={HAULER_COLORS[i % HAULER_COLORS.length]}
                fill={HAULER_COLORS[i % HAULER_COLORS.length]}
                fillOpacity={0.10}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </RadarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 4, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
        }}>
          {haulerRadar.map((h, i) => (
            <span key={h.hauler_id}>
              <span style={{ color: HAULER_COLORS[i % HAULER_COLORS.length] }}>■</span>{' '}
              {h.display_name} ({h.driver_count} drivers)
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
