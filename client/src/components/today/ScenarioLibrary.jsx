/*
 * ScenarioLibrary — Phase 71.
 *
 * Saved what-if scenarios for the take-or-pay forecast. Each row
 * shows the scenario name, the operator's description, and the
 * scenario re-evaluated against current corridor state — so a
 * "Hauler 05 stays flat" scenario saved last week always reflects
 * today's idle truck counts and workorder list with that override
 * re-applied on top.
 *
 * Mounted on Today's left column under TakeOrPayForecast. Read
 * for all roles; archive button visible to axis_admin/axis_ops
 * only.
 */

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Archive, Library } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const VERDICT_TONE = {
  on_pace_for_contracted: 'var(--signal-green)',
  on_pace_or_above:       'var(--signal-green)',
  above_floor:            'var(--text)',
  banked_floor_drift:     'var(--signal-amber)',
  below_floor_at_pace:    'var(--signal-amber)',
  severely_lagging:       'var(--bauxite-rust)',
};

const VERDICT_LABEL = {
  on_pace_for_contracted: 'On pace for contracted',
  on_pace_or_above:       'On pace or above',
  above_floor:            'Above floor, below contracted',
  banked_floor_drift:     'Floor banked — pace slipping',
  below_floor_at_pace:    'Below floor at pace',
  severely_lagging:       'Severely lagging',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function ScenarioLibrary({ refreshKey }) {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/today/forecast/scenarios')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const scenarios = data?.scenarios ?? [];

  if (!data) return null; // wait for first fetch
  if (scenarios.length === 0) return null; // hide entirely until a scenario is saved

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Library size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Scenario library</span>
        </div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {scenarios.length} saved · re-evaluated live · baseline{' '}
          <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
            {(data.baseline.eom_tonnes / 1000).toFixed(1)}kt EOM
          </span>
        </span>
      </header>

      {error && (
        <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {scenarios.map((s) => (
          <ScenarioRow
            key={s.id}
            scenario={s}
            baseline={data.baseline}
            canWrite={canWrite}
            onChange={load}
          />
        ))}
      </div>
    </section>
  );
}

function ScenarioRow({ scenario, baseline, canWrite, onChange }) {
  const e = scenario.evaluation;
  const proj = e?.projection;
  const delta = e?.delta;
  const verdict = proj?.verdict ?? baseline.verdict;
  const tone = VERDICT_TONE[verdict] || 'var(--text)';
  const Icon = !delta ? Minus
              : delta.eom_tonnes > 0 ? TrendingUp
              : delta.eom_tonnes < 0 ? TrendingDown
              : Minus;
  const deltaTone = !delta ? 'var(--text-tertiary)'
                  : delta.eom_tonnes > 0 ? 'var(--signal-green)'
                  : delta.eom_tonnes < 0 ? 'var(--bauxite-rust)'
                  : 'var(--text-tertiary)';
  const baselineKt = (baseline.eom_tonnes / 1000).toFixed(1);
  const scenarioKt = proj ? (proj.eom_tonnes / 1000).toFixed(1) : '—';

  async function archive() {
    if (!confirm(`Archive "${scenario.name}"? It can be unarchived later.`)) return;
    const r = await authFetch(`/api/today/forecast/scenarios/${scenario.id}/archive`, { method: 'POST' });
    if (r.ok) onChange();
  }

  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      borderLeft: `3px solid ${tone}`,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        gap: 12,
        alignItems: 'center',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {scenario.name}
          </div>
          {scenario.description && (
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              marginTop: 2,
              lineHeight: 1.45,
            }}>
              {scenario.description}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
            <span className="mono" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {VERDICT_LABEL[verdict] || verdict}
            </span>
            {scenario.author?.display_name && (
              <span> · saved by {scenario.author.display_name}</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div className="tabular" style={{
            fontSize: 18,
            fontWeight: 'var(--fw-medium)',
            color: tone,
            lineHeight: 1,
          }}>
            {scenarioKt}<span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>kt</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            {proj ? `${proj.pct_of_floor.toFixed(1)}% of floor` : '—'}
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: deltaTone,
          fontSize: 'var(--ts-caption-size)',
        }}>
          <Icon size={14} strokeWidth={1.8} />
          <span className="tabular" style={{ fontWeight: 'var(--fw-medium)' }}>
            {delta && delta.eom_tonnes !== 0
              ? `${delta.eom_tonnes > 0 ? '+' : ''}${delta.eom_tonnes.toLocaleString()}t`
              : '0t'}
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={archive}
              title="Archive this scenario"
              style={{
                background: 'transparent',
                border: 'none',
                padding: 4,
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                lineHeight: 0,
                marginLeft: 4,
              }}
            >
              <Archive size={12} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>

      <ScenarioAppliedSummary applied={e?.applied} totals={e?.totals} baselineKt={baselineKt} />
    </div>
  );
}

function ScenarioAppliedSummary({ applied, totals, baselineKt }) {
  if (!applied) return null;
  const lifts = Object.entries(applied.hauler_truck_lifts || {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${id} +${n}`);
  const wos = applied.resolve_workorders?.length || 0;
  const lift = applied.daily_avg_lift_pct || 0;
  const parts = [];
  if (lifts.length > 0)        parts.push(`Trucks: ${lifts.join(', ')}`);
  if (wos > 0)                 parts.push(`Resolve ${wos} workorder${wos === 1 ? '' : 's'}`);
  if (lift > 0)                parts.push(`+${lift}% pace`);
  if (parts.length === 0)      parts.push('No overrides — tracks the baseline.');

  return (
    <div style={{
      marginTop: 6,
      paddingTop: 6,
      borderTop: '1px dotted var(--border-hairline)',
      fontSize: 10,
      color: 'var(--text-tertiary)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span>{parts.join(' · ')}</span>
      <span>vs <span className="tabular">{baselineKt}kt</span> baseline</span>
    </div>
  );
}
