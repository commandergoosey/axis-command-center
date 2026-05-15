/*
 * LicencePipeline — 90-day expiry pipeline. Rows sorted by days-remaining
 * ascending. <15 days = Bauxite Rust, <30 days = Amber, otherwise Iron.
 *
 * Phase 33 — rows are now click-to-renew for axis_admin/axis_ops. An
 * inline panel captures the new expiry + DVLA reference; POSTing to
 * /api/compliance/licences/:id/renew writes the overlay row, bubbles
 * up via onRenewed so the parent reloads, and the pipeline snaps to
 * the fresh pipeline (renewed licences with expiry >90 d drop off).
 */

import { useState } from 'react';
import { ShieldCheck, Clock } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const ROLES_THAT_RENEW = new Set(['axis_admin', 'axis_ops']);

export default function LicencePipeline({ items, onRenewed }) {
  const { user } = useAuth();
  const canRenew = user && ROLES_THAT_RENEW.has(user.role);
  const [openId, setOpenId] = useState(null);

  if (!items?.length) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{ marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Driver licence &amp; medical pipeline · 90 days</div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
          Expiring documents in the next 90 days. Drivers come off the roster automatically on expiry day; coaching flags at 30 days. {canRenew && 'Click a row to record a DVLA renewal.'}
        </div>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((l) => {
          const tone = l.days_remaining < 15 ? 'var(--bauxite-rust)'
                    : l.days_remaining < 30 ? 'var(--signal-amber)'
                    : 'var(--iron)';
          const isOpen = openId === l.id;
          return (
            <div key={l.id} style={{ borderTop: '1px solid var(--border-hairline)' }}>
              <button
                type="button"
                onClick={() => canRenew && setOpenId(isOpen ? null : l.id)}
                disabled={!canRenew}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.2fr 1fr 1.2fr 0.9fr 0.8fr 0.6fr',
                  gap: 'var(--space-3)',
                  alignItems: 'baseline',
                  padding: '12px 0',
                  fontSize: 'var(--ts-body-sm-size)',
                  background: 'transparent',
                  border: 'none',
                  width: '100%',
                  textAlign: 'left',
                  cursor: canRenew ? 'pointer' : 'default',
                  color: 'inherit',
                }}
              >
                <span style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{l.driver}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{l.hauler_display_name}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{l.document}</span>
                <span className="mono" style={{ color: 'var(--text-secondary)' }}>
                  {formatDate(l.expiry)}
                  {l.renewed && (
                    <span style={{ color: 'var(--signal-green)', marginLeft: 6, fontSize: 10 }}>
                      <ShieldCheck size={10} style={{ verticalAlign: '-1px' }} /> renewed
                    </span>
                  )}
                </span>
                <span className="tabular" style={{ color: tone, textAlign: 'right', fontWeight: 'var(--fw-medium)' }}>
                  {l.days_remaining} d
                </span>
                <span className="mono" style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  textAlign: 'right',
                  letterSpacing: '0.06em',
                  visibility: canRenew ? 'visible' : 'hidden',
                }}>
                  {canRenew ? (isOpen ? '− CLOSE' : '+ RENEW') : ''}
                </span>
              </button>

              {isOpen && canRenew && (
                <RenewPanel
                  licence={l}
                  onCancel={() => setOpenId(null)}
                  onDone={() => {
                    setOpenId(null);
                    onRenewed?.();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RenewPanel({ licence, onCancel, onDone }) {
  const [expiry, setExpiry]   = useState(defaultExpiry(licence.document));
  const [refNum, setRefNum]   = useState('');
  const [note, setNote]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!expiry) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/licences/${licence.id}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiry_iso: new Date(expiry).toISOString(),
          ref_number: refNum.trim() || undefined,
          note: note.trim() || undefined,
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
    <form
      onSubmit={submit}
      style={{
        padding: 'var(--space-3) var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-2)',
        background: 'var(--surface-sunk)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
        gap: 'var(--space-3)',
      }}>
        <div className="eyebrow" style={{ color: 'var(--text-secondary)' }}>
          <Clock size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />
          Record renewal · {licence.driver}
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
          }}
        >
          Cancel
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-3)',
      }}>
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
        <label style={labelStyle}>
          <span>DVLA REFERENCE</span>
          <input
            type="text"
            placeholder="e.g. DVLA-E-887214"
            value={refNum}
            onChange={(e) => setRefNum(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <label style={{ ...labelStyle, marginBottom: 'var(--space-3)' }}>
        <span>NOTE</span>
        <textarea
          rows={2}
          placeholder="Renewal context — DVLA branch, tests passed, escort dispatcher…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={textareaStyle}
        />
      </label>

      {error && (
        <div style={{
          padding: '8px 12px',
          marginBottom: 'var(--space-3)',
          background: 'rgba(139, 46, 26, 0.06)',
          border: '1px solid rgba(139, 46, 26, 0.22)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-red)',
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={busy || !expiry}
          style={{
            padding: '8px 16px',
            background: busy ? 'var(--ash)' : 'var(--bauxite-rust)',
            color: busy ? 'var(--text-tertiary)' : '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Saving…' : 'Record renewal'}
        </button>
      </div>
    </form>
  );
}

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
  padding: '8px 10px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  textTransform: 'none',
  letterSpacing: 'normal',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  lineHeight: 1.4,
};

// Best-guess default renewal horizon per document type. Operator can
// always overwrite before submitting.
function defaultExpiry(document) {
  const now = new Date();
  const years = /medical/i.test(document || '') ? 1 : 2; // Class E = 2y; medical = 1y
  const next = new Date(now);
  next.setFullYear(now.getFullYear() + years);
  return next.toISOString().slice(0, 10);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
