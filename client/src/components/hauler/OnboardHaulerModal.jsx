/*
 * OnboardHaulerModal — Phase 109: 3-step onboarding wizard.
 *
 * Step 1  Company details   display_name, contact_name, contact_email
 * Step 2  Fleet & terms     contracted_trucks, integration_type, planned_start_date
 * Step 3  Review            read-only summary before final submit
 *
 * On submit, POSTs to /api/haulers and calls onCreated with the new hauler id.
 */

import { authFetch } from '../../lib/auth';
import { useState } from 'react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { TextField, SelectField } from '../primitives/FormField';

const INTEGRATION_OPTIONS = [
  { value: 'loconav', label: 'Loconav (read-only API token)' },
  { value: 'custom',  label: 'Custom FMS (bespoke adapter)' },
  { value: 'manual',  label: 'Manual (weighbridge + CSV)' },
];

const TOTAL_STEPS = 3;

const STEP_TITLES = [
  'Company details',
  'Fleet & terms',
  'Review',
];

// ── Step progress indicator ───────────────────────────────────────────────────

function StepIndicator({ current }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      marginBottom: 'var(--space-5)',
    }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
        const n      = i + 1;
        const done   = n < current;
        const active = n === current;
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center', flex: i < TOTAL_STEPS - 1 ? 1 : 'none' }}>
            {/* Circle */}
            <div style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 'var(--fw-medium)',
              fontFamily: 'var(--font-mono)',
              background:  done   ? 'var(--bauxite-rust)'
                         : active ? 'var(--charcoal)'
                         : 'transparent',
              border:      done   ? 'none'
                         : active ? 'none'
                         : '1.5px solid var(--border-strong)',
              color:       done || active ? 'var(--bone)' : 'var(--text-tertiary)',
            }}>
              {done ? '✓' : n}
            </div>
            {/* Label (shown only for active step) */}
            {active && (
              <span style={{
                marginLeft: 8,
                fontSize: 'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                color: 'var(--text)',
                whiteSpace: 'nowrap',
              }}>
                {STEP_TITLES[i]}
              </span>
            )}
            {/* Connector line */}
            {i < TOTAL_STEPS - 1 && (
              <div style={{
                flex: 1,
                height: 1,
                background: done ? 'var(--bauxite-rust)' : 'var(--border-hairline)',
                marginLeft: active ? 'var(--space-2)' : 8,
                marginRight: 8,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Review row ────────────────────────────────────────────────────────────────

function ReviewRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '140px 1fr',
      gap: 'var(--space-2)',
      padding: '8px 0',
      borderBottom: '1px solid var(--border-hairline)',
      fontSize: 'var(--ts-body-sm-size)',
    }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{value}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const INTEGRATION_LABEL = {
  loconav: 'Loconav (read-only API token)',
  custom:  'Custom FMS (bespoke adapter)',
  manual:  'Manual (weighbridge + CSV)',
};

export default function OnboardHaulerModal({ open, onClose, onCreated }) {
  const [step, setStep]               = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [trucks, setTrucks]           = useState('');
  const [integrationType, setIntegrationType] = useState('loconav');
  const [plannedStart, setPlannedStart] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState(null);

  function reset() {
    setStep(1);
    setDisplayName('');
    setContactName('');
    setContactEmail('');
    setTrucks('');
    setIntegrationType('loconav');
    setPlannedStart('');
    setError(null);
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose?.();
  }

  // ── Step validation ─────────────────────────────────────────────────────────

  function validateStep1() {
    if (!displayName.trim()) return 'Company name is required.';
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      return 'Contact email must be a valid address.';
    }
    return null;
  }

  function validateStep2() {
    const t = parseInt(trucks, 10);
    if (!Number.isInteger(t) || t <= 0) return 'Contracted trucks must be a positive integer.';
    if (plannedStart && !/^\d{4}-\d{2}-\d{2}$/.test(plannedStart)) {
      return 'Planned start date must be YYYY-MM-DD.';
    }
    return null;
  }

  function nextStep() {
    const err = step === 1 ? validateStep1() : step === 2 ? validateStep2() : null;
    if (err) { setError(err); return; }
    setError(null);
    setStep((s) => s + 1);
  }

  function prevStep() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authFetch('/api/haulers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name:      displayName.trim(),
          contracted_trucks: parseInt(trucks, 10),
          integration_type:  integrationType,
          contact_name:      contactName.trim() || undefined,
          contact_email:     contactEmail.trim() || undefined,
          planned_start_date: plannedStart || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const body = await res.json();
      reset();
      onCreated?.(body.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} width={520}>
      <form onSubmit={handleSubmit} style={{ padding: 'var(--space-5)' }}>

        {/* Header */}
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
            Admin · Onboard
          </div>
          <h2 style={{
            margin: 0,
            fontSize: 'var(--ts-h2-size)',
            lineHeight: 'var(--ts-h2-lh)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            Add a hauler
          </h2>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            Creates a pending record. Complete the onboarding checklist before activating.
          </p>
        </header>

        <StepIndicator current={step} />

        {/* ── Step 1: Company details ───────────────────────────────────── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <TextField
              label="Company name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="e.g. Hauler 06 Ltd"
              autoFocus
            />
            <TextField
              label="Contact name"
              value={contactName}
              onChange={setContactName}
              placeholder="Operations manager"
            />
            <TextField
              label="Contact email"
              type="email"
              value={contactEmail}
              onChange={setContactEmail}
              placeholder="ops@hauler06.com"
            />
          </div>
        )}

        {/* ── Step 2: Fleet & terms ─────────────────────────────────────── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <TextField
              label="Contracted trucks"
              type="number"
              min={1}
              value={trucks}
              onChange={setTrucks}
              placeholder="15"
              autoFocus
            />
            <SelectField
              label="Integration type"
              value={integrationType}
              onChange={setIntegrationType}
              options={INTEGRATION_OPTIONS}
            />
            <TextField
              label="Planned start date"
              type="date"
              value={plannedStart}
              onChange={setPlannedStart}
            />
          </div>
        )}

        {/* ── Step 3: Review ────────────────────────────────────────────── */}
        {step === 3 && (
          <div style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
          }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--space-3)', color: 'var(--text-tertiary)' }}>
              Summary
            </div>
            <ReviewRow label="Company name"    value={displayName} />
            <ReviewRow label="Contact name"    value={contactName || '—'} />
            <ReviewRow label="Contact email"   value={contactEmail || '—'} />
            <ReviewRow label="Contracted rigs" value={trucks ? `${trucks} trucks` : '—'} />
            <ReviewRow label="Integration"     value={INTEGRATION_LABEL[integrationType]} />
            <ReviewRow label="Planned start"   value={plannedStart || '—'} />
            <div style={{
              marginTop: 'var(--space-3)',
              padding: '10px 12px',
              background: 'rgba(139, 46, 26, 0.04)',
              border: '1px solid rgba(139, 46, 26, 0.12)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
            }}>
              Status will be set to <strong>Pending</strong>. Complete the onboarding
              checklist in the hauler drawer before activating to the live corridor.
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 'var(--space-3)',
            padding: '10px 12px',
            background: 'rgba(139, 46, 26, 0.06)',
            border: '1px solid rgba(139, 46, 26, 0.22)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--signal-red)',
            fontSize: 'var(--ts-body-sm-size)',
          }}>
            {error}
          </div>
        )}

        {/* Footer buttons */}
        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 'var(--space-2)',
        }}>
          <Button variant="ghost" type="button" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {step > 1 && (
              <Button variant="secondary" type="button" onClick={prevStep} disabled={submitting}>
                ← Back
              </Button>
            )}
            {step < TOTAL_STEPS ? (
              <Button variant="primary" type="button" onClick={nextStep}>
                Next →
              </Button>
            ) : (
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create hauler'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}
