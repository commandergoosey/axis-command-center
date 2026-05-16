/*
 * Phase 206 — Coaching session completion rate trend (8 weeks).
 * AreaChart of completion_pct from the existing session_trend data.
 * ReferenceLine at 70% as the ops floor target.
 * Current week is live; prior 7 weeks MODELLED.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

const MODELLED = (
  <span style={{
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.08em',
    color: 'var(--signal-amber)',
    background: 'rgba(217,158,45,0.12)',
    borderRadius: 3,
    padding: '1px 5px',
    marginLeft: 8,
  }}>
    MODELLED
  </span>
);

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const pct   = payload[0]?.value ?? 0;
  const total = payload[0]?.payload?.total ?? null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 4 }}>w/c {label}</div>
      <div style={{ color: pct >= 70 ? 'var(--signal-green)' : 'var(--signal-amber)' }}>
        Completion rate: {pct}%
      </div>
      {total != null && (
        <div style={{ color: 'var(--text-tertiary)' }}>Sessions: {total}</div>
      )}
    </div>
  );
}

export default function CoachingCompletionChart({ sessionTrend }) {
  if (!sessionTrend?.length) return null;

  const data = sessionTrend.map((w) => ({
    ...w,
    week: fmtDate(w.week),
  }));

  const latest   = sessionTrend[sessionTrend.length - 1]?.completion_pct ?? 0;
  const prev     = sessionTrend[sessionTrend.length - 2]?.completion_pct ?? null;
  const delta    = prev != null ? latest - prev : null;
  const onTarget = latest >= 70;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 'var(--ts-body-size)',
            fontWeight: 'var(--fw-semibold)',
            color: 'var(--text)',
          }}>
            Coaching completion rate — 8 weeks
          </span>
          {MODELLED}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Share of flagged-driver pipeline reached by a coaching session in the week. Target ≥ 70%.
          </p>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <span style={{
              fontVariantNumeric: 'tabular-nums lining-nums',
              fontWeight: 'var(--fw-semibold)',
              fontSize: 'var(--ts-body-size)',
              color: onTarget ? 'var(--signal-green)' : 'var(--signal-amber)',
            }}>
              {latest}%
            </span>
            {delta != null && (
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                color: delta >= 0 ? 'var(--signal-green)' : 'var(--signal-amber)',
              }}>
                {delta >= 0 ? '+' : ''}{delta}pp WoW
              </span>
            )}
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
          <defs>
            <linearGradient id="completionGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="var(--signal-green)" stopOpacity={0.18} />
              <stop offset="95%" stopColor="var(--signal-green)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="week"
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
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={70}
            stroke="var(--signal-amber)"
            strokeDasharray="4 3"
            label={{
              value: 'Target 70%',
              position: 'insideTopRight',
              fill: 'var(--signal-amber)',
              fontSize: 10,
            }}
          />
          <Area
            dataKey="completion_pct"
            name="Completion %"
            type="monotone"
            stroke="var(--signal-green)"
            strokeWidth={2}
            fill="url(#completionGrad)"
            dot={{ r: 3, fill: 'var(--signal-green)', strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
