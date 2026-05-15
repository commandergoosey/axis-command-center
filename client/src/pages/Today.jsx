/*
 * Today — the corridor briefing.
 * Composition: hero panel + dominant story + supporting row (convoy cycle,
 * hauler contribution) + brief strip + AXIS Intelligence input on the left;
 * observations + action items + hauler status on the right.
 *
 * Data source: /api/today (composed) + /api/snapshot for the hero figures.
 */

import { authFetch } from '../lib/auth';
import { useAuth }   from '../lib/AuthContext';

import { useCallback, useEffect, useState } from 'react';

import HeroPanel               from '../components/today/HeroPanel';
import DominantStoryCard       from '../components/today/DominantStoryCard';
import HandoverCard            from '../components/today/HandoverCard';
import BroadcastBanner         from '../components/today/BroadcastBanner';
import TakeOrPayForecast       from '../components/today/TakeOrPayForecast';
import ScenarioLibrary         from '../components/today/ScenarioLibrary';
import ConvoyCycleCard         from '../components/today/ConvoyCycleCard';
import HaulerContributionCard  from '../components/today/HaulerContributionCard';
import BriefStrip              from '../components/today/BriefStrip';
import IntelligenceInput       from '../components/today/IntelligenceInput';
import ObservationFeed         from '../components/today/ObservationFeed';
import ActionItems             from '../components/today/ActionItems';
import HaulerStatusList        from '../components/today/HaulerStatusList';
import OperationsLog           from '../components/today/OperationsLog';
import UpcomingStrip           from '../components/today/UpcomingStrip';
import PinboardPanel           from '../components/today/PinboardPanel';
import PlaybookItemsPanel      from '../components/today/PlaybookItemsPanel';

export default function Today() {
  const [snapshot, setSnapshot] = useState(null);
  const [today, setToday]       = useState(null);
  const [intel, setIntel]       = useState({ chips: [], mode: null });
  const [error, setError]       = useState(null);
  // Phase 71 — bumped when a scenario is saved so ScenarioLibrary
  // refetches without a page reload.
  const [scenarioRefresh, setScenarioRefresh] = useState(0);

  // Pulled out of useEffect so QuickAction (inline close-out on action
  // items) can re-trigger the briefing after a successful write.
  const load = useCallback(async () => {
    try {
      const [sRes, tRes, oRes, stRes] = await Promise.all([
        authFetch('/api/snapshot'),
        authFetch('/api/today'),
        authFetch('/api/intelligence/observe?page=today'),
        authFetch('/api/intelligence/status'),
      ]);
      if (!sRes.ok || !tRes.ok) throw new Error('Briefing unavailable');
      const [s, t, o, st] = await Promise.all([
        sRes.json(), tRes.json(),
        oRes.ok ? oRes.json() : { chips: [] },
        stRes.ok ? stRes.json() : { mode: 'demonstration' },
      ]);
      setSnapshot(s);
      setToday(t);
      setIntel({ chips: o.chips ?? [], mode: st.mode });
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div
      style={{
        padding: 'var(--content-pad)',
        display: 'grid',
        gridTemplateColumns: '1fr var(--right-rail)',
        gap: 'var(--space-5)',
        animation: 'fade-up 220ms ease-out',
      }}
    >
      {/* ── Left column ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <HeroPanel corridor={snapshot?.corridor} health={snapshot?.health} />

        {error && <ErrorStrip message={error} />}

        <LiveOpsStrip liveOps={today?.live_ops} />

        <ThroughputStrip throughput={today?.throughput} onTargetSet={load} />

        <TodayConvoySchedule convoys={today?.today_convoys} />

        <BroadcastBanner refreshKey={today?.generated_at} />

        <DominantStoryCard story={today?.dominant_story} />

        <HandoverCard refreshKey={today?.generated_at} />

        <TakeOrPayForecast
          forecast={today?.forecast}
          onScenarioSaved={() => setScenarioRefresh((n) => n + 1)}
        />

        <ScenarioLibrary refreshKey={scenarioRefresh} />

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}>
          <ConvoyCycleCard series={today?.convoy_cycle} />
          <HaulerContributionCard contribution={today?.hauler_contribution} />
        </div>

        <BriefStrip items={today?.brief_strip} />

        <IntelligenceInput page="today" chips={intel.chips} mode={intel.mode} />

        <OperationsLog key={today?.generated_at /* re-mount to refetch when briefing reloads */} />
      </div>

      {/* ── Right column ─────────────────────────────────────────── */}
      <aside style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
      }}>
        <ObservationFeed observations={today?.observations} />
        <UpcomingStrip refreshKey={today?.generated_at} />
        <PlaybookItemsPanel refreshKey={today?.generated_at} />
        <PinboardPanel refreshKey={today?.generated_at} />
        <ActionItems items={today?.action_items} onMutate={load} />
        <HaulerStatusList haulers={today?.hauler_status} />
      </aside>
    </div>
  );
}

function ErrorStrip({ message }) {
  return (
    <div style={{
      padding: 'var(--space-3) var(--space-4)',
      background: 'rgba(139, 46, 26, 0.06)',
      border: '1px solid rgba(139, 46, 26, 0.22)',
      borderRadius: 'var(--radius-sm)',
      color: 'var(--signal-red)',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      {message}
    </div>
  );
}

// ── Phase 108: Live operational status strip ────────────────────────
// Shows fleet / driver / convoy counts derived from the Phase 101–103
// operator write surfaces (convoy dispatch, fleet status, driver status).
// When no operator writes have occurred, shows MODELLED badge — same
// convention as HeroPanel. Once any write is recorded, the badge
// flips to LIVE and the counts reflect real in-session state.

function LiveOpsStrip({ liveOps }) {
  if (!liveOps) return null;
  const { fleet, drivers, convoys, has_live_data } = liveOps;

  return (
    <section
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        <span className="eyebrow">Operational status</span>
        {has_live_data ? (
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: '2px 6px',
              background: 'rgba(38, 160, 100, 0.08)',
              border: '1px solid rgba(38, 160, 100, 0.28)',
              borderRadius: 3,
              color: 'var(--signal-green)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            LIVE
          </span>
        ) : (
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: '2px 6px',
              border: '1px solid var(--border-soft)',
              borderRadius: 3,
              color: 'var(--text-tertiary)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            MODELLED
          </span>
        )}
        {has_live_data && fleet.overrides_count > 0 && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
          }}>
            {fleet.overrides_count} truck override{fleet.overrides_count === 1 ? '' : 's'} applied
          </span>
        )}
      </div>

      {/* Metric tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-4)',
      }}>
        <OpsMetric
          label="Active trucks"
          value={fleet.active}
          sub={`${fleet.idle} idle · ${fleet.garage} garage`}
          tone={fleet.active < Math.round(fleet.total * 0.70) ? 'warn' : 'ok'}
        />
        <OpsMetric
          label="Critical flags"
          value={fleet.critical_flags}
          sub={fleet.critical_flags === 0 ? 'Fleet clear' : 'Needs workorder'}
          tone={fleet.critical_flags > 0 ? 'warn' : 'ok'}
        />
        <OpsMetric
          label="Live convoys"
          value={convoys.active_count}
          sub={
            convoys.active_count === 0
              ? 'None dispatched'
              : `${convoys.truck_count} truck${convoys.truck_count === 1 ? '' : 's'} en route`
          }
          tone="neutral"
        />
        <OpsMetric
          label="Driver flags"
          value={drivers.flagged}
          sub={
            drivers.unavailable > 0
              ? `${drivers.unavailable} off duty`
              : drivers.flagged === 0 ? 'All clear' : `${drivers.rest_breaches} rest breach${drivers.rest_breaches === 1 ? '' : 'es'}`
          }
          tone={drivers.flagged > 0 || drivers.rest_breaches > 0 ? 'warn' : 'ok'}
        />
      </div>
    </section>
  );
}

function OpsMetric({ label, value, sub, tone = 'neutral' }) {
  const valueColor =
    tone === 'warn' ? 'var(--signal-amber)'
    : tone === 'ok' ? 'var(--text)'
    : 'var(--text)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        className="tabular"
        style={{
          fontSize: 'var(--ts-h2-size)',
          fontWeight: 'var(--fw-black)',
          color: valueColor,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        className="micro"
        style={{
          color: 'var(--text-tertiary)',
          marginTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        lineHeight: 1.3,
      }}>
        {sub}
      </div>
    </div>
  );
}

// ── Phase 118: Today's live convoy schedule ────────────────────────
// Shows all convoys dispatched today from the live convoy_dispatches table.
// Only renders when at least one convoy has been dispatched.
// Phase 119: overdue convoys are highlighted in rust.

const PHASE_LABEL = {
  loading: 'Loading',
  laden:   'En route',
  offload: 'Offloading',
  complete: 'Complete',
};

const PHASE_COLOR = {
  loading:  'var(--text-tertiary)',
  laden:    'var(--signal-green)',
  offload:  'var(--signal-amber)',
  complete: 'var(--text-tertiary)',
};

function TodayConvoySchedule({ convoys }) {
  if (!convoys?.length) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        <span className="eyebrow">Today's convoy schedule</span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
          {convoys.length} dispatched
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '110px 80px 80px 70px 80px 1fr',
        columnGap: 'var(--space-3)',
      }}>
        {['Ref', 'Hauler', 'Planned dep', 'Trucks', 'Status', 'Tonnage'].map((h) => (
          <div key={h} className="mono" style={{
            fontSize: 9,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            paddingBottom: 'var(--space-2)',
            borderBottom: '1px solid var(--border-hairline)',
          }}>
            {h}
          </div>
        ))}

        {convoys.map((c) => {
          const overdue  = c.is_overdue;
          const cell = {
            padding: '10px 0',
            borderBottom: '1px solid var(--border-hairline)',
            fontSize: 'var(--ts-body-sm-size)',
            color: overdue ? 'var(--bauxite-rust)' : 'var(--text)',
          };
          const plannedTime = c.planned_departure_iso
            ? new Date(c.planned_departure_iso).toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
              })
            : '—';
          const actualTime = c.actual_departure_iso
            ? new Date(c.actual_departure_iso).toLocaleTimeString('en-GB', {
                hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
              })
            : null;

          const tonnes = c.delivered_tonnes ?? c.cargo_tonnes;

          return (
            <>
              <span key={`ref-${c.id}`} className="mono" style={{ ...cell, fontWeight: 'var(--fw-medium)' }}>
                {c.convoy_ref}
                {overdue && (
                  <span style={{
                    marginLeft: 4, fontSize: 8, padding: '1px 4px',
                    background: 'rgba(162,62,35,0.15)', borderRadius: 2,
                    color: 'var(--bauxite-rust)', letterSpacing: '0.08em',
                  }}>OVD</span>
                )}
              </span>
              <span key={`hauler-${c.id}`} style={{ ...cell, color: 'var(--text-secondary)' }}>
                {c.hauler_display}
              </span>
              <span key={`dep-${c.id}`} className="mono" style={{ ...cell, color: overdue ? 'var(--bauxite-rust)' : 'var(--text-secondary)' }}>
                {actualTime
                  ? <><span style={{ textDecoration: 'line-through', color: 'var(--text-tertiary)' }}>{plannedTime}</span>{' '}{actualTime}</>
                  : plannedTime}
              </span>
              <span key={`trucks-${c.id}`} style={{ ...cell, color: 'var(--text-secondary)' }}>
                {c.trucks}
              </span>
              <span key={`phase-${c.id}`} style={{ ...cell, color: overdue ? 'var(--bauxite-rust)' : PHASE_COLOR[c.phase] ?? 'var(--text-tertiary)' }}>
                {PHASE_LABEL[c.phase] ?? c.phase}
              </span>
              <span key={`tonnes-${c.id}`} className="mono" style={{ ...cell, color: 'var(--text-secondary)' }}>
                {tonnes != null ? `${tonnes.toLocaleString()} t` : '—'}
                {c.delivered_tonnes != null && c.phase === 'complete' && (
                  <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>✓</span>
                )}
              </span>
            </>
          );
        })}
      </div>
    </section>
  );
}

// ── Phase 112: Daily throughput strip ──────────────────────────────
// Shows actual southbound tonnage dispatched today vs. the daily target.
// axis_admin / axis_ops may set or edit the target inline.

function ThroughputStrip({ throughput, onTargetSet }) {
  const { user } = useAuth();
  const canSetTarget = user?.role === 'axis_admin' || user?.role === 'axis_ops';

  const [editing,  setEditing]  = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState(null);

  if (!throughput) return null;

  const { actual_tonnes, convoy_count, target_tonnes, pct, set_by, by_hauler = [] } = throughput;

  // Progress bar / percentage colour
  const barColor =
    pct == null   ? 'var(--signal-amber)'
    : pct >= 100  ? 'var(--signal-green)'
    : pct >= 50   ? 'var(--signal-amber)'
    : 'var(--signal-red)';

  const barWidth = pct != null ? Math.min(100, pct) : 0;

  async function handleSetTarget(e) {
    e.preventDefault();
    const tonnes = parseFloat(inputVal);
    if (!tonnes || tonnes <= 0) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const res = await authFetch('/api/today/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_tonnes: tonnes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to save target');
      }
      setEditing(false);
      setInputVal('');
      onTargetSet();
    } catch (err) {
      setSaveErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}
    >
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        <span className="eyebrow">Daily throughput</span>
        <span style={{
          marginLeft: 'auto',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {convoy_count} southbound convoy{convoy_count === 1 ? '' : 's'} today
        </span>
      </div>

      {/* Tonnage row */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
      }}>
        <span
          className="tabular"
          style={{
            fontSize: 'var(--ts-h1-size)',
            fontWeight: 'var(--fw-black)',
            lineHeight: 1,
            color: 'var(--text)',
          }}
        >
          {actual_tonnes.toLocaleString()}
        </span>
        <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
          t actual
        </span>

        {target_tonnes != null && (
          <>
            <span style={{ color: 'var(--text-tertiary)', margin: '0 2px' }}>/</span>
            <span
              className="tabular"
              style={{
                fontSize: 'var(--ts-h3-size)',
                fontWeight: 'var(--fw-semibold)',
                color: 'var(--text-secondary)',
              }}
            >
              {target_tonnes.toLocaleString()}
            </span>
            <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
              t target
            </span>
            {pct != null && (
              <span
                className="mono"
                style={{
                  marginLeft: 4,
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-semibold)',
                  color: barColor,
                }}
              >
                {pct}%
              </span>
            )}
          </>
        )}

        {target_tonnes == null && (
          <span style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-tertiary)',
            marginLeft: 'var(--space-1)',
          }}>
            — no daily target set
          </span>
        )}

        {canSetTarget && !editing && (
          <button
            onClick={() => {
              setEditing(true);
              setInputVal(target_tonnes != null ? String(target_tonnes) : '');
              setSaveErr(null);
            }}
            style={{
              marginLeft: 'auto',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              background: 'none',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {target_tonnes != null ? 'Edit target' : 'Set target'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div style={{
        height: 6,
        background: 'var(--border-hairline)',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: set_by || editing ? 'var(--space-2)' : 0,
      }}>
        <div style={{
          height: '100%',
          width: `${barWidth}%`,
          background: barColor,
          borderRadius: 3,
          transition: 'width 600ms ease',
        }} />
      </div>

      {/* Set-by attribution */}
      {set_by && !editing && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginBottom: by_hauler?.length ? 'var(--space-2)' : 0,
        }}>
          Target set by {set_by}
        </div>
      )}

      {/* Phase 114 — per-hauler breakdown (only when live dispatches exist) */}
      {by_hauler?.length > 0 && !editing && (
        <div style={{
          marginTop: set_by ? 0 : 'var(--space-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          {by_hauler.map((h) => {
            const hPct = target_tonnes
              ? Math.min(100, Math.round((h.total_tonnes / target_tonnes) * 1000) / 10)
              : null;
            return (
              <div key={h.hauler_id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}>
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-secondary)',
                  width: 68,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {h.display_name}
                </span>
                <div style={{
                  flex: 1,
                  height: 3,
                  background: 'var(--border-hairline)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  {hPct != null && (
                    <div style={{
                      height: '100%',
                      width: `${hPct}%`,
                      background: 'var(--bauxite-rust)',
                      borderRadius: 2,
                    }} />
                  )}
                </div>
                <span className="mono" style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-secondary)',
                  width: 52,
                  textAlign: 'right',
                  flexShrink: 0,
                }}>
                  {h.total_tonnes.toLocaleString()} t
                </span>
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  width: 50,
                  flexShrink: 0,
                }}>
                  {h.convoy_count} cvy
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline target editor */}
      {editing && (
        <form
          onSubmit={handleSetTarget}
          style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
          }}
        >
          <input
            type="number"
            min="1"
            step="100"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="e.g. 5000"
            autoFocus
            style={{
              width: 120,
              padding: '4px 8px',
              background: 'var(--surface)',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              fontSize: 'var(--ts-body-sm-size)',
            }}
          />
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            tonnes
          </span>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '4px 14px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              fontWeight: 'var(--fw-semibold)',
              cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setSaveErr(null); }}
            style={{
              padding: '4px 10px',
              background: 'none',
              border: '1px solid var(--border-soft)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          {saveErr && (
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-red)' }}>
              {saveErr}
            </span>
          )}
        </form>
      )}
    </section>
  );
}
