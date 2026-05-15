/*
 * WeekdayPatternChart — Phase 165.
 * Bar chart showing average corridor tonnes delivered per day of the
 * week (Mon–Sun) over the trailing 12-week window. Seeded per-week
 * distribution of actual weekly tonnes so the pattern reflects real
 * throughput — just broken into day-of-week buckets.
 *
 * Gives ops a quick read on which days run hot (convoy scheduling
 * signal) and which are systemically lighter (maintenance windows).
 *
 * Props:
 *   weekdayPattern — weekday_pattern array from /api/analytics
 */

import {
  BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

function fmtK(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return `${v}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     110,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Avg tonnes</span>
        <span className="tabular" style={{ color: 'var(--text)' }}>
          {payload[0]?.value?.toLocaleString() ?? '—'} t
        </span>
      </div>
    </div>
  );
}

export default function WeekdayPatternChart({ weekdayPattern }) {
  if (!weekdayPattern || weekdayPattern.length === 0) return null;

  const maxTonnes = Math.max(...weekdayPattern.map((d) => d.avg_tonnes));
  const avgTonnes = Math.round(weekdayPattern.reduce((s, d) => s + d.avg_tonnes, 0) / weekdayPattern.length);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Weekday throughput pattern</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          12-week avg · tonnes per day of week · seeded distribution
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={weekdayPattern} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={fmtK}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            {/* Average reference line */}
            <ReferenceLine
              y={avgTonnes}
              stroke="var(--signal-amber)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{ value: 'Avg', position: 'right', fontSize: 9, fill: 'var(--signal-amber)', fontFamily: 'var(--font-mono)' }}
            />
            <Bar dataKey="avg_tonnes" radius={[3, 3, 0, 0]}>
              {weekdayPattern.map((entry) => {
                // Weekend lighter — rust; peak day green; rest rust-fade
                const isWeekend = entry.day === 'Sat' || entry.day === 'Sun';
                const isPeak    = entry.avg_tonnes === maxTonnes;
                const fill      = isPeak    ? 'var(--signal-green)'
                                : isWeekend ? 'rgba(139,46,26,0.40)'
                                : 'var(--bauxite-rust)';
                return <Cell key={entry.day} fill={fill} fillOpacity={0.82} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span><span style={{ color: 'var(--signal-green)' }}>■</span> Peak day</span>
          <span><span style={{ color: 'var(--bauxite-rust)' }}>■</span> Weekday</span>
          <span><span style={{ color: 'rgba(139,46,26,0.45)' }}>■</span> Weekend</span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-amber)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            7-day avg ({fmtK(avgTonnes)} t)
          </span>
          <span style={{ marginLeft: 'auto' }}>Distribution seeded · §12.4</span>
        </div>
      </div>
    </section>
  );
}
