/*
 * VehicleFormModal — LP-3.
 * Create-only modal for axis_admin to add a new truck via POST /api/admin/fleet.
 * Edit is not wired here yet; trucks are updated via the RigDetail drawer.
 */

import { useState } from 'react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { TextField, SelectField } from '../primitives/FormField';
import { authFetch } from '../../lib/auth';

const AXLE_OPTIONS = [
  { value: '6x4', label: '6×4' },
  { value: '8x4', label: '8×4' },
  { value: '6x2', label: '6×2' },
  { value: '4x2', label: '4×2' },
];

const BLANK = {
  plate:                  '',
  hauler_id:              '',
  make:                   '',
  model:                  '',
  axle_config:            '6x4',
  year_of_manufacture:    '',
  gross_weight_t:         '',
  payload_capacity_t:     '',
};

export default function VehicleFormModal({ open, onClose, onCreated, haulerOptions = [] }) {
  const [form,    setForm]    = useState(BLANK);
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState(null);

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
    setErr(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);

    const body = {
      plate:     form.plate.trim(),
      hauler_id: form.hauler_id.trim(),
    };
    if (form.make.trim())              body.make               = form.make.trim();
    if (form.model.trim())             body.model              = form.model.trim();
    if (form.axle_config)              body.axle_config        = form.axle_config;
    if (form.year_of_manufacture)      body.year_of_manufacture = Number(form.year_of_manufacture);
    if (form.gross_weight_t)           body.gross_weight_t      = Number(form.gross_weight_t);
    if (form.payload_capacity_t)       body.payload_capacity_t  = Number(form.payload_capacity_t);

    try {
      const res = await authFetch('/api/admin/fleet', {
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
      onCreated?.(data.truck);
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

  // Build hauler select options
  const haulerSelectOptions = [
    { value: '', label: 'Select hauler…' },
    ...haulerOptions.map(([id, display]) => ({ value: id, label: display ?? id })),
  ];

  return (
    <Modal open={open} onClose={handleClose} width={480}>
      <div style={{ padding: 'var(--space-4)' }}>
        <h2 style={headingStyle}>Add vehicle</h2>
        <form onSubmit={handleSubmit}>
          <div style={gridStyle}>
            <TextField
              label="Registration plate *"
              value={form.plate}
              onChange={(v) => set('plate', v)}
              placeholder="e.g. GR-1234-23"
              autoFocus
            />
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
              label="Make"
              value={form.make}
              onChange={(v) => set('make', v)}
              placeholder="e.g. Sinotruk"
            />
            <TextField
              label="Model"
              value={form.model}
              onChange={(v) => set('model', v)}
              placeholder="e.g. HOWO 371"
            />
            <SelectField
              label="Axle config"
              value={form.axle_config}
              onChange={(v) => set('axle_config', v)}
              options={AXLE_OPTIONS}
            />
            <TextField
              label="Year of manufacture"
              value={form.year_of_manufacture}
              onChange={(v) => set('year_of_manufacture', v)}
              type="number"
              placeholder="e.g. 2021"
              min="1990"
            />
            <TextField
              label="GVW (tonnes)"
              value={form.gross_weight_t}
              onChange={(v) => set('gross_weight_t', v)}
              type="number"
              placeholder="e.g. 40"
              min="1"
            />
            <TextField
              label="Payload capacity (tonnes)"
              value={form.payload_capacity_t}
              onChange={(v) => set('payload_capacity_t', v)}
              type="number"
              placeholder="e.g. 30"
              min="1"
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
              disabled={saving || !form.plate.trim() || !form.hauler_id.trim()}
            >
              {saving ? 'Adding…' : 'Add vehicle'}
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
