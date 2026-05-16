/*
 * DriverSafetyHistogram — Phase 195.
 * Bar chart showing the distribution of driver safety scores across 5-point
 * bands (65–69 through 95–100). Red bands below 75, amber 75–84, green 85+.
 * Helps ops see the shape of fleet safety health at a glance — cluster in the
 * low bands signals a systemic coaching gap; cluster ≥90 shows a mature team.
 *
 * Data: roster.data.safety_distribution[] from GET /api/drivers.
 * Each entry: { band, count, tone }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const TONE_COLOR = {
  critical: 'var(--bauxite-rust)',
  warning:  'var(--signal-amber)',
  ok:       'var(--signal-green)',
};

function bandColor(tone) {
  return TONE_COLOR[tone] ?? 'var(--bauxite-rust)';
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 4, fontSize: 12 }}>
        Score band {d.band}
      </div>
      <div style={{ color: bandColor(d.tone), fontWeight: 500 }}>
        {d.count} driver{d.count !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export default function DriverSafetyHistogram({ safetyDistribution }) {
  if (!safetyDistribution?.length) return null;

  const total = safetyDistribution.reduce((s, b) => s + b.count, 0);
  const highBand = safetyDistribution
    .filter((b) => b.tone === 'ok')
    .reduce((s, b) => s + b.count, 0);
  const highPct = total > 0 ? Math.round((highBand / total) * 100) : 0;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <span className="eyebrow">Safety score distribution</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          {highPct}% of drivers ≥ 85
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={safetyDistribution}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-hairline)"
              vertical={false}
            />
            <XAxis
              dataKey="band"
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {safetyDistribution.map((entry) => (
                <Cell key={entry.band} fill={bandColor(entry.tone)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          marginTop: 'var(--space-2)',
          flexWrap: 'wrap',
        }}>
          {[
            { color: 'var(--bauxite-rust)', label: '< 75 — coaching required' },
            { color: 'var(--signal-amber)', label: '75–84 — developing' },
            { color: 'var(--signal-green)', label: '≥ 85 — proficient' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.85 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
