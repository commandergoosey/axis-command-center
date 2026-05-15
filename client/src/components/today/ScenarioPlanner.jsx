/*
 * ScenarioPlanner — Phase 50.
 *
 * Interactive what-if tool for the take-or-pay forecast. Operator
 * picks levers (activate idle trucks per hauler, resolve open
 * workorders, lift daily pace) and the modal shows the projected
 * outcome live, alongside the baseline. No writes — purely
 * exploratory.
 *
 * The lever inputs read from the baseline forecast prop so the
 * picker only ever offers actually-available moves (idle trucks per
 * hauler, currently-open workorders). Operator can't fabricate
 * trucks they don't have.
 */

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, X, Save } from 'lucide-react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const SAVE_ROLES = new Set(['axis_admin', 'axis_ops']);

const VERDICT_LABEL = {
  on_pace_for_contracted: 'On pace for contracted',
  above_floor:            'Above floor, below contracted',
  banked_floor_drift:     'Floor banked — pace slipping',
  below_floor_at_pace:    'Below floor at current pace',
};
const VERDICT_TONE = {
  on_pace_for_contracted: 'var(--signal-green)',
  above_floor:            'var(--text)',
  banked_floor_drift:     'var(--signal-amber)',
  below_floor_at_pace:    'var(--bauxite-rust)',
};

export default function ScenarioPlanner({ open, baseline, onClose, onSaved }) {
  const { user } = useAuth();
  const canSave = user && SAVE_ROLES.has(user.role);
  const [truckLifts, setTruckLifts] = useState({});
  const [resolveWos, setResolveWos] = useState(new Set());
  const [liftPct, setLiftPct]       = useState(0);
  const [scenario, setScenario]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [saving, setSaving]         = useState(false);
  const [savedJustNow, setSavedJustNow] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioDesc, setScenarioDesc] = useState('');

  // Reset when re-opened
  useEffect(() => {
    if (!open) return;
    setTruckLifts({});
    setResolveWos(new Set());
    setLiftPct(0);
    setScenario(null);
    setError(null);
    setSaving(false);
    setSavedJustNow(false);
    setScenarioName('');
    setScenarioDesc('');
  }, [open]);

  // Phase 71 — save the current draft to the scenario library.
  async function saveScenario() {
    if (!canSave || saving) return;
    if (!scenarioName.trim()) return;
    setSaving(true);
    try {
      const r = await authFetch('/api/today/forecast/scenarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: scenarioName.trim(),
          description: scenarioDesc.trim() || null,
          params: {
            hauler_truck_lifts: truckLifts,
            resolve_workorders: Array.from(resolveWos),
            daily_avg_lift_pct: liftPct,
          },
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedJustNow(true);
      onSaved?.();
    } catch (err) {
      setError(`Save failed — ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // Recompute scenario whenever inputs change. Debounce isn't needed —
  // the endpoint is pure compute, ~ms-fast.
  useEffect(() => {
    if (!open || !baseline) return;
    const anyChange = Object.values(truckLifts).some((n) => n > 0)
                   || resolveWos.size > 0
                   || liftPct > 0;
    if (!anyChange) {
      setScenario(null);
      return;
    }
    let abort = false;
    setLoading(true);
    authFetch('/api/today/forecast/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hauler_truck_lifts: truckLifts,
        resolve_workorders: Array.from(resolveWos),
        daily_avg_lift_pct: liftPct,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { if (!abort) { setScenario(j.scenario); setError(null); } })
      .catch((err) => { if (!abort) setError(err.message); })
      .finally(() => { if (!abort) setLoading(false); });
    return () => { abort = true; };
  }, [open, baseline, truckLifts, resolveWos, liftPct]);

  if (!open || !baseline) return null;

  const idleHaulers = baseline.levers.by_hauler.filter((h) => h.idle_trucks > 0);
  const openWorkorders = baseline.workshop_drag.by_workorder;

  return (
    <Modal open={open} onClose={onClose} width={680}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Scenario planner
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              What if?
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              Levers only — nothing here writes to state. Use it to size the
              moves before committing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 4, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-tertiary)',
            }}
          >
            <X size={18} />
          </button>
        </header>

        <ScoreboardStrip baseline={baseline} scenario={scenario} loading={loading} />

        <div style={{ marginTop: 'var(--space-5)' }}>
          {idleHaulers.length > 0 && (
            <Lever title={`Activate idle trucks · ${idleHaulers.length} hauler${idleHaulers.length === 1 ? '' : 's'} have idle capacity`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {idleHaulers.map((h) => (
                  <TruckLiftRow
                    key={h.hauler_id}
                    hauler={h}
                    value={truckLifts[h.hauler_id] || 0}
                    onChange={(n) => setTruckLifts((prev) => ({ ...prev, [h.hauler_id]: n }))}
                  />
                ))}
              </div>
            </Lever>
          )}

          {openWorkorders.length > 0 && (
            <Lever title={`Resolve open workorders · ${openWorkorders.length} open in workshop`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {openWorkorders.map((w) => (
                  <WorkorderToggle
                    key={w.workorder_id}
                    wo={w}
                    checked={resolveWos.has(w.workorder_id)}
                    onChange={(checked) => {
                      setResolveWos((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(w.workorder_id);
                        else next.delete(w.workorder_id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </Lever>
          )}

          <Lever title="Lift daily pace">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input
                type="range"
                min={0} max={50} step={1}
                value={liftPct}
                onChange={(e) => setLiftPct(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span className="tabular" style={{
                minWidth: 50, textAlign: 'right',
                fontWeight: 'var(--fw-medium)',
                color: liftPct > 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
              }}>
                +{liftPct}%
              </span>
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
              Across-the-board pace adjustment — extra shifts, longer driver
              hours within compliance, faster turn-around.
            </div>
          </Lever>
        </div>

        {error && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(139, 46, 26, 0.08)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--bauxite-rust)',
            fontSize: 'var(--ts-caption-size)',
            marginTop: 'var(--space-3)',
          }}>
            Scenario compute failed — {error}
          </div>
        )}

        {canSave && (
          <div style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px dashed var(--border-hairline)',
          }}>
            <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
              SAVE TO SCENARIO LIBRARY
            </div>
            {savedJustNow ? (
              <p style={{
                margin: 0,
                padding: '8px 10px',
                background: 'var(--surface)',
                borderRadius: 'var(--radius-sm)',
                borderLeft: '3px solid var(--signal-green)',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text-secondary)',
              }}>
                Saved. The scenario will appear in the library on Today and re-evaluate live as the corridor changes.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Name (e.g. 'Downside · Hauler 05 stays flat')"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  maxLength={80}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={scenarioDesc}
                  onChange={(e) => setScenarioDesc(e.target.value)}
                  maxLength={400}
                  style={inputStyle}
                />
              </div>
            )}
          </div>
        )}

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-3)',
        }}>
          {canSave && !savedJustNow && (
            <Button
              variant="secondary"
              onClick={saveScenario}
              disabled={saving || !scenarioName.trim()}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Save size={12} strokeWidth={1.8} />
                {saving ? 'Saving…' : 'Save scenario'}
              </span>
            </Button>
          )}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  boxSizing: 'border-box',
};

// ── Internal components ──────────────────────────────────────────

function ScoreboardStrip({ baseline, scenario, loading }) {
  const baseEom    = baseline.projection.eom_tonnes;
  const scenarioEom = scenario?.projection.eom_tonnes ?? baseEom;
  const delta      = scenario ? scenario.delta.eom_tonnes : 0;
  const verdict    = scenario?.projection.verdict ?? baseline.projection.verdict;
  const verdictLabel = VERDICT_LABEL[verdict] ?? '—';
  const verdictTone  = VERDICT_TONE[verdict] ?? 'var(--text)';
  const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaTone = delta > 0 ? 'var(--signal-green)'
                  : delta < 0 ? 'var(--bauxite-rust)'
                  : 'var(--text-tertiary)';

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      display: 'grid',
      gridTemplateColumns: '1fr auto 1fr',
      gap: 'var(--space-4)',
      alignItems: 'center',
    }}>
      <Tile
        label="Baseline EOM"
        value={`${(baseEom / 1000).toFixed(1)} kt`}
        sub={`${baseline.projection.pct_of_floor.toFixed(0)}% of floor`}
      />
      <div style={{ textAlign: 'center', color: deltaTone }}>
        <Icon size={20} strokeWidth={1.8} />
        <div className="tabular" style={{
          fontSize: 'var(--ts-h3-size, 18px)',
          fontWeight: 'var(--fw-medium)',
          color: deltaTone,
          marginTop: 2,
        }}>
          {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta).toLocaleString()} t
        </div>
        {scenario?.delta?.clears_floor && (
          <div className="micro" style={{
            color: 'var(--signal-green)',
            marginTop: 4,
          }}>
            CLEARS FLOOR
          </div>
        )}
      </div>
      <Tile
        label="Scenario EOM"
        value={`${(scenarioEom / 1000).toFixed(1)} kt`}
        sub={verdictLabel}
        tone={verdictTone}
        loading={loading}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone, loading }) {
  return (
    <div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {label}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size, 24px)',
        lineHeight: 1.05,
        fontWeight: 'var(--fw-black)',
        color: tone ?? 'var(--text)',
        opacity: loading ? 0.45 : 1,
        transition: 'opacity 100ms ease',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
          marginTop: 2,
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Lever({ title, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div className="micro" style={{
        color: 'var(--text-tertiary)',
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function TruckLiftRow({ hauler, value, onChange }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.5fr) auto auto',
      columnGap: 'var(--space-3)',
      alignItems: 'center',
      padding: '6px 8px',
      borderRadius: 'var(--radius-sm)',
      background: value > 0 ? 'var(--accent-tint)' : 'transparent',
      transition: 'background 100ms ease',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
          {hauler.display_name}
        </div>
        <div className="tabular" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {hauler.active_trucks}/{hauler.contracted_trucks} active · {hauler.idle_trucks} idle
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={hauler.idle_trucks}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 140 }}
      />
      <span className="tabular" style={{
        minWidth: 60,
        textAlign: 'right',
        fontSize: 'var(--ts-body-sm-size)',
        fontWeight: 'var(--fw-medium)',
        color: value > 0 ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
      }}>
        +{value} truck{value === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function WorkorderToggle({ wo, checked, onChange }) {
  return (
    <label style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: 'var(--space-3)',
      alignItems: 'baseline',
      padding: '6px 8px',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: checked ? 'var(--accent-tint)' : 'transparent',
      transition: 'background 100ms ease',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={{ minWidth: 0 }}>
        <span className="mono" style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>
          {wo.rig_id}
        </span>
        {wo.title}
      </span>
      <span className="tabular" style={{
        color: checked ? 'var(--signal-green)' : 'var(--text-tertiary)',
        fontSize: 'var(--ts-caption-size)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {checked ? `+${wo.remainder_drag} t recovered` : `${wo.days_open.toFixed(1)}d open`}
      </span>
    </label>
  );
}
