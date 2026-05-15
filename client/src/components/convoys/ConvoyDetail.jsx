/*
 * ConvoyDetail — drawer for a single active convoy. Loads lazily from
 * /api/convoys/:id so the list view doesn't fetch trucks/drivers/timeline for
 * every row. Sections: dispatch, progress, lead driver, assigned trucks,
 * waypoint timeline, related alerts (cross-link back to /alerts).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';

import Modal from '../primitives/Modal';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';

const PHASE_LABEL = {
  laden:   'Laden southbound',
  empty:   'Empty northbound',
  loading: 'Loading',
  offload: 'Offloading',
};

const PHASE_TONE = {
  laden:   'pending',     // amber-ish, high priority
  empty:   'manual',      // iron, routine
  loading: 'degraded',
  offload: 'manual',
};

const REST_TONE = {
  compliant: 'connected',
  warning:   'degraded',
  breach:    'pending',
};

const SEVERITY_TONE = {
  CRITICAL: 'pending',
  WARNING:  'degraded',
  INFO:     'manual',
};

export default function ConvoyDetail({ convoyId, open, onClose }) {
  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !convoyId) { setData(null); setStatus('idle'); return; }
    let cancelled = false;
    setStatus('loading');
    authFetch(`/api/convoys/${convoyId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open, convoyId]);

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div style={{ padding: 'var(--space-5)' }}>
        {status === 'loading' && <Muted>Loading convoy…</Muted>}
        {status === 'error'   && <Muted>Convoy lookup failed.</Muted>}
        {status === 'ready'   && data && <Body data={data} navigate={navigate} onClose={onClose} />}
      </div>
    </Modal>
  );
}

function Body({ data, navigate, onClose }) {
  const schedLag = lagMinutes(data.planned_departure_iso, data.actual_departure_iso);
  return (
    <>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
          Convoy · {data.id}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'var(--space-3)',
        }}>
          <h2 style={{
            margin: 0,
            fontSize: 'var(--ts-h2-size)',
            lineHeight: 'var(--ts-h2-lh)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {data.hauler_display_name} · {data.trucks} trucks
          </h2>
          <StatusBadge tone={PHASE_TONE[data.phase] ?? 'neutral'}>
            {PHASE_LABEL[data.phase] ?? data.phase}
          </StatusBadge>
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          {data.direction === 'northbound' ? 'Takoradi → Nyinahin' : 'Nyinahin → Takoradi'}
          {data.notes ? ` · ${data.notes}` : ''}
        </p>
      </header>

      <Section title="Dispatch">
        <Row label="Direction" value={data.direction === 'northbound' ? 'Northbound · empty' : 'Southbound · laden'} />
        <Row label="Planned departure" value={formatClock(data.planned_departure_iso)} />
        <Row
          label="Actual departure"
          value={data.actual_departure_iso ? (
            <span style={{ color: schedLag > 10 ? 'var(--signal-amber)' : 'var(--text)' }}>
              {formatClock(data.actual_departure_iso)}
              {schedLag != null ? ` · ${schedLag > 0 ? '+' : ''}${schedLag} min` : ''}
            </span>
          ) : <Muted>Not yet departed</Muted>}
        />
        <Row
          label="On schedule"
          value={
            <StatusBadge tone={data.on_schedule ? 'connected' : 'pending'}>
              {data.on_schedule ? 'On time' : 'Delayed'}
            </StatusBadge>
          }
        />
        <Row label="Cycle time" value={data.cycle_h != null ? `${data.cycle_h.toFixed(1)} h` : <Muted>—</Muted>} />
      </Section>

      {/* Phase 122 — cargo section for live convoys */}
      {(data.cargo_tonnes != null || data.delivered_tonnes != null) && (
        <Section title="Cargo">
          {data.cargo_tonnes != null && (
            <Row label="Planned load" value={`${data.cargo_tonnes.toLocaleString()} t`} />
          )}
          {data.delivered_tonnes != null ? (
            <Row
              label="Delivered"
              value={
                <span style={{ color: 'var(--signal-green)' }}>
                  {data.delivered_tonnes.toLocaleString()} t ✓
                </span>
              }
            />
          ) : (
            data.phase !== 'complete' && (
              <Row label="Delivered" value={<Muted>Pending arrival</Muted>} />
            )
          )}
          {data.payload_variance_t != null && (
            <Row
              label="Variance"
              value={
                <span style={{
                  color: Math.abs(data.payload_variance_t) > 1
                    ? 'var(--signal-amber)' : 'var(--text-secondary)',
                }}>
                  {data.payload_variance_t > 0 ? '+' : ''}{data.payload_variance_t} t
                </span>
              }
            />
          )}
        </Section>
      )}

      <Section title="Progress">
        <Row label="Covered"   value={`${data.progress.covered_km} km`} />
        <Row label="Remaining" value={`${data.progress.remaining_km} km`} />
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={data.progress.percent} />
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            marginTop: 4,
          }}>
            {data.progress.percent}% of 300 km corridor · last ping {formatClock(data.last_ping_iso)}
          </div>
        </div>
      </Section>

      <Section title="Lead driver">
        {data.lead_driver ? (
          <>
            <Row label="Name"          value={data.lead_driver.display_name} />
            <Row label="Licence class" value={`Class ${data.lead_driver.licence_class}`} />
            <Row label="Phone"         value={<span className="mono">{data.lead_driver.phone}</span>} />
            <Row label="Safety score"  value={data.lead_driver.safety_score} />
            <Row
              label="Rest status"
              value={
                <StatusBadge tone={REST_TONE[data.lead_driver.rest_status] ?? 'neutral'}>
                  {data.lead_driver.rest_status}
                </StatusBadge>
              }
            />
          </>
        ) : <Muted>No lead driver on record.</Muted>}
      </Section>

      <Section title={`Assigned trucks · ${data.assigned_trucks.length}`}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 6,
        }}>
          {data.assigned_trucks.map((t) => (
            <div key={t.rig_id} style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '6px 8px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <span className="mono" style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)' }}>
                {t.plate}
              </span>
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                {t.make.split(' ')[0]}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Timeline">
        <Timeline entries={data.timeline} />
      </Section>

      {data.related_alerts.length > 0 && (
        <Section title={`Related alerts · ${data.related_alerts.length}`}>
          {data.related_alerts.map((a) => (
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
        justifyContent: 'flex-end',
      }}>
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </>
  );
}

function Timeline({ entries }) {
  if (!entries?.length) return <Muted>No timeline entries yet.</Muted>;
  return (
    <ol style={{
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {entries.map((e, i) => {
        // Support both mock (e.iso, e.km, e.status) and live (e.timestamp, e.pending, e.note) shapes.
        const ts       = e.timestamp ?? e.iso;
        const isCurrent = e.status === 'current';
        const isPending = e.pending === true;
        const dotColor = isPending ? 'var(--border-soft)'
                       : isCurrent ? 'var(--bauxite-rust)' : 'var(--signal-green)';
        return (
          <li key={i} style={{
            display: 'grid',
            gridTemplateColumns: '22px 1fr',
            gap: 10,
          }}>
            {/* Dot */}
            <span style={{
              width: 10, height: 10,
              borderRadius: '50%',
              marginTop: 4,
              flexShrink: 0,
              background: isPending ? 'transparent' : dotColor,
              border: `2px solid ${dotColor}`,
              boxSizing: 'border-box',
            }} />
            {/* Content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  color: isCurrent ? 'var(--text)' : isPending ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                  fontWeight: isCurrent ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  fontStyle: isPending ? 'italic' : 'normal',
                }}>
                  {e.label}
                </span>
                <span className="mono" style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>
                  {formatClock(ts)}{e.km != null ? ` · km ${e.km}` : ''}
                </span>
              </div>
              {/* Live event note */}
              {e.note && (
                <span style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  lineHeight: 1.4,
                }}>
                  {e.note}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
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

function ProgressBar({ value }) {
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
        background: 'var(--text)',
        transition: 'width 200ms ease',
      }} />
    </div>
  );
}

function lagMinutes(plannedIso, actualIso) {
  if (!plannedIso || !actualIso) return null;
  const p = new Date(plannedIso).getTime();
  const a = new Date(actualIso).getTime();
  return Math.round((a - p) / 60_000);
}

function formatClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Africa/Accra',
  });
}
