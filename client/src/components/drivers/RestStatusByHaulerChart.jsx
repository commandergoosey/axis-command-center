/*
 * Phase 211 — Rest status breakdown by hauler.
 * Stacked horizontal BarChart: breach / warning / compliant per hauler.
 * Sorted by breach count desc so the worst haulers appear at top.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const breachPct   = d.total > 0 ? Math.round((d.breach   / d.total) * 100) : 0;
  const warningPct  = d.total > 0 ? Math.round((d.warning  / d.total) * 100) : 0;
  const compliantPct = d.total > 0 ? Math.round((d.compliant / d.total) * 100) : 0;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6 }}>{d.hauler_display}</div>
      {d.breach > 0 && (
        <div style={{ color: 'var(--bauxite-rust)' }}>Breach: {d.breach} ({breachPct}%)</div>
      )}
      {d.warning > 0 && (
        <div style={{ color: 'var(--signal-amber)' }}>Warning: {d.warning} ({warningPct}%)</div>
      )}
      <div style={{ color: 'var(--signal-green)' }}>Compliant: {d.compliant} ({compliantPct}%)</div>
      <div style={{
        borderTop: '1px solid var(--border-hairline)',
        marginTop: 6, paddingTop: 6,
        color: 'var(--text-tertiary)',
      }}>
        Total drivers: {d.total}
      </div>
    </div>
  );
}

export default function RestStatusByHaulerChart({ restByHauler }) {
  if (!restByHauler?.length) return null;

  const totalBreach  = restByHauler.reduce((s, h) => s + h.breach, 0);
  const totalWarning = restByHauler.reduce((s, h) => s + h.warning, 0);

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Rest compliance by hauler
          </span>
          {(totalBreach > 0 || totalWarning > 0) && (
            <span style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: totalBreach > 0 ? 'var(--bauxite-rust)' : 'var(--signal-amber)',
            }}>
              {totalBreach > 0 && `${totalBreach} breach${totalBreach !== 1 ? 'es' : ''}`}
              {totalBreach > 0 && totalWarning > 0 && ' · '}
              {totalWarning > 0 && `${totalWarning} warning${totalWarning !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
          Driver rest-hour status per hauler. Breach = Hours of Service rule exceeded;
          Warning = approaching limit. Resets Monday 00:00 Africa/Accra.
        </p>
      </div>

      <ResponsiveContainer width="100%" height={Math.max(160, restByHauler.length * 44)}>
        <BarChart
          data={restByHauler}
          layout="vertical"
          margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'drivers', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: 'var(--text-tertiary)' }}
          />
          <YAxis
            type="category"
            dataKey="hauler_display"
            width={130}
            tick={{ fontSize: 12, fill: 'var(--text)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="breach"    name="Breach"    stackId="a" fill="var(--bauxite-rust)"  radius={[0, 0, 0, 0]} />
          <Bar dataKey="warning"   name="Warning"   stackId="a" fill="var(--signal-amber)"  radius={[0, 0, 0, 0]} />
          <Bar dataKey="compliant" name="Compliant" stackId="a" fill="var(--signal-green)"  radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
