/*
 * Phase 205 — Risk velocity trend: risks opened vs closed per week.
 * ComposedChart: grouped bars (opened / closed) + net line.
 * Net > 0 = register growing; net < 0 = being worked down.
 * All series MODELLED (seeded).
 */

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--signal-amber)',
    background: 'rgba(217,158,45,0.12)',
    borderRadius: 3,
    padding: '1px 5px',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const get = (key) => payload.find((p) => p.dataKey === key)?.value ?? 0;
  const net = get('net');
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>w/c {label}</div>
      <div style={{ color: 'var(--bauxite-rust)' }}>Opened: {get('opened')}</div>
      <div style={{ color: 'var(--signal-green)' }}>Closed: {get('closed')}</div>
      <div style={{
        borderTop: '1px solid var(--border-hairline)',
        marginTop: 6,
        paddingTop: 6,
        fontWeight: 'var(--fw-semibold)',
        color: net > 0 ? 'var(--bauxite-rust)' : net < 0 ? 'var(--signal-green)' : 'var(--text-tertiary)',
      }}>
        Net: {net > 0 ? '+' : ''}{net}
      </div>
    </div>
  );
}

export default function RiskVelocityChart({ velocityTrend }) {
  if (!velocityTrend?.length) return null;

  const data = velocityTrend.map((w) => ({
    ...w,
    week: fmtDate(w.week),
  }));

  const totalOpened = velocityTrend.reduce((s, w) => s + w.opened, 0);
  const totalClosed = velocityTrend.reduce((s, w) => s + w.closed, 0);
  const netBalance  = totalOpened - totalClosed;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Risk velocity — 8 weeks
          </span>
          {MODELLED}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Risks opened vs closed per week. Net line shows cumulative register momentum.
          </p>
          <span style={{
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums lining-nums',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-semibold)',
            color: netBalance > 0 ? 'var(--bauxite-rust)' : netBalance < 0 ? 'var(--signal-green)' : 'var(--text-tertiary)',
          }}>
            8w net: {netBalance > 0 ? '+' : ''}{netBalance}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <ReferenceLine y={0} stroke="var(--border-soft)" strokeDasharray="0" />
          <Bar dataKey="opened" name="Opened" fill="var(--bauxite-rust)" radius={[2, 2, 0, 0]} barSize={14} />
          <Bar dataKey="closed" name="Closed" fill="var(--signal-green)" radius={[2, 2, 0, 0]} barSize={14} />
          <Line
            dataKey="net"
            name="Net"
            type="monotone"
            stroke="var(--signal-amber)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--signal-amber)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
