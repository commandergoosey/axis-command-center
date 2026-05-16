/*
 * Phase 181 — Handover posting frequency chart (client-only).
 * Groups the notes array into ISO weeks (Mon–Sun) and renders a
 * BarChart of weekly post counts. No server change needed — all
 * data comes from the existing notes[] prop passed from Handovers.jsx.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts';

/* Build 8-week buckets from a notes array (newest first). */
function buildWeekBuckets(notes) {
  // Align to Monday of the current week.
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

  const buckets = [];
  for (let w = 7; w >= 0; w--) {
    const wStart = new Date(monday);
    wStart.setUTCDate(monday.getUTCDate() - w * 7);
    const wEnd = new Date(wStart);
    wEnd.setUTCDate(wStart.getUTCDate() + 7);

    const label = wStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const count = notes.filter((n) => {
      const t = new Date(n.created_at).getTime();
      return t >= wStart.getTime() && t < wEnd.getTime();
    }).length;

    buckets.push({ label, count, isCurrent: w === 0 });
  }
  return buckets;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      fontSize: 'var(--ts-caption-size)',
      minWidth: 140,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>
        w/c {d.label}
        {d.isCurrent && (
          <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--signal-amber)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>MTD</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Handovers</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)' }}>{d.count}</span>
      </div>
    </div>
  );
}

export default function HandoverActivityChart({ notes }) {
  if (!notes) return null;

  const weeks = buildWeekBuckets(notes);
  const avg = weeks.length > 0
    ? (weeks.reduce((s, w) => s + w.count, 0) / weeks.length).toFixed(1)
    : 0;

  // Warn if current week is below half the average.
  const currentCount = weeks[weeks.length - 1]?.count ?? 0;
  const lowActivity = currentCount < Number(avg) * 0.5 && Number(avg) > 0;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-micro-size)',
            letterSpacing: 'var(--ts-micro-tracking)',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
            fontWeight: 'var(--fw-medium)',
            marginBottom: 4,
          }}>
            Handover posting frequency
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            8 weeks · weekly post count · shift continuity health
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 'var(--ts-h2-size, 22px)',
            fontWeight: 'var(--fw-black)',
            fontVariantNumeric: 'tabular-nums',
            color: lowActivity ? 'var(--signal-amber)' : 'var(--text)',
            lineHeight: 1.1,
          }}>
            {currentCount}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            this week
          </div>
        </div>
      </div>

      {lowActivity && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-amber)',
          marginBottom: 'var(--space-3)',
        }}>
          Handover frequency below 8-week average ({avg}/wk) — shift continuity may be at risk.
        </div>
      )}

      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={weeks} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barSize={20}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={22}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          {Number(avg) > 0 && (
            <ReferenceLine
              y={Number(avg)}
              stroke="var(--text-tertiary)"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{ value: `avg ${avg}`, position: 'insideTopRight', fontSize: 9, fill: 'var(--text-tertiary)' }}
            />
          )}
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {weeks.map((w) => (
              <Cell
                key={w.label}
                fill={w.isCurrent ? 'var(--bauxite-rust)' : 'var(--text-tertiary)'}
                fillOpacity={w.isCurrent ? 0.85 : 0.45}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', textAlign: 'right' }}>
        Rust bar = current week · line = 8-week avg
      </div>
    </div>
  );
}
