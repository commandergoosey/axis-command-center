/*
 * Convoys — dispatch board. Phase 101 adds the write path.
 *
 * AXIS roles (axis_admin / axis_ops) see a "Dispatch convoy" button
 * in the PageShell actions bar that opens an inline DispatchForm.
 * Submitted convoys appear immediately at the top of the list with
 * a LIVE badge. Live convoy rows have action chips for lifecycle
 * transitions: Depart → offload → Arrive.
 *
 * Hauler admins are server-scoped (see only their own convoys) and
 * can record departure/arrival on convoys dispatched for them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Truck, X, Loader, CheckCircle2, ArrowRightCircle } from 'lucide-react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell from '../components/layout/PageShell';
import ConvoysSummary from '../components/convoys/ConvoysSummary';
import ConvoyCorridorStrip from '../components/convoys/ConvoyCorridorStrip';
import ConvoyTable from '../components/convoys/ConvoyTable';
import ConvoyDetail from '../components/convoys/ConvoyDetail';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';

const PHASE_OPTIONS = [
  ['', 'All phases'],
  ['laden',   'Laden'],
  ['empty',   'Empty'],
  ['loading', 'Loading'],
  ['offload', 'Offloading'],
];

const SCHEDULE_OPTIONS = [
  ['',         'All schedules'],
  ['on_time',  'On time'],
  ['delayed',  'Delayed'],
];

/* ── Styles ────────────────────────────────────────────────────────── */
const formPanelStyle = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4)',
  marginBottom: 'var(--space-4)',
};
const fieldStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const labelStyle = {
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};
const inputStyle = {
  padding: '8px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const chipBtn = (active, tone = 'rust') => ({
  padding: '5px 12px',
  borderRadius: 'var(--radius-sm)',
  border: `1px solid ${active
    ? (tone === 'green' ? 'var(--signal-green)' : 'var(--bauxite-rust)')
    : 'var(--border-hairline)'}`,
  background: active
    ? (tone === 'green' ? 'rgba(22,163,74,0.10)' : 'rgba(162,62,35,0.10)')
    : 'transparent',
  color: active
    ? (tone === 'green' ? 'var(--signal-green)' : 'var(--bauxite-rust)')
    : 'var(--text-secondary)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  cursor: 'pointer',
  fontFamily: 'inherit',
});

/* ══════════════════════════════════════════════════════════════════ */
/*  Dispatch form                                                      */
/* ══════════════════════════════════════════════════════════════════ */

function DispatchForm({ haulers, onDispatched, onCancel }) {
  const [haulerId, setHaulerId]           = useState(haulers[0]?.id ?? '');
  const [truckCount, setTruckCount]       = useState('');
  const [direction, setDirection]         = useState('southbound');
  const [cargoTonnes, setCargoTonnes]     = useState('');
  const [plannedDep, setPlannedDep]       = useState('');
  const [notes, setNotes]                 = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [error, setError]                 = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!haulerId || !truckCount) { setError('Hauler and truck count are required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        hauler_id:   haulerId,
        truck_count: parseInt(truckCount, 10),
        direction,
        cargo_tonnes:         cargoTonnes ? parseFloat(cargoTonnes) : null,
        planned_departure_iso: plannedDep
          ? new Date(plannedDep).toISOString()
          : null,
        notes: notes.trim() || null,
      };
      const r = await authFetch('/api/convoys', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onDispatched(data.convoy);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={formPanelStyle}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
          Dispatch convoy
        </span>
        <button type="button" onClick={onCancel}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
          <X size={14} color="var(--text-tertiary)" />
        </button>
      </header>

      <form onSubmit={submit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Hauler</label>
            <select value={haulerId} onChange={(e) => setHaulerId(e.target.value)} style={inputStyle}>
              {haulers.map((h) => (
                <option key={h.id} value={h.id}>{h.display_name}</option>
              ))}
            </select>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Trucks</label>
            <input
              type="number" min="1" max="20" placeholder="e.g. 6"
              value={truckCount} onChange={(e) => setTruckCount(e.target.value)}
              style={inputStyle} required
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Cargo (tonnes)</label>
            <input
              type="number" min="0" step="0.1" placeholder="optional"
              value={cargoTonnes} onChange={(e) => setCargoTonnes(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Direction</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['southbound', 'Southbound (laden)'], ['northbound', 'Northbound (return)']].map(([v, l]) => (
                <button key={v} type="button"
                  onClick={() => setDirection(v)}
                  style={chipBtn(direction === v)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle}>Planned departure</label>
            <input
              type="datetime-local"
              value={plannedDep} onChange={(e) => setPlannedDep(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ ...fieldStyle, marginBottom: 'var(--space-3)' }}>
          <label style={labelStyle}>Notes</label>
          <input
            type="text" maxLength={200} placeholder="e.g. Cleared weighbridge, permit ref WB-2209"
            value={notes} onChange={(e) => setNotes(e.target.value)}
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--ts-body-sm-size)', color: 'var(--bauxite-rust)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel}
            style={{ ...chipBtn(false), padding: '7px 16px' }}>
            Cancel
          </button>
          <button type="submit" disabled={submitting}
            style={{
              padding: '7px 18px',
              background: submitting ? 'var(--iron)' : 'var(--bauxite-rust)',
              color: 'var(--bone)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
              fontWeight: 'var(--fw-medium)',
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {submitting ? <Loader size={13} strokeWidth={2} /> : <Truck size={13} strokeWidth={2} />}
            {submitting ? 'Dispatching…' : 'Dispatch convoy'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Live convoy action row                                             */
/* ══════════════════════════════════════════════════════════════════ */

function LiveConvoyActions({ convoy, onUpdate }) {
  const [busy,         setBusy]         = useState(null);
  const [err,          setErr]          = useState(null);
  // Phase 113 — arrival confirmation form
  const [arrivingForm, setArrivingForm] = useState(false);
  const [deliveredT,   setDeliveredT]   = useState('');

  const doAction = async (endpoint, body = {}) => {
    setBusy(endpoint);
    setErr(null);
    try {
      const r = await authFetch(`/api/convoys/${convoy.id}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onUpdate();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
      setArrivingForm(false);
    }
  };

  const showDepart = !convoy.actual_departure_iso && convoy.phase === 'loading';
  const showArrive = convoy.actual_departure_iso && convoy.phase !== 'complete';

  const handleArriveClick = () => {
    setDeliveredT(convoy.cargo_tonnes != null ? String(convoy.cargo_tonnes) : '');
    setArrivingForm(true);
  };

  const handleArriveSubmit = (e) => {
    e.preventDefault();
    const dt = deliveredT !== '' ? parseFloat(deliveredT) : undefined;
    doAction('arrive', dt != null && !Number.isNaN(dt) ? { delivered_tonnes: dt } : {});
  };

  if (arrivingForm) {
    return (
      <form onSubmit={handleArriveSubmit}
        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Delivered tonnes:</span>
        <input
          type="number" min="0" step="0.1"
          value={deliveredT}
          onChange={(e) => setDeliveredT(e.target.value)}
          placeholder={convoy.cargo_tonnes ?? '—'}
          autoFocus
          style={{
            width: 80, padding: '2px 6px',
            background: 'var(--surface)', border: '1px solid var(--border-soft)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 11,
          }}
        />
        <button type="submit" disabled={busy === 'arrive'} style={chipBtn(true, 'green')}>
          {busy === 'arrive' ? <Loader size={11} /> : <CheckCircle2 size={11} />}
          {' '}Confirm
        </button>
        <button type="button" onClick={() => setArrivingForm(false)}
          style={chipBtn(false)}>Cancel</button>
        {err && <span style={{ fontSize: 10, color: 'var(--bauxite-rust)' }}>{err}</span>}
      </form>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {showDepart && (
        <button type="button" onClick={() => doAction('depart')} disabled={busy === 'depart'}
          style={chipBtn(true)}>
          {busy === 'depart' ? <Loader size={11} /> : <ArrowRightCircle size={11} />}
          {' '}Depart
        </button>
      )}
      {showArrive && (
        <button type="button" onClick={handleArriveClick} style={chipBtn(true, 'green')}>
          <CheckCircle2 size={11} /> Arrived
        </button>
      )}
      {err && <span style={{ fontSize: 10, color: 'var(--bauxite-rust)' }}>{err}</span>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Live convoy table row addendum                                     */
/* ══════════════════════════════════════════════════════════════════ */

function LiveBadge() {
  return (
    <span className="mono" style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 'var(--radius-sm)',
      background: 'rgba(162,62,35,0.12)',
      color: 'var(--bauxite-rust)',
      fontSize: 9,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      marginRight: 6,
    }}>
      LIVE
    </span>
  );
}

// Phase 119 — overdue badge shown alongside LIVE when convoy is behind schedule.
function OverdueBadge({ hours }) {
  return (
    <span className="mono" style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 'var(--radius-sm)',
      background: 'rgba(162,62,35,0.20)',
      border: '1px solid rgba(162,62,35,0.40)',
      color: 'var(--bauxite-rust)',
      fontSize: 9,
      fontWeight: 'var(--fw-semibold)',
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      marginRight: 6,
    }}>
      OVERDUE{hours != null ? ` +${hours}h` : ''}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Main page                                                          */
/* ══════════════════════════════════════════════════════════════════ */

export default function Convoys() {
  const { user } = useAuth();
  const [data,       setData]       = useState(null);
  const [haulers,    setHaulers]    = useState([]);
  const [lengthKm,   setLengthKm]   = useState(300);
  const [error,      setError]      = useState(null);
  const [hauler,     setHauler]     = useState('');
  const [phase,      setPhase]      = useState('');
  const [schedule,   setSchedule]   = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [dispatching, setDispatching] = useState(false);

  const isHaulerAdmin  = user?.role === 'hauler_admin';
  const canDispatch     = user?.role === 'axis_admin' || user?.role === 'axis_ops';
  // Hauler admins can also record departure / arrival on their own convoys
  const canUpdateStatus = canDispatch || isHaulerAdmin;

  const load = useCallback(async () => {
    try {
      const [convoysRes, corridorRes] = await Promise.all([
        authFetch('/api/convoys'),
        authFetch('/api/corridor'),
      ]);
      if (!convoysRes.ok) throw new Error(`convoys ${convoysRes.status}`);
      const convoysBody = await convoysRes.json();
      setData(convoysBody);
      if (corridorRes.ok) {
        const corridorBody = await corridorRes.json();
        setLengthKm(corridorBody?.corridor?.length_km ?? 300);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  // Fetch hauler list once for the dispatch form.
  useEffect(() => {
    if (!canDispatch) return;
    authFetch('/api/haulers')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHaulers(d.haulers ?? []); })
      .catch(() => {});
  }, [canDispatch]);

  useEffect(() => { load(); }, [load]);

  const allConvoys = data?.convoys ?? [];

  const haulerOptions = useMemo(() => {
    const seen = new Map();
    for (const c of allConvoys) {
      if (!seen.has(c.hauler_id)) seen.set(c.hauler_id, c.hauler_display_name);
    }
    return [['', 'All haulers'], ...Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))];
  }, [allConvoys]);

  const filtered = useMemo(() => allConvoys.filter((c) => (
    (!hauler   || c.hauler_id === hauler) &&
    (!phase    || c.phase === phase) &&
    (!schedule || (schedule === 'on_time' ? c.on_schedule : !c.on_schedule))
  )), [allConvoys, hauler, phase, schedule]);

  const anyFilter = hauler || phase || schedule;

  const handleDispatched = (_convoy) => {
    setDispatching(false);
    load(); // refresh list to show new live convoy
  };

  return (
    <PageShell
      eyebrow="Operations"
      title="Convoys"
      description="Dispatch discipline across all haulers on the line. A full round trip runs 600 km in 13–15 hours; convoys are grouped by departure window and kept together through weighbridges."
      actions={canDispatch && !dispatching && (
        <button
          type="button"
          onClick={() => setDispatching(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '7px 14px',
            background: 'var(--bauxite-rust)',
            color: 'var(--bone)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Truck size={13} strokeWidth={2} />
          Dispatch convoy
        </button>
      )}
    >
      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--signal-amber)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          fontSize: 'var(--ts-body-sm-size)',
          marginBottom: 'var(--space-4)',
        }}>
          Convoy feed unavailable — {error}
        </div>
      )}

      {dispatching && (
        <DispatchForm
          haulers={haulers}
          onDispatched={handleDispatched}
          onCancel={() => setDispatching(false)}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <ConvoysSummary summary={data?.summary} />
        <PhaseSummaryStrip phaseData={data?.summary?.convoy_by_phase} />
        <ConvoyCorridorStrip convoys={filtered} lengthKm={lengthKm} />

        <FilterBar
          hauler={hauler}     setHauler={setHauler}
          phase={phase}       setPhase={setPhase}
          schedule={schedule} setSchedule={setSchedule}
          haulerOptions={haulerOptions}
          hideHauler={isHaulerAdmin}
          count={filtered.length}
          total={allConvoys.length}
          anyFilter={anyFilter}
          onClear={() => { setHauler(''); setPhase(''); setSchedule(''); }}
        />

        {/* Convoy list — live convoys show LIVE badge + action chips */}
        <ConvoyListWithActions
          convoys={filtered}
          canUpdateStatus={canUpdateStatus}
          onRowClick={(c) => setSelectedId(c.id)}
          onUpdate={load}
        />

        <IntelligencePanel page="convoys" />
      </div>

      <ConvoyDetail
        convoyId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
      />
    </PageShell>
  );
}

/* ── Combined list: live rows get action chips below the table ──── */

function ConvoyListWithActions({ convoys, canUpdateStatus, onRowClick, onUpdate }) {
  const liveConvoys = convoys.filter((c) => c.is_live);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <ConvoyTable convoys={convoys} onRowClick={onRowClick}
        renderRowSuffix={(c) => c.is_live ? (
          <>
            {c.is_overdue && <OverdueBadge hours={c.overdue_hours} />}
            <LiveBadge />
          </>
        ) : null}
      />

      {/* Action chips for live convoys — shown beneath the table */}
      {canUpdateStatus && liveConvoys.length > 0 && (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--border-hairline)',
          }}>
            <span className="eyebrow">Live convoy actions</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {liveConvoys.map((c, i) => (
              <div key={c.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: '10px var(--space-4)',
                borderTop: i === 0 ? 'none' : '1px solid var(--border-hairline)',
              }}>
                <LiveBadge />
                {c.is_overdue && <OverdueBadge hours={c.overdue_hours} />}
                <span className="mono" style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)', minWidth: 100 }}>
                  {c.convoy_ref}
                </span>
                <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', minWidth: 80 }}>
                  {c.hauler_display_name ?? c.hauler_id}
                </span>
                <span style={{ fontSize: 'var(--ts-caption-size)', color: c.is_overdue ? 'var(--bauxite-rust)' : 'var(--text-tertiary)', minWidth: 60 }}>
                  {c.phase} · {c.direction === 'southbound' ? '↓' : '↑'}
                </span>
                <div style={{ marginLeft: 'auto' }}>
                  <LiveConvoyActions convoy={c} onUpdate={onUpdate} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Filter bar ──────────────────────────────────────────────────── */

function FilterBar({
  hauler, setHauler, phase, setPhase, schedule, setSchedule,
  haulerOptions, hideHauler, count, total, anyFilter, onClear,
}) {
  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-3)',
      alignItems: 'center',
      flexWrap: 'wrap',
      padding: 'var(--space-3)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      {!hideHauler && haulerOptions.length > 1 && (
        <FilterSelect label="Hauler" value={hauler} onChange={setHauler} options={haulerOptions} />
      )}
      <FilterSelect label="Phase"    value={phase}    onChange={setPhase}    options={PHASE_OPTIONS} />
      <FilterSelect label="Schedule" value={schedule} onChange={setSchedule} options={SCHEDULE_OPTIONS} />

      {anyFilter && (
        <button type="button" onClick={onClear}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px dashed var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          Clear filters
        </button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        {count} of {total} convoys
      </span>
    </div>
  );
}

// Phase 126 — convoy phase summary strip between the summary card and corridor strip.
// Shows how many convoys are in each phase right now, colour-coded. Only renders
// when there's at least one convoy in any phase.
const PHASE_META = {
  loading: { label: 'Loading',    color: 'var(--signal-amber)' },
  laden:   { label: 'Laden',      color: 'var(--bauxite-rust)' },
  offload: { label: 'Offloading', color: 'var(--signal-amber)' },
  empty:   { label: 'Empty run',  color: 'var(--iron)'         },
  complete:{ label: 'Complete',   color: 'var(--signal-green)'  },
};

function PhaseSummaryStrip({ phaseData }) {
  if (!phaseData) return null;
  const entries = Object.entries(phaseData).filter(([, n]) => n > 0);
  if (!entries.length) return null;

  // Canonical display order
  const ORDER = ['loading', 'laden', 'offload', 'empty', 'complete'];
  const sorted = ORDER.flatMap((k) => {
    const n = phaseData[k];
    return n > 0 ? [[k, n]] : [];
  });

  return (
    <div style={{
      display: 'flex',
      gap: 'var(--space-2)',
      flexWrap: 'wrap',
    }}>
      {sorted.map(([phase, count]) => {
        const meta = PHASE_META[phase] ?? { label: phase, color: 'var(--iron)' };
        return (
          <div key={phase} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderLeft: `3px solid ${meta.color}`,
            borderRadius: 'var(--radius-sm)',
          }}>
            <span className="tabular" style={{
              fontSize: 'var(--ts-h3-size)',
              fontWeight: 'var(--fw-medium)',
              color: meta.color,
              lineHeight: 1,
            }}>
              {count}
            </span>
            <span style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              lineHeight: 1.2,
            }}>
              {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}>
        {options.map(([v, l]) => (
          <option key={`${label}-${v}`} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
