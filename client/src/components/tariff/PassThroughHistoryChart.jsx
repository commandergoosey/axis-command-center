/*
 * PassThroughHistoryChart — Phase 230.
 * 6-month bar chart of fuel pass-through cap utilisation (0–100%).
 * Shows how much of the ±15% pass-through band has been consumed each
 * month — months at ≥80% utilisation triggered the contractual cap.
 * High utilisation = haulers are absorbing less of the diesel swing
 * within their contracted tolerance; AXIS absorbs the difference.
 * MODELLED — seeded without a live NPA feed.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts';

const MODELLED = (
  <span style={{
    display: 'inline-block',
    fontSize: 9,
    letterSpacing: '0.07em',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: 3,
    background: 'rgba(184,134,11,0.10)',
    color: 'var(--signal-amber)',
    border: '1px solid rgba(184,134,11,0.22)',
    verticalAlign: 'middle',
    marginLeft: 6,
  }}>MODELLED</span>
);

function fmtMonth(iso) {
  const [year, mon] = iso.split('-');
  return new Date(Date.UTC(+year, +mon - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--text)',
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', marginBottom: 4 }}>{fmtMonth(d.month)}</div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Utilisation: <strong>{d.utilisation_pct}%</strong>
      </div>
      <div style={{ color: 'var(--text-secondary)' }}>
        Actual delta: +{d.actual_delta_pct}% of tariff
      </div>
      {d.cap_triggered && (
        <div style={{ color: 'var(--bauxite-rust)', marginTop: 3, fontSize: 10, fontWeight: 600 }}>
          CAP TRIGGERED
        </div>
      )}
    </div>
  );
};

export default function PassThroughHistoryChart({ passThroughHistory }) {
  if (!passThroughHistory?.length) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Pass-through cap utilisation · 6 months
          </span>
          {MODELLED}
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          How much of the ±15% contractual fuel pass-through band was consumed each month.
          At ≥80% the cap was triggered — diesel variance beyond this is absorbed by AXIS.
        </p>
      </header>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={passThroughHistory} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonth}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <ReferenceLine
            y={80}
            stroke="var(--bauxite-rust)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: 'Cap zone', position: 'right', fontSize: 10, fill: 'var(--bauxite-rust)' }}
          />
          <Bar dataKey="utilisation_pct" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {passThroughHistory.map((entry) => (
              <Cell
                key={entry.month}
                fill={entry.cap_triggered
                  ? 'var(--bauxite-rust)'
                  : entry.utilisation_pct >= 50
                    ? 'var(--signal-amber)'
                    : 'var(--signal-green)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
