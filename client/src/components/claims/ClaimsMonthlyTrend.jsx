/*
 * ClaimsMonthlyTrend — Phase 161.
 * 6-month stacked bar chart of claim frequency by type.
 * Current month uses live counts; prior 5 months are seeded (§12.4).
 * Lets ops spot whether the claim rate is rising across categories.
 *
 * Props:
 *   monthlyTrend — monthly_trend array from /api/claims
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const TYPE_META = {
  third_party_liability: { label: 'Third party',   color: 'var(--bauxite-rust)'         },
  rig_damage:            { label: 'Rig damage',     color: 'var(--signal-amber)'         },
  cargo_loss:            { label: 'Cargo loss',     color: 'rgba(59,130,246,0.85)'       },
  medical:               { label: 'Medical',        color: 'rgba(139,92,246,0.85)'       },
};
const TYPE_KEYS = Object.keys(TYPE_META);

function monthLabel(iso) {
  const [yr, mo] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
  return `${mon} '${yr.slice(2)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const total = TYPE_KEYS.reduce((s, t) => s + (row[t] ?? 0), 0);
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     150,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {monthLabel(label)}
        {row.partial && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(217,158,55,0.15)', color: 'var(--signal-amber)',
            borderRadius: 3, padding: '1px 5px',
          }}>MTD</span>
        )}
      </div>
      {[...payload].reverse().map((p) => {
        const meta = TYPE_META[p.dataKey];
        if (!meta || p.value === 0) return null;
        return (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
            <span style={{ color: p.fill }}>{meta.label}</span>
            <span className="tabular" style={{ color: 'var(--text)' }}>{p.value}</span>
          </div>
        );
      })}
      <div style={{
        borderTop: '1px solid var(--border-hairline)', marginTop: 4, paddingTop: 4,
        display: 'flex', justifyContent: 'space-between', gap: 12,
        fontWeight: 'var(--fw-medium)', color: 'var(--text)',
      }}>
        <span>Total</span>
        <span className="tabular">{total}</span>
      </div>
    </div>
  );
}

export default function ClaimsMonthlyTrend({ monthlyTrend }) {
  if (!monthlyTrend || monthlyTrend.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Claims frequency trend</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          6-month · by category · current month live
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyTrend} margin={{ top: 4, right: 8, left: -24, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            {TYPE_KEYS.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="claims"
                fill={TYPE_META[key].color}
                fillOpacity={0.80}
                radius={i === TYPE_KEYS.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
        }}>
          {TYPE_KEYS.map((key) => (
            <span key={key}>
              <span style={{ color: TYPE_META[key].color }}>■</span>{' '}{TYPE_META[key].label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto' }}>Prior months seeded · §12.4</span>
        </div>
      </div>
    </section>
  );
}
