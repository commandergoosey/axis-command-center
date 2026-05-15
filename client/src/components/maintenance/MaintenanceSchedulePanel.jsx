/*
 * MaintenanceSchedulePanel — Phase 84.
 *
 * Forward-looking schedule of planned workshop windows. Shown
 * above the reactive buckets on /maintenance so the operator
 * sees both:
 *   - what's *planned* (this panel — Phase 84)
 *   - what's *happening now* (existing buckets — Phase 26)
 *
 * Per-row complete/cancel actions for write roles. Modal form
 * for adding new windows.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, X, Wrench, Calendar, CheckSquare, XSquare } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';

const TYPE_LABEL = {
  service_a:  'Service A (10k)',
  service_b:  'Service B (20k)',
  service_c:  'Service C (40k)',
  tyre:       'Tyres',
  inspection: 'Inspection',
  repair:     'Repair',
  other:      'Other',
};
const TYPE_OPTIONS = Object.entries(TYPE_LABEL);

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

export default function MaintenanceSchedulePanel({ rigs, refreshKey }) {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/maintenance/schedule')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function complete(id) {
    if (!confirm('Mark this maintenance window as completed?')) return;
    const r = await authFetch(`/api/maintenance/schedule/${id}/complete`, { method: 'POST' });
    if (r.ok) load();
  }
  async function cancelEntry(id) {
    if (!confirm('Cancel this scheduled maintenance window?')) return;
    const r = await authFetch(`/api/maintenance/schedule/${id}/cancel`, { method: 'POST' });
    if (r.ok) load();
  }

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-medium)', color: 'var(--text)',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <Calendar size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
            Planned maintenance
          </h2>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            Forward-looking schedule of workshop windows. Shows up on the calendar feed.
          </p>
        </div>
        {canWrite && (
          <Button variant="primary" onClick={() => setComposing(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={12} strokeWidth={1.8} />
              Schedule
            </span>
          </Button>
        )}
      </header>

      {error && <p style={{ color: 'var(--bauxite-rust)' }}>{error}</p>}

      {!data ? (
        <p style={muted}>Loading…</p>
      ) : data.schedule.length === 0 ? (
        <p style={emptyBox}>
          No planned maintenance scheduled.{canWrite ? ' Add one to start tracking.' : ''}
        </p>
      ) : (
        <ScheduleTable
          rows={data.schedule}
          canWrite={canWrite}
          onComplete={complete}
          onCancel={cancelEntry}
        />
      )}

      {composing && (
        <ScheduleFormModal
          rigs={rigs}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}
    </section>
  );
}

// ── Table ─────────────────────────────────────────────────────────

function ScheduleTable({ rows, canWrite, onComplete, onCancel }) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
            <th style={th}>Rig</th>
            <th style={th}>Hauler</th>
            <th style={th}>Type</th>
            <th style={th}>Window</th>
            <th style={th}>Notes</th>
            <th style={th}>Status</th>
            {canWrite && <th style={th}></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const startDays = Math.ceil((new Date(r.start_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            const inProgress = r.status === 'in_progress';
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
                <td style={td}>
                  <span className="mono">{r.rig_id}</span>
                </td>
                <td style={{ ...td, color: 'var(--text-secondary)' }}>
                  {r.hauler_id}
                </td>
                <td style={td}>{TYPE_LABEL[r.type] || r.type}</td>
                <td style={td}>
                  <span className="mono tabular" style={{ color: 'var(--text-secondary)' }}>
                    {r.start_at.slice(0, 10)} → {r.end_at.slice(0, 10)}
                  </span>
                  <div style={{ fontSize: 10, color: startDays < 0 ? 'var(--signal-amber)' : 'var(--text-tertiary)', marginTop: 2 }}>
                    {startDays < 0 ? 'started' : startDays === 0 ? 'today' : startDays === 1 ? 'tomorrow' : `in ${startDays}d`}
                  </div>
                </td>
                <td style={{ ...td, color: 'var(--text-tertiary)', maxWidth: 260, fontSize: 'var(--ts-caption-size)' }}>
                  {r.notes || '—'}
                </td>
                <td style={td}>
                  <Pill label={r.status.replace('_', ' ')} tone={inProgress ? 'var(--signal-amber)' : 'var(--text-secondary)'} />
                </td>
                {canWrite && (
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <IconBtn title="Mark complete" onClick={() => onComplete(r.id)}>
                        <CheckSquare size={11} strokeWidth={1.6} />
                      </IconBtn>
                      <IconBtn title="Cancel" onClick={() => onCancel(r.id)}>
                        <XSquare size={11} strokeWidth={1.6} />
                      </IconBtn>
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pill({ label, tone }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 10%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 10, fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

function IconBtn({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        padding: 4,
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontFamily: 'inherit',
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Form modal ────────────────────────────────────────────────────

function ScheduleFormModal({ rigs, onClose, onSaved }) {
  const [form, setForm] = useState({
    rig_id:   '',
    type:     'service_b',
    start_at: '',
    end_at:   '',
    notes:    '',
  });
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  const selectedRig = rigs?.find((r) => r.id === form.rig_id);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.rig_id || !form.start_at || !form.end_at || posting) return;
    if (!selectedRig) {
      setError('Pick a rig from the list');
      return;
    }
    setPosting(true); setError(null);
    try {
      const r = await authFetch('/api/maintenance/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rig_id:    form.rig_id,
          hauler_id: selectedRig.hauler_id,
          type:      form.type,
          start_at:  new Date(form.start_at).toISOString(),
          end_at:    new Date(form.end_at).toISOString(),
          notes:     form.notes || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  return (
    <Modal open onClose={onClose} width={620}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Schedule maintenance
            </div>
            <h2 style={{
              margin: 0, fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-medium)',
            }}>
              Plan a workshop window
            </h2>
          </div>
          <button type="button" onClick={onClose} style={closeBtn}>
            <X size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Rig">
            <select value={form.rig_id} onChange={(e) => setField('rig_id', e.target.value)} style={inputStyle}>
              <option value="">— Pick a rig —</option>
              {(rigs ?? []).slice(0, 200).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} · {r.plate} · {r.hauler_id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={form.type} onChange={(e) => setField('type', e.target.value)} style={inputStyle}>
              {TYPE_OPTIONS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Field label="Start (date + time)">
              <input
                type="datetime-local" value={form.start_at}
                onChange={(e) => setField('start_at', e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="End (date + time)">
              <input
                type="datetime-local" value={form.end_at}
                onChange={(e) => setField('end_at', e.target.value)}
                style={inputStyle}
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              value={form.notes} maxLength={1000} rows={3}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="Why this window, what work is planned, any prerequisites…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || (selectedRig ? `Will lock ${selectedRig.id} (${selectedRig.hauler_id}) for the window.` : 'Pick a rig + dates.')}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!form.rig_id || !form.start_at || !form.end_at || posting}>
              {posting ? 'Saving…' : 'Schedule'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  boxSizing: 'border-box',
  width: '100%',
};
const th = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  fontWeight: 500,
};
const td = {
  padding: '10px',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  lineHeight: 1.4,
  verticalAlign: 'top',
};
const muted = { color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' };
const emptyBox = {
  margin: 0, padding: 'var(--space-4)',
  background: 'var(--surface)', border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)',
  fontStyle: 'italic', textAlign: 'center',
};
const closeBtn = {
  padding: 4, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-tertiary)',
};
