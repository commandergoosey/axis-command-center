/*
 * QuickAction — inline close-out forms surfaced on Today.
 *
 * Phase 36 — three of the action items the cockpit shows are
 * single-write closes (mark a filing as filed, renew a licence, close
 * an HSE incident with a corrective action). Rather than punting the
 * operator to the source page, ActionItems expands this form
 * underneath the row. The component switches on item.source.type and
 * posts to the same endpoints used by the page-level forms so the
 * audit + lifecycle behaviour is identical.
 */

import { useState } from 'react';
import { Clock, ShieldCheck, FileCheck2 } from 'lucide-react';
import { authFetch } from '../../lib/auth';

export const INLINE_ACTION_TYPES = new Set(['filing', 'licence', 'hse_incident']);

export default function QuickAction({ item, onCancel, onDone }) {
  switch (item.source?.type) {
    case 'filing':       return <FilingForm  item={item} onCancel={onCancel} onDone={onDone} />;
    case 'licence':      return <LicenceForm item={item} onCancel={onCancel} onDone={onDone} />;
    case 'hse_incident': return <HseForm     item={item} onCancel={onCancel} onDone={onDone} />;
    default:             return null;
  }
}

// ── Filing — POST /api/compliance/filings/:id/mark-filed ───────────
function FilingForm({ item, onCancel, onDone }) {
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/filings/${item.source.id}/mark-filed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `mark-filed ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <FormShell
      icon={<FileCheck2 size={10} />}
      title="Mark as filed"
      onCancel={onCancel}
      onSubmit={submit}
      busy={busy}
      error={error}
      submitLabel={busy ? 'Saving…' : 'Mark filed'}
    >
      <p style={bodyStyle}>
        Confirms the regulator has accepted this submission. Stamps the
        filing with your name + the current server time, and writes an
        audit row.
      </p>
    </FormShell>
  );
}

// ── Licence — POST /api/compliance/licences/:id/renew ──────────────
function LicenceForm({ item, onCancel, onDone }) {
  // Default expiry: 2 years out for Class E, 1 year for medical.
  // The action item body carries the document type; pattern-match it.
  const isMedical = /medical/i.test(item.body);
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() + (isMedical ? 1 : 2));

  const [expiry, setExpiry] = useState(defaultDate.toISOString().slice(0, 10));
  const [refNum, setRefNum] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!expiry) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/licences/${item.source.id}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiry_iso: new Date(expiry).toISOString(),
          ref_number: refNum.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `renew ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <FormShell
      icon={<Clock size={10} />}
      title="Record DVLA renewal"
      onCancel={onCancel}
      onSubmit={submit}
      busy={busy}
      error={error}
      submitLabel={busy ? 'Saving…' : 'Record renewal'}
      submitDisabled={!expiry}
    >
      <label style={labelStyle}>
        <span>NEW EXPIRY *</span>
        <input
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          required
          min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
          style={inputStyle}
        />
      </label>
      <label style={{ ...labelStyle, marginTop: 'var(--space-2)' }}>
        <span>DVLA REFERENCE</span>
        <input
          type="text"
          placeholder="e.g. DVLA-E-887214"
          value={refNum}
          onChange={(e) => setRefNum(e.target.value)}
          style={inputStyle}
        />
      </label>
    </FormShell>
  );
}

// ── HSE — POST /api/compliance/incidents/:id/close ─────────────────
function HseForm({ item, onCancel, onDone }) {
  const [action, setAction] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!action.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/incidents/${item.source.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrective_action: action.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `close ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <FormShell
      icon={<ShieldCheck size={10} />}
      title="Close incident"
      onCancel={onCancel}
      onSubmit={submit}
      busy={busy}
      error={error}
      submitLabel={busy ? 'Saving…' : 'Close incident'}
      submitDisabled={!action.trim()}
    >
      <label style={labelStyle}>
        <span>CORRECTIVE ACTION *</span>
        <textarea
          rows={3}
          placeholder="Driver suspended pending retraining; convoy speed cap at km 180–185…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={textareaStyle}
        />
      </label>
    </FormShell>
  );
}

// ── Shared shell ───────────────────────────────────────────────────

function FormShell({ icon, title, onCancel, onSubmit, busy, error, submitLabel, submitDisabled, children }) {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        padding: '12px',
        marginTop: 'var(--space-2)',
        background: 'var(--surface-sunk)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-2)',
      }}>
        <div className="eyebrow" style={{ color: 'var(--text-secondary)' }}>
          <span style={{ marginRight: 4, verticalAlign: '-1px' }}>{icon}</span>
          {title}
        </div>
        <button
          type="button"
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--ts-caption-size)',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Cancel
        </button>
      </div>

      {children}

      {error && (
        <div style={{
          padding: '6px 10px',
          marginTop: 'var(--space-2)',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
        <button
          type="submit"
          disabled={busy || submitDisabled}
          style={{
            padding: '6px 14px',
            background: busy || submitDisabled ? 'var(--ash)' : 'var(--bauxite-rust)',
            color: busy || submitDisabled ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            cursor: busy || submitDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  letterSpacing: '0.08em',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text-tertiary)',
  textTransform: 'uppercase',
};

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.4,
};

const bodyStyle = {
  margin: 0,
  fontSize: 'var(--ts-body-sm-size)',
  lineHeight: 'var(--ts-body-sm-lh)',
  color: 'var(--text-secondary)',
};
