/*
 * HaulerOnboardingPanel — Phase 109.
 *
 * Shown inside HaulerDetail for pending haulers (i.e. those with
 * status === 'pending' and a persisted checklist).
 *
 * Renders:
 *   - Onboarding checklist (4 steps, each togglable by axis_admin/ops)
 *   - Editable contact / planned-start fields
 *   - Activate button (axis_admin only, gated on all checklist items done)
 */

import { useState } from 'react';
import { authFetch, can } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import Button from '../primitives/Button';
import { TextField } from '../primitives/FormField';

const STEP_ORDER = [
  'integration_configured',
  'driver_roster',
  'fleet_manifest',
  'contract_signed',
];

// ── Checklist item ────────────────────────────────────────────────────────────

function ChecklistItem({ item, haulerId, onUpdated, canEdit }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy || !canEdit) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/haulers/${haulerId}/checklist/${item.step}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.json();
      onUpdated(body.checklist);
    } catch { /* silent */ } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        padding: '10px 0',
        borderBottom: '1px solid var(--border-hairline)',
        opacity: busy ? 0.6 : 1,
        transition: 'opacity 120ms',
      }}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !canEdit}
        aria-label={item.done ? `Uncheck ${item.label}` : `Check ${item.label}`}
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: item.done
            ? '2px solid var(--bauxite-rust)'
            : '2px solid var(--border-strong)',
          background: item.done ? 'var(--bauxite-rust)' : 'transparent',
          flexShrink: 0,
          marginTop: 1,
          cursor: canEdit ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--bone)',
          fontSize: 11,
          transition: 'background 120ms, border-color 120ms',
        }}
      >
        {item.done ? '✓' : ''}
      </button>

      {/* Label + hint */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          fontWeight: item.done ? 'var(--fw-regular)' : 'var(--fw-medium)',
          color: item.done ? 'var(--text-tertiary)' : 'var(--text)',
          textDecoration: item.done ? 'line-through' : 'none',
        }}>
          {item.label}
        </div>
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
          lineHeight: 1.4,
        }}>
          {item.done
            ? `Done by ${item.done_by ?? 'operator'} · ${fmtDate(item.done_at)}`
            : item.hint}
        </div>
      </div>
    </div>
  );
}

// ── Meta edit form ────────────────────────────────────────────────────────────

function MetaEditForm({ hauler, haulerId, onUpdated }) {
  const [contactName,  setContactName]  = useState(hauler?.contact_name   ?? '');
  const [contactEmail, setContactEmail] = useState(hauler?.contact_email  ?? '');
  const [plannedStart, setPlannedStart] = useState(hauler?.planned_start_date ?? '');
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState(null);

  const dirty =
    contactName  !== (hauler?.contact_name   ?? '') ||
    contactEmail !== (hauler?.contact_email  ?? '') ||
    plannedStart !== (hauler?.planned_start_date ?? '');

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await authFetch(`/api/haulers/${haulerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_name:      contactName  || null,
          contact_email:     contactEmail || null,
          planned_start_date: plannedStart || null,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      onUpdated?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
        <TextField label="Contact name"  value={contactName}  onChange={setContactName}  placeholder="Ops manager" />
        <TextField label="Contact email" type="email" value={contactEmail} onChange={setContactEmail} placeholder="ops@hauler.com" />
      </div>
      <TextField label="Planned start date" type="date" value={plannedStart} onChange={setPlannedStart} />
      {err && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--signal-red)',
          fontSize: 'var(--ts-caption-size)',
        }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Button variant="secondary" type="button" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HaulerOnboardingPanel({ hauler, haulerId, checklist: initialChecklist, onActivated, onUpdated }) {
  const { user } = useAuth();
  const [checklist, setChecklist] = useState(initialChecklist ?? []);
  const [activating, setActivating]   = useState(false);
  const [activateErr, setActivateErr] = useState(null);

  const canEdit     = can(user?.role, 'manageIntegration') && user?.role !== 'hauler_admin';
  const canActivate = user?.role === 'axis_admin';

  const allDone    = checklist.every((s) => s.done);
  const doneCount  = checklist.filter((s) => s.done).length;
  const totalSteps = checklist.length;

  async function activate() {
    if (!canActivate || !allDone || activating) return;
    setActivating(true);
    setActivateErr(null);
    try {
      const res = await authFetch(`/api/haulers/${haulerId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `${res.status}`);
      onActivated?.();
    } catch (e) {
      setActivateErr(e.message);
    } finally {
      setActivating(false);
    }
  }

  const sortedChecklist = STEP_ORDER
    .map((step) => checklist.find((s) => s.step === step))
    .filter(Boolean);

  return (
    <div style={{ marginTop: 'var(--space-5)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow">Onboarding checklist</div>
        <span className="mono" style={{
          fontSize: 9,
          padding: '2px 6px',
          border: allDone
            ? '1px solid rgba(38, 160, 100, 0.3)'
            : '1px solid var(--border-soft)',
          borderRadius: 3,
          color: allDone ? 'var(--signal-green)' : 'var(--text-tertiary)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          {doneCount} / {totalSteps}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{
        height: 3,
        background: 'var(--border-hairline)',
        borderRadius: 2,
        marginBottom: 'var(--space-3)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${totalSteps > 0 ? (doneCount / totalSteps) * 100 : 0}%`,
          background: allDone ? 'var(--signal-green)' : 'var(--bauxite-rust)',
          borderRadius: 2,
          transition: 'width 300ms ease',
        }} />
      </div>

      {/* Checklist items */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        {sortedChecklist.map((item) => (
          <ChecklistItem
            key={item.step}
            item={item}
            haulerId={haulerId}
            onUpdated={setChecklist}
            canEdit={canEdit}
          />
        ))}
      </div>

      {/* Editable meta fields */}
      {canEdit && (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)', color: 'var(--text-tertiary)' }}>
            Contact & timeline
          </div>
          <MetaEditForm
            hauler={hauler}
            haulerId={haulerId}
            onUpdated={onUpdated}
          />
        </div>
      )}

      {/* Activate */}
      {canActivate && (
        <div style={{
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
        }}>
          {activateErr && (
            <div style={{
              marginBottom: 'var(--space-3)',
              padding: '8px 12px',
              background: 'rgba(139, 46, 26, 0.06)',
              border: '1px solid rgba(139, 46, 26, 0.22)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--signal-red)',
              fontSize: 'var(--ts-caption-size)',
            }}>
              {activateErr}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Button
              variant="primary"
              type="button"
              onClick={activate}
              disabled={!allDone || activating}
            >
              {activating ? 'Activating…' : 'Activate hauler'}
            </Button>
            {!allDone && (
              <span style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
              }}>
                Complete all {totalSteps} steps to enable activation.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}
