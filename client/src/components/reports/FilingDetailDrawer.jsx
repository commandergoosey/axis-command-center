/*
 * FilingDetailDrawer — right-anchored drawer for a regulatory filing.
 * Fetches enriched detail on open (owner, regulator desk, evidence
 * checklist, trailing submission history). AXIS admin/ops can fire a
 * "Mark filed" action that flips DUE/ON_TRACK → FILED server-side.
 */

import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import { can } from '../../lib/auth';

import { useEffect, useState } from 'react';
import { X, CheckCircle2, Circle, Send, Mail, Phone, UserRound } from 'lucide-react';

const STATUS_TONE = {
  FILED:    { bg: 'rgba(46, 107, 63, 0.08)',  color: 'var(--signal-green)', border: 'rgba(46, 107, 63, 0.3)' },
  ON_TRACK: { bg: 'var(--accent-tint)',        color: 'var(--text-secondary)', border: 'var(--border-hairline)' },
  DUE:      { bg: 'rgba(217, 158, 55, 0.08)', color: 'var(--signal-amber)', border: 'rgba(217, 158, 55, 0.3)' },
  OVERDUE:  { bg: 'rgba(139, 46, 26, 0.08)',  color: 'var(--bauxite-rust)', border: 'rgba(139, 46, 26, 0.3)' },
  UPCOMING: { bg: 'var(--accent-tint)',        color: 'var(--text-tertiary)', border: 'var(--border-hairline)' },
  LATE:     { bg: 'rgba(139, 46, 26, 0.08)',  color: 'var(--bauxite-rust)', border: 'rgba(139, 46, 26, 0.3)' },
};

function StatusChip({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.ON_TRACK;
  return (
    <span className="mono" style={{
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      padding: '2px 8px',
      background: tone.bg,
      color:  tone.color,
      border: `1px solid ${tone.border}`,
      borderRadius: 2,
      whiteSpace: 'nowrap',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function fmtDue(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export default function FilingDetailDrawer({ filingId, onClose, onFiled }) {
  const { user } = useAuth();
  const mayFile  = can(user?.role, 'generateReport');

  const [detail, setDetail] = useState(null);
  const [error,  setError]  = useState(null);
  const [busy,   setBusy]   = useState(false);

  useEffect(() => {
    if (!filingId) return;
    let cancelled = false;
    setDetail(null);
    setError(null);
    (async () => {
      try {
        const res = await authFetch(`/api/compliance/filings/${filingId}`);
        if (!res.ok) throw new Error(`filing ${res.status}`);
        const body = await res.json();
        if (!cancelled) setDetail(body);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [filingId]);

  if (!filingId) return null;

  async function markFiled() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/compliance/filings/${filingId}/mark-filed`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `mark-filed ${res.status}`);
      }
      const body = await res.json();
      setDetail(body.filing);
      onFiled?.(body.filing);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 31, 31, 0.38)',
        zIndex: 40,
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          background: 'var(--bone)',
          borderLeft: '1px solid var(--border-hairline)',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          overflow: 'auto',
          animation: 'fade-up 200ms ease-out',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">Regulatory filing</span>
            <h2 style={{ margin: 0, fontSize: 'var(--ts-h3-size)', lineHeight: 'var(--ts-h3-lh)' }}>
              {detail?.agency ?? '…'}
            </h2>
            {detail && (
              <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 'var(--ts-body-sm-size)' }}>
                {detail.detail}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}>
            <X size={18} strokeWidth={1.6} />
          </button>
        </header>

        {error && !detail && (
          <div style={rustErrorStyle}>Failed to load — {error}</div>
        )}

        {!detail && !error && (
          <p style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', margin: 0 }}>
            Loading filing…
          </p>
        )}

        {detail && (
          <>
            <section style={summaryCardStyle}>
              <div style={summaryRowStyle}>
                <span className="eyebrow">Status</span>
                <StatusChip status={detail.status} />
              </div>
              <div style={summaryRowStyle}>
                <span className="eyebrow">Due</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>
                  {fmtDue(detail.due)}
                </span>
              </div>
              {detail.submitted_at && (
                <div style={summaryRowStyle}>
                  <span className="eyebrow">Submitted</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>
                    {new Date(detail.submitted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {detail.submitted_by ? ` · ${detail.submitted_by}` : ''}
                  </span>
                </div>
              )}
            </section>

            <section>
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Counterparties</div>
              <div style={contactCardStyle}>
                <div style={contactRowStyle}>
                  <UserRound size={12} strokeWidth={1.6} color="var(--iron)" />
                  <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                    {detail.internal_owner}
                  </span>
                </div>
                <div style={contactRowStyle}>
                  <Mail size={12} strokeWidth={1.6} color="var(--iron)" />
                  <a href={`mailto:${detail.regulator_desk}`} style={contactLinkStyle}>
                    {detail.regulator_desk}
                  </a>
                </div>
                <div style={contactRowStyle}>
                  <Phone size={12} strokeWidth={1.6} color="var(--iron)" />
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {detail.phone}
                  </span>
                </div>
              </div>
            </section>

            <section>
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
                Evidence required · {detail.evidence_required?.length ?? 0}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(detail.evidence_required ?? []).map((label) => {
                  const checked = detail.status === 'FILED';
                  return (
                    <li key={label} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 'var(--ts-body-sm-size)',
                      color: checked ? 'var(--text-tertiary)' : 'var(--text)',
                      textDecoration: checked ? 'line-through' : 'none',
                    }}>
                      {checked
                        ? <CheckCircle2 size={14} strokeWidth={1.6} color="var(--signal-green)" />
                        : <Circle       size={14} strokeWidth={1.6} color="var(--iron)" />}
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section>
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Submission history</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {(detail.submission_history ?? []).map((h) => (
                  <li key={h.period} style={historyRowStyle}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text)' }}>
                      {h.period}
                    </span>
                    <span style={{
                      fontSize: 'var(--ts-caption-size)',
                      color: 'var(--text-tertiary)',
                      textAlign: 'right',
                    }}>
                      {h.status === 'UPCOMING'
                        ? 'not yet due'
                        : h.days_to_due < 0
                          ? `${Math.abs(h.days_to_due)}d early`
                          : h.days_to_due === 0
                            ? 'on the day'
                            : `${h.days_to_due}d late`}
                    </span>
                    <StatusChip status={h.status} />
                  </li>
                ))}
              </ul>
            </section>

            {error && (
              <div style={rustErrorStyle}>Action failed — {error}</div>
            )}

            <footer style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-3)',
              marginTop: 'auto',
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <button type="button" onClick={onClose} style={secondaryBtnStyle}>
                Close
              </button>
              {detail.status !== 'FILED' && mayFile && (
                <button
                  type="button"
                  onClick={markFiled}
                  disabled={busy}
                  style={{ ...primaryBtnStyle, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}
                >
                  <Send size={12} strokeWidth={1.8} />
                  {busy ? 'Marking…' : 'Mark filed'}
                </button>
              )}
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

const summaryCardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
};

const summaryRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'var(--space-3)',
};

const contactCardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
};

const contactRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const contactLinkStyle = {
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  textDecoration: 'none',
};

const historyRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1fr) auto',
  gap: 'var(--space-3)',
  alignItems: 'center',
  padding: '10px 0',
  borderTop: '1px solid var(--border-hairline)',
};

const rustErrorStyle = {
  padding: 'var(--space-2) var(--space-3)',
  background: 'rgba(139, 46, 26, 0.06)',
  border: '1px solid rgba(139, 46, 26, 0.2)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--bauxite-rust)',
};

const secondaryBtnStyle = {
  padding: '10px 16px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  cursor: 'pointer',
};

const primaryBtnStyle = {
  padding: '10px 20px',
  background: 'var(--bauxite-rust)',
  color: 'var(--bone)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  fontWeight: 'var(--fw-medium)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};
