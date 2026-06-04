/*
 * Corridor Performance Analytics — Phase 96.
 *
 * 12-week trailing view of corridor throughput vs the GIBDLC contract minimum.
 * Four panels:
 *   1. KPI strip — YTD tonnes, % of target, weekly run rate, projected year-end.
 *   2. Weekly throughput — bar chart with target & floor reference lines.
 *   3. YTD cumulative progress — area chart with target trajectory & floor.
 *   4. On-time delivery rate — line chart, last 12 weeks.
 *   5. Hauler contribution — ranked table for the 12-week window.
 *
 * All four roles can access this page (GET /api/analytics has no role gate).
 * The lender uses it for covenant trend monitoring; ops tracks execution;
 * hauler_admin sees their corridor contribution rank.
 *
 * Data source: GET /api/analytics → services/corridorAnalytics.js
 */

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, ComposedChart,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import HaulerThroughputChart   from '../components/analytics/HaulerThroughputChart';
import WeekdayPatternChart     from '../components/analytics/WeekdayPatternChart';
import FuelEfficiencyBenchmark from '../components/analytics/FuelEfficiencyBenchmark';
import TakeOrPayChart          from '../components/analytics/TakeOrPayChart';
import RevenuePerKmChart       from '../components/analytics/RevenuePerKmChart';
import AvgPayloadTrendChart    from '../components/analytics/AvgPayloadTrendChart';
import HaulerCostRankChart      from '../components/analytics/HaulerCostRankChart';
import PayloadHistogramChart    from '../components/analytics/PayloadHistogramChart';
import IntelligencePanel       from '../components/intelligence/IntelligencePanel';

/* ── Token colours (CSS vars resolved at runtime) ─────────────────── */
const C_RUST   = 'var(--bauxite-rust)';
const C_AMBER  = 'var(--signal-amber)';
const C_GREEN  = 'var(--signal-green)';
const C_TEXT   = 'var(--text)';
const C_TERT   = 'var(--text-tertiary)';

/* ── Hauler accent palette ────────────────────────────────────────── */
const HAULER_ACCENT = {
  'haul-01': '#8B2E1A',   // rust
  'haul-02': '#1A6B3A',   // green
  'haul-03': '#7A5C1A',   // amber-brown
  'haul-04': '#1A3D6B',   // navy
  'haul-05': '#4A1A6B',   // purple
};

/* ── Number formatters ────────────────────────────────────────────── */
function fmt(n) { return n == null ? '—' : Math.round(n).toLocaleString(); }
function fmtPct(n) { return n == null ? '—' : `${n}%`; }
function shortWeek(dateStr) {
  // "2026-05-04" → "4 May" or "May 4"
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function shortMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Page                                                              */
/* ══════════════════════════════════════════════════════════════════ */

export default function Analytics() {
  const { user } = useAuth();
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch('/api/analytics');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const weeks            = data?.weeks            ?? [];
  const ytd              = data?.ytd              ?? {};
  const c                = data?.contract         ?? {};
  const haulerTotals     = data?.hauler_totals    ?? [];
  const todayLive        = data?.today_live       ?? null;
  const haulerAttainment = data?.hauler_attainment ?? [];

  // Filter hauler breakdown if hauler_admin: only show their own hauler
  const isHaulerAdmin = user?.role === 'hauler_admin';
  const myHaulerId    = user?.hauler_id;

  // Build cumulative chart data
  const cumulativeData = (() => {
    let cum = 0;
    let targetCum = 0;
    let floorCum = 0;
    return weeks.map((w) => {
      cum       += w.tonnes;
      targetCum += c.weekly_target_t ?? 0;
      floorCum  += c.weekly_floor_t  ?? 0;
      return {
        week_of:  w.week_of,
        actual:   cum,
        target:   targetCum,
        floor:    floorCum,
      };
    });
  })();

  return (
    <PageShell
      eyebrow="Corridor"
      title="Performance analytics"
      description={`12-week trailing view of corridor throughput vs the GIBDLC take-or-pay contract minimum (${fmt(c.annual_floor_t ?? 800_000)} t floor · ${fmt(c.annual_target_t ?? 1_000_000)} t target). Data is modelled.`}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

        {error && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--signal-amber)',
            borderRadius: 'var(--radius-md)',
            color: C_TEXT,
            fontSize: 'var(--ts-body-sm-size)',
          }}>
            Analytics unavailable — {error}
          </div>
        )}

        {/* ── KPI strip ─────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
        }}>
          <KpiTile
            label="YTD tonnes delivered"
            value={loading ? '…' : fmt(ytd.tonnes_actual)}
            sub={`of ${fmt(ytd.tonnes_target)} target`}
            tone={
              !ytd.above_floor ? 'rust'
              : ytd.pct_of_target >= 95 ? 'green'
              : 'amber'
            }
          />
          <KpiTile
            label="vs floor (take-or-pay)"
            value={loading ? '…' : fmtPct(ytd.pct_of_floor)}
            sub={
              ytd.above_floor
                ? `${fmt(ytd.surplus_vs_floor)} t above floor`
                : `${fmt(Math.abs(ytd.surplus_vs_floor ?? 0))} t below floor`
            }
            tone={ytd.above_floor ? 'green' : 'rust'}
          />
          <KpiTile
            label="Weekly run rate (last 4 wks)"
            value={loading ? '…' : fmt(ytd.weekly_run_rate)}
            sub={`vs ${fmt(c.weekly_target_t)} t/wk target`}
            tone={
              !ytd.weekly_run_rate ? 'neutral'
              : ytd.weekly_run_rate >= c.weekly_target_t ? 'green'
              : ytd.weekly_run_rate >= c.weekly_floor_t  ? 'amber'
              : 'rust'
            }
          />
          <KpiTile
            label="Projected year-end"
            value={loading ? '…' : fmt(ytd.projected_year_end)}
            sub={`${fmtPct(ytd.projected_vs_target)} of annual target`}
            tone={
              !ytd.projected_year_end ? 'neutral'
              : ytd.projected_year_end >= (c.annual_target_t ?? 1_000_000) ? 'green'
              : ytd.projected_year_end >= (c.annual_floor_t  ?? 800_000)   ? 'amber'
              : 'rust'
            }
          />
        </div>

        {/* ── Phase 127 — Today live snapshot ──────────────────── */}
        {todayLive?.has_live_data && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'rgba(22,163,74,0.06)',
            border: '1px solid rgba(22,163,74,0.22)',
            borderRadius: 'var(--radius-md)',
            flexWrap: 'wrap',
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 9,
              letterSpacing: '0.08em',
              fontFamily: 'var(--font-mono)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--signal-green)',
              textTransform: 'uppercase',
              padding: '2px 7px',
              background: 'rgba(22,163,74,0.12)',
              borderRadius: 'var(--radius-sm)',
            }}>
              ● LIVE TODAY
            </span>
            <TodayStat
              label="Convoys dispatched"
              value={todayLive.convoy_count_today}
            />
            <TodayStat
              label="Tonnes southbound"
              value={todayLive.tonnes_today > 0 ? `${todayLive.tonnes_today.toLocaleString()} t` : '—'}
            />
            <TodayStat
              label="Active right now"
              value={todayLive.active_convoys}
            />
            <span style={{
              marginLeft: 'auto',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              {todayLive.date} · Excludes modelled historical data
            </span>
          </div>
        )}

        {/* ── Weekly throughput chart ────────────────────────────── */}
        <Panel
          title="Weekly corridor throughput"
          sub={`${weeks.length} weeks · target ${fmt(c.weekly_target_t)} t · floor ${fmt(c.weekly_floor_t)} t`}
        >
          {weeks.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={weeks}
                margin={{ top: 8, right: 24, bottom: 0, left: 12 }}
                barCategoryGap="30%"
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
                <XAxis
                  dataKey="week_of"
                  tickFormatter={shortWeek}
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false}
                  tickLine={false}
                  interval={1}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  domain={[12000, 'auto']}
                />
                <Tooltip content={<WeekTooltip contractTarget={c.weekly_target_t} contractFloor={c.weekly_floor_t} />} />
                <ReferenceLine y={c.weekly_target_t} stroke="var(--signal-green)" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Target', position: 'right', fontSize: 9, fill: 'var(--signal-green)', fontFamily: 'var(--font-mono)' }} />
                <ReferenceLine y={c.weekly_floor_t}  stroke="var(--signal-amber)" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Floor',  position: 'right', fontSize: 9, fill: 'var(--signal-amber)', fontFamily: 'var(--font-mono)' }} />
                <Bar dataKey="tonnes" fill="var(--bauxite-rust)" opacity={0.85} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {loading && <ChartSkeleton />}
        </Panel>

        {/* ── Two-column: cumulative progress + on-time rate ────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 0.7fr)',
          gap: 'var(--space-4)',
        }}>
          {/* Cumulative progress */}
          <Panel
            title="YTD cumulative progress"
            sub="Actual (filled) · Target (green) · Floor (amber)"
          >
            {cumulativeData.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart
                  data={cumulativeData}
                  margin={{ top: 8, right: 24, bottom: 0, left: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
                  <XAxis
                    dataKey="week_of"
                    tickFormatter={shortWeek}
                    tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<CumulativeTooltip />} />
                  {/* Floor band */}
                  <Area
                    type="monotone"
                    dataKey="floor"
                    stroke="rgba(217,158,55,0.6)"
                    fill="rgba(217,158,55,0.06)"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                  {/* Target line */}
                  <Area
                    type="monotone"
                    dataKey="target"
                    stroke="rgba(46,107,63,0.6)"
                    fill="rgba(46,107,63,0.06)"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                  {/* Actual — solid, rust fill */}
                  <Area
                    type="monotone"
                    dataKey="actual"
                    stroke="var(--bauxite-rust)"
                    fill="rgba(139,46,26,0.10)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
            {loading && <ChartSkeleton />}
          </Panel>

          {/* On-time delivery rate */}
          <Panel
            title="On-time delivery rate"
            sub="Southbound laden trips"
          >
            {weeks.length > 0 && (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={weeks}
                  margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
                  <XAxis
                    dataKey="week_of"
                    tickFormatter={shortWeek}
                    tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={2}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
                    axisLine={false}
                    tickLine={false}
                    domain={[70, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(v) => [`${v}%`, 'On-time']}
                    labelFormatter={shortMonth}
                    contentStyle={{
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: 4,
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                  <ReferenceLine y={90} stroke="rgba(46,107,63,0.4)" strokeDasharray="3 2" />
                  <Line
                    type="monotone"
                    dataKey="on_time_pct"
                    stroke="var(--bauxite-rust)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
            {loading && <ChartSkeleton height={200} />}
          </Panel>
        </div>

        {/* ── Hauler contribution table ──────────────────────────── */}
        <Panel
          title="Hauler contribution — 12-week window"
          sub={isHaulerAdmin ? 'Your fleet contribution for the period' : 'Ranked by tonnes delivered'}
        >
          <HaulerTable
            rows={isHaulerAdmin
              ? haulerTotals.filter((h) => h.hauler_id === myHaulerId)
              : haulerTotals}
            showShare={!isHaulerAdmin}
            corridorWeeklyTarget={c.weekly_target_t}
          />
        </Panel>

        {/* ── Phase 130: Per-hauler SLA & MTD attainment ────────── */}
        {!isHaulerAdmin && haulerAttainment.length > 0 && (
          <Panel
            title="Hauler SLA & MTD throughput"
            sub="Contracted vs actual tonnes MTD · SLA attainment % (right axis)"
          >
            <HaulerAttainmentChart rows={haulerAttainment} />
          </Panel>
        )}

        {/* ── Phase 154: Per-hauler stacked throughput ──────────── */}
        <HaulerThroughputChart weeks={weeks} haulerTotals={haulerTotals} />

        {/* ── Phase 165: Weekday throughput pattern ─────────────── */}
        <WeekdayPatternChart weekdayPattern={data?.weekday_pattern} />

        {/* ── Phase 178: Fuel efficiency vs throughput benchmark ─── */}
        {data?.efficiency_benchmark?.length > 0 && (
          <FuelEfficiencyBenchmark efficiencyBenchmark={data.efficiency_benchmark} />
        )}

        {/* ── Phase 194: Take-or-pay floor attainment ───────────── */}
        {data?.take_or_pay_risk?.length > 0 && (
          <TakeOrPayChart takeOrPayRisk={data.take_or_pay_risk} />
        )}

        {/* ── Phase 198: Revenue per corridor-km trend ──────────── */}
        {data?.revenue_per_km?.length > 0 && (
          <RevenuePerKmChart revenuePerKm={data.revenue_per_km} />
        )}

        {/* ── Phase 210: Avg payload per southbound trip, 12-week trend ─ */}
        {data?.avg_payload_trend?.length > 0 && (
          <AvgPayloadTrendChart avgPayloadTrend={data.avg_payload_trend} />
        )}

        {/* ── Phase 222: Per-hauler cost-per-tonne efficiency ranking ─ */}
        {data?.cost_per_tonne_rank?.length > 0 && (
          <HaulerCostRankChart costPerTonneRank={data.cost_per_tonne_rank} />
        )}

        {/* Phase 231 — trip payload histogram: underloaded trip share */}
        {data?.payload_histogram?.length > 0 && (
          <PayloadHistogramChart payloadHistogram={data.payload_histogram} />
        )}

        <IntelligencePanel page="analytics" />

      </div>
    </PageShell>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────── */

function KpiTile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? C_RUST
              : tone === 'amber' ? C_AMBER
              : tone === 'green' ? C_GREEN
              : C_TEXT;
  const ToneIcon = tone === 'rust'  ? TrendingDown
                 : tone === 'green' ? TrendingUp
                 : Minus;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div className="eyebrow" style={{ color: C_TERT, marginBottom: 8 }}>
        {label}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        marginBottom: 6,
      }}>
        <span className="tabular" style={{
          fontSize: 'var(--ts-h2-size)',
          fontWeight: 'var(--fw-black)',
          color,
          lineHeight: 1.1,
        }}>
          {value}
        </span>
        {tone && tone !== 'neutral' && (
          <ToneIcon size={14} strokeWidth={1.8} color={color} />
        )}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: C_TERT,
          lineHeight: 1.4,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── Panel wrapper ────────────────────────────────────────────────── */

function Panel({ title, sub, children }) {
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
        <span className="eyebrow">{title}</span>
        {sub && (
          <span style={{
            fontSize: 10,
            color: C_TERT,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.04em',
          }}>
            {sub}
          </span>
        )}
      </header>
      <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
        {children}
      </div>
    </section>
  );
}

/* ── Chart skeleton ───────────────────────────────────────────────── */

function ChartSkeleton({ height = 220 }) {
  return (
    <div style={{
      height,
      background: 'var(--accent-tint)',
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: C_TERT,
      fontSize: 'var(--ts-caption-size)',
    }}>
      Loading…
    </div>
  );
}

/* ── Week tooltip ─────────────────────────────────────────────────── */

function WeekTooltip({ active, payload, label, contractTarget, contractFloor }) {
  if (!active || !payload?.length) return null;
  const w = payload[0]?.payload;
  if (!w) return null;
  const belowFloor  = w.tonnes < contractFloor;
  const belowTarget = w.tonnes < contractTarget;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
      minWidth: 200,
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6, fontFamily: 'var(--font-primary)', fontSize: 12 }}>
        Week of {shortWeek(label)}
      </div>
      <Row label="Tonnes"   value={`${fmt(w.tonnes)} t`}     color={belowFloor ? C_RUST : belowTarget ? C_AMBER : C_GREEN} />
      <Row label="Target"   value={`${fmt(contractTarget)} t`} color={C_TERT} />
      <Row label="Floor"    value={`${fmt(contractFloor)} t`}  color={C_TERT} />
      <Row label="Laden trips" value={w.laden_trips}          color={C_TEXT} />
      <Row label="Delayed"  value={w.delayed_trips}           color={w.delayed_trips > 10 ? C_AMBER : C_TEXT} />
      <Row label="On-time"  value={`${w.on_time_pct}%`}       color={w.on_time_pct < 85 ? C_RUST : C_TEXT} />
      <Row label="Avg cycle" value={`${w.avg_cycle_h}h`}      color={C_TEXT} />
    </div>
  );
}

function CumulativeTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ fontWeight: 'var(--fw-semibold)', marginBottom: 6, fontFamily: 'var(--font-primary)', fontSize: 12 }}>
        w/e {shortWeek(label)}
      </div>
      <Row label="Actual"  value={`${fmt(d.actual)} t`}  color={C_RUST} />
      <Row label="Target"  value={`${fmt(d.target)} t`}  color="var(--signal-green)" />
      <Row label="Floor"   value={`${fmt(d.floor)} t`}   color="var(--signal-amber)" />
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 3 }}>
      <span style={{ color: C_TERT }}>{label}</span>
      <span style={{ color: color ?? C_TEXT, fontWeight: 'var(--fw-medium)' }}>{value}</span>
    </div>
  );
}

/* ── Hauler contribution table ────────────────────────────────────── */

function HaulerTable({ rows, showShare }) {
  if (!rows.length) return (
    <div style={{ padding: 'var(--space-4)', color: C_TERT, fontSize: 'var(--ts-body-sm-size)' }}>
      No hauler data.
    </div>
  );

  const maxTonnes = Math.max(...rows.map((h) => h.tonnes), 1);

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showShare ? '1.4fr 2fr 100px 100px 100px' : '1.4fr 2fr 100px 100px 100px',
        gap: 'var(--space-2)',
        padding: '6px 0',
        borderBottom: '1px solid var(--border-soft)',
        marginBottom: 4,
      }}>
        {['Hauler', 'Tonnes (12 wks)', 'Trips', 'On-time', showShare ? 'Share' : ''].map((h, i) =>
          h ? (
            <span key={i} className="micro" style={{ color: C_TERT }}>
              {h}
            </span>
          ) : <span key={i} />
        )}
      </div>

      {rows.map((h, rank) => {
        const accent = HAULER_ACCENT[h.hauler_id] ?? '#8B2E1A';
        const barPct = (h.tonnes / maxTonnes) * 100;
        return (
          <div
            key={h.hauler_id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 2fr 100px 100px 100px',
              gap: 'var(--space-2)',
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: rank < rows.length - 1 ? '1px solid var(--border-hairline)' : 'none',
            }}
          >
            {/* Hauler name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 2,
                background: accent, flexShrink: 0,
              }} />
              <span style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)' }}>
                {h.display_name}
              </span>
            </div>

            {/* Tonnes + bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                flex: 1,
                height: 6,
                background: 'var(--border-hairline)',
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${barPct}%`,
                  height: '100%',
                  background: accent,
                  opacity: 0.7,
                  borderRadius: 3,
                  transition: 'width 400ms ease',
                }} />
              </div>
              <span className="tabular" style={{ fontSize: 'var(--ts-caption-size)', color: C_TEXT, minWidth: 52, textAlign: 'right' }}>
                {fmt(h.tonnes)} t
              </span>
            </div>

            {/* Trips */}
            <span className="tabular" style={{ fontSize: 'var(--ts-caption-size)', color: C_TEXT }}>
              {h.trips.toLocaleString()}
            </span>

            {/* On-time pct */}
            <span className="tabular" style={{
              fontSize: 'var(--ts-caption-size)',
              color: h.on_time_pct >= 90 ? C_GREEN : h.on_time_pct >= 85 ? C_AMBER : C_RUST,
            }}>
              {h.on_time_pct}%
            </span>

            {/* Share (AXIS roles only) */}
            {showShare ? (
              <span className="tabular mono" style={{ fontSize: 'var(--ts-caption-size)', color: C_TERT }}>
                {h.share_pct}%
              </span>
            ) : <span />}
          </div>
        );
      })}
    </div>
  );
}

// Phase 127 — helper for the today-live banner.
function TodayStat({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        letterSpacing: '0.04em',
      }}>
        {label}
      </span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-size)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        {value}
      </span>
    </div>
  );
}

/* ── Phase 130: Hauler SLA & MTD attainment chart ─────────────────── */

const SLA_REF_COLOR  = 'rgba(46,107,63,0.45)';

function HaulerAttainmentChart({ rows }) {
  if (!rows.length) return null;

  // Build chart data: contracted (grey), actual (rust), SLA% (line, right axis)
  const chartData = rows.map((h) => ({
    name:        h.display_name.replace(/\s+Haulage.*/, '').replace(/\s+Transport.*/, ''),
    contracted:  h.tonnes_contracted,
    actual:      h.tonnes_mtd,
    sla:         h.sla_attainment_pct,
    on_time:     h.on_time_pct,
  }));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-4)', alignItems: 'start' }}>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 48, bottom: 0, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: 'var(--text-secondary)', fontFamily: 'var(--font-primary)' }}
            axisLine={false}
            tickLine={false}
          />
          {/* Left axis — tonnes */}
          <YAxis
            yAxisId="t"
            tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
          />
          {/* Right axis — SLA % */}
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
            }}
            formatter={(val, name) => {
              if (name === 'sla' || name === 'on_time') return [`${val}%`, name === 'sla' ? 'SLA' : 'On-time'];
              return [`${Math.round(val).toLocaleString()} t`, name === 'actual' ? 'Actual' : 'Contracted'];
            }}
          />
          {/* SLA 90% reference */}
          <ReferenceLine yAxisId="pct" y={90} stroke={SLA_REF_COLOR} strokeDasharray="3 2" />
          {/* Contracted — grey outline bar */}
          <Bar yAxisId="t" dataKey="contracted" fill="var(--border-soft)" radius={[2, 2, 0, 0]} name="contracted" />
          {/* Actual — rust fill bar */}
          <Bar yAxisId="t" dataKey="actual" fill="var(--bauxite-rust)" fillOpacity={0.85} radius={[2, 2, 0, 0]} name="actual" />
          {/* SLA line */}
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="sla"
            stroke="var(--signal-green)"
            strokeWidth={2}
            dot={{ r: 4, fill: 'var(--signal-green)', strokeWidth: 0 }}
            activeDot={{ r: 5 }}
            name="sla"
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12 }}>
        {[
          { color: 'var(--border-soft)', label: 'Contracted MTD' },
          { color: 'var(--bauxite-rust)', label: 'Actual MTD' },
          { color: 'var(--signal-green)', label: 'SLA %', line: true },
        ].map(({ color, label, line }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {line
              ? <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
              : <div style={{ width: 10, height: 10, background: color, borderRadius: 2 }} />
            }
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
