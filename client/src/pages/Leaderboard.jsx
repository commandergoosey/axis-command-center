/*
 * Driver Leaderboard — Phase 94.
 *
 * Three dimensions, one corridor-wide ranking.
 *
 *   Safety     — safety_score (0–100; fewer harsh events = higher score)
 *   Road Warrior — trips_this_week (total runs)
 *   On Duty    — hours_this_week (seat time)
 *
 * Composite score = mean of each dimension normalised to 0–100 relative
 * to the corridor maximum. Equal weight across all three.
 *
 * Route: GET /api/drivers/leaderboard?hauler_id=haul-01
 * Roles: axis_admin (wildcard), axis_ops, hauler_admin
 *   hauler_admin sees only their own drivers; corridor avg shown for context.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trophy, Shield, Truck, Clock, AlertTriangle } from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import FatigueMonitorStrip from '../components/drivers/FatigueMonitorStrip';
import HOSTrendChart       from '../components/drivers/HOSTrendChart';
import HaulerRadarChart    from '../components/drivers/HaulerRadarChart';

/* ── Medal colours ───────────────────────────────────────────────── */
const MEDAL = {
  1: { label: '1st', bg: 'rgba(217,158,55,0.12)', border: 'rgba(217,158,55,0.4)', color: 'var(--signal-amber)' },
  2: { label: '2nd', bg: 'rgba(180,180,180,0.10)', border: 'rgba(160,160,160,0.4)', color: 'var(--text-secondary)' },
  3: { label: '3rd', bg: 'rgba(139,99,66,0.10)',  border: 'rgba(139,99,66,0.4)',   color: 'var(--text-tertiary)' },
};

const MEDAL_NUMERAL = { 1: '①', 2: '②', 3: '③' };

/* ── Hauler pill colours — same palette as sidebar sections ──────── */
const HAULER_TONES = [
  'var(--bauxite-rust)',
  'var(--signal-amber)',
  'var(--signal-green)',
  'var(--text-secondary)',
  'var(--text-tertiary)',
];

/* ── Dimension meta ──────────────────────────────────────────────── */
const DIMENSIONS = [
  {
    key:    'safety_score',
    label:  'Safety champion',
    sub:    'Highest safety score this week',
    icon:   Shield,
    unit:   '',
    fmt:    (v) => String(v),
    desc:   'score',
  },
  {
    key:    'trips_this_week',
    label:  'Road warrior',
    sub:    'Most trips completed this week',
    icon:   Truck,
    unit:   '',
    fmt:    (v) => String(v),
    desc:   'trips',
  },
  {
    key:    'hours_this_week',
    label:  'On duty',
    sub:    'Most hours on shift this week',
    icon:   Clock,
    unit:   'h',
    fmt:    (v) => String(v),
    desc:   'hours',
  },
];

/* ══════════════════════════════════════════════════════════════════ */
/*  Page                                                             */
/* ══════════════════════════════════════════════════════════════════ */

export default function Leaderboard() {
  const { user } = useAuth();
  const isHaulerAdmin = user?.role === 'hauler_admin';

  const [data,      setData]      = useState(null);
  const [error,     setError]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [haulerFilter, setHaulerFilter] = useState('');

  /* hauler_admin is always scoped server-side; UI filter only shown to AXIS roles */
  const load = useCallback(async (filter) => {
    setLoading(true);
    try {
      const qs = filter ? `?hauler_id=${filter}` : '';
      const r = await authFetch(`/api/drivers/leaderboard${qs}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(haulerFilter || null); }, [load, haulerFilter]);

  /* Build hauler list from rankings for the filter pills */
  const haulerOptions = useMemo(() => {
    if (!data?.rankings) return [];
    const seen = new Map();
    for (const d of data.rankings) {
      if (!seen.has(d.hauler_id)) seen.set(d.hauler_id, d.hauler_display);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const haulerColorMap = useMemo(() => {
    const m = new Map();
    haulerOptions.forEach(([id], i) => m.set(id, HAULER_TONES[i % HAULER_TONES.length]));
    return m;
  }, [haulerOptions]);

  const rankings     = data?.rankings      ?? [];
  const podiums      = data?.podiums       ?? {};
  const corridorAvg  = data?.corridor_avg  ?? { safety: 0, trips: 0, hours: 0 };
  const livecorridor = data?.live_corridor ?? null;
  const fatigueFlags = data?.fatigue_flags ?? [];

  return (
    <PageShell
      eyebrow="Operations"
      title="Driver Leaderboard"
      description="Weekly corridor ranking across three dimensions: safety score, trips completed, and hours on duty. Composite score weights all three equally. Recognise your top performers and spot where coaching is needed."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {error && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--signal-amber)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text)',
            fontSize: 'var(--ts-body-sm-size)',
          }}>
            Leaderboard unavailable — {error}
          </div>
        )}

        {/* ── Phase 136: Live corridor strip ──────────────────────── */}
        {livecorridor && (
          <LiveCorridorStrip live={livecorridor} loading={loading} />
        )}

        {/* ── Period + scope label ────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <span style={{
            padding: '4px 12px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
          }}>
            {data?.period ?? 'This week'}
          </span>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            {loading ? '…' : `${data?.total_drivers ?? 0} drivers`}
            {isHaulerAdmin && ' (your fleet)'}
          </span>
          {!isHaulerAdmin && data && (
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              ·  Corridor avg: safety {corridorAvg.safety} · {corridorAvg.trips} trips · {corridorAvg.hours}h
            </span>
          )}
        </div>

        {/* ── Podiums ─────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}>
          {DIMENSIONS.map((dim) => (
            <PodiumCard
              key={dim.key}
              dim={dim}
              entries={podiums[dim.key === 'safety_score' ? 'safety' : dim.key === 'trips_this_week' ? 'trips' : 'hours'] ?? []}
              loading={loading}
              haulerColorMap={haulerColorMap}
            />
          ))}
        </div>

        {/* ── Hauler filter (AXIS roles only) ─────────────────────── */}
        {!isHaulerAdmin && haulerOptions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span className="micro" style={{ color: 'var(--text-tertiary)', marginRight: 4 }}>Filter</span>
            <FilterPill
              label="All haulers"
              active={!haulerFilter}
              onClick={() => setHaulerFilter('')}
            />
            {haulerOptions.map(([id, label]) => (
              <FilterPill
                key={id}
                label={label}
                active={haulerFilter === id}
                onClick={() => setHaulerFilter(id)}
                color={haulerColorMap.get(id)}
              />
            ))}
          </div>
        )}

        {/* ── Phase 143: fatigue monitor ──────────────────────────── */}
        {fatigueFlags.length > 0 && (
          <FatigueMonitorStrip flags={fatigueFlags} />
        )}

        {/* ── Phase 153: HOS 8-week trend ─────────────────────────── */}
        <HOSTrendChart hosTrend={data?.hos_trend} />

        {/* ── Phase 160: per-hauler performance radar ──────────────── */}
        {!isHaulerAdmin && <HaulerRadarChart haulerRadar={data?.hauler_radar} />}

        {/* ── Full ranking table ───────────────────────────────────── */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            Composite ranking · {loading ? '…' : rankings.length}
          </div>
          <RankingTable
            rankings={rankings}
            corridorAvg={corridorAvg}
            haulerColorMap={haulerColorMap}
            userHaulerId={user?.hauler_id}
            showHauler={!isHaulerAdmin}
            loading={loading}
          />
        </section>
      </div>
    </PageShell>
  );
}

/* ── Podium card ──────────────────────────────────────────────────── */

function PodiumCard({ dim, entries, loading, haulerColorMap }) {
  const Icon = dim.icon;

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <Icon size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
        <div>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {dim.label}
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            {dim.sub}
          </div>
        </div>
      </div>

      {/* Entries */}
      <div>
        {loading
          ? [1, 2, 3].map((i) => <SkeletonRow key={i} />)
          : entries.map((entry) => {
              const m = MEDAL[entry.medal];
              const haulerColor = haulerColorMap.get(entry.hauler_id) || 'var(--text-tertiary)';
              return (
                <div
                  key={entry.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 'var(--space-3) var(--space-4)',
                    borderBottom: '1px solid var(--border-hairline)',
                    background: m.bg,
                  }}
                >
                  {/* Medal */}
                  <span style={{
                    fontSize: 16,
                    color: m.color,
                    flexShrink: 0,
                    width: 20,
                    textAlign: 'center',
                  }}>
                    {entry.medal === 1 ? '🥇' : entry.medal === 2 ? '🥈' : '🥉'}
                  </span>

                  {/* Name + hauler */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 'var(--ts-body-sm-size)',
                      fontWeight: 'var(--fw-medium)',
                      color: 'var(--text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {entry.full_name}
                    </div>
                    <div style={{
                      fontSize: 'var(--ts-caption-size)',
                      color: haulerColor,
                    }}>
                      {entry.hauler_display}
                    </div>
                  </div>

                  {/* Value */}
                  <div style={{
                    fontSize: 'var(--ts-h4-size, 18px)',
                    fontWeight: 'var(--fw-semibold)',
                    color: m.color,
                    letterSpacing: '-0.01em',
                    flexShrink: 0,
                  }}>
                    {dim.fmt(entry[dim.key])}{dim.unit}
                    <span style={{
                      fontSize: 'var(--ts-caption-size)',
                      fontWeight: 'var(--fw-normal)',
                      color: 'var(--text-tertiary)',
                      marginLeft: 3,
                    }}>
                      {dim.desc}
                    </span>
                  </div>

                  {/* Flag badge */}
                  {entry.flag && (
                    <AlertTriangle size={12} strokeWidth={1.5} color="var(--signal-amber)" />
                  )}
                </div>
              );
            })}
      </div>
    </div>
  );
}

/* ── Full ranking table ───────────────────────────────────────────── */

const COL_STYLE = {
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  padding: '10px var(--space-3)',
  textAlign: 'right',
};

const HEAD_STYLE = {
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-tertiary)',
  fontWeight: 'var(--fw-medium)',
  padding: '8px var(--space-3)',
  textAlign: 'right',
  letterSpacing: '0.02em',
};

function RankingTable({ rankings, corridorAvg, haulerColorMap, userHaulerId, showHauler, loading }) {
  if (loading) {
    return (
      <div style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--ts-body-sm-size)',
      }}>
        Loading rankings…
      </div>
    );
  }

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 'var(--ts-body-sm-size)',
      }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
            <th style={{ ...HEAD_STYLE, textAlign: 'left', paddingLeft: 'var(--space-4)' }}>#</th>
            <th style={{ ...HEAD_STYLE, textAlign: 'left' }}>Driver</th>
            {showHauler && <th style={{ ...HEAD_STYLE, textAlign: 'left' }}>Hauler</th>}
            <th style={HEAD_STYLE}>Safety</th>
            <th style={HEAD_STYLE}>Trips</th>
            <th style={HEAD_STYLE}>Hours</th>
            <th style={{ ...HEAD_STYLE, color: 'var(--text-secondary)' }}>Composite</th>
          </tr>
        </thead>
        <tbody>
          {/* Corridor average row */}
          <tr style={{
            borderBottom: '1px solid var(--border-hairline)',
            background: 'var(--surface)',
          }}>
            <td style={{ ...COL_STYLE, textAlign: 'left', paddingLeft: 'var(--space-4)', color: 'var(--text-tertiary)' }}>
              —
            </td>
            <td style={{ ...COL_STYLE, textAlign: 'left', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              Corridor avg
            </td>
            {showHauler && <td style={{ ...COL_STYLE, textAlign: 'left' }} />}
            <td style={{ ...COL_STYLE, color: 'var(--text-tertiary)' }}>{corridorAvg.safety}</td>
            <td style={{ ...COL_STYLE, color: 'var(--text-tertiary)' }}>{corridorAvg.trips}</td>
            <td style={{ ...COL_STYLE, color: 'var(--text-tertiary)' }}>{corridorAvg.hours}h</td>
            <td style={{ ...COL_STYLE, color: 'var(--text-tertiary)' }}>—</td>
          </tr>

          {rankings.map((d) => {
            const isMyHauler = userHaulerId && d.hauler_id === userHaulerId;
            const haulerColor = haulerColorMap.get(d.hauler_id) || 'var(--text-tertiary)';
            const rankTone = d.rank <= 3 ? MEDAL[d.rank].color : 'var(--text-secondary)';

            return (
              <tr
                key={d.id}
                style={{
                  borderBottom: '1px solid var(--border-hairline)',
                  background: isMyHauler ? 'rgba(139,46,26,0.03)' : 'transparent',
                }}
              >
                {/* Rank */}
                <td style={{
                  ...COL_STYLE,
                  textAlign: 'left',
                  paddingLeft: 'var(--space-4)',
                  fontWeight: d.rank <= 3 ? 'var(--fw-medium)' : 'var(--fw-normal)',
                  color: rankTone,
                  fontFamily: d.rank <= 3 ? 'inherit' : 'var(--font-mono)',
                  fontSize: d.rank <= 3 ? 'var(--ts-body-sm-size)' : 'var(--ts-caption-size)',
                  letterSpacing: d.rank <= 3 ? 0 : '0.04em',
                }}>
                  {d.rank <= 3
                    ? (d.rank === 1 ? '🥇' : d.rank === 2 ? '🥈' : '🥉')
                    : d.rank
                  }
                </td>

                {/* Name */}
                <td style={{ ...COL_STYLE, textAlign: 'left' }}>
                  <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                    {d.full_name}
                  </span>
                  {d.flag && (
                    <AlertTriangle
                      size={11}
                      strokeWidth={1.5}
                      color="var(--signal-amber)"
                      style={{ marginLeft: 6, verticalAlign: 'middle' }}
                    />
                  )}
                </td>

                {/* Hauler */}
                {showHauler && (
                  <td style={{ ...COL_STYLE, textAlign: 'left', color: haulerColor }}>
                    {d.hauler_display}
                  </td>
                )}

                {/* Safety */}
                <td style={{ ...COL_STYLE }}>
                  <span style={{
                    color: d.safety_score >= 90
                      ? 'var(--signal-green)'
                      : d.safety_score >= 80
                        ? 'var(--text)'
                        : 'var(--signal-amber)',
                  }}>
                    {d.safety_score}
                  </span>
                </td>

                {/* Trips */}
                <td style={COL_STYLE}>{d.trips_this_week}</td>

                {/* Hours */}
                <td style={COL_STYLE}>{d.hours_this_week}h</td>

                {/* Composite */}
                <td style={{
                  ...COL_STYLE,
                  fontWeight: 'var(--fw-medium)',
                  color: d.rank <= 10
                    ? 'var(--text)'
                    : 'var(--text-secondary)',
                }}>
                  {d.composite}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Filter pill ──────────────────────────────────────────────────── */

function FilterPill({ label, active, onClick, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px',
        background: active ? (color || 'var(--bauxite-rust)') : 'transparent',
        color: active ? '#fff' : (color || 'var(--text-secondary)'),
        border: `1px solid ${active ? (color || 'var(--bauxite-rust)') : 'var(--border-hairline)'}`,
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--ts-caption-size)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {label}
    </button>
  );
}

/* ── Phase 136 — Live corridor strip ─────────────────────────────── */

function LiveCorridorStrip({ live, loading }) {
  const { today_convoys = 0, today_tonnes = 0, active_now = 0 } = live;

  const hasCorridor = today_convoys > 0 || active_now > 0;

  return (
    <div style={{
      background:   'var(--surface-raised)',
      border:       '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding:      'var(--space-3) var(--space-4)',
      display:      'flex',
      alignItems:   'center',
      gap:          'var(--space-5)',
      flexWrap:     'wrap',
    }}>
      {/* Live dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <span style={{
          width:        7,
          height:       7,
          borderRadius: '50%',
          background:   hasCorridor ? 'var(--signal-green)' : 'var(--text-tertiary)',
          boxShadow:    hasCorridor ? '0 0 0 2px rgba(74,222,128,0.2)' : 'none',
          display:      'inline-block',
          flexShrink:   0,
        }} />
        <span className="mono" style={{
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}>
          Live corridor
        </span>
      </div>

      <CorridorStat
        label="Convoys today"
        value={loading ? '…' : String(today_convoys)}
      />
      <CorridorStat
        label="Tonnes southbound"
        value={loading ? '…' : `${new Intl.NumberFormat('en-GB').format(today_tonnes)} t`}
      />
      <CorridorStat
        label="Active right now"
        value={loading ? '…' : String(active_now)}
        accent={active_now > 0}
      />
    </div>
  );
}

function CorridorStat({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        color: accent ? 'var(--signal-green)' : 'var(--text)',
      }}>
        {value}
      </span>
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        {label}
      </span>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */

function SkeletonRow() {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: '1px solid var(--border-hairline)',
      display: 'flex',
      gap: 10,
      alignItems: 'center',
    }}>
      <div style={{ width: 20, height: 16, background: 'var(--border-hairline)', borderRadius: 3 }} />
      <div style={{ flex: 1, height: 14, background: 'var(--border-hairline)', borderRadius: 3 }} />
      <div style={{ width: 32, height: 14, background: 'var(--border-hairline)', borderRadius: 3 }} />
    </div>
  );
}
