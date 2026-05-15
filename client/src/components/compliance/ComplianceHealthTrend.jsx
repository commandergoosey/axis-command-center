/*
 * ComplianceHealthTrend — Phase 167.
 * 8-week compliance health score trend (0–100). Current week is
 * computed live from the licences and filings set; prior 7 weeks
 * are seeded so the chart shows historical trajectory context.
 *
 * Score = (compliant items) / (total tracked items) × 100.
 * Compliant = licence > 30d remaining, filing = FILED.
 *
 * Props:
 *   healthScore — health_score object from /api/compliance
 *     { current, status, compliant_items, total_items, trend: [] }
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function weekLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${day} ${mon}`;
}

const STATUS_COLOR = {
  GOOD:  'var(--signal-green)',
  WATCH: 'var(--signal-amber)',
  RISK:  'var(--bauxite-rust)',
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const score = payload[0]?.value ?? 0;
  const isCurrent = payload[0]?.payload?.current;
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     130,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {weekLabel(label)}
        {isCurrent && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(22,163,74,0.12)', color: 'var(--signal-green)',
            borderRadius: 3, padding: '1px 5px',
          }}>LIVE</span>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--text-secondary)' }}>Health score</span>
        <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{score}%</span>
      </div>
    </div>
  );
}

export default function ComplianceHealthTrend({ healthScore }) {
  if (!healthScore?.trend?.length) return null;

  const { current, status, compliant_items, total_items, trend } = healthScore;
  const lineColor = STATUS_COLOR[status] ?? STATUS_COLOR.GOOD;

  // Mark last entry as current week for tooltip
  const chartData = trend.map((row, i) => ({ ...row, current: i === trend.length - 1 }));

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Compliance health score</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          8-week trend · {compliant_items}/{total_items} items compliant · current week live
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        {/* Score hero */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 'var(--space-3)' }}>
          <span style={{
            fontSize:   32,
            fontWeight: 'var(--fw-medium)',
            fontFamily: 'var(--font-mono)',
            color:      lineColor,
            lineHeight: 1,
          }}>
            {current}%
          </span>
          <span style={{
            fontSize:   'var(--ts-caption-size)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.08em',
            background: status === 'GOOD'  ? 'rgba(22,163,74,0.12)'
                      : status === 'WATCH' ? 'rgba(217,158,55,0.15)'
                      : 'rgba(139,46,26,0.10)',
            color:      lineColor,
            borderRadius: 'var(--radius-sm)',
            padding:    '2px 8px',
          }}>
            {status}
          </span>
        </div>

        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradHealth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0.03} />
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
              domain={[50, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-hairline)', strokeWidth: 1 }} />
            <ReferenceLine y={85} stroke="var(--signal-green)" strokeDasharray="3 2" strokeWidth={1} />
            <ReferenceLine y={70} stroke="var(--signal-amber)" strokeDasharray="3 2" strokeWidth={1} />
            <Area
              type="monotone"
              dataKey="score"
              stroke={lineColor}
              fill="url(#gradHealth)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-green)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Good (85%)
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-amber)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Watch (70%)
          </span>
          <span style={{ marginLeft: 'auto' }}>Prior weeks seeded · §12.4</span>
        </div>
      </div>
    </section>
  );
}
