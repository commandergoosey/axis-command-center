/*
 * PaymentDaysChart — Phase 202.
 * Horizontal BarChart showing each hauler's average days from invoice date
 * to payment, benchmarked against the contractual 30-day settlement window.
 * Bars beyond the SLA reference line flag chronic slow payers; ops can use
 * this to prioritise credit-control calls before the lender's quarterly review.
 *
 * Data: data.payment_days[] from GET /api/settlements.
 * Each entry: { hauler_id, hauler_display, avg_days, sla_days, modelled }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

const MODELLED_BADGE = (
  <span style={{
    fontSize: 9,
    letterSpacing: '0.06em',
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(139,46,26,0.10)',
    color: 'var(--bauxite-rust)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    textTransform: 'uppercase',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function barColor(days, sla) {
  if (days <= sla)      return 'var(--signal-green)';
  if (days <= sla + 7)  return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

function shortName(s) {
  return s.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, '');
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const over = d.avg_days - d.sla_days;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 180,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {d.hauler_display}
      </div>
      <Row label="Avg settlement" value={`${d.avg_days} days`} color={barColor(d.avg_days, d.sla_days)} />
      <Row label="SLA window"     value={`${d.sla_days} days`} color="var(--text-tertiary)" />
      {over > 0 && (
        <Row label="Over SLA" value={`+${over}d`} color="var(--bauxite-rust)" />
      )}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export default function PaymentDaysChart({ paymentDays }) {
  if (!paymentDays?.length) return null;

  const sla = paymentDays[0]?.sla_days ?? 30;
  const chartData = paymentDays.map((h) => ({
    ...h,
    name: shortName(h.hauler_display),
  }));

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
        <span style={{ display: 'flex', alignItems: 'center' }}>
          <span className="eyebrow">Average settlement days by hauler</span>
          {MODELLED_BADGE}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          SLA: {sla} days from invoice
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 44)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) => `${v}d`}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              domain={[0, 'auto']}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={80}
              tick={{ fontSize: 11, fill: 'var(--text)', fontFamily: 'var(--font-primary)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <ReferenceLine
              x={sla}
              stroke="var(--signal-amber)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: `SLA ${sla}d`,
                position: 'top',
                fontSize: 9,
                fill: 'var(--signal-amber)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Bar dataKey="avg_days" radius={[0, 3, 3, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.hauler_id} fill={barColor(entry.avg_days, sla)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
