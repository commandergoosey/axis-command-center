/*
 * DriverFormModal — LP-3.
 * Create-only modal for axis_admin to add a new driver via POST /api/admin/drivers.
 * Edit is not wired here yet; drivers are updated via the DriverDetail drawer.
 */

import { useState } from 'react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { TextField, SelectField } from '../primitives/FormField';
import { authFetch } from '../../lib/auth';

const SHIFT_OPTIONS = [
  { value: 'day',    label: 'Day' },
  { value: 'night',  label: 'Night' },
  { value: 'rest',   label: 'Rest day' },
  { value: 'relief', label: 'Relief pool' },
];

const LICENCE_CLASS_OPTIONS = [
  { value: 'E',  label: 'Class E (articulated)' },
  { value: 'D',  label: 'Class D (rigid)' },
  { value: 'C',  label: 'Class C' },
  { value: 'B',  label: 'Class B' },
];

const BLANK = {
  full_name:         '',
  hauler_id:         '',
  phone:             '',
  licence_number:    '',
  licence_class:     'E',
  licence_expiry_iso:'',
  years_experience:  '',
  shift:             'day',
};

export default function DriverFormModal({ open, onClose, onCreated, haulerOptions = [] }) {
  const [form,   setForm]   = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState(null);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setErr(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    const body = {
      full_name: form.full_name.trim(),
      hauler_id: form.hauler_id.trim(),
    };
    if (form.phone.trim())             body.phone              = form.phone.trim();
    if (form.licence_number.trim())    body.licence_number     = form.licence_number.trim();
    if (form.licence_class)            body.licence_class      = form.licence_class;
    if (form.licence_expiry_iso)       body.licence_expiry_iso = form.licence_expiry_iso;
    if (form.years_experience)         body.years_experience   = Number(form.years_experience);
    if (form.shift)                    body.shift              = form.shift;

    try {
      const res = await authFetch('/api/admin/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `Error ${res.status}`);
        setSaving(false);
        return;
      }
      setForm(BLANK);
      onCreated?.(data.driver);
      onClose?.();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setForm(BLANK);
    setErr(null);
    onClose?.();
  }

  const haulerSelectOptions = [
    { value: '', label: 'Select hauler…' },
    ...haulerOptions.map(([id, display]) => ({ value: id, label: display ?? id })),
  ];

  return (
    <Modal open={open} onClose={handleClose} width={480}>
      <div style={{ padding: 'var(--space-4)' }}>
        <h2 style={headingStyle}>Add driver</h2>
        <form onSubmit={handleSubmit}>
          <div style={gridStyle}>
            <div style={{ gridColumn: '1 / -1' }}>
              <TextField
                label="Full name *"
                value={form.full_name}
                onChange={(v) => set('full_name', v)}
                placeholder="e.g. Kofi Mensah"
                autoFocus
              />
            </div>

            {haulerOptions.length > 0 ? (
              <SelectField
                label="Hauler *"
                value={form.hauler_id}
                onChange={(v) => set('hauler_id', v)}
                options={haulerSelectOptions}
              />
            ) : (
              <TextField
                label="Hauler ID *"
                value={form.hauler_id}
                onChange={(v) => set('hauler_id', v)}
                placeholder="e.g. hauler-kofi-transport"
              />
            )}

            <TextField
              label="Phone"
              value={form.phone}
              onChange={(v) => set('phone', v)}
              placeholder="+233 …"
            />

            <TextField
              label="Licence number"
              value={form.licence_number}
              onChange={(v) => set('licence_number', v)}
              placeholder="e.g. GHA-DL-001234"
            />

            <SelectField
              label="Licence class"
              value={form.licence_class}
              onChange={(v) => set('licence_class', v)}
              options={LICENCE_CLASS_OPTIONS}
            />

            <TextField
              label="Licence expiry"
              value={form.licence_expiry_iso}
              onChange={(v) => set('licence_expiry_iso', v)}
              type="date"
            />

            <TextField
              label="Years' experience"
              value={form.years_experience}
              onChange={(v) => set('years_experience', v)}
              type="number"
              placeholder="e.g. 5"
              min="0"
            />

            <SelectField
              label="Default shift"
              value={form.shift}
              onChange={(v) => set('shift', v)}
              options={SHIFT_OPTIONS}
            />
          </div>

          {err && (
            <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)', marginTop: 'var(--space-3)' }}>
              {err}
            </p>
          )}

          <div style={footerStyle}>
            <Button type="button" variant="ghost" onClick={handleClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving || !form.full_name.trim() || !form.hauler_id.trim()}
            >
              {saving ? 'Adding…' : 'Add driver'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

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
