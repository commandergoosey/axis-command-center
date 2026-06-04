/*
 * TakeOrPayForecast — Phase 42.
 *
 * Forward-looking complement to DominantStoryCard. The dominant story
 * tells the operator "where we are today"; this card tells them "where
 * we'll land at month-end if today's pace holds, and what's the smallest
 * lever that flips the verdict."
 *
 * Visual structure mirrors HeroPanel's restraint: one big projected
 * number, one progress bar with the floor + nameplate marked, a
 * "required to clear floor" line, and the top three idle-truck levers
 * keyed to the verdict tone (rust = below floor, amber = drifting,
 * green = on pace for contracted).
 */

import { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Sliders } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import ScenarioPlanner from './ScenarioPlanner';

const VERDICT_TONE = {
  on_pace_for_contracted: { color: 'var(--signal-green)', icon: TrendingUp,   label: 'On pace for contracted' },
  above_floor:            { color: 'var(--text)',         icon: Minus,        label: 'Above floor, below contracted' },
  banked_floor_drift:     { color: 'var(--signal-amber)', icon: Minus,        label: 'Floor banked — pace slipping' },
  below_floor_at_pace:    { color: 'var(--bauxite-rust)', icon: TrendingDown, label: 'Below floor at current pace' },
};

export default function TakeOrPayForecast({ forecast, onScenarioSaved }) {
  // Falls back to its own fetch if not provided by the parent — keeps the
  // component usable from the digest page (which composes server-side)
  // and from any future placement without prop-drilling.
  const [own, setOwn] = useState(null);
  // Phase 43 — 14-day projection trend, fetched independently so the
  // sparkline lazily appears when there's snapshot history to draw on.
  const [history, setHistory] = useState(null);

  useEffect(() => {
    if (forecast) return;
    let abort = false;
    authFetch('/api/today/forecast')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abort && j) setOwn(j); })
      .catch(() => { /* silent — card is composable, not critical */ });
    return () => { abort = true; };
  }, [forecast]);

  useEffect(() => {
    let abort = false;
    authFetch('/api/today/forecast/history?days=14')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!abort && j) setHistory(j); })
      .catch(() => { /* silent — sparkline is decorative */ });
    return () => { abort = true; };
  }, [forecast]);

  // Phase 50 — scenario planner modal state.
  const [scenarioOpen, setScenarioOpen] = useState(false);

  const f = forecast ?? own;
  if (!f) return null;

  const verdict = VERDICT_TONE[f.projection.verdict] ?? VERDICT_TONE.above_floor;
  const VerdictIcon = verdict.icon;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">Take-or-pay forecast · month-end</div>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            {f.horizon.days_elapsed}/{f.horizon.days_in_month} days elapsed ·{' '}
            <span className="tabular">{f.horizon.days_remaining}</span> remaining
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: verdict.color,
            fontSize: 'var(--ts-caption-size)',
            fontWeight: 'var(--fw-medium)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}>
            <VerdictIcon size={13} strokeWidth={1.8} />
            {verdict.label}
          </div>
          {/* Phase 50 — opens the scenario planner. Subtle by design;
              the forecast card is loud enough already. */}
          <button
            type="button"
            onClick={() => setScenarioOpen(true)}
            title="Model truck activations, workorder closures, and pace lifts"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Sliders size={12} strokeWidth={1.6} />
            Run scenario
          </button>
        </div>
      </header>

      <ScenarioPlanner
        open={scenarioOpen}
        baseline={f}
        onClose={() => setScenarioOpen(false)}
        onSaved={onScenarioSaved}
      />

      {/* ── Projected number + comparison ─────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 'var(--space-5)',
        alignItems: 'flex-end',
        marginBottom: 'var(--space-4)',
      }}>
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Projected EOM
          </div>
          <div className="tabular" style={{
            fontSize: 'var(--ts-h1-size, 32px)',
            lineHeight: 1.05,
            fontWeight: 'var(--fw-black)',
            color: verdict.color,
          }}>
            {kt(f.projection.eom_tonnes)}
            <span style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-tertiary)',
              fontWeight: 'var(--fw-regular)',
              marginLeft: 6,
            }}>kt</span>
          </div>
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            <span className="tabular">{f.projection.pct_of_floor}%</span> of floor ·{' '}
            <span className="tabular">{f.projection.pct_of_monthly}%</span> of contracted
          </div>
        </div>

        <ProgressBar
          delivered={f.actual.delivered_mtd}
          projected={f.projection.eom_tonnes}
          floor={f.targets.floor}
          monthly={f.targets.monthly}
        />
      </div>

      {/* ── 14-day projection trend (Phase 43) ────────────────── */}
      {history && history.points && history.points.length >= 2 && (
        <TrendSparkline
          points={history.points}
          floor={f.targets.floor}
          monthly={f.targets.monthly}
        />
      )}

      {/* ── What it would take ─────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <Stat
          label="Daily avg now"
          value={`${num(f.actual.daily_avg)} t/d`}
          tone="text"
        />
        <Stat
          label="Required to clear floor"
          value={
            f.required.daily_to_floor > 0
              ? `${num(f.required.daily_to_floor)} t/d`
              : 'Floor cleared'
          }
          tone={f.required.daily_to_floor > f.actual.daily_avg ? 'rust' : 'green'}
          sub={
            f.required.lift_pct_to_floor != null && f.required.lift_pct_to_floor > 0
              ? `+${f.required.lift_pct_to_floor.toFixed(1)}% lift`
              : null
          }
        />
        <Stat
          label={f.projection.shortfall_to_floor > 0 ? 'Shortfall to floor' : 'Surplus over floor'}
          value={`${num(f.projection.shortfall_to_floor || f.projection.surplus_over_floor)} t`}
          tone={f.projection.shortfall_to_floor > 0 ? 'rust' : 'green'}
          sub={
            f.horizon.days_remaining > 0
              ? `over ${f.horizon.days_remaining}d remaining`
              : 'month closed'
          }
        />
      </div>

      {/* ── Workshop drag (Phase 47) ─────────────────────────────── */}
      {f.workshop_drag && f.workshop_drag.open_count > 0 && (
        <WorkshopDragRow drag={f.workshop_drag} />
      )}

      {/* ── Levers — only when there's a gap to close ───────────── */}
      {f.projection.shortfall_to_floor > 0 && f.levers.by_hauler.length > 0 && (
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 6,
          }}>
            <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
              Idle-truck levers
            </span>
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              Activating all idle trucks recovers{' '}
              <span className="tabular" style={{ color: 'var(--text)' }}>
                {num(f.levers.total_remainder_recovery_if_all_active)} t
              </span>
              {f.levers.pct_of_floor_gap_closed != null && (
                <> — <span className="tabular" style={{
                  color: f.levers.pct_of_floor_gap_closed >= 100 ? 'var(--signal-green)' : 'var(--signal-amber)',
                }}>{f.levers.pct_of_floor_gap_closed.toFixed(0)}% of gap</span></>
              )}
            </span>
          </div>
          <ol style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
          }}>
            {f.levers.by_hauler.slice(0, 3).map((l) => (
              <li
                key={l.hauler_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1.4fr) auto auto',
                  columnGap: 'var(--space-3)',
                  alignItems: 'baseline',
                  padding: '6px 0',
                  borderTop: '1px solid var(--border-hairline)',
                  fontSize: 'var(--ts-body-sm-size)',
                }}
              >
                <span style={{ color: 'var(--text)' }}>{l.display_name}</span>
                <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                  {l.active_trucks}/{l.contracted_trucks} trucks ·{' '}
                  <span style={{ color: 'var(--bauxite-rust)' }}>{l.idle_trucks} idle</span>
                </span>
                <span className="tabular" style={{ color: 'var(--text)', textAlign: 'right' }}>
                  +{num(l.remainder_recovery)} t
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ── Internals ────────────────────────────────────────────────────

// Phase 47 — Workshop drag. Surfaces "open work orders cost X t over the
// month" so operators see the consequence of dwell time directly. The
// row collapses by default; clicking "details" expands the per-workorder
// table. Hidden when there are no open workorders (no drag = no signal).
function WorkshopDragRow({ drag }) {
  const [expanded, setExpanded] = useState(false);
  const significant = drag.pct_of_floor_gap != null && drag.pct_of_floor_gap >= 25;
  const tone = significant ? 'var(--bauxite-rust)' : 'var(--text-secondary)';

  return (
    <div style={{
      marginBottom: 'var(--space-4)',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          Workshop drag
        </span>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
        }}>
          <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {drag.open_count}
          </span>
          {' '}open · costing{' '}
          <span className="tabular" style={{ color: tone, fontWeight: 'var(--fw-medium)' }}>
            {drag.total_drag.toLocaleString()} t
          </span>
          {' '}over the month
          {drag.pct_of_floor_gap != null && drag.pct_of_floor_gap > 0 && (
            <> ({drag.pct_of_floor_gap.toFixed(0)}% of floor gap)</>
          )}
          {' · '}
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--bauxite-rust)',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {expanded ? 'hide' : 'details'}
          </button>
        </span>
      </div>
      {expanded && (
        <ol style={{
          listStyle: 'none',
          margin: '6px 0 0',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {drag.by_workorder.slice(0, 5).map((w) => (
            <li key={w.workorder_id} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.6fr) auto auto',
              columnGap: 'var(--space-3)',
              alignItems: 'baseline',
              padding: '4px 0',
              borderTop: '1px solid var(--border-hairline)',
              fontSize: 'var(--ts-caption-size)',
            }}>
              <span style={{
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                <span className="mono" style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>
                  {w.rig_id}
                </span>
                {w.title}
              </span>
              <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                {w.days_open.toFixed(1)}d open
              </span>
              <span className="tabular" style={{ color: 'var(--bauxite-rust)', textAlign: 'right' }}>
                −{w.total_drag.toLocaleString()} t
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProgressBar({ delivered, projected, floor, monthly }) {
  // Bar runs 0 → monthly. Fill = MTD delivered (solid). Ghost = the
  // additional projected delivery between now and EOM (translucent).
  // Floor and monthly cap are marked as vertical pins so the operator
  // sees the two horizons against the actual + projected fill.
  const pct = (v) => Math.min(100, Math.max(0, (v / monthly) * 100));
  const deliveredPct = pct(delivered);
  const projectedPct = pct(projected);
  const floorPct     = pct(floor);

  return (
    <div style={{ width: '100%' }}>
      {/* Tick row: floor + monthly marker labels */}
      <div style={{
        position: 'relative',
        height: 14,
        fontSize: 10,
        color: 'var(--text-tertiary)',
      }}>
        <span className="mono" style={{
          position: 'absolute',
          left: `${floorPct}%`,
          transform: 'translateX(-50%)',
        }}>FLOOR · {kt(floor)}kt</span>
        <span className="mono" style={{
          position: 'absolute',
          right: 0,
        }}>NAMEPLATE · {kt(monthly)}kt</span>
      </div>
      {/* The bar itself */}
      <div style={{
        position: 'relative',
        height: 10,
        background: 'var(--surface)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        {/* Projected ghost extension */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${projectedPct}%`,
          background: 'var(--bauxite-rust)',
          opacity: 0.22,
        }} />
        {/* Delivered solid */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${deliveredPct}%`,
          background: 'var(--bauxite-rust)',
        }} />
        {/* Floor pin */}
        <div style={{
          position: 'absolute',
          left: `${floorPct}%`,
          top: -2, bottom: -2,
          width: 1.5,
          background: 'var(--text)',
        }} />
      </div>
      {/* Bottom legend */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 4,
        fontSize: 10,
        color: 'var(--text-tertiary)',
      }}>
        <span className="mono">DELIVERED · {kt(delivered)}kt</span>
        <span className="mono">PROJECTED · {kt(projected)}kt</span>
      </div>
    </div>
  );
}

// Phase 43 — 14-day projection trend.
//
// Each bar is one daily snapshot. The dashed line is the floor target
// (the contractual line operators are trying to clear). Bar tone:
//   - rust solid for snapshots BELOW floor
//   - text-secondary for snapshots AT/ABOVE floor
//   - the right-most bar (today) gets a tiny dot below it as a "you are here" tick
function TrendSparkline({ points, floor }) {
  // Y-axis domain: tight around the floor so the trend reads dramatically
  // rather than sitting in the middle of a 0..nameplate canvas.
  const values = points.map((p) => p.eom_tonnes);
  const lo = Math.min(...values, floor) * 0.985;
  const hi = Math.max(...values, floor) * 1.015;
  const span = Math.max(1, hi - lo);
  const yFrac = (v) => 1 - (v - lo) / span;

  const first = points[0];
  const last  = points[points.length - 1];
  const delta = last.eom_tonnes - first.eom_tonnes;
  const deltaPct = first.eom_tonnes > 0
    ? (delta / first.eom_tonnes) * 100
    : 0;

  return (
    <div style={{
      marginBottom: 'var(--space-4)',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 6,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
          Projected EOM trend · {points.length} d
        </span>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          <span className="tabular" style={{
            color: delta >= 0 ? 'var(--signal-green)' : 'var(--bauxite-rust)',
            fontWeight: 'var(--fw-medium)',
          }}>
            {delta >= 0 ? '+' : '−'}{Math.abs(Math.round(delta)).toLocaleString('en-US')} t
          </span>
          {' '}({delta >= 0 ? '+' : '−'}{Math.abs(deltaPct).toFixed(1)}%) since {first.date.slice(5)}
        </span>
      </div>
      <div style={{
        position: 'relative',
        height: 44,
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 6px',
      }}>
        {/* Floor reference line */}
        <div style={{
          position: 'absolute',
          left: 6, right: 6,
          top: `calc(${(yFrac(floor) * 100).toFixed(2)}% + 4px)`,
          borderTop: '1px dashed var(--border-strong, var(--text-tertiary))',
          opacity: 0.7,
        }} />
        {/* Bars */}
        <div style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${points.length}, 1fr)`,
          gap: 2,
          alignItems: 'flex-end',
          height: '100%',
        }}>
          {points.map((p, i) => {
            const isToday   = i === points.length - 1;
            const belowFloor = p.eom_tonnes < floor;
            const heightPct  = (1 - yFrac(p.eom_tonnes)) * 100;
            return (
              <div
                key={p.date}
                title={`${p.date} · ${(p.eom_tonnes / 1000).toFixed(1)} kt projected · ${p.pct_of_floor}% of floor`}
                style={{
                  height: `${Math.max(4, heightPct)}%`,
                  background: belowFloor
                    ? 'var(--bauxite-rust)'
                    : 'var(--text-secondary)',
                  opacity: belowFloor ? 1 : 0.55,
                  borderRadius: 1,
                  outline: isToday ? '1px solid var(--text)' : 'none',
                  outlineOffset: isToday ? 0 : 0,
                }}
              />
            );
          })}
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: 4,
        fontSize: 10,
        color: 'var(--text-tertiary)',
      }}>
        <span className="mono">{first.date.slice(5)}</span>
        <span className="mono">today · {(last.eom_tonnes / 1000).toFixed(1)}kt</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = 'text' }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : 'var(--text)';
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-3)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {label}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h3-size, 18px)',
        lineHeight: 1.1,
        fontWeight: 'var(--fw-medium)',
        color,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function num(n) {
  return (n ?? 0).toLocaleString('en-US');
}
function kt(n) {
  return (Math.round((n ?? 0) / 100) / 10).toLocaleString('en-US', { minimumFractionDigits: 1 });
}
