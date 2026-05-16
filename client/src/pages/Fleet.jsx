/*
 * Fleet — aggregated truck roster across every onboarded hauler. Table is the
 * primary artefact; summary strip up top sets context. Hauler admins see only
 * their own rigs (server enforces), so the filter dropdown is suppressed for
 * that role.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import StatusBadge from '../components/primitives/StatusBadge';
import RigDetail from '../components/fleet/RigDetail';
import FleetAvailabilityStrip    from '../components/fleet/FleetAvailabilityStrip';
import MaintenanceForecastStrip  from '../components/fleet/MaintenanceForecastStrip';
import PayloadEfficiencyChart    from '../components/fleet/PayloadEfficiencyChart';
import FleetStatusByHaulerChart  from '../components/fleet/FleetStatusByHaulerChart';
import IntelligencePanel from '../components/intelligence/IntelligencePanel';
import { formatKm } from '../lib/format';

const STATUS_LABEL = {
  active:     'Active',
  in_transit: 'In transit',
  idle:       'Idle',
  garage:     'Garage',
};

const STATUS_TONE = {
  active:     'connected',
  in_transit: 'connected',
  idle:       'manual',
  garage:     'pending',
};

const FLAG_LABEL = {
  service_due:     'Service due',
  road_worthy_30d: 'Cert <30d',
  critical:        'Critical',
};

const FLAG_TONE = {
  service_due:     'degraded',
  road_worthy_30d: 'degraded',
  critical:        'pending',
};

export default function Fleet() {
  const { user } = useAuth();
  const [summary, setSummary] = useState({ status: 'loading', data: null, error: null });
  const [roster, setRoster]   = useState({ status: 'loading', data: null, error: null });
  const [haulerFilter, setHaulerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedRig, setSelectedRig] = useState(null);
  const isHaulerAdmin = user?.role === 'hauler_admin';

  const load = useCallback(async () => {
    const qs = !isHaulerAdmin && haulerFilter ? `?hauler_id=${encodeURIComponent(haulerFilter)}` : '';
    setSummary((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    setRoster((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const [sRes, rRes] = await Promise.all([
        authFetch(`/api/fleet/summary${qs}`),
        authFetch(`/api/fleet${qs}`),
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

  const trucks = roster.data?.trucks ?? [];
  const haulerOptions = useMemo(() => {
    const seen = new Map();
    for (const t of trucks) {
      if (!seen.has(t.hauler_id)) seen.set(t.hauler_id, t.hauler_display);
    }
    return Array.from(seen.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [trucks]);

  const filtered = useMemo(() => (
    statusFilter ? trucks.filter((t) => t.status === statusFilter) : trucks
  ), [trucks, statusFilter]);

  return (
    <PageShell
      eyebrow="Fleet"
      title="Fleet"
      description="Aggregated rig roster across every onboarded hauler. Normalised from each hauler's FMS feed. 40-tonne 6×4 tippers on the Nyinahin–Takoradi corridor."
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
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            ['', 'All statuses'],
            ['active', 'Active'],
            ['in_transit', 'In transit'],
            ['idle', 'Idle'],
            ['garage', 'Garage'],
          ]}
        />
        <span style={{
          marginLeft: 'auto',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          {filtered.length} of {trucks.length} rigs
        </span>
      </div>

      {roster.status === 'loading' && <LoadingBlock />}
      {roster.status === 'error' && <ErrorBlock message={roster.error} onRetry={load} />}
      {roster.data && (
        <RosterTable
          trucks={filtered}
          showHauler={!isHaulerAdmin}
          onRowClick={setSelectedRig}
        />
      )}

      {/* Phase 157 — per-hauler fleet availability breakdown */}
      {roster.data && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <FleetAvailabilityStrip availabilityByHauler={roster.data.availability_by_hauler} />
        </div>
      )}

      {/* Phase 164 — maintenance look-ahead: trucks within 5,000 km of service */}
      {roster.data?.maintenance_forecast?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <MaintenanceForecastStrip maintenanceForecast={roster.data.maintenance_forecast} />
        </div>
      )}

      {/* Phase 199 — payload efficiency: actual vs rated capacity per hauler */}
      {roster.data?.payload_efficiency?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <PayloadEfficiencyChart payloadEfficiency={roster.data.payload_efficiency} />
        </div>
      )}

      {/* Phase 218 — fleet status breakdown by hauler (active / idle / garage) */}
      {roster.data?.availability_by_hauler?.length > 0 && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <FleetStatusByHaulerChart availabilityByHauler={roster.data.availability_by_hauler} />
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <IntelligencePanel page="fleet" />
      </div>

      <RigDetail
        rig={selectedRig}
        open={Boolean(selectedRig)}
        onClose={() => setSelectedRig(null)}
        onRigUpdated={() => load()}
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
      <Stat label="Total rigs"   value={s.total} sub="Contracted fleet" />
      <Stat label="Active today" value={s.active_today} sub={`${pctOf(s.active_today, s.total)} of roster`} />
      <Stat label="In garage"    value={s.in_garage} sub="Workshop / pulled" />
      <Stat label="Idle at yard" value={s.idle_yard} sub="Not dispatched" />
      <Stat label="Avg efficiency" value={`${s.avg_efficiency_l_per_100km} L`} sub="per 100 km · laden" />
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
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>{label}</div>
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

function RosterTable({ trucks, showHauler, onRowClick }) {
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
            <Th>Plate</Th>
            {showHauler && <Th>Hauler</Th>}
            <Th>Make / Model</Th>
            <Th align="right">Year</Th>
            <Th>Status</Th>
            <Th align="right">Total km</Th>
            <Th align="right">Since service</Th>
            <Th align="right">L/100km</Th>
            <Th align="right">Trips / wk</Th>
            <Th>Flag</Th>
          </tr>
        </thead>
        <tbody>
          {trucks.map((t) => (
            <tr
              key={t.id}
              onClick={() => onRowClick?.(t)}
              style={{
                borderBottom: '1px solid var(--border-hairline)',
                transition: 'background 100ms ease',
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-tint)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Td>
                <span className="mono" style={{ fontWeight: 'var(--fw-medium)' }}>{t.plate}</span>
              </Td>
              {showHauler && (
                <Td>
                  <span style={{ fontSize: 'var(--ts-body-sm-size)' }}>{t.hauler_display}</span>
                </Td>
              )}
              <Td>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{t.make}</span>
                  <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                    {t.model}
                  </span>
                </div>
              </Td>
              <Td align="right" tabular>{t.year_of_manufacture}</Td>
              <Td>
                <StatusBadge tone={STATUS_TONE[t.status] ?? 'neutral'}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </StatusBadge>
              </Td>
              <Td align="right" tabular>{formatKm(t.total_km)}</Td>
              <Td align="right" tabular>{formatKm(t.km_since_service)}</Td>
              <Td align="right" tabular>{t.efficiency_l_per_100km}</Td>
              <Td align="right" tabular>{t.trips_this_week}</Td>
              <Td>
                {t.maintenance_flag ? (
                  <StatusBadge tone={FLAG_TONE[t.maintenance_flag] ?? 'neutral'}>
                    {FLAG_LABEL[t.maintenance_flag] ?? t.maintenance_flag}
                  </StatusBadge>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                )}
              </Td>
            </tr>
          ))}
          {trucks.length === 0 && (
            <tr>
              <td colSpan={showHauler ? 10 : 9} style={{
                padding: 'var(--space-5)',
                textAlign: 'center',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text-tertiary)',
              }}>
                No rigs match the current filter.
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
      Loading fleet roster…
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
        Fleet roster unavailable. {message}
      </span>
      <Button variant="secondary" onClick={onRetry}>Retry</Button>
    </div>
  );
}
