/*
 * GateChecklist — gate-by-gate detail for the selected tranche.
 * Met gates get a Signal Green tick; outstanding gates get an Iron ring.
 * The header summarises met/total and date posture.
 *
 * Phase 97 — Drawdown request workflow appended below the gate list.
 *   axis_admin / axis_ops  : submit a drawdown request when all gates close.
 *   lender                 : approve / reject / request-info on pending requests.
 *   hauler_admin           : read-only view of the current request status.
 */

import { useState, useEffect, useCallback } from 'react';
import { Check, Circle, Send, CheckCircle2, XCircle, MessageSquare, Loader } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

/* ─── Public component ──────────────────────────────────────────── */

export default function GateChecklist({ tranche }) {
  const { user } = useAuth();
  const [request, setRequest]         = useState(undefined); // undefined = not loaded
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState(null);

  const fetchRequest = useCallback(async () => {
    if (!tranche) return;
    try {
      const res = await authFetch(`/api/tranches/${tranche.id}/drawdown`);
      if (!res.ok) { setRequest(null); return; }
      const body = await res.json();
      setRequest(body.request); // null if none submitted
    } catch {
      setRequest(null);
    }
  }, [tranche]);

  useEffect(() => { fetchRequest(); }, [fetchRequest]);

  if (!tranche) return null;
  const allMet = tranche.all_gates_met;

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
        alignItems: 'flex-start',
        marginBottom: 'var(--space-3)',
        gap: 'var(--space-3)',
      }}>
        <div>
          <div className="eyebrow">Decision gates · {tranche.name}</div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', marginTop: 2 }}>
            Drawdown conditions per the lender side letter. All must close before next draw.
          </div>
        </div>
        <div style={{
          padding: '4px 10px',
          background: allMet ? 'rgba(46, 107, 63, 0.10)' : 'var(--surface-sunk)',
          color:      allMet ? 'var(--signal-green)' : 'var(--text)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          fontWeight: 'var(--fw-medium)',
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}>
          {tranche.gates_met} / {tranche.gates_total} {allMet ? '· eligible to draw' : 'gates closed'}
        </div>
      </header>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {tranche.gates.map((g) => <GateRow key={g.id} gate={g} />)}
      </ul>

      <footer style={{
        display: 'flex',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-4)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px solid var(--border-hairline)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>Start · <span className="mono" style={{ color: 'var(--text)' }}>{formatDate(tranche.start_date)}</span></span>
        <span>Steady state · <span className="mono" style={{ color: 'var(--text)' }}>{formatDate(tranche.steady_state_date)}</span></span>
      </footer>

      {/* ── Phase 97: Drawdown request panel ─────────────────────── */}
      {/* Skip for tranches already fully drawn (capex_drawn_usd == capex_usd). */}
      {request !== undefined && tranche.capex_drawn_usd < tranche.capex_usd && (
        <DrawdownPanel
          tranche={tranche}
          user={user}
          request={request}
          loading={loading}
          err={err}
          setErr={setErr}
          setLoading={setLoading}
          onRefresh={fetchRequest}
        />
      )}
    </section>
  );
}

/* ─── Drawdown panel — context-aware per role ───────────────────── */

function DrawdownPanel({ tranche, user, request, loading, err, setErr, setLoading, onRefresh }) {
  if (!user) return null;

  const role = user.role;

  // No request yet
  if (!request) {
    if (role === 'axis_admin' || role === 'axis_ops') {
      return (
        <SubmitForm
          tranche={tranche}
          loading={loading}
          err={err}
          setErr={setErr}
          setLoading={setLoading}
          onRefresh={onRefresh}
        />
      );
    }
    // lender / hauler_admin — nothing to show until AXIS submits
    return (
      <div style={pendingNoticeStyle}>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          No drawdown request submitted for this tranche.
        </span>
      </div>
    );
  }

  // Request exists — show status card
  return (
    <RequestCard
      tranche={tranche}
      user={user}
      request={request}
      loading={loading}
      err={err}
      setErr={setErr}
      setLoading={setLoading}
      onRefresh={onRefresh}
    />
  );
}

/* ─── Submit form (axis_admin / axis_ops) ────────────────────────── */

function SubmitForm({ tranche, loading, err, setErr, setLoading, onRefresh }) {
  const [open, setOpen]     = useState(false);
  const [amount, setAmount] = useState(String(tranche.capex_usd || ''));
  const [notes, setNotes]   = useState('');

  if (!tranche.all_gates_met) {
    return (
      <div style={pendingNoticeStyle}>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          All gate conditions must close before a drawdown request can be submitted.
        </span>
      </div>
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr('Enter a valid amount in USD.'); return; }
    setLoading(true);
    try {
      const res = await authFetch(`/api/tranches/${tranche.id}/drawdown`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount_usd: amt, notes }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body.error || 'Submission failed'); return; }
      setOpen(false);
      onRefresh();
    } catch {
      setErr('Network error — request not sent.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-hairline)' }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 16px',
            background: 'var(--bauxite-rust)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--ts-body-sm-size)',
            fontWeight: 'var(--fw-medium)',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <Send size={13} strokeWidth={1.8} />
          Request drawdown
        </button>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)', marginBottom: 2 }}>
            Submit drawdown request · {tranche.name}
          </div>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Draw amount (USD)</span>
            <div style={{ position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 12, color: 'var(--text-secondary)',
              }}>$</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ ...inputStyle, paddingLeft: 22 }}
                required
              />
            </div>
          </label>

          <label style={labelStyle}>
            <span style={labelTextStyle}>Supporting notes <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span></span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Describe deployment plan, timeline, and any conditions..."
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </label>

          {err && <ErrorNote msg={err} />}

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '7px 16px',
                background: loading ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
                color: loading ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                fontFamily: 'inherit',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading
                ? <><Loader size={13} strokeWidth={1.8} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</>
                : <><Send size={13} strokeWidth={1.8} /> Send to GIBDLC</>
              }
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(null); }}
              style={ghostBtnStyle}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ─── Request status card (all roles once submitted) ────────────── */

function RequestCard({ tranche, user, request, loading, err, setErr, setLoading, onRefresh }) {
  const [responseNote, setResponseNote] = useState('');
  const [actionOpen, setActionOpen]     = useState(false);

  const role = user.role;

  async function handleRespond(status) {
    setErr(null);
    setLoading(true);
    try {
      const res = await authFetch(`/api/tranches/${tranche.id}/drawdown`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status, response_note: responseNote }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body.error || 'Response failed'); return; }
      setActionOpen(false);
      onRefresh();
    } catch {
      setErr('Network error — response not sent.');
    } finally {
      setLoading(false);
    }
  }

  const STATUS_META = {
    pending:        { label: 'Pending lender review',    color: 'var(--signal-amber)', bg: 'rgba(217,158,55,0.08)'  },
    approved:       { label: 'Approved',                 color: 'var(--signal-green)', bg: 'rgba(46,107,63,0.08)'   },
    rejected:       { label: 'Rejected',                 color: 'var(--signal-red)',   bg: 'rgba(180,40,30,0.08)'   },
    info_requested: { label: 'More info requested',      color: 'var(--signal-amber)', bg: 'rgba(217,158,55,0.08)'  },
  };
  const meta = STATUS_META[request.status] || STATUS_META.pending;

  // Can AXIS re-submit? Only if rejected or info_requested
  const canResubmit = (role === 'axis_admin' || role === 'axis_ops')
    && (request.status === 'rejected' || request.status === 'info_requested');

  return (
    <div style={{
      marginTop: 'var(--space-4)',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--border-hairline)',
    }}>
      <div style={{
        background: meta.bg,
        border: `1px solid ${meta.color}33`,
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3) var(--space-4)',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            DRAWDOWN REQUEST · {tranche.name.toUpperCase()}
          </span>
          <span style={{
            fontSize: 'var(--ts-caption-size)',
            fontWeight: 'var(--fw-medium)',
            color: meta.color,
            letterSpacing: '0.04em',
          }}>
            {meta.label.toUpperCase()}
          </span>
        </div>

        {/* Amount + submitted by */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', marginBottom: 8 }}>
          <DataPair label="Amount" value={`$${(request.amount_usd / 1_000_000).toFixed(1)}M`} mono />
          <DataPair label="Submitted by" value={request.requested_by_name} />
          <DataPair label="Submitted" value={formatDateTime(request.requested_at)} />
        </div>

        {/* Notes */}
        {request.notes && (
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            marginBottom: request.responded_at ? 8 : 0,
          }}>
            {request.notes}
          </div>
        )}

        {/* Lender response */}
        {request.responded_at && (
          <div style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px solid ${meta.color}33`,
          }}>
            <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', marginBottom: 4 }}>
              <DataPair label="Responded by" value={request.responded_by_name} />
              <DataPair label="On" value={formatDateTime(request.responded_at)} />
            </div>
            {request.response_note && (
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {request.response_note}
              </div>
            )}
          </div>
        )}

        {/* Error banner */}
        {err && <ErrorNote msg={err} />}

        {/* Lender actions — only on pending */}
        {role === 'lender' && request.status === 'pending' && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {!actionOpen ? (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  onClick={() => handleRespond('approved')}
                  disabled={loading}
                  style={{ ...actionBtnStyle, background: 'rgba(46,107,63,0.12)', color: 'var(--signal-green)', border: '1px solid rgba(46,107,63,0.3)' }}
                >
                  <CheckCircle2 size={13} strokeWidth={1.8} />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => handleRespond('rejected')}
                  disabled={loading}
                  style={{ ...actionBtnStyle, background: 'rgba(180,40,30,0.08)', color: 'var(--signal-red)', border: '1px solid rgba(180,40,30,0.25)' }}
                >
                  <XCircle size={13} strokeWidth={1.8} />
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setActionOpen(true)}
                  disabled={loading}
                  style={{ ...actionBtnStyle, background: 'var(--surface-sunk)', color: 'var(--text-secondary)', border: '1px solid var(--border-hairline)' }}
                >
                  <MessageSquare size={13} strokeWidth={1.8} />
                  Request info
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <textarea
                  value={responseNote}
                  onChange={(e) => setResponseNote(e.target.value)}
                  rows={2}
                  placeholder="Describe what additional information is required…"
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    onClick={() => handleRespond('info_requested')}
                    disabled={loading || !responseNote.trim()}
                    style={{
                      ...actionBtnStyle,
                      background: loading || !responseNote.trim() ? 'var(--surface-sunk)' : 'rgba(217,158,55,0.12)',
                      color: loading || !responseNote.trim() ? 'var(--text-tertiary)' : 'var(--signal-amber)',
                      border: '1px solid rgba(217,158,55,0.3)',
                    }}
                  >
                    {loading
                      ? <Loader size={13} strokeWidth={1.8} style={{ animation: 'spin 1s linear infinite' }} />
                      : <MessageSquare size={13} strokeWidth={1.8} />
                    }
                    Send request
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActionOpen(false); setErr(null); }}
                    style={ghostBtnStyle}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* AXIS re-submit option when rejected / info requested */}
        {canResubmit && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <ResubmitForm tranche={tranche} loading={loading} setLoading={() => {}} err={null} setErr={setErr} onRefresh={onRefresh} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Re-submit form (after rejection / info_requested) ─────────── */

function ResubmitForm({ tranche, err, setErr, onRefresh }) {
  const [open, setOpen]     = useState(false);
  const [amount, setAmount] = useState(String(tranche.capex_usd || ''));
  const [notes, setNotes]   = useState('');
  const [busy, setBusy]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr('Enter a valid amount in USD.'); return; }
    setBusy(true);
    try {
      const res = await authFetch(`/api/tranches/${tranche.id}/drawdown`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount_usd: amt, notes }),
      });
      const body = await res.json();
      if (!res.ok) { setErr(body.error || 'Re-submission failed'); return; }
      setOpen(false);
      onRefresh();
    } catch {
      setErr('Network error — request not sent.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...ghostBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 'var(--ts-caption-size)' }}
      >
        <Send size={12} strokeWidth={1.8} />
        Resubmit updated request
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <label style={labelStyle}>
        <span style={labelTextStyle}>Draw amount (USD)</span>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-secondary)' }}>$</span>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, paddingLeft: 22 }} required />
        </div>
      </label>
      <label style={labelStyle}>
        <span style={labelTextStyle}>Updated notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Address the lender's information request…" style={{ ...inputStyle, resize: 'vertical' }} />
      </label>
      {err && <ErrorNote msg={err} />}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button type="submit" disabled={busy} style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '6px 14px',
          background: busy ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
          color: busy ? 'var(--text-tertiary)' : '#fff',
          border: 'none', borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)', fontFamily: 'inherit', cursor: busy ? 'not-allowed' : 'pointer',
        }}>
          {busy ? <Loader size={12} /> : <Send size={12} />}
          {busy ? 'Sending…' : 'Resubmit'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setErr(null); }} style={ghostBtnStyle}>Cancel</button>
      </div>
    </form>
  );
}

/* ─── Gate row (unchanged) ──────────────────────────────────────── */

function GateRow({ gate }) {
  const Icon = gate.met ? Check : Circle;
  const color = gate.met ? 'var(--signal-green)' : 'var(--iron)';
  return (
    <li style={{
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      padding: '10px var(--space-3)',
      background: gate.met ? 'rgba(46, 107, 63, 0.04)' : 'var(--surface-sunk)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <Icon size={16} strokeWidth={1.6} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
      <span style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: gate.met ? 'var(--text-secondary)' : 'var(--text)',
        textDecoration: gate.met ? 'line-through' : 'none',
        textDecorationColor: 'var(--text-tertiary)',
        lineHeight: 1.5,
      }}>
        {gate.body}
      </span>
    </li>
  );
}

/* ─── Small utilities ──────────────────────────────────────────── */

function DataPair({ label, value, mono }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>{value}</div>
    </div>
  );
}

function ErrorNote({ msg }) {
  return (
    <div style={{
      marginTop: 4,
      padding: '6px 10px',
      background: 'rgba(180,40,30,0.08)',
      border: '1px solid rgba(180,40,30,0.25)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--ts-caption-size)',
      color: 'var(--signal-red)',
    }}>
      {msg}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Accra',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/* ─── Shared style tokens ───────────────────────────────────────── */

const pendingNoticeStyle = {
  marginTop: 'var(--space-4)',
  paddingTop: 'var(--space-3)',
  borderTop: '1px solid var(--border-hairline)',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const labelTextStyle = {
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-secondary)',
  letterSpacing: '0.02em',
};

const inputStyle = {
  width: '100%',
  padding: '7px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const actionBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 13px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const ghostBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};
