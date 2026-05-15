/*
 * HaulerThroughputChart — Phase 154.
 * Stacked bar chart of weekly corridor tonnes broken down by hauler.
 * Lets ops immediately see which hauler drove any given week's
 * over/underperformance — and whether the mix is shifting over time.
 *
 * Derives all data from data.weeks (already returned by /api/analytics)
 * and data.hauler_totals (for legend + colour assignments).
 * No additional server fetch needed.
 *
 * Props:
 *   weeks        — weeks array from /api/analytics
 *   haulerTotals — hauler_totals array from /api/analytics (for legend)
 */

import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

// Corridor palette — matches HAULER_TONES in Leaderboard.jsx
const HAULER_COLORS = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'rgba(59,130,246,0.85)',   // blue
  'rgba(16,185,129,0.85)',   // green
  'rgba(139,92,246,0.85)',   // purple
];

function weekLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${day} ${mon}`;
}

function fmtK(v) {
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k`;
  return `${v}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
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
        Week of {weekLabel(label)}
      </div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: p.fill }}>{p.name}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{fmtK(p.value ?? 0)} t</span>
        </div>
      ))}
      <div style={{
        borderTop:  '1px solid var(--border-hairline)',
        marginTop:  4,
        paddingTop: 4,
        display:    'flex',
        justifyContent: 'space-between',
        gap: 12,
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        <span>Total</span>
        <span className="tabular">{fmtK(total)} t</span>
      </div>
    </div>
  );
}

export default function HaulerThroughputChart({ weeks, haulerTotals }) {
  if (!weeks || weeks.length === 0) return null;

  // Derive ordered hauler list from hauler_totals (share desc)
  const haulers = haulerTotals
    ? [...haulerTotals].sort((a, b) => b.trailing_share_pct - a.trailing_share_pct)
    : [];

  // Build chart data by pivoting hauler_breakdown per week
  const chartData = weeks.map((w) => {
    const row = { week_of: w.week_of, total: w.tonnes };
    (w.hauler_breakdown ?? []).forEach((hb) => {
      row[hb.hauler_id] = hb.tonnes;
    });
    return row;
  });

  if (haulers.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Weekly throughput · by hauler</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          12-week stacked · seeded
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barCategoryGap="14%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="week_of"
              tickFormatter={weekLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={1}
            />
            <YAxis
              tickFormatter={fmtK}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            {haulers.map((h, i) => (
              <Bar
                key={h.hauler_id}
                dataKey={h.hauler_id}
                name={h.display_name}
                stackId="wk"
                fill={HAULER_COLORS[i % HAULER_COLORS.length]}
                fillOpacity={0.82}
                radius={i === haulers.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display:    'flex',
          gap:        'var(--space-3)',
          marginTop:  8,
          paddingTop: 8,
          borderTop:  '1px solid var(--border-hairline)',
          fontSize:   'var(--ts-caption-size)',
          color:      'var(--text-tertiary)',
          flexWrap:   'wrap',
        }}>
          {haulers.map((h, i) => (
            <span key={h.hauler_id}>
              <span style={{ color: HAULER_COLORS[i % HAULER_COLORS.length] }}>■</span>{' '}
              {h.display_name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
