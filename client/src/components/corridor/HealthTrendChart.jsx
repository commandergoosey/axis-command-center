/*
 * HealthTrendChart — Phase 147.
 * 30-day corridor health score history as an area chart.
 * Score bands: STRONG ≥80, WATCH ≥65, BELOW <65.
 * Reference lines mark the two thresholds so the operator can
 * see exactly when and how often the corridor has dipped.
 *
 * Props:
 *   history — health_history from /api/corridor
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

function dayLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  // Show label on the 1st and every 7th day
  return (day === 1 || day % 7 === 0) ? `${day} ${mon}` : '';
}

function verdictColor(verdict) {
  if (verdict === 'STRONG') return 'var(--signal-green)';
  if (verdict === 'WATCH')  return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const color = verdictColor(d.verdict);
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '6px 10px',
      fontSize:     'var(--ts-caption-size)',
    }}>
      <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>{d.date}</div>
      <div style={{ fontWeight: 'var(--fw-semibold)', color }}>
        {d.score} · {d.verdict}
      </div>
    </div>
  );
}

export default function HealthTrendChart({ history }) {
  if (!history || history.length === 0) return null;

  const latest      = history[history.length - 1];
  const lineColor   = verdictColor(latest?.verdict);
  const latestScore = latest?.score ?? '—';

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Corridor health · 30-day history</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          composite score · today {latestScore} ({latest?.verdict}) · MODELLED
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={history} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-hairline)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis
              domain={[40, 100]}
              tickCount={4}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />

            {/* Threshold reference lines */}
            <ReferenceLine
              y={80}
              stroke="var(--signal-green)"
              strokeDasharray="4 4"
              strokeOpacity={0.45}
            />
            <ReferenceLine
              y={65}
              stroke="var(--signal-amber)"
              strokeDasharray="4 4"
              strokeOpacity={0.45}
            />

            <Tooltip content={<CustomTooltip />} />

            <Area
              type="monotone"
              dataKey="score"
              stroke={lineColor}
              strokeWidth={1.5}
              fill="url(#healthGrad)"
              dot={false}
              activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display:     'flex',
          gap:         'var(--space-4)',
          marginTop:   8,
          paddingTop:  8,
          borderTop:   '1px solid var(--border-hairline)',
          fontSize:    'var(--ts-caption-size)',
          color:       'var(--text-tertiary)',
          flexWrap:    'wrap',
          alignItems:  'center',
        }}>
          <span><span style={{ color: 'var(--signal-green)' }}>—</span> STRONG ≥80</span>
          <span><span style={{ color: 'var(--signal-amber)' }}>—</span> WATCH ≥65</span>
          <span><span style={{ color: 'var(--bauxite-rust)' }}>—</span> BELOW &lt;65</span>
        </div>
      </div>
    </section>
  );
}
