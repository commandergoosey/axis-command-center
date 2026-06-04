/*
 * HaulerManagementPanel — LP-4.
 * Admin surface for full hauler CRUD and deactivation.
 * Wired into Settings.jsx (axis_admin only).
 *
 * Actions available per row:
 *   - Edit (display_name, contracted_trucks, contact_name, contact_email,
 *           contract_share_pct, planned_start_date, integration_type)
 *   - Deactivate / Reactivate
 */

import { useEffect, useState, useCallback } from 'react';
import { Truck } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { TextField, SelectField } from '../primitives/FormField';

const STATUS_TONE = {
  active:  { fg: 'var(--signal-green)',  bg: 'rgba(46,107,63,0.08)',  bd: 'rgba(46,107,63,0.3)' },
  pending: { fg: 'var(--signal-amber)',  bg: 'rgba(217,158,55,0.08)', bd: 'rgba(217,158,55,0.3)' },
};

const INTEGRATION_OPTIONS = [
  { value: 'loconav', label: 'Loconav' },
  { value: 'custom',  label: 'Custom (GeoTab etc.)' },
  { value: 'manual',  label: 'Manual / CSV' },
  { value: 'mqtt',    label: 'MQTT / Telematics Core' },
];

/* ── Main panel ──────────────────────────────────────────────────────────── */
export default function HaulerManagementPanel() {
  const [haulers,   setHaulers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [editing,   setEditing]   = useState(null);   // hauler being edited
  const [addOpen,   setAddOpen]   = useState(false);
  const [actionErr, setActionErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/haulers');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setHaulers(data.haulers ?? []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDeactivate(h) {
    setActionErr(null);
    const res = await authFetch(`/api/admin/haulers/${h.id}/deactivate`, { method: 'POST' });
    if (res.ok) { load(); } else { const d = await res.json(); setActionErr(d.error); }
  }

  async function handleReactivate(h) {
    setActionErr(null);
    const res = await authFetch(`/api/admin/haulers/${h.id}/reactivate`, { method: 'POST' });
    if (res.ok) { load(); } else { const d = await res.json(); setActionErr(d.error); }
  }

  const active      = haulers.filter((h) => !h.deactivated);
  const deactivated = haulers.filter((h) =>  h.deactivated);

  return (
    <section style={sectionStyle}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Truck size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Hauler management</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {active.length} active · {deactivated.length} deactivated
          </span>
          <Button variant="secondary" onClick={() => setAddOpen(true)}>
            + Add hauler
          </Button>
        </div>
      </header>

      {loading && <Skeleton rows={3} />}
      {error   && <p style={errStyle}>Load failed — {error}</p>}
      {actionErr && <p style={errStyle}>{actionErr}</p>}

      {!loading && !error && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {haulers.map((h) => (
            <li
              key={h.id}
              style={{
                ...rowStyle,
                opacity: h.deactivated ? 0.5 : 1,
              }}
            >
              {/* Identity */}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
                  {h.display_name}
                  {h.deactivated && (
                    <span style={badgeStyle('var(--bauxite-rust)', 'rgba(139,46,26,0.08)', 'rgba(139,46,26,0.3)')}>
                      Deactivated
                    </span>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {h.id} · {h.fleet?.contracted_trucks ?? 0} trucks
                </div>
              </div>

              {/* Status */}
              {!h.deactivated && (() => {
                const tone = STATUS_TONE[h.status] ?? STATUS_TONE.pending;
                return (
                  <span className="mono" style={{
                    fontSize: 10, letterSpacing: '0.08em', padding: '2px 8px',
                    background: tone.bg, color: tone.fg,
                    border: `1px solid ${tone.bd}`, borderRadius: 2,
                    whiteSpace: 'nowrap',
                  }}>
                    {h.status?.toUpperCase()}
                  </span>
                );
              })()}

              {/* Integration */}
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                {h.integration?.type ?? '—'}
              </span>

              {/* Contact */}
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {h.contact_email ?? '—'}
              </span>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                <IconBtn title="Edit" onClick={() => setEditing(h)}>✎</IconBtn>
                {h.deactivated ? (
                  <IconBtn title="Reactivate" tone="green" onClick={() => handleReactivate(h)}>↺</IconBtn>
                ) : (
                  <IconBtn title="Deactivate" tone="red" onClick={() => handleDeactivate(h)}>⊘</IconBtn>
                )}
              </div>
            </li>
          ))}
          {haulers.length === 0 && (
            <li style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>
              No haulers yet
            </li>
          )}
        </ul>
      )}

      <HaulerFormModal
        open={addOpen}
        hauler={null}
        onClose={() => setAddOpen(false)}
        onSaved={load}
      />
      <HaulerFormModal
        open={Boolean(editing)}
        hauler={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </section>
  );
}

/* ── Create / Edit modal ─────────────────────────────────────────────────── */
function HaulerFormModal({ open, hauler, onClose, onSaved }) {
  const isEdit = Boolean(hauler);

  const blank = {
    display_name:        '',
    contracted_trucks:   '',
    integration_type:    'manual',
    contact_name:        '',
    contact_email:       '',
    contract_share_pct:  '',
    planned_start_date:  '',
  };

  const [form,   setForm]   = useState(blank);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState(null);

  // Populate form when editing
  useEffect(() => {
    if (hauler) {
      setForm({
        display_name:       hauler.display_name             ?? '',
        contracted_trucks:  hauler.fleet?.contracted_trucks ?? '',
        integration_type:   hauler.integration?.type       ?? 'manual',
        contact_name:       hauler.contact_name             ?? '',
        contact_email:      hauler.contact_email            ?? '',
        contract_share_pct: hauler.contract_share_pct != null ? hauler.contract_share_pct : '',
        planned_start_date: hauler.planned_start_date       ?? '',
      });
    } else {
      setForm(blank);
    }
    setErr(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hauler, open]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setErr(null); }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    const body = {
      display_name:       form.display_name.trim(),
      contracted_trucks:  form.contracted_trucks !== '' ? Number(form.contracted_trucks) : 0,
      integration_type:   form.integration_type,
    };
    if (form.contact_name.trim())       body.contact_name       = form.contact_name.trim();
    if (form.contact_email.trim())      body.contact_email      = form.contact_email.trim();
    if (form.contract_share_pct !== '') body.contract_share_pct = Number(form.contract_share_pct);
    if (form.planned_start_date)        body.planned_start_date = form.planned_start_date;

    const url    = isEdit ? `/api/admin/haulers/${hauler.id}` : '/api/admin/haulers';
    const method = isEdit ? 'PATCH' : 'POST';

    try {
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || `Error ${res.status}`); setSaving(false); return; }
      onSaved?.(data.hauler);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <div style={{ padding: 'var(--space-4)' }}>
        <h2 style={headingStyle}>{isEdit ? `Edit ${hauler?.display_name}` : 'Add hauler'}</h2>
        <form onSubmit={handleSubmit}>
          <div style={gridStyle}>
            <div style={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Display name *"
                value={form.display_name}
                onChange={(v) => set('display_name', v)}
                placeholder="e.g. Kofi Transport Ltd"
                autoFocus
              />
            </div>
            <TextField
              label="Contracted trucks"
              value={form.contracted_trucks}
              onChange={(v) => set('contracted_trucks', v)}
              type="number"
              placeholder="e.g. 15"
              min="0"
            />
            <SelectField
              label="Integration type"
              value={form.integration_type}
              onChange={(v) => set('integration_type', v)}
              options={INTEGRATION_OPTIONS}
            />
            <TextField
              label="Contact name"
              value={form.contact_name}
              onChange={(v) => set('contact_name', v)}
              placeholder="e.g. Kwame Asante"
            />
            <TextField
              label="Contact email"
              value={form.contact_email}
              onChange={(v) => set('contact_email', v)}
              type="email"
              placeholder="e.g. kwame@kofi.com"
            />
            <TextField
              label="Contract share (%)"
              value={form.contract_share_pct}
              onChange={(v) => set('contract_share_pct', v)}
              type="number"
              placeholder="e.g. 22.5"
              min="0"
            />
            <TextField
              label="Planned start date"
              value={form.planned_start_date}
              onChange={(v) => set('planned_start_date', v)}
              type="date"
            />
          </div>
          {err && <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)', marginTop: 'var(--space-3)' }}>{err}</p>}
          <div style={footerStyle}>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving || !form.display_name.trim()}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add hauler'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function IconBtn({ title, onClick, tone, children }) {
  const [hover, setHover] = useState(false);
  const fg = tone === 'red' ? 'var(--bauxite-rust)' : tone === 'green' ? 'var(--signal-green)' : 'var(--text-secondary)';
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? 'var(--accent-tint)' : 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-sm)',
        color: hover ? fg : 'var(--text-tertiary)',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        padding: '4px 6px',
        transition: 'background 100ms, color 100ms',
      }}
    >
      {children}
    </button>
  );
}

function badgeStyle(fg, bg, bd) {
  return {
    marginLeft: 8,
    display: 'inline-block',
    fontSize: 10,
    letterSpacing: '0.08em',
    padding: '1px 6px',
    background: bg, color: fg, border: `1px solid ${bd}`, borderRadius: 2,
  };
}

function Skeleton({ rows = 3 }) {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height: 12, marginBottom: 10, background: 'var(--accent-tint)', borderRadius: 2, opacity: 0.5 }} />
      ))}
    </div>
  );
}

const sectionStyle = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-hairline)',
};

const rowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0,1.4fr) 80px 90px minmax(0,1fr) auto',
  gap: 'var(--space-3)',
  alignItems: 'center',
  padding: 'var(--space-3) var(--space-4)',
  borderTop: '1px solid var(--border-hairline)',
};

const errStyle = {
  padding: 'var(--space-3) var(--space-4)',
  color: 'var(--bauxite-rust)',
  fontSize: 'var(--ts-caption-size)',
};

const headingStyle = {
  fontSize: 'var(--ts-heading-sm-size)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text)',
  margin: '0 0 var(--space-4)',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-4)',
};

const footerStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'var(--space-2)',
  paddingTop: 'var(--space-3)',
  borderTop: '1px solid var(--border-hairline)',
  marginTop: 'var(--space-2)',
};
