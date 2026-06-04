/*
 * ConvoyPhaseChart — Phase 201.
 * Stacked horizontal BarChart showing active convoy phase distribution per
 * hauler: loading → laden → offload → empty. Gives dispatch a real-time
 * picture of where each operator's rigs are in the cycle without reading
 * individual convoy cards.
 *
 * Data: data.phase_by_hauler[] from GET /api/convoys.
 * Each entry: { hauler_id, hauler_display, loading, laden, offload, empty, total }
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const PHASE_COLORS = {
  loading: 'rgba(217,158,55,0.85)',   // amber — at mine gate
  laden:   'var(--bauxite-rust)',      // rust  — southbound loaded
  offload: 'rgba(59,130,246,0.85)',    // blue  — at port
  empty:   'rgba(156,163,175,0.7)',    // grey  — returning north
};

const PHASE_LABELS = {
  loading: 'Loading',
  laden:   'Laden (southbound)',
  offload: 'Offloading',
  empty:   'Empty (northbound)',
};

function shortName(s) {
  return s.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, '');
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '8px 12px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 180,
    }}>
      <div style={{ fontFamily: 'var(--font-primary)', fontWeight: 600, marginBottom: 6, fontSize: 12 }}>
        {label}
      </div>
      {payload.slice().reverse().map((p) => (
        p.value > 0 && (
          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{PHASE_LABELS[p.dataKey] ?? p.dataKey}</span>
            <span style={{ color: PHASE_COLORS[p.dataKey] ?? 'var(--text)', fontWeight: 500 }}>
              {p.value} convoy{p.value !== 1 ? 's' : ''}
            </span>
          </div>
        )
      ))}
    </div>
  );
}

export default function ConvoyPhaseChart({ phaseByHauler }) {
  if (!phaseByHauler?.length) return null;

  const chartData = phaseByHauler.map((h) => ({
    ...h,
    name: shortName(h.hauler_display),
  }));

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
        <span className="eyebrow">Active convoy phase by hauler</span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          color: 'var(--text-tertiary)',
        }}>
          {phaseByHauler.reduce((s, h) => s + h.total, 0)} convoys active
        </span>
      </header>

      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        <ResponsiveContainer width="100%" height={Math.max(140, chartData.length * 44)}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
            barSize={18}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
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
            <Bar dataKey="loading" stackId="a" fill={PHASE_COLORS.loading} radius={[0, 0, 0, 0]} />
            <Bar dataKey="laden"   stackId="a" fill={PHASE_COLORS.laden}   radius={[0, 0, 0, 0]} />
            <Bar dataKey="offload" stackId="a" fill={PHASE_COLORS.offload} radius={[0, 0, 0, 0]} />
            <Bar dataKey="empty"   stackId="a" fill={PHASE_COLORS.empty}   radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          {['loading', 'laden', 'offload', 'empty'].map((phase) => (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: PHASE_COLORS[phase] }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {PHASE_LABELS[phase]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
