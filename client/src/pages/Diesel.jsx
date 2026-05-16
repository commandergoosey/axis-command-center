/*
 * Diesel watch — Phase 92.
 *
 * Trajectory of NPA diesel pump price (the corridor's #1 cost
 * variable), what it's doing to the indexation formula, and
 * what's queued for the next monthly tariff review. The Tariff
 * page shows the *effect* of the current reading on the headline
 * rate; this page is the *trajectory* — where has fuel been,
 * where is it going, what does it mean for the next reset.
 *
 * Per-hauler fuel cost / tonne table closes the loop on the
 * operational side: even with a generous pass-through cap, the
 * hauler whose trucks burn 8% more diesel than the corridor
 * average will eat that variance themselves. Coaching surface.
 */

import { useEffect, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Fuel, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, CalendarRange } from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import BurnEfficiencyStrip      from '../components/diesel/BurnEfficiencyStrip';
import HaulerBurnVarianceChart  from '../components/diesel/HaulerBurnVarianceChart';
import TariffSensitivityChart   from '../components/diesel/TariffSensitivityChart';
import DieselPriceTrend         from '../components/diesel/DieselPriceTrend';
import FleetEfficiencyChart     from '../components/diesel/FleetEfficiencyChart';
import DieselMonthlyCostChart  from '../components/diesel/DieselMonthlyCostChart';

export default function Diesel() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/diesel')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell
      eyebrow="Tariff"
      title="Diesel watch"
      description="The corridor's biggest cost variable. NPA monthly pump price, what it's doing to the indexation formula, and what's queued for the next tariff review on the 1st."
    >
      {error && <div style={errorBox}>Diesel watch unavailable — {error}</div>}
      {!data && !error && <div style={emptyBox}>Loading…</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <KpiStrip data={data} />

          <TrajectoryChart
            series={data.series}
            baseMonth={data.base_month}
            baseValue={data.base_ghs_per_l}
            currentValue={data.current_ghs_per_l}
          />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
            gap: 'var(--space-3)',
          }}>
            <PendingReview pending={data.pending_review} pass={data.pass_through} summary={data.summary} />
            <PassThroughCard pass={data.pass_through} summary={data.summary} />
          </div>

          <FleetBurn fleet={data.fleet_burn} />

          {/* Phase 149 — burn efficiency ranking: worst haulers at top */}
          <BurnEfficiencyStrip
            burnRanking={data.burn_ranking}
            corridorAvg={data.fleet_burn?.corridor_avg_fuel_usd_per_tonne}
          />

          {/* Phase 179 — diverging variance chart: who's above/below corridor avg */}
          <HaulerBurnVarianceChart
            burnRanking={data.burn_ranking}
            corridorAvg={data.fleet_burn?.corridor_avg_fuel_usd_per_tonne}
          />

          {/* Phase 186 — EBITDA sensitivity to diesel price scenarios */}
          <TariffSensitivityChart sensitivityScenarios={data.sensitivity_scenarios} />

          {/* Phase 159 — 12-week diesel price & burn-cost trend */}
          <DieselPriceTrend priceHistory={data.price_history} />

          {/* Phase 207 — per-hauler L/100km fleet efficiency */}
          {data.fleet_efficiency && (
            <FleetEfficiencyChart fleetEfficiency={data.fleet_efficiency} />
          )}

          {/* Phase 227 — 6-month corridor diesel cost trend */}
          {data.monthly_cost_trend?.length > 0 && (
            <DieselMonthlyCostChart monthlyCostTrend={data.monthly_cost_trend} />
          )}

          {/* Phase 115 — actual fill events from Phase 111 fuel logs */}
          <ActualBurnsPanel burns={data.actual_burns} />

          <div style={notesBox}>{data.notes}</div>
        </div>
      )}
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ data }) {
  const { current_month, current_ghs_per_l, summary, pass_through } = data;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile
        label="Current price"
        value={`${current_ghs_per_l.toFixed(2)}`}
        unit="GHS/L"
        sub={`as of ${formatMonth(current_month)} (NPA monthly avg)`}
        Icon={Fuel}
      />
      <Tile
        label="MoM change"
        value={fmtPct(summary.latest_change_pct)}
        unit=""
        sub="vs prior month"
        signed={summary.latest_change_pct}
      />
      <Tile
        label="Trailing 12m"
        value={fmtPct(summary.trailing_12m_pct)}
        unit=""
        sub="year-over-year"
        signed={summary.trailing_12m_pct}
      />
      <Tile
        label="vs base"
        value={fmtPct(summary.vs_base_pct)}
        unit=""
        sub={`base ${formatMonth(data.base_month)} · ${data.base_ghs_per_l.toFixed(2)} GHS/L`}
        signed={summary.vs_base_pct}
      />
    </div>
  );
}

function Tile({ label, value, unit, sub, signed, Icon }) {
  // For "signed" KPIs (% changes), color rust if positive (price up = cost up),
  // green if negative, tertiary if effectively zero.
  let color = 'var(--text)';
  let TrendIcon = null;
  if (signed != null) {
    if (signed > 0.05)      { color = 'var(--bauxite-rust)'; TrendIcon = ArrowUpRight; }
    else if (signed < -0.05){ color = 'var(--signal-green)'; TrendIcon = ArrowDownRight; }
    else                    { color = 'var(--text-tertiary)'; TrendIcon = Minus; }
  }
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          {label.toUpperCase()}
        </span>
        {Icon && <Icon size={12} strokeWidth={1.6} color="var(--text-tertiary)" />}
        {TrendIcon && <TrendIcon size={12} strokeWidth={1.6} color={color} />}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {value}{unit ? <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 'var(--fw-medium)', marginLeft: 4 }}>{unit}</span> : null}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ── Trajectory chart ──────────────────────────────────────────────

function TrajectoryChart({ series, baseMonth, baseValue, currentValue }) {
  const data = series.map((r) => ({
    month: formatMonth(r.month),
    raw_month: r.month,
    ghs_per_l: r.ghs_per_l,
  }));
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">NPA DIESEL TRAJECTORY</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Monthly pump price · GHS per litre · {series.length} months on tape
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h2-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {currentValue.toFixed(2)} GHS/L
          </div>
          <div className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            CURRENT
          </div>
        </div>
      </header>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border-hairline)' }}
              interval={1}
            />
            <YAxis
              stroke="var(--text-tertiary)"
              tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              domain={['dataMin - 0.5', 'dataMax + 0.5']}
              width={42}
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
              }}
              formatter={(v) => [`${Number(v).toFixed(2)} GHS/L`, 'NPA diesel']}
            />
            <ReferenceLine
              y={baseValue}
              stroke="var(--charcoal)"
              strokeDasharray="3 3"
              label={{
                value: `BASE · ${formatMonth(baseMonth)} · ${baseValue.toFixed(2)}`,
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                fill: 'var(--text-tertiary)',
                position: 'insideTopLeft',
              }}
            />
            <Line
              type="monotone"
              dataKey="ghs_per_l"
              stroke="var(--bauxite-rust)"
              strokeWidth={2}
              dot={{ r: 2.5, fill: 'var(--bauxite-rust)', strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ── Pending review callout ────────────────────────────────────────

function PendingReview({ pending, pass, summary }) {
  const isUp   = pending.would_delta_pct > 0;
  const isFlat = Math.abs(pending.would_delta_pct) < 0.05;
  const tone   = isFlat ? 'tertiary' : (isUp ? 'rust' : 'green');
  const color  = tone === 'rust'  ? 'var(--bauxite-rust)'
               : tone === 'green' ? 'var(--signal-green)'
               : 'var(--text-tertiary)';
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
        <CalendarRange size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
        <span className="eyebrow">NEXT REVIEW · {formatLongDate(pending.review_date)}</span>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 'var(--space-3)',
      }}>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>BASE TARIFF</div>
          <div className="tabular" style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
            ${pending.base_usd_per_tonne.toFixed(2)}<span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>/t</span>
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            contract reference rate
          </div>
        </div>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>WOULD APPLY</div>
          <div className="tabular" style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)', color }}>
            ${pending.would_effective_usd_per_tonne.toFixed(2)}<span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 4 }}>/t</span>
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            indexed effective rate
          </div>
        </div>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>DELTA</div>
          <div className="tabular" style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)', color }}>
            {pending.would_delta_pct >= 0 ? '+' : ''}{pending.would_delta_pct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            indexation adjustment
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
      }}>
        Fuel is contributing <strong style={{ color: 'var(--text)' }}>{summary.fuel_contribution_pct.toFixed(1)}%</strong> to
        the multiplier, on a fuel index of <strong style={{ color: 'var(--text)' }}>{summary.fuel_index.toFixed(4)}</strong>.
        With CPI and fixed components factored in, the next monthly reset would
        move the headline rate by <strong style={{ color }}>
          {pending.would_delta_pct >= 0 ? '+' : ''}{pending.would_delta_pct.toFixed(2)}%
        </strong>{' '}
        — {' '}
        {pass.clamped_at_cap   ? <span style={{ color: 'var(--bauxite-rust)' }}>capped at the {pass.cap_pct}% pass-through ceiling.</span>
         : pass.clamped_at_floor ? <span style={{ color: 'var(--signal-green)' }}>capped at the {pass.floor_pct}% pass-through floor.</span>
         : <span>well within the {pass.floor_pct}–{pass.cap_pct}% pass-through band.</span>}
      </div>
    </section>
  );
}

// ── Pass-through card ─────────────────────────────────────────────

function PassThroughCard({ pass, summary }) {
  // Visualize the multiplier on the floor..cap range as a horizontal bar.
  const cap   = pass.cap_pct;
  const floor = pass.floor_pct;
  const cur   = pass.multiplier * 100; // express as %
  const span  = cap - floor;
  const pos   = Math.max(0, Math.min(100, ((cur - floor) / span) * 100));
  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>PASS-THROUGH BAND</div>

      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color: pass.clamped_at_cap || pass.clamped_at_floor ? 'var(--bauxite-rust)' : 'var(--text)',
      }}>
        {cur.toFixed(1)}%
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-3)' }}>
        current multiplier · {pass.headroom_pct_points >= 0
          ? `${pass.headroom_pct_points.toFixed(1)} pts headroom to cap`
          : `${Math.abs(pass.headroom_pct_points).toFixed(1)} pts above cap (clamped)`}
      </div>

      <div style={{ position: 'relative', height: 8, background: 'var(--surface)', borderRadius: 4, marginTop: 8 }}>
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: '100%',
          background: 'linear-gradient(to right, rgba(46,107,63,0.15) 0%, rgba(217,158,55,0.15) 50%, rgba(139,46,26,0.15) 100%)',
          borderRadius: 4,
        }} />
        <div style={{
          position: 'absolute',
          left: `calc(${pos}% - 1px)`,
          top: -3, bottom: -3,
          width: 2,
          background: 'var(--bauxite-rust)',
          borderRadius: 1,
        }} />
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 10,
        color: 'var(--text-tertiary)',
      }}>
        <span className="mono">FLOOR · {floor}%</span>
        <span className="mono">100%</span>
        <span className="mono">CAP · {cap}%</span>
      </div>
    </section>
  );
}

// ── Fleet fuel-burn variance ──────────────────────────────────────

function FleetBurn({ fleet }) {
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
        <div>
          <div className="eyebrow">FLEET FUEL BURN</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Average fuel cost per laden tonne. Last {fleet.laden_trips_n} southbound trips · corridor benchmark:
            <span className="tabular" style={{ color: 'var(--text)', marginLeft: 6, fontWeight: 'var(--fw-medium)' }}>
              ${fleet.corridor_avg_fuel_usd_per_tonne.toFixed(2)}/t
            </span>
          </div>
        </div>
      </header>

      {fleet.per_hauler.length === 0 ? (
        <div style={{
          padding: 'var(--space-5)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          textAlign: 'center',
        }}>
          No laden trips on record yet.
        </div>
      ) : (
        <div>
          {fleet.per_hauler.map((h) => (
            <HaulerRow key={h.hauler_id} hauler={h} corridorAvg={fleet.corridor_avg_fuel_usd_per_tonne} />
          ))}
        </div>
      )}
    </section>
  );
}

function HaulerRow({ hauler, corridorAvg }) {
  // Bar visualises hauler $/t against a 25%-band visualisation around corridor avg.
  const lo = corridorAvg * 0.85;
  const hi = corridorAvg * 1.15;
  const pos = Math.max(0, Math.min(100, ((hauler.fuel_usd_per_tonne - lo) / (hi - lo)) * 100));
  const tone = hauler.signal === 'better' ? 'green'
             : hauler.signal === 'worse'  ? 'rust'
             : 'tertiary';
  const color = tone === 'green' ? 'var(--signal-green)'
              : tone === 'rust'  ? 'var(--bauxite-rust)'
              : 'var(--text-tertiary)';
  const label = hauler.signal === 'better' ? 'better than corridor'
              : hauler.signal === 'worse'  ? 'above corridor avg'
              : 'in line with corridor';
  const Sign = hauler.vs_corridor_pct > 0.5 ? ArrowUpRight
             : hauler.vs_corridor_pct < -0.5 ? ArrowDownRight
             : Minus;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr 100px 90px 110px',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: '10px 14px',
      borderBottom: '1px solid var(--border-hairline)',
    }}>
      <div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
          {hauler.display_name}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
          {hauler.hauler_id.toUpperCase()} · {hauler.trips_n} TRIPS · {hauler.tons.toFixed(0)}T
        </div>
      </div>

      <div style={{ position: 'relative', height: 6, background: 'var(--surface)', borderRadius: 3 }}>
        {/* corridor average tick */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: -3, bottom: -3,
          width: 1,
          background: 'var(--text-tertiary)',
          opacity: 0.5,
        }} />
        <div style={{
          position: 'absolute',
          left: `calc(${pos}% - 4px)`,
          top: -2, bottom: -2,
          width: 8, height: 10,
          background: color,
          borderRadius: 2,
        }} />
      </div>

      <div className="tabular" style={{
        textAlign: 'right',
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        ${hauler.fuel_usd_per_tonne.toFixed(2)}<span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>/t</span>
      </div>

      <div className="tabular" style={{
        textAlign: 'right',
        fontSize: 'var(--ts-body-sm-size)',
        color,
        fontWeight: 'var(--fw-medium)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        justifyContent: 'flex-end',
      }}>
        <Sign size={11} strokeWidth={1.8} />
        {hauler.vs_corridor_pct >= 0 ? '+' : ''}{hauler.vs_corridor_pct.toFixed(1)}%
      </div>

      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        textAlign: 'right',
      }}>
        {label}
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────

function fmtPct(v) {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function formatMonth(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

function formatLongDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
};
const emptyBox = {
  padding: 'var(--space-5)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
  textAlign: 'center',
};
const notesBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'transparent',
  border: '1px dashed var(--border-soft)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
};

// ── Phase 115 — Actual fills panel ────────────────────────────────
// Shows real fill events logged by hauler admins / ops (Phase 111).
// When no fills have been logged, renders a minimal prompt.

function ActualBurnsPanel({ burns }) {
  if (!burns) return null;

  const livePill = burns.has_live_data ? (
    <span style={{
      fontSize: 9, padding: '2px 6px',
      background: 'rgba(38,160,100,0.08)',
      border: '1px solid rgba(38,160,100,0.28)',
      borderRadius: 3, color: 'var(--signal-green)',
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }} className="mono">LIVE</span>
  ) : (
    <span style={{
      fontSize: 9, padding: '2px 6px',
      border: '1px solid var(--border-soft)',
      borderRadius: 3, color: 'var(--text-tertiary)',
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }} className="mono">NO FILLS LOGGED</span>
  );

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Fuel size={14} strokeWidth={1.5} style={{ color: 'var(--text-tertiary)' }} />
        <span className="eyebrow">Actual corridor fills</span>
        {livePill}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Last 30 days
        </span>
      </div>

      {!burns.has_live_data ? (
        <p style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', margin: 0 }}>
          No fill events logged. Hauler admins and ops can record fills from the fleet drawer on each rig.
        </p>
      ) : (
        <>
          {/* Corridor totals */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-4)',
            marginBottom: 'var(--space-4)',
          }}>
            <BurnStat label="Total fills" value={burns.fill_count} />
            <BurnStat label="Total litres" value={`${burns.total_litres.toLocaleString()} L`} />
            <BurnStat
              label="Total cost"
              value={burns.total_cost_ghs != null ? `GHS ${burns.total_cost_ghs.toLocaleString()}` : '—'}
            />
          </div>

          {/* Per-hauler table */}
          {burns.by_hauler.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                  {['Hauler', 'Fills', 'Litres', 'Cost (GHS)', 'Last fill'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '0 0 var(--space-2)',
                      fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)',
                      fontWeight: 'var(--fw-medium)', textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {burns.by_hauler.map((r) => (
                  <tr key={r.hauler_id} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                    <td style={{ padding: 'var(--space-2) 0', color: 'var(--text)' }}>
                      {r.hauler_id}
                    </td>
                    <td style={{ padding: 'var(--space-2) 0', color: 'var(--text-secondary)' }}>
                      {r.fill_count}
                    </td>
                    <td className="mono" style={{ padding: 'var(--space-2) 0', color: 'var(--text)' }}>
                      {r.total_litres.toLocaleString()} L
                    </td>
                    <td className="mono" style={{ padding: 'var(--space-2) 0', color: 'var(--text-secondary)' }}>
                      {r.total_cost_ghs != null ? r.total_cost_ghs.toLocaleString() : '—'}
                    </td>
                    <td style={{ padding: 'var(--space-2) 0', color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>
                      {r.last_fill_at
                        ? new Date(r.last_fill_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function BurnStat({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h3-size)',
        fontWeight: 'var(--fw-black)',
        color: 'var(--text)',
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        {label}
      </div>
    </div>
  );
}
