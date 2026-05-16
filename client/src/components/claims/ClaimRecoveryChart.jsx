/*
 * ClaimRecoveryChart — Phase 203.
 * Horizontal BarChart showing each hauler's insurance claim recovery rate:
 * total paid/approved amounts ÷ total claimed. Operators with low recovery
 * rates may have weak claim submissions or underinsurance; those at 100%
 * have strong documentation and clean incidents.
 *
 * Data: data.recovery_by_hauler[] from GET /api/claims.
 * Each entry: { hauler_id, hauler_display, claim_amount_usd, recovered_usd,
 *               recovery_pct, claim_count, paid_count }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';

function barColor(pct) {
  if (pct >= 80)  return 'var(--signal-green)';
  if (pct >= 50)  return 'var(--signal-amber)';
  return 'var(--bauxite-rust)';
}

function fmtUsd(n) {
  if (n == null) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

function shortName(s) {
  return s.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, '');
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
      minWidth: 200,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {d.hauler_display}
      </div>
      <Row label="Recovery rate"  value={`${d.recovery_pct}%`}          color={barColor(d.recovery_pct)} />
      <Row label="Recovered"      value={fmtUsd(d.recovered_usd)}        color="var(--text)" />
      <Row label="Total claimed"  value={fmtUsd(d.claim_amount_usd)}     color="var(--text-tertiary)" />
      <Row label="Claims"         value={`${d.claim_count} (${d.paid_count} paid)`} color="var(--text-tertiary)" />
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

export default function ClaimRecoveryChart({ recoveryByHauler }) {
  if (!recoveryByHauler?.length) return null;

  // Only show haulers with claims
  const chartData = recoveryByHauler
    .filter((h) => h.claim_count > 0)
    .map((h) => ({ ...h, name: shortName(h.hauler_display) }));

  if (!chartData.length) return null;

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
        <span className="eyebrow">Insurance claim recovery by hauler</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          Paid + approved ÷ total claimed
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 44)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 0, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
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
              x={80}
              stroke="var(--signal-green)"
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: '80%',
                position: 'top',
                fontSize: 9,
                fill: 'var(--signal-green)',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Bar dataKey="recovery_pct" radius={[0, 3, 3, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.hauler_id} fill={barColor(entry.recovery_pct)} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          {[
            { color: 'var(--signal-green)', label: '≥ 80% — strong recovery' },
            { color: 'var(--signal-amber)', label: '50–79% — partial recovery' },
            { color: 'var(--bauxite-rust)', label: '< 50% — poor recovery' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color, opacity: 0.85 }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
