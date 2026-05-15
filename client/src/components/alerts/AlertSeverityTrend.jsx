/*
 * AlertSeverityTrend — Phase 155.
 * 8-week stacked area chart of alert severity counts.
 * Current week uses live counts from the summary; prior 7 weeks
 * use seeded PRNG values (computed server-side). Lets ops spot
 * whether the alert volume and severity mix is improving over time.
 *
 * Props:
 *   severityTrend — severity_trend array from /api/alerts
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${day} ${mon}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const isCurrentWeek = payload[0]?.payload?.current;
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     140,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        Week of {weekLabel(label)}
        {isCurrentWeek && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(22,163,74,0.12)', color: 'var(--signal-green)',
            borderRadius: 3, padding: '1px 5px',
          }}>LIVE</span>
        )}
      </div>
      {[...payload].reverse().map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: p.fill }}>{p.name}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{p.value ?? 0}</span>
        </div>
      ))}
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

export default function AlertSeverityTrend({ severityTrend }) {
  if (!severityTrend || severityTrend.length === 0) return null;

  // Mark the last entry as current week for tooltip badge
  const chartData = severityTrend.map((row, i) => ({
    ...row,
    current: i === severityTrend.length - 1,
  }));

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Alert severity trend</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          8-week · current week live · prior weeks seeded
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradInfo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--text-tertiary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--text-tertiary)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradWarning" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--signal-amber)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--signal-amber)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="gradCritical" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="var(--bauxite-rust)" stopOpacity={0.5} />
                <stop offset="95%" stopColor="var(--bauxite-rust)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="week"
              tickFormatter={weekLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              interval={1}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-hairline)', strokeWidth: 1 }} />
            {/* Stacked: INFO bottom, WARNING middle, CRITICAL top */}
            <Area
              type="monotone"
              dataKey="info"
              name="INFO"
              stackId="sev"
              stroke="var(--text-tertiary)"
              fill="url(#gradInfo)"
              strokeWidth={1.5}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="warning"
              name="WARNING"
              stackId="sev"
              stroke="var(--signal-amber)"
              fill="url(#gradWarning)"
              strokeWidth={1.5}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="critical"
              name="CRITICAL"
              stackId="sev"
              stroke="var(--bauxite-rust)"
              fill="url(#gradCritical)"
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
        }}>
          {[
            { color: 'var(--bauxite-rust)',   label: 'Critical' },
            { color: 'var(--signal-amber)',   label: 'Warning'  },
            { color: 'var(--text-tertiary)',  label: 'Info'     },
          ].map(({ color, label }) => (
            <span key={label}>
              <span style={{ color }}>■</span>{' '}{label}
            </span>
          ))}
          <span style={{ marginLeft: 'auto' }}>Prior weeks seeded · §12.4</span>
        </div>
      </div>
    </section>
  );
}
