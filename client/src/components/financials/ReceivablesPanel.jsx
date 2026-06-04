/*
 * ReceivablesPanel — Phase 64.
 *
 * Per-band view of receivables ageing with chase log activity.
 * Each band renders as a tile showing the balance + followup count;
 * clicking expands an inline chase log + add-new form.
 *
 * Read-open to all financial-aware roles (axis_admin/ops/lender).
 * Writes restricted to axis_admin / axis_ops; lender sees the log
 * but not the add-new form. Hauler_admin doesn't see this panel
 * (no access to /financials).
 */

import { useCallback, useEffect, useState } from 'react';
import { Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const BANDS = [
  { id: 'band_0_30',  label: '0–30 days',  tone: 'text' },
  { id: 'band_31_60', label: '31–60 days', tone: 'amber' },
  { id: 'band_61_90', label: '61–90 days', tone: 'amber' },
  { id: 'band_90p',   label: '90+ days',   tone: 'rust' },
];

const OUTCOMES = [
  { id: 'committed',   label: 'Committed', tone: 'green' },
  { id: 'partial',     label: 'Partial',   tone: 'amber' },
  { id: 'no_response', label: 'No response', tone: 'rust' },
  { id: 'disputed',    label: 'Disputed',  tone: 'rust' },
  { id: 'collected',   label: 'Collected', tone: 'green' },
];

const ROLES_THAT_WRITE = new Set(['axis_admin', 'axis_ops']);

export default function ReceivablesPanel({ receivables, onMutate }) {
  const { user } = useAuth();
  const canWrite = user && ROLES_THAT_WRITE.has(user.role);
  const [expandedBand, setExpandedBand] = useState(null);

  if (!receivables) return null;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <div>
          <span className="eyebrow">Receivables ageing</span>
          <div style={{
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
            marginTop: 2,
          }}>
            ${receivables.current_balance_usd.toLocaleString()} on {receivables.terms_days}-day terms ·{' '}
            <span className="tabular" style={{
              color: receivables.overdue_pct >= 8 ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {receivables.overdue_pct}% overdue
            </span>
          </div>
        </div>
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0,
      }}>
        {BANDS.map((b) => {
          const balance = receivables.ageing[b.id] ?? 0;
          const followupCount = receivables.followup_counts?.[b.id] ?? 0;
          const isExpanded = expandedBand === b.id;
          const interactive = balance > 0 || followupCount > 0;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => interactive && setExpandedBand((id) => (id === b.id ? null : b.id))}
              disabled={!interactive}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRight: '1px solid var(--border-hairline)',
                background: isExpanded ? 'var(--accent-tint)' : 'transparent',
                cursor: interactive ? 'pointer' : 'default',
                textAlign: 'left',
                fontFamily: 'inherit',
                color: 'inherit',
                border: 'none',
                borderBottom: isExpanded ? '2px solid var(--bauxite-rust)' : 'none',
                transition: 'background 100ms ease',
              }}
            >
              <div className="micro" style={{
                color: b.tone === 'rust' ? 'var(--bauxite-rust)'
                     : b.tone === 'amber' ? 'var(--signal-amber)'
                     : 'var(--text-tertiary)',
                marginBottom: 4,
              }}>
                {b.label}
              </div>
              <div className="tabular" style={{
                fontSize: 'var(--ts-h3-size, 18px)',
                fontWeight: 'var(--fw-medium)',
                color: balance > 0 && b.tone === 'rust' ? 'var(--bauxite-rust)'
                     : balance > 0 && b.tone === 'amber' ? 'var(--signal-amber)'
                     : 'var(--text)',
              }}>
                ${(balance / 1000).toFixed(0)}k
              </div>
              <div style={{
                marginTop: 4,
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {followupCount > 0
                  ? `${followupCount} followup${followupCount === 1 ? '' : 's'}`
                  : (interactive ? 'No chase yet' : '—')}
                {interactive && (isExpanded
                  ? <ChevronUp size={11} strokeWidth={1.6} style={{ marginLeft: 'auto' }} />
                  : <ChevronDown size={11} strokeWidth={1.6} style={{ marginLeft: 'auto' }} />)}
              </div>
            </button>
          );
        })}
      </div>

      {expandedBand && (
        <BandChaseLog
          bandId={expandedBand}
          bandLabel={BANDS.find((b) => b.id === expandedBand)?.label}
          canWrite={canWrite}
          onMutate={onMutate}
        />
      )}
    </section>
  );
}

function BandChaseLog({ bandId, bandLabel, canWrite, onMutate }) {
  const { user } = useAuth();
  const [followups, setFollowups] = useState(null);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/financials/receivables/followups?band=${bandId}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setFollowups(j.followups ?? []);
    } catch (err) {
      setError(err.message);
    }
  }, [bandId]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    setError(null);
    try {
      const r = await authFetch(`/api/financials/receivables/followups/${id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      await load();
      onMutate?.();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{
      background: 'var(--surface)',
      borderTop: '1px solid var(--border-hairline)',
      padding: 'var(--space-4)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        Chase log · {bandLabel}
      </div>

      {error && (
        <div style={{
          padding: '6px 10px',
          background: 'rgba(139, 46, 26, 0.08)',
          color: 'var(--bauxite-rust)',
          fontSize: 'var(--ts-caption-size)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 8,
        }}>
          {error}
        </div>
      )}

      {!followups ? (
        <p style={{ margin: 0, fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Loading chase log…
        </p>
      ) : followups.length === 0 ? (
        <p style={{
          margin: '0 0 var(--space-3)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No collection activity logged for this band yet.
        </p>
      ) : (
        <ul style={{
          margin: '0 0 var(--space-3)', padding: 0, listStyle: 'none',
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          {followups.map((f) => (
            <li key={f.id} style={{
              padding: '8px 12px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-hairline)',
              borderLeft: `3px solid ${outcomeColor(f.outcome)}`,
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: outcomeColor(f.outcome), fontWeight: 'var(--fw-medium)',
                }}>
                  {OUTCOMES.find((o) => o.id === f.outcome)?.label ?? f.outcome}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono tabular" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                    {fmtTime(f.created_at)} · {f.author?.display_name}
                  </span>
                  {(user?.role === 'axis_admin' || f.author?.user_id === user?.id) && (
                    <button
                      type="button"
                      onClick={() => remove(f.id)}
                      title="Delete followup"
                      style={{
                        padding: 2, background: 'transparent', border: 'none',
                        cursor: 'pointer', color: 'var(--text-tertiary)',
                      }}
                    >
                      <Trash2 size={11} strokeWidth={1.6} />
                    </button>
                  )}
                </span>
              </div>
              <div style={{ color: 'var(--text)', marginTop: 4 }}>{f.notes}</div>
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <AddFollowupForm bandId={bandId} onAdded={() => { load(); onMutate?.(); }} />
      ) : (
        <p style={{
          margin: 0,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          Read-only. AXIS Ops or Admin can log new chase activity.
        </p>
      )}
    </div>
  );
}

function AddFollowupForm({ bandId, onAdded }) {
  const [outcome, setOutcome] = useState('committed');
  const [notes, setNotes]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState(null);

  const submit = async (e) => {
    e?.preventDefault?.();
    const trimmed = notes.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch('/api/financials/receivables/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ band_id: bandId, outcome, notes: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setNotes('');
      onAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} style={{
      padding: '8px 12px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {error && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--bauxite-rust)',
        }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          style={selectStyle}
        >
          {OUTCOMES.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Log chase activity (call, email, meeting)…"
          maxLength={1000}
          style={inputStyle}
        />
        <button
          type="submit"
          disabled={submitting || !notes.trim()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            background: notes.trim() ? 'var(--bauxite-rust)' : 'var(--surface)',
            color: notes.trim() ? 'var(--bone)' : 'var(--text-tertiary)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-sm)',
            cursor: notes.trim() ? 'pointer' : 'default',
            fontSize: 'var(--ts-caption-size)',
            fontFamily: 'inherit',
          }}
        >
          <Send size={11} strokeWidth={1.8} />
          Log
        </button>
      </div>
    </form>
  );
}

function outcomeColor(outcome) {
  const o = OUTCOMES.find((x) => x.id === outcome);
  if (o?.tone === 'green') return 'var(--signal-green)';
  if (o?.tone === 'amber') return 'var(--signal-amber)';
  if (o?.tone === 'rust')  return 'var(--bauxite-rust)';
  return 'var(--text-tertiary)';
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'UTC',
  }) + ' UTC';
}

const inputStyle = {
  flex: 1,
  padding: '4px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};
const selectStyle = {
  padding: '4px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};
