/*
 * TakeOrPayProjection — Phase 162.
 * Full-year cumulative take-or-pay projection chart.
 * Shows cumulative actual tonnes (past + current MTD), a projected
 * year-end trajectory at current daily run-rate, the take-or-pay floor,
 * and the annual target — all on the same axis so ops and lenders can
 * instantly see if the corridor will clear the floor at current pace.
 *
 * Props:
 *   projection — top_projection array from /api/contract
 */

import {
  ComposedChart, Area, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

function monthLabel(iso) {
  const [, mo] = iso.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
}

function fmtK(v) {
  if (v == null) return '—';
  return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}Mt`
       : v >= 1_000     ? `${(v / 1_000).toFixed(0)}kt`
       : `${v}t`;
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
      minWidth:     170,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {monthLabel(label)}
        {row.is_current && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(22,163,74,0.12)', color: 'var(--signal-green)',
            borderRadius: 3, padding: '1px 5px',
          }}>LIVE MTD</span>
        )}
        {row.is_future && (
          <span style={{
            fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
            background: 'rgba(0,0,0,0.06)', color: 'var(--text-tertiary)',
            borderRadius: 3, padding: '1px 5px',
          }}>PROJECTED</span>
        )}
      </div>
      {[
        { label: 'Actual',     value: row.cumulative_actual,    color: 'var(--bauxite-rust)'         },
        { label: 'Projected',  value: row.cumulative_projected, color: 'rgba(139,92,246,0.85)'       },
        { label: 'Floor',      value: row.cumulative_floor,     color: 'var(--signal-amber)'         },
        { label: 'Target',     value: row.cumulative_target,    color: 'var(--signal-green)'         },
      ].filter(({ value }) => value != null).map(({ label: l, value, color }) => (
        <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color }}>{l}</span>
          <span className="tabular" style={{ color: 'var(--text)' }}>{fmtK(value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function TakeOrPayProjection({ projection }) {
  if (!projection || projection.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Take-or-pay projection</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Cumulative year-to-date · projected at current run-rate
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={projection} margin={{ top: 4, right: 40, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : `${(v/1_000).toFixed(0)}k`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-hairline)', strokeWidth: 1 }} />

            {/* Floor band — amber dashed */}
            <Line
              type="monotone"
              dataKey="cumulative_floor"
              stroke="var(--signal-amber)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              name="Floor"
            />
            {/* Target line — green dashed */}
            <Line
              type="monotone"
              dataKey="cumulative_target"
              stroke="var(--signal-green)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              name="Target"
            />
            {/* Projected trajectory — purple area */}
            <Area
              type="monotone"
              dataKey="cumulative_projected"
              stroke="rgba(139,92,246,0.85)"
              fill="rgba(139,92,246,0.08)"
              strokeWidth={1.5}
              strokeDasharray="3 2"
              dot={false}
              name="Projected"
            />
            {/* Actual delivered — rust area, solid */}
            <Area
              type="monotone"
              dataKey="cumulative_actual"
              stroke="var(--bauxite-rust)"
              fill="rgba(139,46,26,0.10)"
              strokeWidth={2}
              dot={false}
              name="Actual"
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span><span style={{ color: 'var(--bauxite-rust)' }}>■</span> Actual</span>
          <span><span style={{ color: 'rgba(139,92,246,0.85)' }}>■</span> Projected</span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-amber)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3, borderTop: '2px dashed var(--signal-amber)' }} />
            Floor
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-green)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Target
          </span>
          <span style={{ marginLeft: 'auto' }}>
            Projection at current daily rate
          </span>
        </div>
      </div>
    </section>
  );
}
