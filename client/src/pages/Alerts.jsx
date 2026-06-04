/*
 * Alerts — Phase 13 triage board.
 * Summary strip → intelligence → filter bar → single alert list → resolved today.
 *
 * The page is the traffic controller for day-of operations: every alert lands
 * here with the actions an operator can take (resolve, snooze, assign, note)
 * gated by role. Server returns the full merged set; filtering happens via
 * query params so the summary still reflects the full visible context.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell           from '../components/layout/PageShell';
import AlertsSummary       from '../components/alerts/AlertsSummary';
import AlertCard           from '../components/alerts/AlertCard';
import AutoClearedSection  from '../components/alerts/AutoClearedSection';
import AlertSeverityTrend  from '../components/alerts/AlertSeverityTrend';
import AlertAgeProfileChart   from '../components/alerts/AlertAgeProfileChart';
import AlertResolutionChart      from '../components/alerts/AlertResolutionChart';
import AlertHaulerVolumeChart    from '../components/alerts/AlertHaulerVolumeChart';
import IntelligencePanel     from '../components/intelligence/IntelligencePanel';

const SEVERITY_OPTIONS = [
  ['', 'All severities'],
  ['CRITICAL', 'Critical'],
  ['WARNING',  'Warning'],
  ['INFO',     'Info'],
];

const STATUS_OPTIONS = [
  ['', 'All statuses'],
  ['NEEDS_ACTION', 'Needs action'],
  ['MONITORING',   'Monitoring'],
  ['SNOOZED',      'Snoozed'],
  ['RESOLVED',     'Resolved'],
];

const TYPE_OPTIONS = [
  ['', 'All types'],
  ['axle_load_breach',    'Axle load'],
  ['sla_breach',          'SLA'],
  ['licence_expiry',      'Licence'],
  ['payment_ageing',      'Receivables'],
  ['hse_event',           'HSE'],
  ['convoy_delay',        'Convoy'],
  ['payload_variance',    'Payload'],
  ['weighbridge_hold',    'Weighbridge'],
  ['integration_failure', 'Integration'],
  ['filing_overdue',      'Filing'],
  ['maintenance_cluster', 'Maintenance'],
];

export default function Alerts() {
  const { user } = useAuth();
  const [data, setData]   = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);

  const [severity, setSeverity] = useState('');
  const [status,   setStatus]   = useState('');
  const [haulerId, setHaulerId] = useState('');
  const [type,     setType]     = useState('');
  const [assignee, setAssignee] = useState('');

  const isHaulerAdmin = user?.role === 'hauler_admin';
  const canWriteAny   = user?.role === 'axis_admin' || user?.role === 'axis_ops' || isHaulerAdmin;

  // Focus routing — /alerts?focus=<id> deep-links from drawers. We consume
  // the param once, scroll the card into view, light it up, then clear the
  // URL so a reload doesn't re-fire the ceremony. useNavigate/useLocation
  // give us stable references so the cleanup-on-every-render footgun from
  // useSearchParams doesn't cancel our raf/timeouts mid-flight.
  const location = useLocation();
  const navigate = useNavigate();
  const focusParam = useMemo(
    () => new URLSearchParams(location.search).get('focus'),
    [location.search],
  );
  const [focusedId, setFocusedId] = useState(null);
  const handledFocusRef = useRef(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (severity) qs.set('severity', severity);
    if (status)   qs.set('status',   status);
    if (haulerId) qs.set('hauler_id', haulerId);
    if (type)     qs.set('type',     type);
    if (assignee) qs.set('assignee', assignee);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    try {
      const requests = [authFetch(`/api/alerts${query}`)];
      if (canWriteAny) requests.push(authFetch('/api/auth/users'));
      const responses = await Promise.all(requests);
      const [aRes, uRes] = responses;
      if (!aRes.ok) throw new Error(`alerts ${aRes.status}`);
      setData(await aRes.json());
      if (uRes) {
        if (!uRes.ok) throw new Error(`users ${uRes.status}`);
        const uBody = await uRes.json();
        setUsers(uBody.users ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [severity, status, haulerId, type, assignee, canWriteAny]);

  useEffect(() => { load(); }, [load]);

  const alerts = useMemo(() => data?.alerts ?? [], [data]);

  // Derive hauler options from the current alert set. Null-hauler alerts
  // surface as "Corridor-wide" so they can be filtered the same way.
  const haulerOptions = useMemo(() => {
    const seen = new Map();
    for (const a of alerts) {
      const id = a.hauler_id ?? '__null__';
      const label = a.hauler_id ? a.hauler_display_name ?? a.hauler_id : 'Corridor-wide';
      if (!seen.has(id)) seen.set(id, label);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [alerts]);

  // Split resolved into its own collapsed section so the main list only shows
  // active work. Server returns them unified; we just split for presentation.
  const activeAlerts   = alerts.filter((a) => a.status !== 'RESOLVED');
  const resolvedAlerts = alerts.filter((a) => a.status === 'RESOLVED');

  const focusIsResolved = useMemo(() => (
    !!focusParam && resolvedAlerts.some((a) => a.id === focusParam)
  ), [focusParam, resolvedAlerts]);

  // After the alerts list is in the DOM, resolve the focus param: scroll the
  // target card into view, mark it focused for ~2.4 s, then strip `focus`
  // from the URL so the effect only fires once per navigation.
  useEffect(() => {
    if (!focusParam || alerts.length === 0) return;
    if (handledFocusRef.current === focusParam) return;
    const hit = alerts.find((a) => a.id === focusParam);
    if (!hit) return; // not in the current filtered set — leave the param, let user clear filters
    handledFocusRef.current = focusParam;

    // Fire-and-forget the ceremony. We deliberately do not return a cleanup:
    // once committed, subsequent effect re-runs early-return via the ref
    // guard, but their cleanup would still fire and cancel the in-flight
    // ring before scrollIntoView / setFocusedId land. Poll for the target
    // card to appear — ResolvedSection auto-expand + children mount can
    // take a couple of render cycles, and scrollIntoView needs the card
    // in the DOM AND its height committed to layout.
    const start = performance.now();
    const tryScroll = () => {
      const el = document.getElementById(`alert-${focusParam}`);
      if (el && el.offsetHeight > 0) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        setFocusedId(focusParam);
        return;
      }
      if (performance.now() - start < 1000) setTimeout(tryScroll, 32);
    };
    setTimeout(tryScroll, 16);

    setTimeout(() => {
      const next = new URLSearchParams(location.search);
      next.delete('focus');
      const qs = next.toString();
      navigate(qs ? `${location.pathname}?${qs}` : location.pathname, { replace: true });
    }, 400);

    setTimeout(() => setFocusedId(null), 2400);
  }, [focusParam, alerts, navigate, location.pathname, location.search]);

  const canTriageAlert = (alert) => {
    if (!user) return false;
    if (user.role === 'axis_admin' || user.role === 'axis_ops') return true;
    if (user.role === 'hauler_admin') return alert.hauler_id === user.hauler_id;
    return false;
  };

  return (
    <PageShell
      eyebrow="Operations"
      title="Alerts"
      description="Day-of triage board. Each alert carries the action you can take on it — resolve with a note, snooze until a time, assign to a teammate, or jump to the source page."
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
          Alerts feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <AlertsSummary summary={data?.summary} />
        {/* Phase 155 — 8-week severity trend */}
        <AlertSeverityTrend severityTrend={data?.severity_trend} />
        {/* Phase 197 — open alert age profile */}
        {data?.alert_age_profile && (
          <AlertAgeProfileChart alertAgeProfile={data.alert_age_profile} />
        )}
        {/* Phase 212 — mean time to resolve by alert type */}
        {data?.resolution_by_type?.length > 0 && (
          <AlertResolutionChart resolutionByType={data.resolution_by_type} />
        )}
        {/* Phase 229 — open alert load by hauler */}
        {data?.alert_volume_by_hauler?.length > 0 && (
          <AlertHaulerVolumeChart alertVolumeByHauler={data.alert_volume_by_hauler} />
        )}
        <IntelligencePanel page="alerts" />

        <FilterBar
          severity={severity} setSeverity={setSeverity}
          status={status}     setStatus={setStatus}
          haulerId={haulerId} setHaulerId={setHaulerId}
          type={type}         setType={setType}
          assignee={assignee} setAssignee={setAssignee}
          haulerOptions={haulerOptions}
          hideHauler={isHaulerAdmin}
          canFilterByMe={canWriteAny}
          users={users}
          total={alerts.length}
          active={activeAlerts.length}
          onClear={() => {
            setSeverity(''); setStatus(''); setHaulerId(''); setType(''); setAssignee('');
          }}
        />

        {activeAlerts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {activeAlerts.map((a) => (
              <AlertCard
                key={a.id}
                alert={a}
                canTriage={canTriageAlert(a)}
                users={users}
                onChange={load}
                isFocused={focusedId === a.id}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}

        {resolvedAlerts.length > 0 && (
          <ResolvedSection
            alerts={resolvedAlerts}
            canTriageAlert={canTriageAlert}
            users={users}
            onChange={load}
            forceOpen={focusIsResolved}
            focusedId={focusedId}
          />
        )}

        <AutoClearedSection alerts={data?.auto_cleared ?? []} />
      </div>
    </PageShell>
  );
}

function FilterBar({
  severity, setSeverity,
  status,   setStatus,
  haulerId, setHaulerId,
  type,     setType,
  assignee, setAssignee,
  haulerOptions, hideHauler, canFilterByMe, users,
  total, active,
  onClear,
}) {
  const assigneeOptions = useMemo(() => {
    const base = [
      ['', 'All assignees'],
      ['unassigned', 'Unassigned'],
    ];
    if (canFilterByMe) base.push(['me', 'Assigned to me']);
    for (const u of users) base.push([u.id, u.display_name]);
    return base;
  }, [canFilterByMe, users]);

  // Drop the synthetic null-hauler entry — the server filter expects a real
  // hauler_id; "All haulers" already surfaces the corridor-wide rows.
  const haulerFilterOptions = useMemo(() => ([
    ['', 'All haulers'],
    ...haulerOptions.filter(([id]) => id !== '__null__'),
  ]), [haulerOptions]);

  const anyActive = severity || status || haulerId || type || assignee;

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
      <FilterSelect label="Severity" value={severity} onChange={setSeverity} options={SEVERITY_OPTIONS} />
      <FilterSelect label="Status"   value={status}   onChange={setStatus}   options={STATUS_OPTIONS} />
      {!hideHauler && haulerFilterOptions.length > 1 && (
        <FilterSelect label="Hauler" value={haulerId} onChange={setHaulerId} options={haulerFilterOptions} />
      )}
      <FilterSelect label="Type"     value={type}     onChange={setType}     options={TYPE_OPTIONS} />
      <FilterSelect label="Assignee" value={assignee} onChange={setAssignee} options={assigneeOptions} />

      {anyActive && (
        <button
          type="button"
          onClick={onClear}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            border: '1px dashed var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Clear filters
        </button>
      )}

      <span style={{
        marginLeft: 'auto',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        {active} active · {total} total
      </span>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      >
        {options.map(([v, l]) => (
          <option key={`${label}-${v}`} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function ResolvedSection({ alerts, canTriageAlert, users, onChange, forceOpen = false, focusedId = null }) {
  const [open, setOpen] = useState(false);
  // Deep-link to a resolved alert auto-expands the section. The effect only
  // toggles to open, never back to closed, so the user can still hide it.
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        <span className="eyebrow" style={{ color: 'var(--text-secondary)' }}>
          Resolved · {alerts.length}
        </span>
        <span className="mono" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          letterSpacing: '0.04em',
        }}>
          {open ? 'HIDE' : 'SHOW'}
        </span>
      </button>

      {open && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
          marginTop: 'var(--space-3)',
        }}>
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              canTriage={canTriageAlert(a)}
              users={users}
              onChange={onChange}
              isFocused={focusedId === a.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div style={{
      padding: 'var(--space-6) var(--space-5)',
      textAlign: 'center',
      background: 'var(--surface-raised)',
      border: '1px dashed var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div className="eyebrow" style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
        No active alerts match these filters
      </div>
      <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
        Clear filters to see the full board, or check the resolved list below for recent closures.
      </div>
    </div>
  );
}
