/*
 * RigDetail — drawer for a single truck on the Fleet page. Phase 102
 * adds a "Status" section with status + maintenance-flag controls for
 * axis_admin / axis_ops / hauler_admin (own fleet only).
 *
 * PATCH /api/fleet/:rigId/status — body: { status, maintenance_flag?, notes? }
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

import Modal from '../primitives/Modal';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';
import { formatKm } from '../../lib/format';

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

const STATUS_OPTIONS    = ['active', 'idle', 'garage', 'in_transit'];
const FLAG_OPTIONS      = [null, 'service_due', 'road_worthy_30d', 'critical'];

// ── Status update panel ────────────────────────────────────────────

function StatusPanel({ rig, onUpdated }) {
  const [status, setStatus]     = useState(rig.status);
  const [flag, setFlag]         = useState(rig.maintenance_flag ?? null);
  const [notes, setNotes]       = useState(rig._status_override?.notes ?? '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(false);

  // Reset form when a new rig is opened
  useEffect(() => {
    setStatus(rig.status);
    setFlag(rig.maintenance_flag ?? null);
    setNotes(rig._status_override?.notes ?? '');
    setError(null);
    setSuccess(false);
  }, [rig.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = status !== rig.status
    || flag !== (rig.maintenance_flag ?? null)
    || notes !== (rig._status_override?.notes ?? '');

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const r = await authFetch(`/api/fleet/${rig.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, maintenance_flag: flag, notes: notes.trim() || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSuccess(true);
      onUpdated(data.truck);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [rig.id, status, flag, notes, onUpdated]);

  const chip = (active) => ({
    padding: '5px 12px',
    borderRadius: 'var(--radius-sm)',
    border: `1px solid ${active ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
    background: active ? 'rgba(162,62,35,0.10)' : 'transparent',
    color: active ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
    fontSize: 'var(--ts-caption-size)',
    fontWeight: 'var(--fw-medium)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 80ms ease',
  });

  const overrideMeta = rig._status_override;

  return (
    <div>
      {overrideMeta && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginBottom: 'var(--space-2)',
        }}>
          Last updated by {overrideMeta.updated_by_name} ·{' '}
          {new Date(overrideMeta.updated_at).toLocaleString('en-GB', {
            day: '2-digit', month: 'short',
            hour: '2-digit', minute: '2-digit',
            hour12: false, timeZone: 'Africa/Accra',
          })}
        </div>
      )}

      <div style={{ marginBottom: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 6 }}>
          Status
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} style={chip(status === s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-2)' }}>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 6 }}>
          Maintenance flag
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setFlag(null)}
            style={{ ...chip(flag === null), borderStyle: flag === null ? 'solid' : 'dashed' }}>
            None
          </button>
          {FLAG_OPTIONS.filter(Boolean).map((f) => (
            <button key={f} type="button" onClick={() => setFlag(f)} style={chip(flag === f)}>
              {FLAG_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 6 }}>
          Notes (optional)
        </div>
        <input
          type="text"
          maxLength={200}
          placeholder="e.g. Brake caliper replacement, back Friday"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            background: 'var(--surface)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={{
            padding: '7px 16px',
            background: !dirty ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
            color: !dirty ? 'var(--text-tertiary)' : 'var(--bone)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            cursor: !dirty || saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {saving && <Loader size={12} strokeWidth={2} />}
          {saving ? 'Saving…' : 'Save status'}
        </button>
        {success && (
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-green)' }}>
            Updated ✓
          </span>
        )}
        {error && (
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────

export default function RigDetail({ rig: rigProp, open, onClose, onRigUpdated }) {
  const { user } = useAuth();
  const [rig, setRig] = useState(rigProp);
  const [driver, setDriver] = useState(null);
  const [driverStatus, setDriverStatus] = useState('idle');
  const [liveAssignment, setLiveAssignment] = useState(false);
  const [assignmentMeta, setAssignmentMeta] = useState(null);

  // Keep local rig in sync when prop changes (new row selected)
  useEffect(() => { setRig(rigProp); }, [rigProp]);

  useEffect(() => {
    if (!open || !rig?.id) {
      setDriver(null);
      setDriverStatus('idle');
      setLiveAssignment(false);
      setAssignmentMeta(null);
      return;
    }
    let cancelled = false;
    setDriverStatus('loading');
    authFetch(`/api/drivers/by-rig/${rig.id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => {
        if (!cancelled) {
          setDriver(j.primary);
          setLiveAssignment(j.live_assignment ?? false);
          setAssignmentMeta(j.assignment_meta ?? null);
          setDriverStatus('ready');
        }
      })
      .catch(() => { if (!cancelled) setDriverStatus('error'); });
    return () => { cancelled = true; };
  }, [open, rig?.id]);

  const handleUpdated = useCallback((updatedTruck) => {
    setRig(updatedTruck);
    onRigUpdated?.(updatedTruck);
  }, [onRigUpdated]);

  const refreshDriver = useCallback(() => {
    if (!rig?.id) return;
    setDriverStatus('loading');
    authFetch(`/api/drivers/by-rig/${rig.id}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j) => {
        setDriver(j.primary);
        setLiveAssignment(j.live_assignment ?? false);
        setAssignmentMeta(j.assignment_meta ?? null);
        setDriverStatus('ready');
      })
      .catch(() => setDriverStatus('error'));
  }, [rig?.id]);

  if (!rig) return null;

  const canUpdate = user?.role === 'axis_admin'
    || user?.role === 'axis_ops'
    || (user?.role === 'hauler_admin' && user?.hauler_id === rig.hauler_id);

  const serviceUtilPct = Math.min(100, Math.round((rig.km_since_service / 20000) * 100));
  const serviceOver = rig.km_since_service > 20000;
  const kmToNext = rig.next_service_km_due - rig.total_km;

  return (
    <Modal open={open} onClose={onClose} width={560}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Rig · {rig.id}
          </div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
          }}>
            <h2 className="mono" style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--text)',
              letterSpacing: '0.02em',
            }}>
              {rig.plate}
            </h2>
            <StatusBadge tone={STATUS_TONE[rig.status] ?? 'neutral'}>
              {STATUS_LABEL[rig.status] ?? rig.status}
            </StatusBadge>
          </div>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            {rig.hauler_display} · {rig.make} {rig.model} · {rig.year_of_manufacture}
          </p>
        </header>

        <Section title="Specification">
          <Row label="Make / Model"       value={`${rig.make} ${rig.model}`} />
          <Row label="Axle configuration" value={rig.axle_config} />
          <Row label="Year of manufacture" value={rig.year_of_manufacture} />
          <Row label="Empty weight"       value={`${rig.empty_weight_t} t`} />
          <Row label="Gross weight"       value={`${rig.gross_weight_t} t`} />
          <Row label="Payload capacity"   value={`${rig.payload_capacity_t} t`} />
        </Section>

        <Section title="This week">
          <Row label="Trips completed"    value={rig.trips_this_week} />
          <Row label="Fuel efficiency"    value={`${rig.efficiency_l_per_100km} L / 100 km`} />
          <Row label="Last position ping" value={formatPing(rig.last_position_ping_iso)} />
        </Section>

        <Section title="Service">
          <Row label="Total km"           value={formatKm(rig.total_km)} />
          <Row label="Last service at"    value={formatKm(rig.last_service_km)} />
          <Row label="Next service due"   value={formatKm(rig.next_service_km_due)} />
          <Row
            label="Since last service"
            value={
              <span style={{ color: serviceOver ? 'var(--signal-amber)' : 'var(--text)' }}>
                {formatKm(rig.km_since_service)}
              </span>
            }
          />
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={serviceUtilPct} warn={serviceOver} />
            <div style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
              marginTop: 4,
            }}>
              {serviceOver
                ? `${formatKm(-kmToNext)} past the 20,000 km service interval`
                : `${formatKm(kmToNext)} remaining to next service`}
            </div>
          </div>
        </Section>

        <Section title="Compliance">
          <Row
            label="Road-worthy cert"
            value={
              <span style={{
                color: rig.road_worthy_expiry_days <= 7  ? 'var(--bauxite-rust)'
                     : rig.road_worthy_expiry_days <= 30 ? 'var(--signal-amber)'
                     : 'var(--text)',
              }}>
                {rig.road_worthy_expiry_days} days to expiry
              </span>
            }
          />
          <Row
            label="Maintenance flag"
            value={
              rig.maintenance_flag ? (
                <StatusBadge tone={FLAG_TONE[rig.maintenance_flag] ?? 'neutral'}>
                  {FLAG_LABEL[rig.maintenance_flag] ?? rig.maintenance_flag}
                </StatusBadge>
              ) : (
                <span style={{ color: 'var(--text-tertiary)' }}>—</span>
              )
            }
          />
        </Section>

        {canUpdate && (
          <Section title="Update status">
            <StatusPanel rig={rig} onUpdated={handleUpdated} />
          </Section>
        )}

        <Section title="Assigned driver">
          <DriverAssignPanel
            rig={rig}
            driver={driver}
            driverLoadStatus={driverStatus}
            liveAssignment={liveAssignment}
            assignmentMeta={assignmentMeta}
            canUpdate={canUpdate}
            onRefresh={refreshDriver}
          />
        </Section>

        <Section title="Fuel log">
          <FuelLogSection rig={rig} open={open} canUpdate={canUpdate} />
        </Section>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Primitive sub-components ───────────────────────────────────────

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <h3 className="micro" style={{ margin: '0 0 10px', color: 'var(--text-tertiary)' }}>
        {title}
      </h3>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3)',
      }}>
        {children}
      </div>
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
    }}>
      <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>{label}</span>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </span>
    </div>
  );
}

function MutedLine({ children }) {
  return (
    <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
      {children}
    </span>
  );
}

// ── Driver assignment panel (Phase 110) ────────────────────────────

function DriverAssignPanel({ rig, driver, driverLoadStatus, liveAssignment, assignmentMeta, canUpdate, onRefresh }) {
  const [reassigning, setReassigning] = useState(false);
  const [driverList,  setDriverList]  = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedId,  setSelectedId]  = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [error,       setError]       = useState(null);

  async function openReassign() {
    setReassigning(true);
    setSelectedId('');
    setAssignNotes('');
    setError(null);
    setListLoading(true);
    try {
      const r = await authFetch(`/api/drivers?hauler_id=${rig.hauler_id}`);
      const j = await r.json();
      setDriverList(j.drivers ?? []);
    } catch {
      setDriverList([]);
    } finally {
      setListLoading(false);
    }
  }

  async function doAssign() {
    if (!selectedId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch(`/api/fleet/${rig.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_id: selectedId, notes: assignNotes.trim() || undefined }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setReassigning(false);
      onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function doUnassign() {
    if (unassigning) return;
    setUnassigning(true);
    setError(null);
    try {
      const r = await authFetch(`/api/fleet/${rig.id}/assign`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setUnassigning(false);
    }
  }

  if (driverLoadStatus === 'loading') return <MutedLine>Loading…</MutedLine>;
  if (driverLoadStatus === 'error')   return <MutedLine>Driver lookup failed.</MutedLine>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* Assignment source badge */}
      {driver && (
        <div style={{ marginBottom: 2 }}>
          <span style={{
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            padding: '2px 6px',
            borderRadius: 3,
            border: liveAssignment
              ? '1px solid rgba(38, 160, 100, 0.3)'
              : '1px solid var(--border-soft)',
            color: liveAssignment ? 'var(--signal-green)' : 'var(--text-tertiary)',
          }}>
            {liveAssignment ? 'Live' : 'System default'}
          </span>
        </div>
      )}

      {/* No driver */}
      {!driver && <MutedLine>No primary driver assigned.</MutedLine>}

      {/* Driver rows */}
      {driver && (
        <>
          <Row label="Name"          value={driver.full_name} />
          <Row label="Licence"       value={`${driver.licence_number} · Class ${driver.licence_class}`} />
          <Row label="Years"         value={driver.years_experience} />
          <Row label="Phone"         value={<span className="mono">{driver.phone}</span>} />
          <Row label="Hrs this week" value={`${driver.hours_this_week.toFixed(1)} h`} />
          <Row
            label="Rest status"
            value={
              <StatusBadge tone={REST_TONE[driver.rest_status] ?? 'neutral'}>
                {REST_LABEL[driver.rest_status] ?? driver.rest_status}
              </StatusBadge>
            }
          />
          <Row label="Safety score"  value={driver.safety_score} />
          {liveAssignment && assignmentMeta?.assigned_by && (
            <Row
              label="Assigned by"
              value={
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {assignmentMeta.assigned_by} · {fmtAssignTime(assignmentMeta.assigned_at)}
                </span>
              }
            />
          )}
          {liveAssignment && assignmentMeta?.notes && (
            <Row
              label="Notes"
              value={
                <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                  {assignmentMeta.notes}
                </span>
              }
            />
          )}
        </>
      )}

      {/* Action buttons */}
      {canUpdate && !reassigning && (
        <div style={{ display: 'flex', gap: 8, marginTop: driver ? 6 : 2, flexWrap: 'wrap' }}>
          <button type="button" onClick={openReassign} style={assignBtn(false)}>
            {driver ? 'Reassign' : 'Assign driver'}
          </button>
          {liveAssignment && (
            <button type="button" onClick={doUnassign} disabled={unassigning} style={assignBtn(true, unassigning)}>
              {unassigning ? 'Removing…' : 'Remove assignment'}
            </button>
          )}
        </div>
      )}

      {/* Inline reassign form */}
      {canUpdate && reassigning && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            Select driver — {rig.hauler_display}
          </div>
          {listLoading ? (
            <MutedLine>Loading drivers…</MutedLine>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                color: selectedId ? 'var(--text)' : 'var(--text-tertiary)',
                fontFamily: 'inherit',
              }}
            >
              <option value="">— Select a driver —</option>
              {driverList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} · {d.licence_number} · {d.shift}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            maxLength={120}
            placeholder="Notes (optional)"
            value={assignNotes}
            onChange={(e) => setAssignNotes(e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '7px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          />
          {error && (
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>
              {error}
            </span>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={doAssign}
              disabled={!selectedId || saving}
              style={assignBtn(false, !selectedId || saving)}
            >
              {saving ? 'Assigning…' : 'Confirm assignment'}
            </button>
            <button
              type="button"
              onClick={() => { setReassigning(false); setError(null); }}
              style={{
                padding: '5px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid transparent',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--ts-caption-size)',
                fontWeight: 'var(--fw-medium)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unassign error (shown outside the form) */}
      {error && !reassigning && (
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)', marginTop: 2 }}>
          {error}
        </span>
      )}
    </div>
  );
}

function assignBtn(destructive, disabled) {
  return {
    padding: '5px 12px',
    borderRadius: 'var(--radius-sm)',
    border: `1px solid ${
      disabled      ? 'var(--border-hairline)'
      : destructive ? 'rgba(139, 46, 26, 0.3)'
      :               'var(--border-strong)'
    }`,
    background: 'transparent',
    color: disabled ? 'var(--text-tertiary)'
         : destructive ? 'var(--bauxite-rust)'
         : 'var(--text)',
    fontSize: 'var(--ts-caption-size)',
    fontWeight: 'var(--fw-medium)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    transition: 'all 80ms ease',
  };
}

function fmtAssignTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    });
  } catch { return iso; }
}

// ── Fuel log section (Phase 111) ──────────────────────────────────

function FuelLogSection({ rig, open, canUpdate }) {
  const [logs,       setLogs]       = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [loadStatus, setLoadStatus] = useState('idle');
  const [logging,    setLogging]    = useState(false);
  const [litres,     setLitres]     = useState('');
  const [costGhs,    setCostGhs]    = useState('');
  const [odomKm,     setOdomKm]     = useState('');
  const [fillNotes,  setFillNotes]  = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState(null);

  function doLoad() {
    setLoadStatus('loading');
    authFetch(`/api/fleet/${rig.id}/fuel`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((j) => { setLogs(j.logs ?? []); setSummary(j.summary); setLoadStatus('ready'); })
      .catch(() => setLoadStatus('error'));
  }

  useEffect(() => {
    if (!open || !rig?.id) {
      setLogs([]); setSummary(null); setLoadStatus('idle'); setLogging(false);
      return;
    }
    doLoad();
  }, [open, rig?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitFill() {
    const l = parseFloat(litres);
    if (Number.isNaN(l) || l <= 0) { setError('Litres must be a positive number.'); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch(`/api/fleet/${rig.id}/fuel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          litres:      l,
          cost_ghs:    costGhs  ? parseFloat(costGhs)  : undefined,
          odometer_km: odomKm   ? parseFloat(odomKm)   : undefined,
          notes:       fillNotes.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setLogging(false);
      setLitres(''); setCostGhs(''); setOdomKm(''); setFillNotes('');
      doLoad();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadStatus === 'loading') return <MutedLine>Loading…</MutedLine>;
  if (loadStatus === 'error')   return <MutedLine>Fuel log unavailable.</MutedLine>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

      {/* Summary strip */}
      {summary && summary.fill_count > 0 && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-4)',
          padding: '8px 10px',
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-hairline)',
          flexWrap: 'wrap',
        }}>
          <FuelSumCell label="Fills"        value={summary.fill_count} />
          <FuelSumCell label="Total litres" value={`${summary.total_litres.toFixed(1)} L`} />
          {summary.total_cost_ghs && (
            <FuelSumCell label="Total cost" value={`GHS ${summary.total_cost_ghs.toFixed(2)}`} />
          )}
          {summary.last_odometer_km && (
            <FuelSumCell label="Last odometer" value={`${Math.round(summary.last_odometer_km).toLocaleString()} km`} />
          )}
        </div>
      )}

      {/* Log rows */}
      {logs.length === 0 && !logging && <MutedLine>No fuel fills logged yet.</MutedLine>}
      {logs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
          {logs.map((l) => (
            <div key={l.id} style={{
              display: 'grid',
              gridTemplateColumns: '110px 64px 88px 1fr',
              gap: 4,
              padding: '5px 6px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              alignItems: 'baseline',
            }}>
              <span className="mono" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.02em', fontSize: 11 }}>
                {fmtFuelDate(l.logged_at)}
              </span>
              <span className="tabular" style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                {l.litres.toFixed(1)} L
              </span>
              <span className="tabular" style={{ color: l.cost_ghs ? 'var(--text)' : 'var(--text-tertiary)' }}>
                {l.cost_ghs ? `GHS ${l.cost_ghs.toFixed(2)}` : '—'}
              </span>
              <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l.logged_by_name ?? ''}
                {l.notes ? ` · ${l.notes.slice(0, 40)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Log fill button */}
      {canUpdate && !logging && (
        <div style={{ marginTop: 2 }}>
          <button type="button" onClick={() => { setLogging(true); setError(null); }} style={assignBtn(false)}>
            Log fill
          </button>
        </div>
      )}

      {/* Inline form */}
      {canUpdate && logging && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>Litres *</span>
              <input
                type="number" min="0" step="0.1" placeholder="850"
                value={litres} onChange={(e) => setLitres(e.target.value)}
                style={fuelInputStyle} autoFocus
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>Cost (GHS)</span>
              <input
                type="number" min="0" step="0.01" placeholder="3 400.00"
                value={costGhs} onChange={(e) => setCostGhs(e.target.value)}
                style={fuelInputStyle}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>Odometer (km)</span>
            <input
              type="number" min="0" placeholder="182 450"
              value={odomKm} onChange={(e) => setOdomKm(e.target.value)}
              style={fuelInputStyle}
            />
          </label>
          <input
            type="text" maxLength={120} placeholder="Notes (optional)"
            value={fillNotes} onChange={(e) => setFillNotes(e.target.value)}
            style={fuelInputStyle}
          />
          {error && (
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{error}</span>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" onClick={submitFill} disabled={!litres || saving}
              style={assignBtn(false, !litres || saving)}
            >
              {saving ? 'Saving…' : 'Record fill'}
            </button>
            <button
              type="button"
              onClick={() => { setLogging(false); setError(null); }}
              style={{
                padding: '5px 12px', borderRadius: 'var(--radius-sm)',
                border: '1px solid transparent', background: 'transparent',
                color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)',
                fontWeight: 'var(--fw-medium)', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FuelSumCell({ label, value }) {
  return (
    <div>
      <div style={{
        fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.08em',
        textTransform: 'uppercase', fontFamily: 'var(--font-mono)', marginBottom: 2,
      }}>
        {label}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)',
      }}>
        {value}
      </div>
    </div>
  );
}

const fuelInputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '6px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)', fontFamily: 'inherit',
};

function fmtFuelDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Africa/Accra',
    });
  } catch { return iso; }
}

function ProgressBar({ value, warn }) {
  return (
    <div style={{
      height: 6,
      background: 'var(--border-hairline)',
      borderRadius: 999,
      overflow: 'hidden',
    }}>
      <div style={{
        width: `${value}%`,
        height: '100%',
        background: warn ? 'var(--signal-amber)' : 'var(--text)',
        transition: 'width 200ms ease',
      }} />
    </div>
  );
}

function formatPing(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const minsAgo = Math.floor((now - d.getTime()) / 60000);
  if (minsAgo < 1)  return 'just now';
  if (minsAgo < 60) return `${minsAgo} min ago`;
  const hoursAgo = Math.floor(minsAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo} hr ago`;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Africa/Accra',
  });
}
