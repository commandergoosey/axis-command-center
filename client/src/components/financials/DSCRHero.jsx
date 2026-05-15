/*
 * DSCRHero — Charcoal panel with the current DSCR reading (huge) and the
 * 6-month trend beside it. Target 1.30× reference line makes headroom
 * immediately legible. Mirrors the EffectiveRateHero treatment on the
 * Tariff page so lender-facing pages read as a set.
 */

import {
  LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip,
} from 'recharts';
import ModelledTag from '../primitives/ModelledTag';

export default function DSCRHero({ dscr }) {
  if (!dscr) return null;
  const data = dscr.series.map((r) => ({
    month: formatMonth(r.month),
    dscr: r.dscr,
  }));
  const pass = dscr.current >= dscr.target_min;

  return (
    <section style={{
      background: 'var(--charcoal)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-5) var(--space-5)',
      color: 'rgba(245, 241, 236, 0.92)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
      gap: 'var(--space-5)',
      alignItems: 'center',
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="eyebrow" style={{ color: 'rgba(245, 241, 236, 0.6)' }}>Debt service coverage</span>
          <ModelledTag tone="dark" />
        </div>
        <div className="tabular" style={{
          fontSize: 'var(--ts-display-size)',
          lineHeight: 1,
          fontWeight: 'var(--fw-medium)',
          color: pass ? 'var(--signal-green)' : 'var(--bauxite-rust)',
          letterSpacing: '-0.01em',
        }}>
          {dscr.current.toFixed(2)}×
        </div>
        <div className="mono" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'rgba(245, 241, 236, 0.55)',
          marginTop: 10,
          letterSpacing: '0.04em',
        }}>
          COVENANT {dscr.target_min.toFixed(2)}× · HEADROOM {dscr.headroom_pct.toFixed(1)}%
        </div>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'rgba(245, 241, 236, 0.72)',
          marginTop: 14,
          lineHeight: 1.5,
        }}>
          Target {dscr.target_min.toFixed(2)}× at covenant, {dscr.steady_state.toFixed(1)}× at Year 5 steady state. Trailing 3-month rolling reading, recomputed monthly against lender side letter.
        </div>
      </div>

      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
            <XAxis
              dataKey="month"
              stroke="rgba(245, 241, 236, 0.4)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'rgba(245, 241, 236, 0.5)' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(245, 241, 236, 0.12)' }}
            />
            <YAxis
              stroke="rgba(245, 241, 236, 0.4)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'rgba(245, 241, 236, 0.5)' }}
              tickLine={false}
              axisLine={false}
              domain={[0, 'dataMax + 0.3']}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--charcoal)',
                border: '1px solid rgba(245, 241, 236, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
                color: 'rgba(245, 241, 236, 0.9)',
              }}
              formatter={(v) => [`${Number(v).toFixed(2)}×`, 'DSCR']}
              labelStyle={{ color: 'rgba(245, 241, 236, 0.7)' }}
            />
            <ReferenceLine
              y={dscr.target_min}
              stroke="rgba(245, 241, 236, 0.35)"
              strokeDasharray="3 3"
              label={{
                value: `COVENANT ${dscr.target_min.toFixed(2)}×`,
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.08em',
                fill: 'rgba(245, 241, 236, 0.55)',
                position: 'insideBottomRight',
              }}
            />
            <Line
              type="monotone"
              dataKey="dscr"
              stroke="var(--signal-green)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--signal-green)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}
