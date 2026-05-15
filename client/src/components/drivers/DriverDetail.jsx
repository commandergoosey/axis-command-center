/*
 * DriverDetail — drawer for a single driver. Loads lazily from
 * /api/drivers/:id. Sections: status strip, assigned rig, licences &
 * certifications, recent trips, 8-week safety trend, open alerts.
 * Navigate to /alerts?focus=… or /maintenance?rig=… to cross-link.
 *
 * Phase 103 — StatusPanel: operators can override availability,
 * rest_status, and maintenance flag. Role-gated: axis_admin / axis_ops
 * can update any driver; hauler_admin can only update their own drivers.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

import Modal from '../primitives/Modal';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';

const REST_LABEL = { compliant: 'Compliant', warning: 'Warning', breach: 'Breach' };
const REST_TONE  = { compliant: 'connected', warning: 'degraded', breach: 'pending' };

const SHIFT_LABEL = {
  day: 'Day', night: 'Night', rest: 'Rest day', relief: 'Relief pool',
};

const CERT_TONE_COLOR = {
  critical: 'var(--bauxite-rust)',
  warning:  'var(--signal-amber)',
  ok:       'var(--text-secondary)',
};

const AVAIL_LABEL = {
  available: 'Available',
  on_leave:  'On leave',
  sick:      'Sick',
  suspended: 'Suspended',
};

const FLAG_LABEL = {
  rest_breach:      'Rest breach',
  psv_expiring:     'PSV expiring',
  licence_expiring: 'Lic. expiring',
  coaching_due:     'Coaching due',
};

export default function DriverDetail({ driverId, open, onClose, onDriverUpdated }) {
  const [data, setData]     = useState(null);
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !driverId) { setData(null); setStatus('idle'); return; }
    let cancelled = false;
    setStatus('loading');
    authFetch(`/api/drivers/${driverId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open, driverId]);

  const handleDriverUpdated = useCallback((updated) => {
    setData((prev) => prev ? { ...prev, ...updated } : prev);
    onDriverUpdated?.();
  }, [onDriverUpdated]);

  return (
    <Modal open={open} onClose={onClose} width={640}>
      <div style={{ padding: 'var(--space-5)' }}>
        {status === 'loading' && <Muted>Loading driver…</Muted>}
        {status === 'error'   && <Muted>Driver lookup failed.</Muted>}
        {status === 'ready'   && data && (
          <Body
            data={data}
            navigate={navigate}
            onClose={onClose}
            onDriverUpdated={handleDriverUpdated}
          />
        )}
      </div>
    </Modal>
  );
}

function Body({ data, navigate, onClose, onDriverUpdated }) {
  // Local driver state — starts from fetched data, updated after status saves.
  const [driver, setDriver] = useState(data);
  useEffect(() => { setDriver(data); }, [data]);

  const { user } = useAuth();
  const canUpdate = user?.role === 'axis_admin'
    || user?.role === 'axis_ops'
    || (user?.role === 'hauler_admin' && user.hauler_id === driver.hauler_id);

  return (
    <>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
          Driver · {driver.id}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
              color: 'var(--text)',
            }}>
              {driver.full_name}
            </h2>
            <p className="mono" style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-tertiary)',
            }}>
              {driver.licence_number} · Class {driver.licence_class}
            </p>
          </div>
          <StatusBadge tone={REST_TONE[driver.rest_status] ?? 'neutral'}>
            {REST_LABEL[driver.rest_status] ?? driver.rest_status}
          </StatusBadge>
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          {driver.hauler_display} · {SHIFT_LABEL[driver.shift] ?? driver.shift} · {driver.years_experience} yrs
        </p>
      </header>

      <Section title="Status">
        <Row label="Availability" value={
          driver.availability ? (
            <span style={{
              color: driver.availability === 'suspended' ? 'var(--bauxite-rust)'
                   : driver.availability === 'sick'      ? 'var(--signal-amber)'
                   : driver.availability === 'on_leave'  ? 'var(--text-secondary)'
                   : 'var(--text)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {AVAIL_LABEL[driver.availability] ?? driver.availability}
            </span>
          ) : <Muted>—</Muted>
        } />
        <Row label="Hours this week" value={
          <span style={{
            color: driver.rest_status === 'breach'  ? 'var(--bauxite-rust)'
                 : driver.rest_status === 'warning' ? 'var(--signal-amber)'
                 : 'var(--text)',
          }}>{driver.hours_this_week.toFixed(1)} h</span>
        } />
        <Row label="Safety score"  value={`${driver.safety_score} / 100`} />
        <Row label="Harsh events · 7 d" value={
          driver.harsh_events_7d > 0
            ? <span style={{ color: driver.harsh_events_7d >= 4 ? 'var(--bauxite-rust)' : 'var(--text)' }}>
                {driver.harsh_events_7d}
              </span>
            : <Muted>—</Muted>
        } />
        <Row label="Trips this week" value={driver.trips_this_week ?? 0} />
        <Row label="Phone" value={<span className="mono">{driver.phone}</span>} />
      </Section>

      {canUpdate && (
        <StatusPanel
          driver={driver}
          onSaved={(updated) => {
            setDriver((prev) => ({ ...prev, ...updated }));
            onDriverUpdated?.(updated);
          }}
        />
      )}

      <Section title="Assigned rig">
        {driver.assigned_rig ? (
          <>
            <Row label="Plate" value={<span className="mono">{driver.assigned_rig.plate}</span>} />
            <Row label="Rig"   value={`${driver.assigned_rig.make} ${driver.assigned_rig.model}`} />
            <Row label="Status" value={
              <StatusBadge tone={driver.assigned_rig.status === 'garage' ? 'pending' : 'connected'}>
                {driver.assigned_rig.status}
              </StatusBadge>
            } />
            <Row label="Total km" value={<span className="tabular">{driver.assigned_rig.total_km.toLocaleString()} km</span>} />
            {driver.assigned_rig.maintenance_flag && (
              <Row label="Flag" value={
                <span style={{ color: 'var(--bauxite-rust)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {driver.assigned_rig.maintenance_flag.replace(/_/g, ' ')}
                </span>
              } />
            )}
          </>
        ) : (
          <Muted>Relief pool — no primary rig assignment.</Muted>
        )}
      </Section>

      <Section title="Licences & certifications">
        <CertRow
          label="Class E licence"
          detail={`Expires ${formatDate(driver.licence.expiry_iso)}`}
          tone={driver.licence.tone}
          value={driver.licence.months_to_expiry <= 0
            ? 'expired'
            : `${driver.licence.months_to_expiry} mo`}
        />
        <CertRow
          label="DVLA PSV endorsement"
          detail={`Expires ${formatDate(driver.psv.expiry_iso)}`}
          tone={driver.psv.tone}
          value={`${driver.psv.days_to_expiry} d`}
        />
        <CertRow
          label="Medical clearance"
          detail={`Expires ${formatDate(driver.medical.expiry_iso)}`}
          tone={driver.medical.tone}
          value={`${driver.medical.days_to_expiry} d`}
        />
        {driver.training.map((c) => (
          <CertRow
            key={c.code}
            label={c.label}
            detail={`Issued ${formatDate(c.issued_iso)} · expires ${formatDate(c.expires_iso)}`}
            tone={c.tone}
            value={c.months_to_expiry <= 0 ? 'expired' : `${c.months_to_expiry} mo`}
          />
        ))}
      </Section>

      {driver.recent_trips.length > 0 && (
        <Section title={`Recent trips · ${driver.recent_trips.length}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Trip</Th>
                <Th>Route</Th>
                <Th align="right">Cycle h</Th>
                <Th align="right">t</Th>
                <Th align="right">Delay</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {driver.recent_trips.map((t) => (
                <tr key={t.id}>
                  <TdCell mono>{t.id}</TdCell>
                  <TdCell>
                    <span className="mono">{t.route_id}</span>
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 4 }}>
                      {t.direction === 'southbound' ? '↓' : '↑'}
                    </span>
                  </TdCell>
                  <TdCell align="right" mono>{t.cycle_h.toFixed(1)}</TdCell>
                  <TdCell align="right" mono>{t.tonnage_t > 0 ? t.tonnage_t : '—'}</TdCell>
                  <TdCell align="right" mono>
                    <span style={{ color: t.delay_min > 60 ? 'var(--bauxite-rust)' : 'var(--text)' }}>
                      {t.delay_min > 0 ? t.delay_min : '—'}
                    </span>
                  </TdCell>
                  <TdCell>
                    <StatusBadge tone={t.status === 'delayed' ? 'pending' : 'connected'}>
                      {t.status}
                    </StatusBadge>
                  </TdCell>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Safety score trend · 8 weeks">
        <SafetyTrend points={driver.safety_series} current={driver.safety_score} />
      </Section>

      {/* Phase 54 — coaching attendance for this driver, last 90 days. */}
      {driver.coaching_history && driver.coaching_history.length > 0 && (
        <Section title={`Coaching attended · last 90 d`}>
          <ul style={{
            listStyle: 'none', margin: 0, padding: 0,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {driver.coaching_history.map((c) => (
              <li key={c.id} style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                columnGap: 'var(--space-3)',
                alignItems: 'baseline',
                padding: '4px 0',
                borderTop: '1px solid var(--border-hairline)',
                fontSize: 'var(--ts-caption-size)',
              }}>
                <span className="mono tabular" style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                  {new Date(c.held_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
                <span style={{ color: 'var(--text)' }}>
                  {c.topic}
                  {c.dispatcher_name && (
                    <span style={{ color: 'var(--text-tertiary)' }}> · w/ {c.dispatcher_name}</span>
                  )}
                </span>
                {c.expected_delta_pct != null && (
                  <span className="tabular" style={{
                    color: c.expected_delta_pct < 0 ? 'var(--signal-green)' : 'var(--text-tertiary)',
                    fontSize: 10,
                  }}>
                    {c.expected_delta_pct > 0 ? '+' : ''}{c.expected_delta_pct}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {driver.open_alerts.length > 0 && (
        <Section title={`Open alerts · ${driver.open_alerts.length}`}>
          {driver.open_alerts.map((a) => (
            <div key={a.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 10px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                  {a.title}
                </span>
                <span className="mono" style={{
                  fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em',
                }}>
                  {a.severity} · {a.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { onClose(); navigate(`/alerts?focus=${a.id}`); }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 10px',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Open alert
              </button>
            </div>
          ))}
        </Section>
      )}

      <div style={{
        marginTop: 'var(--space-5)',
        paddingTop: 'var(--space-4)',
        borderTop: '1px solid var(--border-hairline)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        {/* Phase 58 — opens the printable per-driver weekly scorecard
            in a new tab. Mirrors the "Print weekly scorecard" link on
            the HaulerDetail drawer (Phase 49). */}
        <a
          href={`/drivers/${driver.id}/scorecard`}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--bauxite-rust)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-hairline)',
          }}
          title="Open the printable weekly safety scorecard in a new tab"
        >
          Print weekly scorecard →
        </a>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

// ── Phase 103 — StatusPanel ────────────────────────────────────────

function StatusPanel({ driver, onSaved }) {
  const [availability, setAvailability] = useState(driver.availability ?? 'available');
  const [restStatus,   setRestStatus]   = useState(driver.rest_status ?? 'compliant');
  const [flag,         setFlag]         = useState(driver.flag ?? null);
  const [notes,        setNotes]        = useState(driver._status_override?.notes ?? '');
  const [saving,       setSaving]       = useState(false);
  const [saved,        setSaved]        = useState(false);

  // Reset if parent driver changes (e.g. new driver opened).
  useEffect(() => {
    setAvailability(driver.availability ?? 'available');
    setRestStatus(driver.rest_status ?? 'compliant');
    setFlag(driver.flag ?? null);
    setNotes(driver._status_override?.notes ?? '');
    setSaved(false);
  }, [driver.id]);

  const isDirty = availability !== (driver.availability ?? 'available')
    || restStatus !== (driver.rest_status ?? 'compliant')
    || flag       !== (driver.flag ?? null)
    || notes      !== (driver._status_override?.notes ?? '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/drivers/${driver.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability, rest_status: restStatus, flag, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `${res.status}`);
      }
      const body = await res.json();
      setSaved(true);
      onSaved?.(body.driver);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const ov = driver._status_override;

  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <h3 className="micro" style={{ margin: '0 0 10px', color: 'var(--text-tertiary)' }}>
        Availability override
      </h3>
      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}>

        {/* Availability */}
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Availability
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['available', 'on_leave', 'sick', 'suspended'].map((v) => (
              <ChipButton
                key={v}
                active={availability === v}
                danger={v === 'suspended'}
                onClick={() => setAvailability(v)}
              >
                {AVAIL_LABEL[v]}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Rest status */}
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Rest status
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['compliant', 'warning', 'breach'].map((v) => (
              <ChipButton
                key={v}
                active={restStatus === v}
                danger={v === 'breach'}
                onClick={() => setRestStatus(v)}
              >
                {REST_LABEL[v]}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Flag */}
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Flag
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <ChipButton active={flag === null} onClick={() => setFlag(null)}>None</ChipButton>
            {Object.entries(FLAG_LABEL).map(([v, l]) => (
              <ChipButton key={v} active={flag === v} danger onClick={() => setFlag(v)}>
                {l}
              </ChipButton>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            Notes
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 200))}
            rows={2}
            maxLength={200}
            placeholder="Reason for change (optional)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              resize: 'vertical',
            }}
          />
        </div>

        {/* Footer: last-updated meta + save button */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
            {ov
              ? `Last updated by ${ov.updated_by_name} · ${formatDate(ov.updated_at)}`
              : 'No override recorded yet'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {saved && (
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-green)' }}>
                Updated ✓
              </span>
            )}
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChipButton({ children, active, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active
          ? (danger ? 'var(--bauxite-rust)' : 'var(--bauxite-rust)')
          : 'var(--border-hairline)'}`,
        background: active
          ? (danger ? 'rgba(139,46,26,0.12)' : 'rgba(139,46,26,0.08)')
          : 'transparent',
        color: active
          ? (danger ? 'var(--bauxite-rust)' : 'var(--bauxite-rust)')
          : 'var(--text-secondary)',
        fontSize: 'var(--ts-caption-size)',
        fontFamily: 'inherit',
        cursor: 'pointer',
        fontWeight: active ? 'var(--fw-medium)' : 'var(--fw-regular)',
        transition: 'all 100ms ease',
      }}
    >
      {children}
    </button>
  );
}

// ── Supporting components ──────────────────────────────────────────

function SafetyTrend({ points, current }) {
  if (!points?.length) return <Muted>No data.</Muted>;
  const min = Math.min(...points.map((p) => p.score));
  const max = Math.max(...points.map((p) => p.score));
  const span = Math.max(1, max - min);
  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${points.length}, 1fr)`,
        gap: 6,
        alignItems: 'flex-end',
        height: 72,
        padding: '4px 0',
      }}>
        {points.map((p, i) => {
          const isCurrent = i === points.length - 1;
          const ratio = (p.score - min) / span;
          const height = 12 + Math.round(ratio * 52); // 12..64 px
          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4,
            }}>
              <span className="mono" style={{
                fontSize: 10, color: 'var(--text-tertiary)',
              }}>{p.score}</span>
              <div style={{
                width: '100%',
                height,
                background: isCurrent ? 'var(--bauxite-rust)' : 'var(--border-soft)',
                borderRadius: 2,
              }} />
            </div>
          );
        })}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>8 wks ago</span>
        <span>current · <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{current}</span></span>
      </div>
    </div>
  );
}

function CertRow({ label, detail, tone, value }) {
  const color = CERT_TONE_COLOR[tone] ?? 'var(--text-secondary)';
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 'var(--space-3)',
      padding: '4px 0',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>{detail}</span>
      </div>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color,
        fontWeight: tone === 'ok' ? 'var(--fw-regular)' : 'var(--fw-medium)',
        textTransform: value === 'expired' ? 'uppercase' : 'none',
        letterSpacing: value === 'expired' ? '0.04em' : 'normal',
      }}>
        {value}
      </span>
    </div>
  );
}

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
        textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  );
}

function Muted({ children }) {
  return <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>{children}</span>;
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      textAlign: align,
      padding: '6px 8px',
      fontSize: 'var(--ts-micro-size)',
      letterSpacing: 'var(--ts-micro-tracking)',
      textTransform: 'uppercase',
      fontWeight: 'var(--fw-medium)',
      color: 'var(--text-tertiary)',
      borderBottom: '1px solid var(--border-hairline)',
    }}>
      {children}
    </th>
  );
}

function TdCell({ children, align = 'left', mono }) {
  return (
    <td style={{
      textAlign: align,
      padding: '8px',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text)',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
      verticalAlign: 'top',
    }}>
      {children}
    </td>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
