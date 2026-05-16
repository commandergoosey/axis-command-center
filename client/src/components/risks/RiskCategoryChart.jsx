/*
 * Phase 187 — Risk category exposure breakdown.
 * Horizontal BarChart of open risks grouped by category,
 * scored by severity × likelihood weighting.
 * Uses category_breakdown from /api/risks.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer,
} from 'recharts';

const CATEGORY_COLORS = {
  operational:   'var(--bauxite-rust)',
  commercial:    'var(--signal-amber)',
  financial:     'rgba(59,130,246,0.85)',
  compliance:    'rgba(16,185,129,0.85)',
  reputational:  'rgba(139,92,246,0.85)',
  strategic:     'rgba(236,72,153,0.85)',
};

const CATEGORY_LABELS = {
  operational:   'Operational',
  commercial:    'Commercial',
  financial:     'Financial',
  compliance:    'Compliance',
  reputational:  'Reputational',
  strategic:     'Strategic',
};

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
      minWidth: 170,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
        {CATEGORY_LABELS[d.category] ?? d.category}
      </div>
      <Row label="Open risks"      value={d.count} />
      <Row label="Weighted score"  value={d.weighted_score} />
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
        {value}
      </span>
    </div>
  );
}

export default function RiskCategoryChart({ categoryBreakdown }) {
  if (!categoryBreakdown?.length) return null;

  const topCategory = categoryBreakdown[0];

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
            Risk category exposure
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Open risks weighted by severity × likelihood · higher score = greater exposure
          </div>
        </div>
        {topCategory && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              fontWeight: 'var(--fw-medium)',
              color: CATEGORY_COLORS[topCategory.category] ?? 'var(--bauxite-rust)',
            }}>
              {CATEGORY_LABELS[topCategory.category] ?? topCategory.category}
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              highest exposure
            </div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={Math.max(80, categoryBreakdown.length * 44)}>
        <BarChart
          data={categoryBreakdown}
          layout="vertical"
          margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 'auto']}
            tick={{ fontSize: 10, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="category"
            tickFormatter={(v) => CATEGORY_LABELS[v] ?? v}
            tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="weighted_score" barSize={16} radius={[0, 3, 3, 0]}>
            {categoryBreakdown.map((c) => (
              <Cell
                key={c.category}
                fill={CATEGORY_COLORS[c.category] ?? 'var(--text-tertiary)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend strip */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
      }}>
        {categoryBreakdown.map((c) => (
          <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLORS[c.category] ?? 'var(--text-tertiary)', flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              {CATEGORY_LABELS[c.category] ?? c.category} ({c.count})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
