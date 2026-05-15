import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch, can } from '../lib/auth';
import { Plus, Columns3 } from 'lucide-react';

import PageShell from '../components/layout/PageShell';
import HaulerTable from '../components/hauler/HaulerTable';
import HaulerDetail from '../components/hauler/HaulerDetail';
import HaulerCompare from '../components/hauler/HaulerCompare';
import OnboardHaulerModal from '../components/hauler/OnboardHaulerModal';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';
import Button from '../components/primitives/Button';
import { useAuth } from '../lib/AuthContext';

export default function Haulers() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [selected, setSelected] = useState(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  // Phase 65 — multi-select for comparison. Set of hauler IDs.
  const [comparePicks, setComparePicks] = useState(new Set());
  const [compareOpen, setCompareOpen]   = useState(false);
  const mayOnboard = can(user?.role, 'onboardHauler');
  // Hauler admins can't compare across haulers (only see their own).
  const mayCompare = user && user.role !== 'hauler_admin';

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const res = await authFetch('/api/haulers');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = await res.json();
      setState({ status: 'ready', data: body, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allHaulers = state.data?.haulers ?? [];
  // Hauler admins see only their own hauler row; everyone else sees the full roster.
  const haulers = useMemo(() => (
    user?.role === 'hauler_admin'
      ? allHaulers.filter((h) => h.id === user.hauler_id)
      : allHaulers
  ), [allHaulers, user?.role, user?.hauler_id]);
  const totals = state.data?.totals;

  return (
    <PageShell
      eyebrow="Fleet"
      title="Haulers"
      description="Onboarded haulage companies contributing to the corridor fleet. Each hauler connects via Loconav, a custom FMS adapter, or manual CSV upload."
      actions={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {/* Phase 65 — compare button. Disabled until ≥2 selected. */}
          {mayCompare && (
            <Button
              variant="secondary"
              disabled={comparePicks.size < 2}
              onClick={() => setCompareOpen(true)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Columns3 size={16} strokeWidth={1.5} />
                Compare {comparePicks.size > 0 ? `· ${comparePicks.size}` : ''}
              </span>
            </Button>
          )}
          {mayOnboard && (
            <Button variant="primary" onClick={() => setOnboardOpen(true)}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={16} strokeWidth={1.5} />
                Onboard hauler
              </span>
            </Button>
          )}
        </span>
      }
    >
      <SummaryStrip totals={totals} haulers={haulers} />
      <LiveHaulerStrip haulers={haulers} />

      {state.status === 'loading' && <LoadingBlock />}
      {state.status === 'error' && <ErrorBlock message={state.error} onRetry={load} />}

      {state.data && (
        <HaulerTable
          haulers={haulers}
          onRowClick={setSelected}
          selectable={mayCompare}
          selected={comparePicks}
          onToggleSelect={(id) => setComparePicks((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < 4) next.add(id);
            return next;
          })}
        />
      )}

      <HaulerCompare
        open={compareOpen}
        haulerIds={Array.from(comparePicks)}
        onClose={() => setCompareOpen(false)}
      />

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="haulers" />
      </div>

      <HaulerDetail
        hauler={selected ? haulers.find((h) => h.id === selected.id) ?? selected : null}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        onSynced={load}
      />

      <OnboardHaulerModal
        open={onboardOpen}
        onClose={() => setOnboardOpen(false)}
        onCreated={() => { setOnboardOpen(false); load(); }}
      />
    </PageShell>
  );
}

function SummaryStrip({ totals, haulers }) {
  if (!totals) return <div style={{ height: 72, marginBottom: 'var(--space-4)' }} />;

  const active  = haulers.filter((h) => h.status === 'active').length;
  const pending = haulers.filter((h) => h.status !== 'active').length;
  const connected = haulers.filter((h) => h.api_status === 'connected').length;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)',
    }}>
      <Stat label="Haulers onboarded" value={haulers.length} sub={`${active} active · ${pending} pending`} />
      <Stat label="Contracted trucks" value={totals.contracted_trucks} sub="Tranche 1 target: 110" />
      <Stat label="Active today" value={totals.active_trucks} sub={`${pctOf(totals.active_trucks, totals.contracted_trucks)} of contracted`} />
      <Stat label="API connected" value={`${connected} / ${haulers.length}`} sub="Automated feed only" />
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size)',
        lineHeight: 'var(--ts-h2-lh)',
        fontWeight: 'var(--fw-black)',
        color: 'var(--text)',
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

// Phase 125 — live today convoy activity strip, rendered between SummaryStrip and HaulerTable.
// Only renders when at least one hauler has live convoy data recorded today.
function LiveHaulerStrip({ haulers }) {
  const withLive = haulers.filter((h) => h.live_today && (
    h.live_today.active_count > 0 || h.live_today.completed_today > 0
  ));
  if (!withLive.length) return null;

  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Live today
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(withLive.length, 4)}, minmax(0, 1fr))`,
        gap: 'var(--space-3)',
      }}>
        {withLive.map((h) => {
          const s = h.live_today;
          const t = s.delivered_today_t;
          return (
            <div key={h.id} style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-3) var(--space-4)',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 6,
              }}>
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  fontWeight: 'var(--fw-medium)',
                  color: 'var(--text)',
                }}>
                  {h.display_name}
                </span>
                <span style={{
                  fontSize: 9,
                  letterSpacing: '0.06em',
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(22,163,74,0.12)',
                  color: 'var(--signal-green)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'var(--fw-medium)',
                  textTransform: 'uppercase',
                }}>
                  LIVE
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                <LiveStat label="Active" value={s.active_count} />
                <LiveStat label="Done today" value={s.completed_today} />
                {t > 0 && (
                  <LiveStat label="Delivered" value={`${t.toLocaleString(undefined, { maximumFractionDigits: 1 })} t`} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveStat({ label, value }) {
  return (
    <div>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>{label}</div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-body-size)',
        fontWeight: 'var(--fw-medium)',
        color: 'var(--text)',
      }}>
        {value}
      </div>
    </div>
  );
}

function pctOf(n, d) {
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

function LoadingBlock() {
  return (
    <div style={{
      padding: 'var(--space-5)',
      textAlign: 'center',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text-secondary)',
    }}>
      Loading hauler roster…
    </div>
  );
}

function ErrorBlock({ message, onRetry }) {
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'rgba(139, 46, 26, 0.06)',
      border: '1px solid rgba(139, 46, 26, 0.22)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--signal-red)' }}>
        Hauler roster unavailable. {message}
      </span>
      <Button variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}
