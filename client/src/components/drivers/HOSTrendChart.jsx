/*
 * HOSTrendChart — Phase 153.
 * 8-week stacked bar chart showing how the hours-of-service tier
 * distribution has shifted across the driver pool week by week.
 * Tiers: CRITICAL (≥68h) / WARNING (≥65h) / WATCH (≥60h) / OK.
 *
 * An increasing CRITICAL + WARNING share week-over-week is a
 * systemic overutilisation signal that rostering needs to address —
 * not just a coaching prompt for individuals.
 *
 * Props:
 *   hosTrend — hos_trend from /api/drivers/leaderboard
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';

const COLOR_CRITICAL = 'var(--bauxite-rust)';
const COLOR_WARNING  = 'rgba(239,100,50,0.8)';   // rust-adjacent, mid
const COLOR_WATCH    = 'var(--signal-amber)';
const COLOR_OK       = 'var(--text-tertiary)';

function weekLabel(iso) {
  const d   = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDate();
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return `${day} ${mon}`;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const atRisk = (d.critical ?? 0) + (d.warning ?? 0) + (d.watch ?? 0);
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     140,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6 }}>
        Week of {weekLabel(d.week)}
      </div>
      {[
        { label: 'Critical ≥68h', value: d.critical, color: COLOR_CRITICAL },
        { label: 'Warning ≥65h',  value: d.warning,  color: COLOR_WARNING  },
        { label: 'Watch ≥60h',    value: d.watch,    color: COLOR_WATCH    },
        { label: 'OK <60h',       value: d.ok,       color: COLOR_OK       },
      ].map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: row.color }}>{row.label}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{row.value ?? 0}</span>
        </div>
      ))}
      <div style={{
        borderTop:  '1px solid var(--border-hairline)',
        marginTop:  4,
        paddingTop: 4,
        display:    'flex',
        justifyContent: 'space-between',
        gap: 12,
        color: 'var(--text-tertiary)',
      }}>
        <span>At-risk</span>
        <span className="tabular" style={{ color: atRisk > 0 ? COLOR_WARNING : COLOR_OK }}>
          {atRisk} / {d.total}
        </span>
      </div>
    </div>
  );
}

export default function HOSTrendChart({ hosTrend }) {
  if (!hosTrend || hosTrend.length === 0) return null;

  const latest = hosTrend[hosTrend.length - 1];
  const atRiskNow = (latest?.critical ?? 0) + (latest?.warning ?? 0) + (latest?.watch ?? 0);

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">HOS tier trend · 8 weeks</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {atRiskNow} driver{atRiskNow !== 1 ? 's' : ''} at-risk this week · seeded
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={hosTrend} margin={{ top: 4, right: 8, left: -22, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border-hairline)"
              vertical={false}
            />
            <XAxis
              dataKey="week"
              tickFormatter={weekLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="ok"       stackId="hos" fill={COLOR_OK}       fillOpacity={0.45} name="OK" />
            <Bar dataKey="watch"    stackId="hos" fill={COLOR_WATCH}    fillOpacity={0.75} name="Watch" />
            <Bar dataKey="warning"  stackId="hos" fill={COLOR_WARNING}  fillOpacity={0.85} name="Warning" />
            <Bar dataKey="critical" stackId="hos" fill={COLOR_CRITICAL} fillOpacity={0.90} name="Critical" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Legend + advisory */}
        <div style={{
          display:     'flex',
          gap:         'var(--space-4)',
          marginTop:   8,
          paddingTop:  8,
          borderTop:   '1px solid var(--border-hairline)',
          fontSize:    'var(--ts-caption-size)',
          color:       'var(--text-tertiary)',
          flexWrap:    'wrap',
          alignItems:  'center',
        }}>
          <span><span style={{ color: COLOR_CRITICAL }}>■</span> Critical ≥68h</span>
          <span><span style={{ color: COLOR_WARNING  }}>■</span> Warning ≥65h</span>
          <span><span style={{ color: COLOR_WATCH    }}>■</span> Watch ≥60h</span>
          <span><span style={{ color: COLOR_OK       }}>■</span> OK &lt;60h</span>
          <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
            Trend is seeded — verify against driver logs
          </span>
        </div>
      </div>
    </section>
  );
}
