/*
 * Claims — Phase 90.
 *
 * Insurance claims register. Distinct from HSE incidents
 * (Phase 12) and rig workorders (Phase 26): a claim is the
 * insurer-side workflow that follows an incident, with its own
 * lifecycle (filed → under_review → approved/denied → paid)
 * and its own paper trail.
 *
 * Role gate:
 *   - axis_admin / axis_ops: full read + write (transitions).
 *   - hauler_admin: read own only (no transitions).
 *   - lender: read all (claims affect DSCR via insurance
 *     recoveries — explicit credit-relevant input).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldQuestion, Check, X, FileText, ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import Modal from '../components/primitives/Modal';
import Button from '../components/primitives/Button';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import ClaimsExposureChart   from '../components/claims/ClaimsExposureChart';
import ClaimsMonthlyTrend   from '../components/claims/ClaimsMonthlyTrend';

const STATUS_TONE = {
  filed:        'var(--text-secondary)',
  under_review: 'var(--signal-amber)',
  approved:     'var(--signal-green)',
  paid:         'var(--signal-green)',
  denied:       'var(--bauxite-rust)',
};
const STATUS_LABEL = {
  filed:        'Filed',
  under_review: 'Under review',
  approved:     'Approved · pending payout',
  paid:         'Paid',
  denied:       'Denied',
};
const TYPE_LABEL = {
  third_party_liability: 'Third-party liability',
  rig_damage:            'Rig damage',
  cargo_loss:            'Cargo loss',
  medical:               'Medical',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function Claims() {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [transitioning, setTransitioning] = useState(null); // { claim, target: 'approved'|'denied'|'paid' }
  const [statusFilter, setStatusFilter] = useState(null);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/claims')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!data?.claims) return [];
    return data.claims.filter((c) => !statusFilter || c.status === statusFilter);
  }, [data, statusFilter]);

  return (
    <PageShell
      eyebrow="Capital"
      title="Insurance claims"
      description="Claim lifecycle — filed → review → approval → payment — for HSE incidents and rig damage. Insurance recoveries flow through the corridor's cash position; outstanding approved claims are real receivables."
    >
      {error && <div style={errorBox}>Claims feed unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <KpiStrip counts={data?.counts} />
        <FilterRow counts={data?.counts} statusFilter={statusFilter} setStatusFilter={setStatusFilter} />
        <ClaimsExposureChart exposureByType={data?.exposure_by_type} />
        {/* Phase 161 — 6-month claim frequency trend by category */}
        <ClaimsMonthlyTrend monthlyTrend={data?.monthly_trend} />

        {!data ? (
          <p style={muted}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={emptyBox}>No claims match the current filter.</p>
        ) : (
          <ClaimsList
            claims={filtered}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? null : id)}
            canWrite={canWrite}
            onTransition={(claim, target) => setTransitioning({ claim, target })}
          />
        )}
      </div>

      {transitioning && (
        <TransitionModal
          claim={transitioning.claim}
          target={transitioning.target}
          onClose={() => setTransitioning(null)}
          onSaved={() => { setTransitioning(null); load(); }}
        />
      )}
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ counts }) {
  const total       = counts?.total ?? 0;
  const inFlight    = (counts?.filed ?? 0) + (counts?.under_review ?? 0);
  const inFlightUsd = counts?.in_flight_amount_usd ?? 0;
  const pendingUsd  = counts?.approved_pending_payout_usd ?? 0;
  const paidUsd     = counts?.paid_amount_usd ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile label="Claims" value={total} sub="across visible scope" tone={total === 0 ? 'tertiary' : 'text'} />
      <Tile label="In flight" value={inFlight} sub={inFlightUsd > 0 ? `$${inFlightUsd.toLocaleString()} filed` : '—'} tone={inFlight > 0 ? 'amber' : 'green'} />
      <Tile label="Approved · pending payout" value={`$${pendingUsd.toLocaleString()}`} sub={`${counts?.approved ?? 0} claim${(counts?.approved ?? 0) === 1 ? '' : 's'}`} tone={pendingUsd > 0 ? 'green' : 'tertiary'} />
      <Tile label="Paid out · YTD" value={`$${paidUsd.toLocaleString()}`} sub={`${counts?.paid ?? 0} settled`} tone={paidUsd > 0 ? 'green' : 'tertiary'} />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ── Filter row ────────────────────────────────────────────────────

function FilterRow({ counts, statusFilter, setStatusFilter }) {
  const statuses = ['filed', 'under_review', 'approved', 'paid', 'denied'];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      flexWrap: 'wrap',
    }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>FILTER</span>
      <Chip label="All" active={!statusFilter} onClick={() => setStatusFilter(null)} />
      {statuses.map((s) => {
        const n = counts?.[s] ?? 0;
        if (n === 0) return null;
        return (
          <Chip
            key={s}
            label={`${STATUS_LABEL[s]} · ${n}`}
            tone={STATUS_TONE[s]}
            active={statusFilter === s}
            onClick={() => setStatusFilter((f) => f === s ? null : s)}
          />
        );
      })}
    </div>
  );
}

function Chip({ label, active, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${active ? (tone || 'var(--bauxite-rust)') : 'var(--border-hairline)'}`,
        borderRadius: 999,
        fontSize: 'var(--ts-caption-size)',
        color: active ? (tone || 'var(--bauxite-rust)') : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── List ──────────────────────────────────────────────────────────

function ClaimsList({ claims, openId, onToggle, canWrite, onTransition }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      {claims.map((c) => (
        <ClaimRow
          key={c.id}
          claim={c}
          expanded={openId === c.id}
          onToggle={() => onToggle(c.id)}
          canWrite={canWrite}
          onTransition={onTransition}
        />
      ))}
    </div>
  );
}

function ClaimRow({ claim: c, expanded, onToggle, canWrite, onTransition }) {
  const tone = STATUS_TONE[c.status] || 'var(--text)';
  return (
    <div style={{ borderBottom: '1px solid var(--border-hairline)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '12px 14px',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto auto auto',
          alignItems: 'center',
          columnGap: 12,
          background: 'transparent',
          border: 'none',
          borderLeft: `3px solid ${tone}`,
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        {expanded
          ? <ChevronDown size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
          : <ChevronRight size={14} strokeWidth={1.6} color="var(--text-tertiary)" />}
        <div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {c.id} · {TYPE_LABEL[c.type] || c.type}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {c.hauler_id} · filed {c.filed_at.slice(0, 10)} · {c.insurer}
          </div>
        </div>
        <span className="tabular" style={{
          fontSize: 'var(--ts-body-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          ${c.claim_amount_usd.toLocaleString()}
        </span>
        <StatusPill label={STATUS_LABEL[c.status]} tone={tone} />
        {c.approved_amount_usd != null && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            approved <span className="tabular">${c.approved_amount_usd.toLocaleString()}</span>
          </span>
        )}
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px 28px', background: 'var(--surface)' }}>
          <Detail claim={c} canWrite={canWrite} onTransition={onTransition} />
        </div>
      )}
    </div>
  );
}

function Detail({ claim: c, canWrite, onTransition }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 8 }}>
      <p style={{
        margin: 0,
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        lineHeight: 1.5,
      }}>
        {c.description}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <KvBlock label="Insurer" value={c.insurer} sub={c.policy_number} />
        <KvBlock label="Incident date" value={c.incident_date} sub={c.incident_ref ? `→ ${c.incident_ref}` : 'no linked incident'} />
        <KvBlock label="Filed" value={c.filed_at.slice(0, 10)} sub={c.filed_at.slice(11, 16) + ' UTC'} />
        <KvBlock label="Deductible" value={`$${c.deductible_usd.toLocaleString()}`} sub="hauler-borne" />
      </div>

      {c.notes && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderLeft: '3px solid var(--text-tertiary)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>NOTES</div>
          {c.notes}
        </div>
      )}

      {c.payment_ref && (
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Payment ref · <span className="mono" style={{ color: 'var(--text-secondary)' }}>{c.payment_ref}</span>
          {c.paid_at && <> · paid {c.paid_at.slice(0, 10)}</>}
        </div>
      )}

      {canWrite && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {c.status === 'filed' && (
            <button type="button" onClick={() => onTransition(c, 'under_review')} style={btnSecondary}>
              <FileText size={11} strokeWidth={1.6} /> Send to review
            </button>
          )}
          {(c.status === 'filed' || c.status === 'under_review') && (
            <>
              <button type="button" onClick={() => onTransition(c, 'approved')} style={btnPrimary}>
                <Check size={11} strokeWidth={1.6} /> Approve
              </button>
              <button type="button" onClick={() => onTransition(c, 'denied')} style={btnSecondary}>
                <X size={11} strokeWidth={1.6} /> Deny
              </button>
            </>
          )}
          {c.status === 'approved' && (
            <button type="button" onClick={() => onTransition(c, 'paid')} style={btnPrimary}>
              <Check size={11} strokeWidth={1.6} /> Mark paid
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KvBlock({ label, value, sub }) {
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)', marginTop: 2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, tone }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone, fontSize: 10, fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ── Transition modal ──────────────────────────────────────────────

function TransitionModal({ claim, target, onClose, onSaved }) {
  const [amount, setAmount] = useState(claim.approved_amount_usd ?? claim.claim_amount_usd);
  const [paymentRef, setPaymentRef] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [notes, setNotes] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState(null);

  const showAmount = target === 'approved';
  const showPayout = target === 'paid';

  async function save() {
    setPosting(true); setError(null);
    try {
      const body = {
        status: target,
        notes: notes.trim() || null,
      };
      if (showAmount) body.approved_amount_usd = Number(amount);
      if (showPayout) {
        body.payment_ref = paymentRef.trim() || null;
        body.paid_at = paidDate ? new Date(paidDate + 'T12:00:00Z').toISOString() : null;
      }
      const r = await authFetch(`/api/claims/${claim.id}/transition`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  const labelMap = {
    under_review: 'Send to review',
    approved:     'Approve claim',
    denied:       'Deny claim',
    paid:         'Mark as paid',
  };

  return (
    <Modal open onClose={onClose} width={520}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow">{labelMap[target]}</div>
          <h2 style={modalH2}>{claim.id}</h2>
          <p style={modalSub}>
            {TYPE_LABEL[claim.type]} · {claim.hauler_id} · {claim.insurer}
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {showAmount && (
            <Field label="Approved amount (USD)">
              <input
                type="number" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={inputStyle}
              />
            </Field>
          )}
          {showPayout && (
            <>
              <Field label="Payment reference">
                <input
                  type="text" value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. EI-PAYOUT-2026-088"
                  maxLength={120}
                  style={inputStyle}
                />
              </Field>
              <Field label="Paid date (optional)">
                <input
                  type="date" value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </>
          )}
          <Field label="Notes (optional)">
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              rows={3} maxLength={1000}
              placeholder="Anything to record alongside this transition…"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={modalFooter}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || 'Transition + notes are audit-logged. Lender pack reflects at next refresh.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={posting}>
              {posting ? 'Saving…' : labelMap[target]}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  boxSizing: 'border-box',
  width: '100%',
};
const muted = { color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' };
const errorBox = { padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-raised)', border: '1px solid var(--bauxite-rust)', borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: 'var(--ts-body-sm-size)' };
const emptyBox = { margin: 0, padding: 'var(--space-5)', background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center' };
const modalH2 = { margin: '4px 0 0', fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)' };
const modalSub = { margin: '4px 0 0', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' };
const modalFooter = { marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--bauxite-rust)', color: 'var(--bone)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'transparent', color: 'var(--bauxite-rust)', border: '1px solid var(--bauxite-rust)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', cursor: 'pointer', fontFamily: 'inherit' };
