/*
 * DSCRWaterfall — Phase 148.
 * Waterfall bar chart decomposing how each stress-test factor
 * (FX/cedi, diesel, opex) contributes to the DSCR shift from
 * baseline to scenario.
 *
 * Chart pattern: stacked BarChart with an invisible spacer bar
 * holding the float position and a coloured value bar on top.
 * - Baseline / Scenario: solid bars from zero
 * - Delta bars: float at their start position, colour signals
 *   direction (green = tailwind, rust = headwind)
 *
 * Props:
 *   waterfall — waterfall array from /api/sensitivity
 *   targetMin — baseline.target_min covenant floor (optional)
 */

import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

const COLOR_BASE = 'var(--text-secondary)';
const COLOR_POS  = 'var(--signal-green)';
const COLOR_NEG  = 'var(--bauxite-rust)';
const COLOR_END  = 'var(--signal-amber)';

function barColor(entry) {
  if (entry.type === 'start') return COLOR_BASE;
  if (entry.type === 'end')   return COLOR_END;
  return (entry.step ?? 0) >= 0 ? COLOR_POS : COLOR_NEG;
}

/*
 * Transform raw waterfall rows into recharts stacked-bar data.
 * spacer  = invisible float base
 * barValue = visible bar height
 */
function buildChartData(waterfall) {
  return waterfall.map((w, i) => {
    if (w.type === 'start' || w.type === 'end') {
      return { ...w, spacer: 0, barValue: w.dscr };
    }
    const from = waterfall[i - 1]?.dscr ?? 0;
    const to   = w.dscr;
    return {
      ...w,
      spacer:   Math.min(from, to),
      barValue: Math.abs(w.step ?? 0),
    };
  });
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const w = payload.find((p) => p.dataKey === 'barValue')?.payload;
  if (!w) return null;
  const color = barColor(w);
  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding:      '6px 10px',
      fontSize:     'var(--ts-caption-size)',
      minWidth:     100,
    }}>
      <div style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 4 }}>
        {w.label}
      </div>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
        DSCR {w.dscr?.toFixed(3)}×
      </div>
      {w.step != null && (
        <div style={{ color, fontFamily: 'var(--font-mono)' }}>
          {w.step >= 0 ? '+' : ''}{w.step.toFixed(3)}×
        </div>
      )}
    </div>
  );
}

export default function DSCRWaterfall({ waterfall, targetMin }) {
  if (!waterfall || waterfall.length === 0) return null;

  // If all steps are zero / null the sliders are at baseline — show placeholder
  const hasShift = waterfall.some((w) => w.type === 'delta' && w.step != null && w.step !== 0);

  const chartData = buildChartData(waterfall);

  // Y-axis domain: buffer above & below the extremes, always show the floor
  const dscrValues = waterfall.map((w) => w.dscr);
  const rawMin     = Math.min(...dscrValues, targetMin ?? Infinity);
  const rawMax     = Math.max(...dscrValues);
  const yMin       = Math.max(0, Math.floor((rawMin - 0.12) * 10) / 10);
  const yMax       = Math.ceil((rawMax  + 0.10) * 10) / 10;

  return (
    <section>
      <div style={{
        display:      'flex',
        alignItems:   'baseline',
        gap:          10,
        marginBottom: 'var(--space-3)',
        flexWrap:     'wrap',
      }}>
        <div className="eyebrow">DSCR factor attribution</div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          waterfall — baseline → scenario decomposed by input driver
        </span>
      </div>

      {!hasShift ? (
        <div style={{
          padding:      'var(--space-4)',
          background:   'var(--surface-raised)',
          border:       '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          color:        'var(--text-tertiary)',
          fontSize:     'var(--ts-caption-size)',
          fontStyle:    'italic',
          textAlign:    'center',
        }}>
          Move a slider to see factor attribution
        </div>
      ) : (
        <div style={{
          background:   'var(--surface-raised)',
          border:       '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          padding:      'var(--space-4)',
        }}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 24, left: -20, bottom: 0 }}
              barCategoryGap="22%"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-hairline)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                tickFormatter={(v) => `${v.toFixed(1)}×`}
                tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />

              {/* Covenant floor reference line */}
              {targetMin != null && (
                <ReferenceLine
                  y={targetMin}
                  stroke="var(--bauxite-rust)"
                  strokeDasharray="5 3"
                  strokeOpacity={0.55}
                  label={{
                    value:      `floor ${targetMin.toFixed(2)}×`,
                    position:   'insideTopRight',
                    fontSize:   9,
                    fill:       'var(--bauxite-rust)',
                    fontFamily: 'var(--font-mono)',
                    dx:         -4,
                    dy:         -2,
                  }}
                />
              )}

              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />

              {/* Invisible spacer — provides the float position */}
              <Bar
                dataKey="spacer"
                stackId="wf"
                fill="rgba(0,0,0,0)"
                isAnimationActive={false}
              />

              {/* Visible value bar — coloured per type/direction */}
              <Bar
                dataKey="barValue"
                stackId="wf"
                radius={[2, 2, 0, 0]}
                isAnimationActive
              >
                {chartData.map((entry, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={barColor(entry)}
                    fillOpacity={entry.type === 'end' ? 0.65 : 0.80}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{
            display:    'flex',
            gap:        'var(--space-4)',
            marginTop:  8,
            paddingTop: 8,
            borderTop:  '1px solid var(--border-hairline)',
            fontSize:   'var(--ts-caption-size)',
            color:      'var(--text-tertiary)',
            flexWrap:   'wrap',
          }}>
            <span><span style={{ color: COLOR_BASE }}>●</span> Baseline</span>
            <span><span style={{ color: COLOR_POS  }}>●</span> Tailwind</span>
            <span><span style={{ color: COLOR_NEG  }}>●</span> Headwind</span>
            <span><span style={{ color: COLOR_END  }}>●</span> Scenario</span>
          </div>
        </div>
      )}
    </section>
  );
}
