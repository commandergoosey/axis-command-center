/*
 * WorkorderDetail — drawer for a single rig's maintenance lifecycle. Loads
 * lazily from /api/maintenance/:rigId. Sections: rig summary · open defects ·
 * parts on order · service history · assigned driver · related alerts.
 * Open-alert button deep-links to /alerts?focus=<id> so the coordinator can
 * jump from a road-worthy defect to the compliance alert that opened it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

import Modal from '../primitives/Modal';
import StatusBadge from '../primitives/StatusBadge';
import Button from '../primitives/Button';
import { formatKm } from '../../lib/format';

const STATUS_LABEL = {
  active: 'Active', in_transit: 'In transit', idle: 'Idle', garage: 'Garage',
};

const STATUS_TONE = {
  active: 'connected', in_transit: 'connected', idle: 'manual', garage: 'pending',
};

const FLAG_LABEL = {
  service_due: 'Service due', road_worthy_30d: 'Cert <30d', critical: 'Critical',
};

const FLAG_TONE = {
  service_due: 'degraded', road_worthy_30d: 'degraded', critical: 'pending',
};

const SEVERITY_TONE = {
  CRITICAL: 'pending', WARNING: 'degraded', INFO: 'manual',
};

const WO_STATUS_TONE = {
  OPEN: 'pending', IN_PROGRESS: 'degraded', RESOLVED: 'connected',
};

export default function WorkorderDetail({ rigId, open, onClose, onMutate }) {
  const [data, setData]     = useState(null);
  const [status, setStatus] = useState('idle');
  const navigate = useNavigate();
  const { user } = useAuth();

  const fetchRig = useCallback(async (markLoading = true) => {
    if (!rigId) return;
    if (markLoading) setStatus('loading');
    try {
      const res = await authFetch(`/api/maintenance/${rigId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [rigId]);

  useEffect(() => {
    if (!open || !rigId) { setData(null); setStatus('idle'); return; }
    let cancelled = false;
    setStatus('loading');
    authFetch(`/api/maintenance/${rigId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => { if (!cancelled) { setData(j); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [open, rigId]);

  const canWrite = user && (
    user.role === 'axis_admin' || user.role === 'axis_ops' ||
    (user.role === 'hauler_admin' && data?.hauler_id === user.hauler_id)
  );

  // Bubble a refresh both to this drawer and up to the parent list so the
  // Critical/In-workshop buckets recount without a full page reload.
  const refreshAll = useCallback(async () => {
    await fetchRig(false);
    onMutate?.();
  }, [fetchRig, onMutate]);

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div style={{ padding: 'var(--space-5)' }}>
        {status === 'loading' && <Muted>Loading workorder…</Muted>}
        {status === 'error'   && <Muted>Workorder lookup failed.</Muted>}
        {status === 'ready'   && data && (
          <Body
            data={data}
            navigate={navigate}
            onClose={onClose}
            canWrite={canWrite}
            onMutate={refreshAll}
          />
        )}
      </div>
    </Modal>
  );
}

function Body({ data, navigate, onClose, canWrite, onMutate }) {
  const serviceOver = data.km_since_service > 20000;
  const kmToNext = data.next_service_km_due - data.total_km;

  return (
    <>
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
          Workorder · {data.id}
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
            {data.plate}
          </h2>
          <StatusBadge tone={STATUS_TONE[data.status] ?? 'neutral'}>
            {STATUS_LABEL[data.status] ?? data.status}
          </StatusBadge>
        </div>
        <p style={{
          margin: '4px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          {data.hauler_display} · {data.make} {data.model} · {data.year_of_manufacture}
        </p>
      </header>

      <Section title="Status">
        <Row
          label="Flag"
          value={
            data.maintenance_flag ? (
              <StatusBadge tone={FLAG_TONE[data.maintenance_flag] ?? 'neutral'}>
                {FLAG_LABEL[data.maintenance_flag] ?? data.maintenance_flag}
              </StatusBadge>
            ) : <Muted>—</Muted>
          }
        />
        <Row label="Total km"          value={formatKm(data.total_km)} />
        <Row label="Last service at"   value={formatKm(data.last_service_km)} />
        <Row label="Next service due"  value={formatKm(data.next_service_km_due)} />
        <Row
          label="Since last service"
          value={
            <span style={{ color: serviceOver ? 'var(--signal-amber)' : 'var(--text)' }}>
              {formatKm(data.km_since_service)}
              {serviceOver ? ` · ${formatKm(-kmToNext)} over` : ` · ${formatKm(kmToNext)} to go`}
            </span>
          }
        />
        <Row
          label="Road-worthy cert"
          value={
            <span style={{
              color: data.road_worthy_expiry_days <= 7  ? 'var(--bauxite-rust)'
                   : data.road_worthy_expiry_days <= 30 ? 'var(--signal-amber)'
                   : 'var(--text)',
            }}>
              {data.road_worthy_expiry_days} days to expiry
            </span>
          }
        />
      </Section>

      <Lifecycle
        rigId={data.id}
        plate={data.plate}
        active={data.active_workorder}
        canWrite={canWrite}
        onMutate={onMutate}
      />

      {data.open_defects.length > 0 && (
        <Section title={`Open defects · ${data.open_defects.length}`}>
          {data.open_defects.map((d) => (
            <div key={d.id} style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 'var(--space-3)',
              alignItems: 'baseline',
              padding: '8px 10px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <StatusBadge tone={SEVERITY_TONE[d.severity] ?? 'neutral'}>
                {d.severity}
              </StatusBadge>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                  {d.title}
                </span>
                <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
                  {d.system.toUpperCase()} · {d.reported_by}
                </span>
              </div>
              <span className="mono" style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
                letterSpacing: '0.04em',
              }}>
                {formatDate(d.opened_at)}
              </span>
            </div>
          ))}
        </Section>
      )}

      {data.parts_on_order.length > 0 && (
        <Section title={`Parts on order · ${data.parts_on_order.length}`}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <WbTh>Part</WbTh>
                <WbTh align="right">Qty</WbTh>
                <WbTh>Supplier</WbTh>
                <WbTh align="right">ETA</WbTh>
                <WbTh align="right">PO</WbTh>
              </tr>
            </thead>
            <tbody>
              {data.parts_on_order.map((p) => (
                <tr key={p.id}>
                  <WbTd>{p.part}</WbTd>
                  <WbTd align="right" mono>{p.qty}</WbTd>
                  <WbTd muted>{p.supplier}</WbTd>
                  <WbTd align="right" mono>
                    {p.eta_days === 0 ? 'in stock' : `${p.eta_days} d`}
                  </WbTd>
                  <WbTd align="right" mono muted>{p.po_ref}</WbTd>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={`Service history · ${data.history.length}`}>
        {data.history.length === 0 ? (
          <Muted>No prior workorders on record.</Muted>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.history.map((h, i) => (
              <li key={h.id} style={{
                display: 'grid',
                gridTemplateColumns: '22px 1fr auto',
                gap: 10,
                alignItems: 'baseline',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  marginTop: 5,
                  background: i === 0 ? 'var(--bauxite-rust)' : 'var(--border-hairline)',
                  border: i === 0 ? '2px solid var(--bauxite-rust)' : '1px solid var(--border-soft)',
                  boxSizing: 'border-box',
                }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    color: i === 0 ? 'var(--text)' : 'var(--text-secondary)',
                    fontWeight: i === 0 ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  }}>
                    {h.service_type}
                    <span className="micro" style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>
                      ${h.cost_usd.toLocaleString()}
                    </span>
                  </span>
                  <span className="micro" style={{ color: 'var(--text-tertiary)' }}>
                    {h.workshop} · at {formatKm(h.km_at_service)}
                  </span>
                </div>
                <span className="mono" style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  letterSpacing: '0.04em',
                }}>
                  {formatDate(h.completed_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {data.primary_driver && (
        <Section title="Primary driver">
          <Row label="Name"          value={data.primary_driver.display_name} />
          <Row label="Licence class" value={`Class ${data.primary_driver.licence_class}`} />
          <Row label="Phone"         value={<span className="mono">{data.primary_driver.phone}</span>} />
          <Row label="Rest status"   value={
            <StatusBadge tone={{ compliant: 'connected', warning: 'degraded', breach: 'pending' }[data.primary_driver.rest_status] ?? 'neutral'}>
              {data.primary_driver.rest_status}
            </StatusBadge>
          } />
        </Section>
      )}

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
    }}>
      {children}
    </td>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'Africa/Accra',
  });
}

// ── Lifecycle block ──────────────────────────────────────────────
// When there's no active workorder, offers "Open workorder". When one
// is active, renders its current state + record-progress / resolve
// controls. Role gate is applied by the parent; here we just honour it.

function Lifecycle({ rigId, plate, active, canWrite, onMutate }) {
  const [panel, setPanel] = useState(null); // 'open' | 'progress' | 'resolve'
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const post = async (url, body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `request failed (${res.status})`);
      }
      setPanel(null);
      await onMutate?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={active ? `Workorder · ${active.id}` : 'Workorder'}>
      {active ? (
        <>
          <Row
            label="Status"
            value={
              <StatusBadge tone={WO_STATUS_TONE[active.status] ?? 'neutral'}>
                {active.status.replace('_', ' ')}
              </StatusBadge>
            }
          />
          <Row label="Title"      value={active.title} />
          <Row label="Opened"     value={`${formatDateTime(active.opened_at)} · ${active.opened_by_display ?? '—'}`} />
          {active.progress_at && (
            <Row
              label="Last progress"
              value={`${formatDateTime(active.progress_at)}${active.progress_by_display ? ` · ${active.progress_by_display}` : ''}${active.progress_note ? ` — ${active.progress_note}` : ''}`}
            />
          )}
        </>
      ) : (
        <Muted>No active workorder on {plate}. Open one to place this rig into remediation.</Muted>
      )}

      {error && (
        <div style={{
          padding: '8px 10px',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
          marginTop: 8,
        }}>
          {error}
        </div>
      )}

      {canWrite && !panel && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {!active && (
            <Button variant="primary" onClick={() => setPanel('open')} disabled={busy}>
              Open workorder
            </Button>
          )}
          {active && active.status !== 'RESOLVED' && (
            <>
              <Button variant="secondary" onClick={() => setPanel('progress')} disabled={busy}>
                Record progress
              </Button>
              <Button variant="primary" onClick={() => setPanel('resolve')} disabled={busy}>
                Resolve workorder
              </Button>
            </>
          )}
        </div>
      )}

      {panel === 'open' && (
        <OpenPanel
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(title) => post(`/api/maintenance/${rigId}/workorders`, { title })}
        />
      )}
      {panel === 'progress' && active && (
        <ProgressPanel
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(note) => post(`/api/maintenance/workorders/${active.id}/progress`, { note })}
        />
      )}
      {panel === 'resolve' && active && (
        <ResolveWOPanel
          busy={busy}
          onCancel={() => setPanel(null)}
          onSubmit={(body) => post(`/api/maintenance/workorders/${active.id}/resolve`, body)}
        />
      )}
    </Section>
  );
}

function OpenPanel({ busy, onCancel, onSubmit }) {
  const [title, setTitle] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <PanelShell title="Open workorder" onCancel={onCancel}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>Title *</span>
        <input
          ref={ref}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Rear bogie bearing replacement"
          style={fieldStyle}
        />
      </label>
      <Button variant="primary" disabled={busy || !title.trim()} onClick={() => onSubmit(title.trim())}>
        Open workorder
      </Button>
    </PanelShell>
  );
}

function ProgressPanel({ busy, onCancel, onSubmit }) {
  const [note, setNote] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <PanelShell title="Record progress" onCancel={onCancel}>
      <textarea
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What was done today? Parts fitted, tests run, what's outstanding?"
        rows={3}
        style={fieldStyleArea}
      />
      <Button variant="primary" disabled={busy} onClick={() => onSubmit(note.trim())}>
        Record progress
      </Button>
    </PanelShell>
  );
}

function ResolveWOPanel({ busy, onCancel, onSubmit }) {
  const [note, setNote]   = useState('');
  const [cost, setCost]   = useState('');
  const [hours, setHours] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const disabled = busy || !note.trim();
  const submit = () => onSubmit({
    resolution_note: note.trim(),
    cost_usd: cost === '' ? null : Number(cost),
    hours:    hours === '' ? null : Number(hours),
  });
  return (
    <PanelShell title="Resolve workorder" onCancel={onCancel}>
      <textarea
        ref={ref}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note * — what was fixed, signed off by whom."
        rows={3}
        style={fieldStyleArea}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, marginBottom: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="micro" style={{ color: 'var(--text-tertiary)' }}>Cost (USD)</span>
          <input
            type="number"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="e.g. 1850"
            style={fieldStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="micro" style={{ color: 'var(--text-tertiary)' }}>Hours</span>
          <input
            type="number"
            step="0.1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 6"
            style={fieldStyle}
          />
        </label>
      </div>
      <Button variant="primary" disabled={disabled} onClick={submit}>
        Resolve workorder
      </Button>
    </PanelShell>
  );
}

function PanelShell({ title, children, onCancel }) {
  return (
    <div style={{
      marginTop: 'var(--space-3)',
      padding: 'var(--space-3)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}>
        <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{title}</span>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent', border: 'none',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Cancel
        </button>
      </div>
      {children}
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

const fieldStyleArea = {
  ...fieldStyle,
  resize: 'vertical',
};
