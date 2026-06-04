/*
 * Drivers — roster across every onboarded hauler. Primary focus is rest /
 * licence / safety compliance; the table is the infrastructure register and
 * the summary strip sets top-of-page context.
 *
 * Hauler admins are auto-scoped server-side, so the hauler dropdown is
 * suppressed for that role (same pattern as Fleet).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import StatusBadge from '../components/primitives/StatusBadge';
import DriverDetail             from '../components/drivers/DriverDetail';
import DriverHoursDistribution  from '../components/drivers/DriverHoursDistribution';
import LicenceExpiryPipeline    from '../components/drivers/LicenceExpiryPipeline';
import DriverSafetyHistogram      from '../components/drivers/DriverSafetyHistogram';
import RestStatusByHaulerChart    from '../components/drivers/RestStatusByHaulerChart';
import IntelligencePanel          from '../components/intelligence/IntelligencePanel';
import DriverFormModal            from '../components/drivers/DriverFormModal';

const REST_LABEL = {
  compliant: 'Compliant',
  warning:   'Warning',
  breach:    'Breach',
};

const REST_TONE = {
  compliant: 'connected',
  warning:   'degraded',
  breach:    'pending',
};

const FLAG_LABEL = {
  rest_breach:      'Rest breach',
  licence_expiring: 'Licence <60d',
  psv_expiring:     'PSV <30d',
  coaching_due:     'Coaching due',
};

const FLAG_TONE = {
  rest_breach:      'pending',
  licence_expiring: 'pending',
  psv_expiring:     'degraded',
  coaching_due:     'degraded',
};

const SHIFT_LABEL = {
  day:    'Day',
  night:  'Night',
  rest:   'Rest day',
  relief: 'Relief pool',
};

export default function Drivers() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ status: 'loading', data: null, error: null });
  const [roster,  setRoster]  = useState({ status: 'loading', data: null, error: null });
  const [haulerFilter, setHaulerFilter] = useState('');
  const [restFilter,   setRestFilter]   = useState('');
  const [selectedId,   setSelectedId]   = useState(null);
  const [addOpen,      setAddOpen]      = useState(false);
  const isHaulerAdmin = user?.role === 'hauler_admin';
  const isAxisAdmin   = user?.role === 'axis_admin';

  const load = useCallback(async () => {
    const qs = !isHaulerAdmin && haulerFilter ? `?hauler_id=${encodeURIComponent(haulerFilter)}` : '';
    setSummary((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    setRoster((s)  => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const [sRes, rRes] = await Promise.all([
        authFetch(`/api/drivers/summary${qs}`),
        authFetch(`/api/drivers${qs}`),
      ]);
      if (!sRes.ok) throw new Error(`Summary failed (${sRes.status})`);
      if (!rRes.ok) throw new Error(`Roster failed (${rRes.status})`);
      const [sBody, rBody] = await Promise.all([sRes.json(), rRes.json()]);
      setSummary({ status: 'ready', data: sBody, error: null });
      setRoster({  status: 'ready', data: rBody, error: null });
    } catch (err) {
      setSummary((s) => ({ ...s, status: 'error', error: err.message }));
      setRoster((s)  => ({ ...s, status: 'error', error: err.message }));
    }
  }, [haulerFilter, isHaulerAdmin]);

  useEffect(() => { load(); }, [load]);

  const drivers = useMemo(() => roster.data?.drivers ?? [], [roster.data]);

  const haulerOptions = useMemo(() => {
    const seen = new Map();
    for (const d of drivers) {
      if (!seen.has(d.hauler_id)) seen.set(d.hauler_id, d.hauler_display);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [drivers]);

  const filtered = useMemo(() => (
    restFilter ? drivers.filter((d) => d.rest_status === restFilter) : drivers
  ), [drivers, restFilter]);

  return (
    <PageShell
      eyebrow="Operations"
      title="Drivers"
      description="Primary + relief roster across every onboarded hauler. 1.55 drivers per rig covers shift rotation, leave, and training. Rest hours roll over Monday 00:00 Africa/Accra."
    >
      <SummaryStrip summary={summary} />

      <div style={{
        display: 'flex',
        gap: 'var(--space-3)',
        alignItems: 'center',
        marginBottom: 'var(--space-3)',
      }}>
        {!isHaulerAdmin && (
          <FilterSelect
            label="Hauler"
            value={haulerFilter}
            onChange={setHaulerFilter}
            options={[['', 'All haulers'], ...haulerOptions]}
          />
        )}
        <FilterSelect
          label="Rest"
          value={restFilter}
          onChange={setRestFilter}
          options={[
            ['', 'All statuses'],
            ['compliant', 'Compliant'],
            ['warning',   'Warning'],
            ['breach',    'Breach'],
          ]}
        />
        <span style={{
          marginLeft: 'auto',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {filtered.length} of {drivers.length} drivers
        </span>
        {isAxisAdmin && (
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            + Add driver
          </Button>
        )}
      </div>

      {roster.status === 'loading' && <LoadingBlock />}
      {roster.status === 'error' && <ErrorBlock message={roster.error} onRetry={load} />}
      {roster.data && (
        <RosterTable
          drivers={filtered}
          showHauler={!isHaulerAdmin}
          onRowClick={(d) => setSelectedId(d.id)}
        />
      )}

      {/* Phase 173 — driver HOS weekly hours distribution */}
      {drivers.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <DriverHoursDistribution drivers={drivers} />
        </div>
      )}

      {/* Phase 185 — licence expiry pipeline */}
      {roster.data?.licence_pipeline && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <LicenceExpiryPipeline licencePipeline={roster.data.licence_pipeline} />
        </div>
      )}

      {/* Phase 195 — safety score distribution histogram */}
      {roster.data?.safety_distribution?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <DriverSafetyHistogram safetyDistribution={roster.data.safety_distribution} />
        </div>
      )}

      {/* Phase 211 — rest status breakdown by hauler */}
      {roster.data?.rest_by_hauler?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <RestStatusByHaulerChart restByHauler={roster.data.rest_by_hauler} />
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="drivers" />
      </div>

      <DriverDetail
        driverId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        onDriverUpdated={() => load()}
      />

      <DriverFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => load()}
        haulerOptions={haulerOptions}
      />
    </PageShell>
  );
}

function SummaryStrip({ summary }) {
  if (!summary.data) return <div style={{ height: 72, marginBottom: 'var(--space-4)' }} />;
  const s = summary.data;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: 'var(--space-3)',
      marginBottom: 'var(--space-4)',
    }}>
      <Stat label="Total drivers"  value={s.total}             sub={`${s.assigned_primary} primary · ${s.relief_pool} relief`} />
      <Stat label="Rest breach"    value={s.rest_breach}       sub="Over 56 hrs this week"   accent={s.rest_breach  > 0 ? 'var(--bauxite-rust)'  : undefined} />
      <Stat label="Rest warning"   value={s.rest_warning}      sub="48–56 hrs this week"     accent={s.rest_warning > 0 ? 'var(--signal-amber)'  : undefined} />
      <Stat label="Coaching flagged" value={s.coaching_flagged} sub="Licence / safety drift" accent={s.coaching_flagged > 0 ? 'var(--signal-amber)' : undefined} />
      <Stat label="Avg safety"     value={s.avg_safety_score}  sub="Composite · 100" />
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
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
        color: accent ?? 'var(--text)',
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

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function RosterTable({ drivers, showHauler, onRowClick }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-soft)' }}>
            <Th>Driver</Th>
            {showHauler && <Th>Hauler</Th>}
            <Th>Assignment</Th>
            <Th>Shift</Th>
            <Th align="right">Years</Th>
            <Th align="right">Hrs / wk</Th>
            <Th>Rest</Th>
            <Th align="right">Safety</Th>
            <Th align="right">Licence</Th>
            <Th>Flag</Th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((d) => (
            <tr key={d.id}
              onClick={() => onRowClick?.(d)}
              style={{
                borderBottom: '1px solid var(--border-hairline)',
                transition: 'background 100ms ease',
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-tint)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 'var(--fw-medium)' }}>{d.full_name}</span>
                  <span className="mono" style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                    {d.licence_number}
                  </span>
                </div>
              </Td>
              {showHauler && <Td>{d.hauler_display}</Td>}
              <Td>
                {d.assigned_plate ? (
                  <span className="mono" style={{ fontWeight: 'var(--fw-medium)' }}>{d.assigned_plate}</span>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>Relief pool</span>
                )}
              </Td>
              <Td>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
                  {SHIFT_LABEL[d.shift] ?? d.shift}
                </span>
              </Td>
              <Td align="right" tabular>{d.years_experience}</Td>
              <Td align="right" tabular>
                <span style={{
                  color: d.rest_status === 'breach'  ? 'var(--bauxite-rust)'
                       : d.rest_status === 'warning' ? 'var(--signal-amber)'
                       : 'var(--text)',
                }}>
                  {d.hours_this_week.toFixed(1)}
                </span>
              </Td>
              <Td>
                <StatusBadge tone={REST_TONE[d.rest_status] ?? 'neutral'}>
                  {REST_LABEL[d.rest_status] ?? d.rest_status}
                </StatusBadge>
              </Td>
              <Td align="right" tabular>{d.safety_score}</Td>
              <Td align="right" tabular>
                <span style={{ color: d.licence_expiry_months <= 2 ? 'var(--bauxite-rust)' : 'var(--text-secondary)' }}>
                  {d.licence_expiry_months}m
                </span>
              </Td>
              <Td>
                {d.flag ? (
                  <StatusBadge tone={FLAG_TONE[d.flag] ?? 'neutral'}>
                    {FLAG_LABEL[d.flag] ?? d.flag}
                  </StatusBadge>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </Td>
            </tr>
          ))}
          {drivers.length === 0 && (
            <tr>
              <td colSpan={showHauler ? 10 : 9} style={{
                padding: 'var(--space-5)',
                textAlign: 'center',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text-tertiary)',
              }}>
                No drivers match the current filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
      Loading driver roster…
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
        Driver roster unavailable. {message}
      </span>
      <Button variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}
