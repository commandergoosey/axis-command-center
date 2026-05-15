/*
 * TripDetail — drawer for a single trip. Loads lazily from /api/trips/:id.
 * Sections: summary, economics (cost/revenue/margin), rig + driver,
 * weighbridge events (laden runs only), corridor timeline, related alerts
 * (deep-link to /alerts).
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';

import Modal from '../primitives/Modal';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';

export default function TripDetail({ tripId, open, onClose }) {
  const [data, setData]     = useState(null);
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || !tripId) { setData(null); setStatus('idle'); return; }
    let cancelled = false;
    setStatus('loading');
    authFetch(`/api/trips/${tripId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open, tripId]);

  return (
    <Modal open={open} onClose={onClose} width={640}>
      <div style={{ padding: 'var(--space-5)' }}>
        {status === 'loading' && <Muted>Loading trip…</Muted>}
        {status === 'error'   && <Muted>Trip lookup failed.</Muted>}
        {status === 'ready'   && data && <Body data={data} navigate={navigate} onClose={onClose} />}
      </div>
    </Modal>
  );
}

function Body({ data, navigate, onClose }) {
  const margin = data.revenue_usd - data.cost.total_usd;
  const isLaden = data.direction === 'southbound' && data.tonnage_t > 0;

  return (
    <>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
          Trip · {data.id}
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
            {data.hauler_display_name} · {data.route_label}
          </h2>
          <StatusBadge tone={data.status === 'delayed' ? 'pending' : 'connected'}>
            {data.status === 'delayed' ? 'Delayed' : 'Completed'}
          </StatusBadge>
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          {isLaden ? `Laden · ${data.tonnage_t} t` : 'Empty return'}
          {' · '}
          {data.cycle_h.toFixed(1)} h cycle
          {data.delay_min > 0 ? ` · ${data.delay_min} min late` : ''}
        </p>
      </header>

      <Section title="Dispatch">
        <Row label="Departed" value={formatClock(data.departed_at)} />
        <Row label="Arrived"  value={formatClock(data.arrived_at)} />
        <Row label="Cycle"    value={`${data.cycle_h.toFixed(1)} h`} />
        <Row
          label="Delay"
          value={
            data.delay_min > 0
              ? <span style={{ color: data.delay_min > 60 ? 'var(--bauxite-rust)' : 'var(--signal-amber)' }}>
                  {data.delay_min} min
                </span>
              : <Muted>—</Muted>
          }
        />
      </Section>

      <Section title="Economics">
        <Row label="Revenue"      value={fmtUsd(data.revenue_usd)} />
        <Row label="Fuel"         value={fmtUsd(-data.cost.fuel_usd)} />
        <Row label="Driver"       value={fmtUsd(-data.cost.driver_usd)} />
        <Row label="Maintenance"  value={fmtUsd(-data.cost.maint_usd)} />
        <Row label="Tolls"        value={fmtUsd(-data.cost.tolls_usd)} />
        <Row
          label="Margin"
          value={
            <span style={{
              color: margin >= 0 ? 'var(--text)' : 'var(--bauxite-rust)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {fmtUsd(margin)}
            </span>
          }
        />
      </Section>

      <Section title="Rig & driver">
        {data.assigned_rig ? (
          <>
            <Row label="Plate" value={<span className="mono">{data.assigned_rig.plate}</span>} />
            <Row label="Rig"   value={`${data.assigned_rig.make} ${data.assigned_rig.model}`} />
            <Row label="Payload capacity" value={`${data.assigned_rig.payload_capacity_t} t`} />
          </>
        ) : <Muted>No rig assigned on record.</Muted>}
        {data.driver ? (
          <>
            <Row label="Driver"        value={data.driver.display_name} />
            <Row label="Licence class" value={`Class ${data.driver.licence_class}`} />
            <Row label="Phone"         value={<span className="mono">{data.driver.phone}</span>} />
            <Row label="Safety score"  value={String(data.driver.safety_score)} />
          </>
        ) : <Muted>No driver on record.</Muted>}
      </Section>

      {data.weighbridges.length > 0 && (
        <Section title={`Weighbridge events · ${data.weighbridges.length}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <WbTh>Station</WbTh>
                <WbTh align="right">Payload</WbTh>
                <WbTh align="right">GVW</WbTh>
                <WbTh align="right">Result</WbTh>
                <WbTh align="right">Time</WbTh>
              </tr>
            </thead>
            <tbody>
              {data.weighbridges.map((w) => (
                <tr key={w.id}>
                  <WbTd>
                    {w.label}
                    <div className="micro" style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {w.kind === 'load_check' ? 'LOAD CHECK' : 'CLEARANCE'} · km {w.km}
                    </div>
                  </WbTd>
                  <WbTd align="right" mono>{w.payload_t != null ? `${w.payload_t} t` : '—'}</WbTd>
                  <WbTd align="right" mono>{w.gvw_t != null ? `${w.gvw_t} t` : '—'}</WbTd>
                  <WbTd align="right">
                    <StatusBadge tone={w.result === 'HOLD' ? 'pending' : 'connected'}>
                      {w.result}
                    </StatusBadge>
                  </WbTd>
                  <WbTd align="right" mono muted>{formatClock(w.iso)}</WbTd>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Corridor timeline">
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
  if (!entries?.length) return <Muted>No timeline entries.</Muted>;
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((e, i) => (
        <li key={i} style={{
          display: 'grid',
          gridTemplateColumns: '22px 1fr auto',
          gap: 10,
          alignItems: 'baseline',
        }}>
          <span style={{
            width: 10, height: 10,
            borderRadius: '50%',
            marginTop: 5,
            background: e.status === 'terminal' ? 'var(--bauxite-rust)' : 'var(--border-hairline)',
            border: e.status === 'terminal' ? '2px solid var(--bauxite-rust)' : '1px solid var(--border-soft)',
            boxSizing: 'border-box',
          }} />
          <span style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: e.status === 'terminal' ? 'var(--text)' : 'var(--text-secondary)',
            fontWeight: e.status === 'terminal' ? 'var(--fw-medium)' : 'var(--fw-regular)',
          }}>
            {e.label}
            <span className="micro" style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
              {e.type.toUpperCase()}
            </span>
          </span>
          <span className="mono" style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.04em',
          }}>
            {formatClock(e.iso)} · km {e.km}
          </span>
        </li>
      ))}
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

function WbTh({ children, align = 'left' }) {
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

function WbTd({ children, align = 'left', mono, muted }) {
  return (
    <td style={{
      textAlign: align,
      padding: '8px',
      fontSize: 'var(--ts-body-sm-size)',
      color: muted ? 'var(--text-tertiary)' : 'var(--text)',
      fontFamily: mono ? 'var(--font-mono)' : 'inherit',
      fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
      verticalAlign: 'top',
    }}>
      {children}
    </td>
  );
}

function fmtUsd(n) {
  if (n == null) return '—';
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US')}`;
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
