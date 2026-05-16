/*
 * AlertAgeProfileChart — Phase 197.
 * Bar chart showing open alerts bucketed by how long they have been open:
 * 0–2 days (green / new), 3–7 days (amber / aging), 8–14 days (rust / stale),
 * 15+ days (deep rust / chronic). Helps the shift supervisor spot backlog
 * accumulation without scanning the full alert list.
 *
 * Data: data.alert_age_profile from GET /api/alerts.
 * Shape: { buckets: [{ key, label, count }], oldest_open_days }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

const BUCKET_COLORS = {
  '0–2d':  'var(--signal-green)',
  '3–7d':  'var(--signal-amber)',
  '8–14d': 'var(--bauxite-rust)',
  '15+d':  '#7A1A0A',
};

function bucketColor(key) {
  return BUCKET_COLORS[key] ?? 'var(--bauxite-rust)';
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
        {d.label}
      </div>
      <div style={{ color: bucketColor(d.key), fontWeight: 500 }}>
        {d.count} open alert{d.count !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

export default function AlertAgeProfileChart({ alertAgeProfile }) {
  if (!alertAgeProfile?.buckets?.length) return null;

  const { buckets, oldest_open_days } = alertAgeProfile;
  const totalOpen = buckets.reduce((s, b) => s + b.count, 0);
  const chronic   = (buckets.find((b) => b.key === '15+d')?.count) ?? 0;

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
        <span className="eyebrow">Open alert age profile</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          {totalOpen} open · oldest {oldest_open_days}d
          {chronic > 0 && (
            <span style={{ color: 'var(--bauxite-rust)', marginLeft: 8 }}>
              {chronic} chronic (15+d)
            </span>
          )}
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={buckets}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="30%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              width={24}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {buckets.map((b) => (
                <Cell key={b.key} fill={bucketColor(b.key)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
