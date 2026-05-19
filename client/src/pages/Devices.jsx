'use strict';

/*
 * Devices — GPS device management for axis_admin and axis_ops.
 *
 * Lists all provisioned Teltonika devices with live health snapshots.
 * Supports provisioning new devices, reassigning vehicles, managing
 * fuel calibration curves, and viewing diagnostic event logs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Plus, RefreshCw, Copy, Check, ChevronDown, ChevronUp, X, Trash2 } from 'lucide-react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import StatusBadge from '../components/primitives/StatusBadge';
import Modal from '../components/primitives/Modal';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function minutesAgo(isoString) {
  if (!isoString) return Infinity;
  return (Date.now() - new Date(isoString).getTime()) / 60_000;
}

function signalTone(signal) {
  if (signal == null) return 'neutral';
  if (signal >= 15) return 'connected';
  if (signal >= 5)  return 'degraded';
  return 'pending';
}

function signalLabel(signal) {
  if (signal == null) return '—';
  if (signal >= 15) return `${signal} Good`;
  if (signal >= 5)  return `${signal} Weak`;
  return `${signal} Lost`;
}

function lastSeenTone(isoString) {
  const m = minutesAgo(isoString);
  if (m < 5)  return 'connected';
  if (m < 30) return 'degraded';
  return 'pending';
}

function lastSeenLabel(isoString) {
  if (!isoString) return 'Never';
  const m = minutesAgo(isoString);
  if (m < 1)    return 'Just now';
  if (m < 60)   return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24)   return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function batteryLabel(mv) {
  if (mv == null) return '—';
  return `${(mv / 1000).toFixed(1)}V`;
}

/* ── Summary strip ────────────────────────────────────────────────────── */

function SummaryStrip({ devices }) {
  const active     = devices.filter((d) => d.active && minutesAgo(d.health?.last_seen_at) < 30).length;
  const offline    = devices.filter((d) => d.active && minutesAgo(d.health?.last_seen_at) >= 30).length;
  const unassigned = devices.filter((d) => !d.vehicle_id).length;

  const tile = (label, value, tone) => (
    <div style={{
      flex: '1 1 0',
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: 28,
        fontWeight: 'var(--fw-semibold)',
        color: tone === 'connected' ? 'var(--signal-green)'
             : tone === 'degraded'  ? 'var(--signal-amber)'
             : tone === 'pending'   ? 'var(--bauxite-rust)'
             : 'var(--text)',
      }}>{value}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
      {tile('Total devices',  devices.length, null)}
      {tile('Online (<30m)',  active,          active > 0    ? 'connected' : null)}
      {tile('Offline',        offline,         offline > 0   ? 'degraded'  : null)}
      {tile('Unassigned',     unassigned,      unassigned > 0 ? 'pending'  : null)}
    </div>
  );
}

/* ── Provision modal ──────────────────────────────────────────────────── */

function ProvisionModal({ open, onClose, onProvisioned }) {
  const [fields, setFields] = useState({ imei: '', model: '', vehicle_id: '', hauler_id: '', serial: '', sim_iccid: '', notes: '' });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [creds, setCreds]     = useState(null); // one-time credentials after provision
  const [copied, setCopied]   = useState(false);

  function reset() {
    setFields({ imei: '', model: '', vehicle_id: '', hauler_id: '', serial: '', sim_iccid: '', notes: '' });
    setSaving(false);
    setError(null);
    setCreds(null);
    setCopied(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...fields };
      Object.keys(body).forEach((k) => { if (!body[k]) delete body[k]; });
      const r = await authFetch(`/api/devices/${encodeURIComponent(fields.imei.trim())}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setCreds(data.mqtt_credentials);
      onProvisioned(data.device);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function copyCredentials() {
    const text = `MQTT credentials for device ${fields.imei.trim()}\nUsername: ${creds.username}\nPassword: ${creds.password}\n\n${creds.note}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-primary)',
    fontSize: 'var(--ts-body-sm-size)',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 'var(--ts-caption-size)',
    color: 'var(--text-secondary)',
    marginBottom: 4,
  };

  return (
    <Modal open={open} onClose={handleClose} width={520}>
      <div style={{ padding: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h2 style={{ margin: 0, fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)' }}>
            {creds ? 'Device provisioned' : 'Provision device'}
          </h2>
          <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {creds ? (
          <div>
            <div style={{
              padding: 'var(--space-4)',
              background: 'rgba(46,107,63,0.08)',
              border: '1px solid rgba(46,107,63,0.2)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 'var(--space-4)',
            }}>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-green)', fontWeight: 'var(--fw-medium)', marginBottom: 8 }}>
                Device registered successfully
              </div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 12 }}>
                {creds.note}
              </div>
              <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border-hairline)', borderRadius: 4, padding: '10px 12px', lineHeight: 1.8 }}>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Username:</span> {creds.username}</div>
                <div><span style={{ color: 'var(--text-tertiary)' }}>Password:</span> {creds.password}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={copyCredentials}>
                {copied ? <><Check size={13} style={{ marginRight: 4 }} />Copied</> : <><Copy size={13} style={{ marginRight: 4 }} />Copy credentials</>}
              </Button>
              <Button variant="primary" onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>IMEI <span style={{ color: 'var(--bauxite-rust)' }}>*</span></label>
                <input style={inputStyle} value={fields.imei} onChange={set('imei')} required placeholder="352093079660097" />
              </div>
              <div>
                <label style={labelStyle}>Model</label>
                <input style={inputStyle} value={fields.model} onChange={set('model')} placeholder="FMB920-003" />
              </div>
              <div>
                <label style={labelStyle}>Serial</label>
                <input style={inputStyle} value={fields.serial} onChange={set('serial')} placeholder="Device serial" />
              </div>
              <div>
                <label style={labelStyle}>Vehicle ID</label>
                <input style={inputStyle} value={fields.vehicle_id} onChange={set('vehicle_id')} placeholder="GR-5432-23" />
              </div>
              <div>
                <label style={labelStyle}>Hauler ID</label>
                <input style={inputStyle} value={fields.hauler_id} onChange={set('hauler_id')} placeholder="haul-01" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>SIM ICCID</label>
                <input style={inputStyle} value={fields.sim_iccid} onChange={set('sim_iccid')} placeholder="89233012345678901234" />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Notes</label>
                <input style={inputStyle} value={fields.notes} onChange={set('notes')} placeholder="Optional notes" />
              </div>
            </div>
            {error && (
              <div style={{ marginBottom: 'var(--space-3)', padding: '8px 12px', background: 'rgba(162,62,35,0.08)', border: '1px solid rgba(162,62,35,0.2)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={handleClose} type="button">Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving || !fields.imei.trim()}>
                {saving ? 'Provisioning…' : 'Provision device'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/* ── Calibration editor ───────────────────────────────────────────────── */

function CalibrationEditor({ imei, vehicleId, canEdit }) {
  const [points, setPoints]   = useState(null); // null = loading
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [saved, setSaved]     = useState(false);

  const load = useCallback(async () => {
    setPoints(null);
    const r = await authFetch(`/api/devices/${encodeURIComponent(imei)}/calibration`);
    if (r.ok) {
      const data = await r.json();
      setPoints(data.points || []);
    } else {
      setPoints([]);
    }
  }, [imei]);

  useEffect(() => { load(); }, [load]);

  function startEdit() {
    setDraft(points.map((p) => ({ mm: String(p.mm), litres: String(p.litres) })));
    setEditing(true);
    setError(null);
  }

  function cancelEdit() { setEditing(false); setError(null); }

  function addRow() {
    setDraft((d) => [...d, { mm: '', litres: '' }]);
  }

  function removeRow(i) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  function updateRow(i, k, v) {
    setDraft((d) => d.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = draft.map((r) => ({ mm: Number(r.mm), litres: Number(r.litres) }));
      const r = await authFetch(`/api/devices/${encodeURIComponent(imei)}/calibration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: payload }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setPoints(data.points);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const cellStyle = { padding: '6px 8px', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--ts-body-sm-size)' };

  if (points === null) return <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)', padding: 'var(--space-3)' }}>Loading calibration…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          {vehicleId ? `Calibration for ${vehicleId}` : 'Assign vehicle to manage calibration'}
        </div>
        {canEdit && vehicleId && !editing && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {saved && <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-green)' }}><Check size={12} style={{ marginRight: 2 }} />Saved</span>}
            <Button variant="secondary" onClick={startEdit}>Edit curve</Button>
          </div>
        )}
      </div>

      {points.length === 0 && !editing ? (
        <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)', border: '1px dashed var(--border-soft)', borderRadius: 'var(--radius-sm)' }}>
          No calibration table. {canEdit && vehicleId ? 'Click "Edit curve" to add points.' : ''}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
          <thead>
            <tr style={{ background: 'var(--surface)' }}>
              <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>mm (depth)</th>
              <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Litres</th>
              {editing && <th style={{ ...cellStyle, width: 32 }} />}
            </tr>
          </thead>
          <tbody>
            {editing
              ? draft.map((row, i) => (
                  <tr key={i}>
                    <td style={cellStyle}>
                      <input
                        type="number"
                        value={row.mm}
                        onChange={(e) => updateRow(i, 'mm', e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 4, fontFamily: 'inherit', fontSize: 'inherit' }}
                        placeholder="0"
                        min="0"
                      />
                    </td>
                    <td style={cellStyle}>
                      <input
                        type="number"
                        value={row.litres}
                        onChange={(e) => updateRow(i, 'litres', e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid var(--border-strong)', borderRadius: 4, fontFamily: 'inherit', fontSize: 'inherit' }}
                        placeholder="0"
                        min="0"
                        step="0.1"
                      />
                    </td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              : points.map((p, i) => (
                  <tr key={i}>
                    <td style={cellStyle}>{p.mm}</td>
                    <td style={cellStyle}>{p.litres}</td>
                  </tr>
                ))
            }
          </tbody>
        </table>
      )}

      {editing && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" onClick={addRow} style={{ marginBottom: 'var(--space-3)' }}>
            <Plus size={13} style={{ marginRight: 4 }} />Add row
          </Button>
          {error && (
            <div style={{ marginBottom: 'var(--space-3)', padding: '8px 12px', background: 'rgba(162,62,35,0.08)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={cancelEdit}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving || draft.length < 2}>
              {saving ? 'Saving…' : 'Save curve'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Fuel history ─────────────────────────────────────────────────────── */

function FuelHistory({ imei }) {
  const [readings, setReadings] = useState(null);

  useEffect(() => {
    authFetch(`/api/devices/${encodeURIComponent(imei)}/fuel?limit=50`)
      .then((r) => r.ok ? r.json() : { readings: [] })
      .then((d) => setReadings(d.readings || []));
  }, [imei]);

  const cellStyle = { padding: '6px 8px', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--ts-body-sm-size)' };

  if (readings === null) return <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>Loading…</div>;
  if (readings.length === 0) return <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>No fuel readings yet.</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--surface)' }}>
          <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Recorded</th>
          <th style={{ ...cellStyle, textAlign: 'right', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>mm</th>
          <th style={{ ...cellStyle, textAlign: 'right', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Litres</th>
        </tr>
      </thead>
      <tbody>
        {readings.map((r, i) => (
          <tr key={i}>
            <td style={{ ...cellStyle, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {new Date(r.recorded_at).toLocaleString()}
            </td>
            <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.fuel_mm ?? '—'}</td>
            <td style={{ ...cellStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {r.fuel_litres != null ? `${r.fuel_litres.toFixed(1)} L` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Diagnostic events ────────────────────────────────────────────────── */

function EventLog({ imei }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    authFetch(`/api/devices/${encodeURIComponent(imei)}/events`)
      .then((r) => r.ok ? r.json() : { events: [] })
      .then((d) => setEvents(d.events || []));
  }, [imei]);

  const cellStyle = { padding: '6px 8px', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--ts-body-sm-size)' };

  if (events === null) return <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>Loading…</div>;
  if (events.length === 0) return <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>No events yet.</div>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--surface)' }}>
          <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Time</th>
          <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Type</th>
          <th style={{ ...cellStyle, textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>Payload</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr key={ev.id}>
            <td style={{ ...cellStyle, color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {new Date(ev.recorded_at).toLocaleString()}
            </td>
            <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{ev.event_type}</td>
            <td style={{ ...cellStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
              {ev.payload_json}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── Device detail panel ──────────────────────────────────────────────── */

const TABS = ['Overview', 'Fuel', 'Events'];

function DeviceDetail({ device, onClose, onUpdated, canEdit }) {
  const [tab, setTab]         = useState('Overview');
  const [editing, setEditing] = useState(false);
  const [patch, setPatch]     = useState({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const [deactivating, setDeactivating] = useState(false);

  useEffect(() => {
    setTab('Overview');
    setEditing(false);
    setPatch({});
    setError(null);
  }, [device.imei]);

  function startEdit() {
    setPatch({ vehicle_id: device.vehicle_id || '', hauler_id: device.hauler_id || '', notes: device.notes || '' });
    setEditing(true);
  }

  async function saveAssignment() {
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch(`/api/devices/${encodeURIComponent(device.imei)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      onUpdated(data.device);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!window.confirm(`Deactivate device ${device.imei}? It will stop receiving data.`)) return;
    setDeactivating(true);
    try {
      const r = await authFetch(`/api/devices/${encodeURIComponent(device.imei)}/deactivate`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onUpdated({ ...device, active: false });
    } catch (err) {
      alert(err.message);
    } finally {
      setDeactivating(false);
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid var(--border-strong)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontFamily: 'var(--font-primary)',
    fontSize: 'var(--ts-body-sm-size)',
    boxSizing: 'border-box',
  };

  const row = (label, value) => (
    <div style={{ display: 'flex', gap: 'var(--space-3)', padding: '8px 0', borderBottom: '1px solid var(--border-hairline)', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 120, fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', paddingTop: 2 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 'var(--ts-body-sm-size)', wordBreak: 'break-all' }}>{value ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</div>
    </div>
  );

  return (
    <Modal open onClose={onClose} width={620}>
      <div style={{ padding: 'var(--space-5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
              <Cpu size={16} color="var(--text-tertiary)" />
              <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 14, fontWeight: 'var(--fw-semibold)' }}>{device.imei}</span>
              <StatusBadge tone={device.active ? 'connected' : 'pending'}>{device.active ? 'Active' : 'Inactive'}</StatusBadge>
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              {[device.model, device.vehicle_id, device.hauler_id].filter(Boolean).join(' · ') || 'Unassigned'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 'var(--space-4)', borderBottom: '1px solid var(--border-hairline)' }}>
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 14px',
                fontSize: 'var(--ts-body-sm-size)',
                fontFamily: 'var(--font-primary)',
                color: tab === t ? 'var(--text)' : 'var(--text-tertiary)',
                borderBottom: tab === t ? '2px solid var(--bauxite-rust)' : '2px solid transparent',
                marginBottom: -1,
                fontWeight: tab === t ? 'var(--fw-medium)' : 'var(--fw-regular)',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'Overview' && (
          <div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Identity</div>
              {row('IMEI',      device.imei)}
              {row('Model',     device.model)}
              {row('Serial',    device.serial)}
              {row('SIM ICCID', device.sim_iccid)}
              {row('Firmware',  device.health?.firmware)}
            </div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assignment</div>
                {canEdit && !editing && <Button variant="ghost" onClick={startEdit}>Edit</Button>}
              </div>
              {editing ? (
                <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                  <div>
                    <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 4 }}>Vehicle ID</div>
                    <input style={inputStyle} value={patch.vehicle_id} onChange={(e) => setPatch((p) => ({ ...p, vehicle_id: e.target.value }))} placeholder="GR-5432-23" />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 4 }}>Hauler ID</div>
                    <input style={inputStyle} value={patch.hauler_id} onChange={(e) => setPatch((p) => ({ ...p, hauler_id: e.target.value }))} placeholder="haul-01" />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 4 }}>Notes</div>
                    <input style={inputStyle} value={patch.notes} onChange={(e) => setPatch((p) => ({ ...p, notes: e.target.value }))} />
                  </div>
                  {error && <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button variant="primary" onClick={saveAssignment} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              ) : (
                <>
                  {row('Vehicle',   device.vehicle_id)}
                  {row('Hauler',    device.hauler_id)}
                  {row('Notes',     device.notes)}
                </>
              )}
            </div>
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Health</div>
              {row('Signal',    device.health ? <StatusBadge tone={signalTone(device.health.signal)}>{signalLabel(device.health.signal)}</StatusBadge> : null)}
              {row('Battery',   device.health ? batteryLabel(device.health.battery_mv) : null)}
              {row('Last seen', device.health?.last_seen_at
                ? <StatusBadge tone={lastSeenTone(device.health.last_seen_at)}>{lastSeenLabel(device.health.last_seen_at)}</StatusBadge>
                : null
              )}
              {row('Provisioned', device.provisioned_at ? new Date(device.provisioned_at).toLocaleDateString() : null)}
            </div>
            {canEdit && device.active && (
              <div style={{ paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-hairline)' }}>
                <Button variant="secondary" onClick={deactivate} disabled={deactivating}>
                  {deactivating ? 'Deactivating…' : 'Deactivate device'}
                </Button>
              </div>
            )}
          </div>
        )}

        {tab === 'Fuel' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-3)' }}>Calibration curve</div>
              <CalibrationEditor imei={device.imei} vehicleId={device.vehicle_id} canEdit={canEdit} />
            </div>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-3)' }}>Recent readings</div>
              <FuelHistory imei={device.imei} />
            </div>
          </div>
        )}

        {tab === 'Events' && (
          <div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 'var(--space-3)' }}>Last 50 diagnostic events</div>
            <EventLog imei={device.imei} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

const TH = { padding: '8px 12px', textAlign: 'left', fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)', borderBottom: '1px solid var(--border-hairline)', whiteSpace: 'nowrap' };
const TD = { padding: '10px 12px', borderBottom: '1px solid var(--border-hairline)', fontSize: 'var(--ts-body-sm-size)', verticalAlign: 'middle' };

export default function Devices() {
  const { user } = useAuth();
  const canEdit  = user?.role === 'axis_admin' || user?.role === 'axis_ops';

  const [state, setState]     = useState({ status: 'loading', data: null, error: null });
  const [selected, setSelected] = useState(null);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [search, setSearch]   = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading', error: null }));
    try {
      const r = await authFetch('/api/devices?limit=500');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const devices = state.data?.devices ?? [];

  const visible = devices.filter((d) => {
    if (!showInactive && !d.active) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      d.imei.includes(q) ||
      (d.model ?? '').toLowerCase().includes(q) ||
      (d.vehicle_id ?? '').toLowerCase().includes(q) ||
      (d.hauler_id ?? '').toLowerCase().includes(q)
    );
  });

  function onProvisioned(device) {
    setState((s) => ({
      ...s,
      data: s.data ? { ...s.data, devices: [device, ...s.data.devices] } : null,
    }));
    setProvisionOpen(false);
  }

  function onUpdated(updated) {
    setState((s) => ({
      ...s,
      data: s.data ? {
        ...s.data,
        devices: s.data.devices.map((d) => d.imei === updated.imei ? updated : d),
      } : null,
    }));
    setSelected((sel) => sel?.imei === updated.imei ? updated : sel);
  }

  return (
    <PageShell
      eyebrow="Platform"
      title="Devices"
      description="GPS and telematics hardware provisioned on the Nyinahin–Takoradi corridor."
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button
            onClick={load}
            title="Refresh"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 6, display: 'flex', alignItems: 'center' }}
          >
            <RefreshCw size={15} style={{ animation: state.status === 'refreshing' ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          {canEdit && (
            <Button variant="primary" onClick={() => setProvisionOpen(true)}>
              <Plus size={14} style={{ marginRight: 4 }} />Provision device
            </Button>
          )}
        </div>
      }
    >
      {state.status === 'error' && (
        <div style={{ padding: 'var(--space-4)', background: 'rgba(162,62,35,0.08)', borderRadius: 'var(--radius-sm)', color: 'var(--bauxite-rust)', fontSize: 'var(--ts-body-sm-size)', marginBottom: 'var(--space-4)' }}>
          Failed to load devices: {state.error}
        </div>
      )}

      {state.status !== 'loading' && <SummaryStrip devices={devices} />}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by IMEI, model, vehicle, hauler…"
          style={{
            flex: '1 1 300px',
            maxWidth: 400,
            padding: '7px 10px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-primary)',
            fontSize: 'var(--ts-body-sm-size)',
          }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {/* Table */}
      {state.status === 'loading' ? (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>Loading devices…</div>
      ) : visible.length === 0 ? (
        <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)', border: '1px dashed var(--border-soft)', borderRadius: 'var(--radius-md)' }}>
          {devices.length === 0 ? (
            <>No devices provisioned yet.{canEdit && <> Click <strong>Provision device</strong> to add the first one.</>}</>
          ) : (
            'No devices match your filter.'
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--surface)' }}>
              <tr>
                <th style={TH}>IMEI</th>
                <th style={TH}>Model</th>
                <th style={TH}>Vehicle</th>
                <th style={TH}>Hauler</th>
                <th style={TH}>Status</th>
                <th style={TH}>Signal</th>
                <th style={TH}>Battery</th>
                <th style={TH}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr
                  key={d.imei}
                  onClick={() => setSelected(d)}
                  style={{
                    cursor: 'pointer',
                    background: selected?.imei === d.imei ? 'rgba(162,62,35,0.04)' : 'transparent',
                    transition: 'background 80ms ease',
                  }}
                  onMouseEnter={(e) => { if (selected?.imei !== d.imei) e.currentTarget.style.background = 'var(--surface-hover, var(--surface))'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = selected?.imei === d.imei ? 'rgba(162,62,35,0.04)' : 'transparent'; }}
                >
                  <td style={{ ...TD, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{d.imei}</td>
                  <td style={{ ...TD, color: d.model ? 'var(--text)' : 'var(--text-tertiary)' }}>{d.model ?? '—'}</td>
                  <td style={{ ...TD, color: d.vehicle_id ? 'var(--text)' : 'var(--text-tertiary)' }}>{d.vehicle_id ?? <span style={{ color: 'var(--signal-amber)' }}>Unassigned</span>}</td>
                  <td style={{ ...TD, color: d.hauler_id ? 'var(--text)' : 'var(--text-tertiary)' }}>{d.hauler_id ?? '—'}</td>
                  <td style={TD}><StatusBadge tone={d.active ? 'connected' : 'pending'}>{d.active ? 'Active' : 'Inactive'}</StatusBadge></td>
                  <td style={TD}>
                    {d.health
                      ? <StatusBadge tone={signalTone(d.health.signal)}>{signalLabel(d.health.signal)}</StatusBadge>
                      : <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                    }
                  </td>
                  <td style={{ ...TD, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                    {d.health ? batteryLabel(d.health.battery_mv) : '—'}
                  </td>
                  <td style={TD}>
                    {d.health?.last_seen_at
                      ? <StatusBadge tone={lastSeenTone(d.health.last_seen_at)}>{lastSeenLabel(d.health.last_seen_at)}</StatusBadge>
                      : <span style={{ color: 'var(--text-tertiary)' }}>Never</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '8px 12px', fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-hairline)' }}>
            {visible.length} device{visible.length !== 1 ? 's' : ''}
            {state.data?.total != null && state.data.total > visible.length ? ` (${state.data.total} total)` : ''}
          </div>
        </div>
      )}

      {/* Modals */}
      {selected && (
        <DeviceDetail
          device={selected}
          onClose={() => setSelected(null)}
          onUpdated={onUpdated}
          canEdit={canEdit}
        />
      )}

      <ProvisionModal
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        onProvisioned={onProvisioned}
      />
    </PageShell>
  );
}
