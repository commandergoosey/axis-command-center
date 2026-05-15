/*
 * Maintenance — four buckets surfaced from /api/maintenance:
 *   Critical            — rigs pulled from service (axle/brake/etc)
 *   In workshop         — status === 'garage' (includes non-critical garage time)
 *   Service due         — km_since_service crossed the 20k interval
 *   Road-worthy <30d    — DVLA certificate expires within 30 days
 * Plus a recent-completions list for context.
 *
 * Hauler admins are auto-scoped server-side, so the same component renders
 * for every role — just with fewer rows for a hauler admin.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import StatusBadge from '../components/primitives/StatusBadge';
import WorkorderDetail from '../components/maintenance/WorkorderDetail';
import MaintenanceSchedulePanel from '../components/maintenance/MaintenanceSchedulePanel';
import IntervalTrackerStrip from '../components/maintenance/IntervalTrackerStrip';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';
import { formatKm, formatUsd } from '../lib/format';

export default function Maintenance() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [selectedRigId, setSelectedRigId] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const res = await authFetch('/api/maintenance');
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const body = await res.json();
      setState({ status: 'ready', data: body, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const showHauler = user?.role !== 'hauler_admin';

  return (
    <PageShell
      eyebrow="Fleet"
      title="Maintenance"
      description="Preventive discipline is the single largest operational differentiator on this corridor. 20,000 km service interval; DVLA road-worthy renewals every 12 months."
    >
      <CountersStrip counters={state.data?.counters ?? null} />

      {state.status === 'loading' && <LoadingBlock />}
      {state.status === 'error' && <ErrorBlock message={state.error} onRetry={load} />}

      {state.data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Phase 138 — interval tracker strip */}
          <IntervalTrackerStrip data={state.data} />
          <MaintenanceSchedulePanel
            rigs={[
              ...(state.data.critical ?? []),
              ...(state.data.in_workshop ?? []),
              ...(state.data.service_due ?? []),
              ...(state.data.road_worthy_expiring_30d ?? []),
            ]}
            refreshKey={state.data?.generated_at}
          />
          <Bucket
            title="Critical — pulled from service"
            note="Axle, brake or chassis issue. Rigs are off the corridor until signed off by a workshop. Open a workorder to place a rig into remediation."
            rows={state.data.critical}
            showHauler={showHauler}
            columns={['plate', 'hauler', 'make', 'workorder', 'total_km', 'since_service']}
            onRowClick={(t) => setSelectedRigId(t.id)}
          />
          <Bucket
            title="In workshop"
            note="Rigs currently at a workshop bay — scheduled services and in-flight repairs both count here."
            rows={state.data.in_workshop}
            showHauler={showHauler}
            columns={['plate', 'hauler', 'make', 'total_km', 'since_service']}
            onRowClick={(t) => setSelectedRigId(t.id)}
          />
          <Bucket
            title="Service due"
            note="Crossed the 20,000 km service interval since last workshop visit. Book before the next laden trip."
            rows={state.data.service_due}
            showHauler={showHauler}
            columns={['plate', 'hauler', 'make', 'total_km', 'since_service']}
            onRowClick={(t) => setSelectedRigId(t.id)}
          />
          <Bucket
            title="Road-worthy certificate · <30 days"
            note="DVLA road-worthy certificate expires inside the next 30 days. Renew before expiry or the rig is off the road."
            rows={state.data.road_worthy_expiring_30d}
            showHauler={showHauler}
            columns={['plate', 'hauler', 'make', 'expiry_days']}
            onRowClick={(t) => setSelectedRigId(t.id)}
          />
          <RecentCompletions
            rows={state.data.recent_completions}
            showHauler={showHauler}
            onRowClick={(r) => setSelectedRigId(r.rig_id)}
          />
          <IntelligencePanel page="maintenance" />
        </div>
      )}

      <WorkorderDetail
        rigId={selectedRigId}
        open={Boolean(selectedRigId)}
        onClose={() => setSelectedRigId(null)}
        onMutate={load}
      />
    </PageShell>
  );
}

function CountersStrip({ counters }) {
  if (!counters) return <div style={{ height: 72, marginBottom: 'var(--space-4)' }} />;
  const critSub = counters.critical > 0
    ? `${counters.critical_unremediated ?? counters.critical} pending · ${counters.critical_remediating ?? 0} in remediation`
    : 'rigs affected';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)',
    }}>
      <Counter label="Critical"    value={counters.critical} tone="pending" sub={critSub} />
      <Counter label="In workshop" value={counters.in_workshop} tone="neutral" />
      <Counter label="Service due" value={counters.service_due} tone="degraded" />
      <Counter label="Cert <30d"   value={counters.road_worthy_expiring_30d} tone="degraded" />
    </div>
  );
}

function Counter({ label, value, tone, sub }) {
  const accent = tone === 'pending'  ? 'var(--bauxite-rust)'
               : tone === 'degraded' ? 'var(--signal-amber)'
               : 'var(--text)';
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>{label}</div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h2-size)',
        lineHeight: 'var(--ts-h2-lh)',
        fontWeight: 'var(--fw-black)',
        color: accent,
      }}>
        {value}
      </div>
      <div style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        marginTop: 2,
      }}>
        {sub ?? 'rigs affected'}
      </div>
    </div>
  );
}

function Bucket({ title, note, rows, showHauler, columns, onRowClick }) {
  return (
    <section>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <h2 style={{
          margin: 0,
          fontSize: 'var(--ts-h3-size)',
          lineHeight: 'var(--ts-h3-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          {title} <span className="tabular" style={{ color: 'var(--text-tertiary)' }}>· {rows.length}</span>
        </h2>
        {note && (
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            maxWidth: '72ch',
          }}>
            {note}
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <EmptyRow label="Nothing outstanding in this bucket." />
      ) : (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
                {columns.includes('plate')         && <Th>Plate</Th>}
                {columns.includes('hauler') && showHauler && <Th>Hauler</Th>}
                {columns.includes('make')          && <Th>Make / Model</Th>}
                {columns.includes('workorder')     && <Th>Workorder</Th>}
                {columns.includes('total_km')      && <Th align="right">Total km</Th>}
                {columns.includes('since_service') && <Th align="right">Since service</Th>}
                {columns.includes('expiry_days')   && <Th align="right">Expires in</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => onRowClick?.(t)}
                  onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = 'var(--accent-tint)'; }}
                  onMouseLeave={(e) => { if (onRowClick) e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    borderBottom: '1px solid var(--border-hairline)',
                    cursor: onRowClick ? 'pointer' : 'default',
                    transition: 'background 100ms ease',
                  }}
                >
                  {columns.includes('plate') && (
                    <Td><span className="mono" style={{ fontWeight: 'var(--fw-medium)' }}>{t.plate}</span></Td>
                  )}
                  {columns.includes('hauler') && showHauler && (
                    <Td>{t.hauler_display}</Td>
                  )}
                  {columns.includes('make') && (
                    <Td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{t.make}</span>
                        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                          {t.model}
                        </span>
                      </div>
                    </Td>
                  )}
                  {columns.includes('workorder') && (
                    <Td>
                      {t.active_workorder ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(184, 134, 11, 0.12)',
                          color: 'var(--signal-amber)',
                          fontSize: 10,
                          letterSpacing: '0.06em',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 'var(--fw-medium)',
                        }}>
                          {t.active_workorder.status.replace('_', ' ')}
                        </span>
                      ) : (
                        <span className="mono" style={{
                          fontSize: 10,
                          color: 'var(--text-tertiary)',
                          letterSpacing: '0.06em',
                        }}>
                          NONE
                        </span>
                      )}
                    </Td>
                  )}
                  {columns.includes('total_km') && (
                    <Td align="right" tabular>{formatKm(t.total_km)}</Td>
                  )}
                  {columns.includes('since_service') && (
                    <Td align="right" tabular>
                      <span style={{ color: t.km_since_service > 20000 ? 'var(--signal-amber)' : 'var(--text)' }}>
                        {formatKm(t.km_since_service)}
                      </span>
                    </Td>
                  )}
                  {columns.includes('expiry_days') && (
                    <Td align="right" tabular>
                      <span style={{ color: t.road_worthy_expiry_days <= 7 ? 'var(--bauxite-rust)' : 'var(--signal-amber)' }}>
                        {t.road_worthy_expiry_days} days
                      </span>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecentCompletions({ rows, showHauler, onRowClick }) {
  return (
    <section>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <h2 style={{
          margin: 0,
          fontSize: 'var(--ts-h3-size)',
          lineHeight: 'var(--ts-h3-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          Recent completions <span className="tabular" style={{ color: 'var(--text-tertiary)' }}>· last 30d</span>
        </h2>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          maxWidth: '72ch',
        }}>
          Workshop closures in the last month. Cost lines roll into the corridor cost block against the monthly maintenance budget.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyRow label="No workshop closures recorded in the last 30 days." />
      ) : (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
                <Th>Plate</Th>
                {showHauler && <Th>Hauler</Th>}
                <Th>Service</Th>
                <Th>Workshop</Th>
                <Th>Completed</Th>
                <Th align="right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.rig_id}-${r.completed_at}`}
                  onClick={() => onRowClick?.(r)}
                  onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = 'var(--accent-tint)'; }}
                  onMouseLeave={(e) => { if (onRowClick) e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    borderBottom: '1px solid var(--border-hairline)',
                    cursor: onRowClick ? 'pointer' : 'default',
                    transition: 'background 100ms ease',
                  }}
                >
                  <Td><span className="mono" style={{ fontWeight: 'var(--fw-medium)' }}>{r.plate}</span></Td>
                  {showHauler && <Td>{r.hauler_display}</Td>}
                  <Td>{r.service_type}</Td>
                  <Td>
                    <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
                      {r.workshop}
                    </span>
                  </Td>
                  <Td>
                    <span className="mono" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                      {formatCompleted(r.completed_at)}
                    </span>
                  </Td>
                  <Td align="right" tabular>{formatUsd(r.cost_usd)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatCompleted(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function EmptyRow({ label }) {
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text-tertiary)',
      textAlign: 'center',
    }}>
      {label}
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '12px 16px',
      fontSize: 'var(--ts-micro-size)',
      letterSpacing: 'var(--ts-micro-tracking)',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      fontWeight: 'var(--fw-medium)',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', tabular = false }) {
  return (
    <td style={{
      textAlign: align,
      padding: '14px 16px',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: tabular ? 'tabular-nums lining-nums' : 'normal',
    }}>
      {children}
    </td>
  );
}

function LoadingBlock() {
  return (
    <div style={{
      padding: 'var(--space-5)',
      textAlign: 'center',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text-secondary)',
    }}>
      Loading maintenance queue…
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
        Maintenance queue unavailable. {message}
      </span>
      <Button variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}
