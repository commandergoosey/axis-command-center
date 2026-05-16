/*
 * Phase 220 — ClaimAmountByStatusChart
 * Horizontal BarChart showing total claim exposure (USD) bucketed by workflow
 * status: open → under review → approved → paid → rejected.
 * Cell colour signals urgency: open/review = amber, approved = green (awaiting
 * payout), paid = text-secondary, rejected = rust.
 * No MODELLED badge — all figures are derived from real claims data.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ResponsiveContainer,
} from 'recharts';

const FMT_USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

const STATUS_COLOR = {
  open:         'var(--signal-amber)',
  under_review: 'var(--signal-amber)',
  approved:     'var(--signal-green)',
  paid:         'var(--text-tertiary)',
  rejected:     'var(--bauxite-rust)',
};

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
        {d.label}
      </div>
      <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>
        {d.count} claim{d.count !== 1 ? 's' : ''}
      </div>
      <div style={{ fontWeight: 'var(--fw-medium)', color: STATUS_COLOR[d.status] ?? 'var(--text)', marginTop: 4 }}>
        {FMT_USD.format(d.amount_usd)}
      </div>
    </div>
  );
};

export default function ClaimAmountByStatusChart({ amountByStatus }) {
  if (!amountByStatus?.length) return null;

  const totalExposure = amountByStatus.reduce((s, d) => s + d.amount_usd, 0);
  const inFlight = amountByStatus
    .filter((d) => d.status === 'open' || d.status === 'under_review')
    .reduce((s, d) => s + d.amount_usd, 0);

  const axisTick = {
    fontSize: 'var(--ts-caption-size)',
    fill: 'var(--text-tertiary)',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
            marginBottom: 2,
          }}>
            Claim exposure by status
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            Total claim amounts by workflow stage · USD
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-black)',
            color: inFlight > 0 ? 'var(--signal-amber)' : 'var(--text)',
            lineHeight: 1,
          }}>
            {FMT_USD.format(inFlight)}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
            in-flight exposure
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(140, amountByStatus.length * 44)}>
        <BarChart
          data={amountByStatus}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          barSize={18}
        >
          <CartesianGrid horizontal={false} stroke="var(--border-hairline)" />
          <XAxis
            type="number"
            tick={axisTick}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            width={110}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-tint)' }} />
          <Bar dataKey="amount_usd" name="Exposure (USD)" radius={[0, 3, 3, 0]}>
            {amountByStatus.map((d) => (
              <Cell key={d.status} fill={STATUS_COLOR[d.status] ?? 'var(--text-secondary)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div style={{
        marginTop: 'var(--space-3)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        textAlign: 'right',
      }}>
        Total lifecycle · {FMT_USD.format(totalExposure)}
      </div>
    </div>
  );
}
