/*
 * PaymentVelocityChart — Phase 158.
 * Grouped bar chart of invoiced vs paid USD per settlement period.
 * Outstanding (un-paid) shown as a rust-tinted bar so ops can see
 * at a glance which periods still have open balances.
 *
 * Derives data from payment_velocity in GET /api/settlements.
 *
 * Props:
 *   paymentVelocity — payment_velocity array from /api/settlements
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function periodLabel(iso) {
  // "2026-04" → "Apr '26"
  const [yr, mo] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
  return `${mon} '${yr.slice(2)}`;
}

function fmtUSD(v) {
  if (v == null || v === 0) return '$0';
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000)    return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6 }}>
        {periodLabel(label)}
      </div>
      {[
        { label: 'Invoiced',     value: row.invoiced_usd,     color: 'rgba(59,130,246,0.85)' },
        { label: 'Paid',         value: row.paid_usd,         color: 'var(--signal-green)'   },
        { label: 'Outstanding',  value: row.outstanding_usd,  color: 'var(--bauxite-rust)'   },
      ].map(({ label: l, value, color }) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color }}>{l}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{fmtUSD(value)}</span>
        </div>
      ))}
      {row.outstanding_usd > 0 && (
        <div style={{
          borderTop: '1px solid var(--border-hairline)', marginTop: 4, paddingTop: 4,
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)',
        }}>
          {row.invoiced_usd > 0
            ? `${Math.round((row.paid_usd / row.invoiced_usd) * 100)}% collected`
            : ''}
        </div>
      )}
    </div>
  );
}

export default function PaymentVelocityChart({ paymentVelocity }) {
  if (!paymentVelocity || paymentVelocity.length === 0) return null;

  const hasOutstanding = paymentVelocity.some((r) => r.outstanding_usd > 0);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Payment velocity</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Invoiced vs paid by period
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={paymentVelocity}
            margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
            barCategoryGap="24%"
            barGap={3}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="period"
              tickFormatter={periodLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : `$${(v/1_000).toFixed(0)}k`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
            {/* Invoiced — blue outline */}
            <Bar
              dataKey="invoiced_usd"
              name="Invoiced"
              fill="rgba(59,130,246,0.15)"
              stroke="rgba(59,130,246,0.85)"
              strokeWidth={1.5}
              radius={[2, 2, 0, 0]}
            />
            {/* Paid — green fill */}
            <Bar
              dataKey="paid_usd"
              name="Paid"
              fill="var(--signal-green)"
              fillOpacity={0.7}
              radius={[2, 2, 0, 0]}
            />
            {/* Outstanding — rust fill */}
            {hasOutstanding && (
              <Bar
                dataKey="outstanding_usd"
                name="Outstanding"
                fill="var(--bauxite-rust)"
                fillOpacity={0.65}
                radius={[2, 2, 0, 0]}
              />
            )}
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
        }}>
          <span><span style={{ color: 'rgba(59,130,246,0.85)' }}>■</span> Invoiced</span>
          <span><span style={{ color: 'var(--signal-green)' }}>■</span> Paid</span>
          {hasOutstanding && (
            <span><span style={{ color: 'var(--bauxite-rust)' }}>■</span> Outstanding</span>
          )}
        </div>
      </div>
    </section>
  );
}
