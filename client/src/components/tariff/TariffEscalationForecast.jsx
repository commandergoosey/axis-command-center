/*
 * TariffEscalationForecast — Phase 168.
 * 6-month tariff rate forecast under three scenarios:
 *   Base   — indices held flat at current values
 *   Trend  — extrapolated at recent month-on-month growth rate
 *   Stress — trend + 1% MoM additional fuel shock
 *
 * Gives lenders and ops a forward-looking rate sensitivity view
 * before the next indexation review date.
 *
 * All entries are MODELLED per §12.4.
 *
 * Props:
 *   escalationForecast — escalation_forecast array from /api/tariff
 *   currentRate        — effective_rate_usd_per_tonne from /api/tariff
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

function monthLabel(iso) {
  const [yr, mo] = iso.split('-');
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1];
  return `${mon} '${yr.slice(2)}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '8px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     160,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {monthLabel(label)}
        <span style={{
          fontSize: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
          background: 'rgba(0,0,0,0.06)', color: 'var(--text-tertiary)',
          borderRadius: 3, padding: '1px 5px',
        }}>MODELLED</span>
      </div>
      {[
        { key: 'stress_rate', label: 'Stress',  color: 'var(--bauxite-rust)'         },
        { key: 'trend_rate',  label: 'Trend',   color: 'var(--signal-amber)'         },
        { key: 'base_rate',   label: 'Base',    color: 'var(--text-secondary)'       },
      ].map(({ key, label: l, color }) => {
        const v = payload[0]?.payload?.[key];
        if (v == null) return null;
        return (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
            <span style={{ color }}>{l}</span>
            <span className="tabular" style={{ color: 'var(--text)' }}>${v.toFixed(2)}/t</span>
          </div>
        );
      })}
    </div>
  );
}

export default function TariffEscalationForecast({ escalationForecast, currentRate }) {
  if (!escalationForecast || escalationForecast.length === 0) return null;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">Tariff escalation forecast</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          6-month · base / trend / stress scenarios · modelled §12.4
        </span>
      </div>

      <div style={{
        background:   'var(--surface-raised)',
        border:       '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding:      'var(--space-4)',
      }}>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={escalationForecast} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={monthLabel}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border-hairline)', strokeWidth: 1 }} />

            {/* Current rate reference */}
            {currentRate != null && (
              <ReferenceLine
                y={currentRate}
                stroke="var(--border-soft)"
                strokeDasharray="3 2"
                label={{ value: 'Current', position: 'insideTopRight', fontSize: 8, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
              />
            )}

            {/* Base — flat neutral line */}
            <Line
              type="monotone"
              dataKey="base_rate"
              name="Base"
              stroke="var(--text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              dot={false}
            />
            {/* Trend — amber */}
            <Line
              type="monotone"
              dataKey="trend_rate"
              name="Trend"
              stroke="var(--signal-amber)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--signal-amber)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
            {/* Stress — rust */}
            <Line
              type="monotone"
              dataKey="stress_rate"
              name="Stress"
              stroke="var(--bauxite-rust)"
              strokeWidth={2}
              strokeDasharray="2 2"
              dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{
          display: 'flex', gap: 'var(--space-3)', marginTop: 8, paddingTop: 8,
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--text-secondary)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Base (flat)
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--signal-amber)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Trend
          </span>
          <span>
            <span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--bauxite-rust)', borderRadius: 1, verticalAlign: 'middle', marginRight: 3 }} />
            Stress (+1% MoM fuel)
          </span>
          <span style={{ marginLeft: 'auto' }}>All scenarios modelled · §12.4</span>
        </div>
      </div>
    </section>
  );
}
