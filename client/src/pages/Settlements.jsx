/*
 * Settlements — Phase 89.
 *
 * Per-hauler monthly settlement statements. Distinct from
 * Phase 64's receivables collection workflow (which tracks
 * GIBDLC → AXIS at the band level) — this page is AXIS → hauler
 * at the per-month invoice level.
 *
 * Role gate:
 *   - axis_admin / axis_ops: full ledger across all 5 haulers,
 *     mark-paid + dispute-resolution + per-statement notes.
 *   - hauler_admin: own hauler only; can dispute + add notes
 *     (but not mark-paid — that's an AXIS-side action).
 *   - lender: full read-only view for credit committee
 *     (overdue + disputed amounts surface in the lender pack
 *     too).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet, Check, AlertTriangle, X, ChevronDown, ChevronRight,
  RefreshCw, CheckCircle, Clock,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import Modal from '../components/primitives/Modal';
import Button from '../components/primitives/Button';
import SettlementAgeingStrip   from '../components/settlements/SettlementAgeingStrip';
import PaymentVelocityChart    from '../components/settlements/PaymentVelocityChart';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

const STATUS_TONE = {
  pending:  'var(--signal-amber)',
  paid:     'var(--signal-green)',
  partial:  'var(--signal-amber)',
  disputed: 'var(--bauxite-rust)',
};
const STATUS_LABEL = {
  pending:  'Pending',
  paid:     'Paid',
  partial:  'Partial',
  disputed: 'Disputed',
};

const PAY_ROLES    = new Set(['axis_admin', 'axis_ops']);
const DISPUTE_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

export default function Settlements() {
  const { user } = useAuth();
  const canMarkPaid = user && PAY_ROLES.has(user.role);
  const canDispute  = user && DISPUTE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [periodFilter, setPeriodFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [payingId, setPayingId] = useState(null);
  const [disputingId, setDisputingId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [ageing, setAgeing] = useState(null);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/settlements')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadAgeing = useCallback(() => {
    authFetch('/api/settlements/ageing')
      .then((r) => (r.ok ? r.json() : null))
      .then(setAgeing)
      .catch(() => {});
  }, []);

  useEffect(() => { loadAgeing(); }, [loadAgeing]);

  async function generateFortnightly() {
    setGenerating(true); setGenResult(null);
    try {
      const r = await authFetch('/api/settlements/generate-fortnightly', { method: 'POST' });
      const body = await r.json();
      setGenResult(body);
      load(); loadAgeing();
    } catch { /* ignored */ }
    finally { setGenerating(false); }
  }

  const filtered = useMemo(() => {
    if (!data?.statements) return [];
    return data.statements.filter((s) =>
      (!periodFilter || s.period === periodFilter) &&
      (!statusFilter || s.status === statusFilter),
    );
  }, [data, periodFilter, statusFilter]);

  return (
    <PageShell
      eyebrow="Capital"
      title="Settlements"
      description="Per-hauler invoices for their share of corridor revenue. Distinct from receivables (GIBDLC → AXIS); this is AXIS → hauler. Mark paid, dispute, resolve."
      actions={canMarkPaid && (
        <button type="button" onClick={generateFortnightly} disabled={generating} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          background: generating ? 'var(--surface-raised)' : 'var(--bauxite-rust)',
          color: generating ? 'var(--text-secondary)' : 'var(--bone)',
          border: '1px solid var(--bauxite-rust)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)',
          fontFamily: 'inherit', cursor: generating ? 'default' : 'pointer',
        }}>
          <RefreshCw size={12} strokeWidth={1.8} />
          {generating ? 'Generating…' : 'Generate fortnightly invoices'}
        </button>
      )}
    >
      {error && <div style={errorBox}>Settlements feed unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {genResult && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--signal-green)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>
              <CheckCircle size={13} strokeWidth={1.6} style={{ verticalAlign: 'middle', color: 'var(--signal-green)', marginRight: 6 }} />
              Generated {genResult.created} invoice{genResult.created !== 1 ? 's' : ''} for <strong>{genResult.label}</strong>
              {genResult.skipped > 0 && ` · ${genResult.skipped} already existed`}
              {' · '}effective tariff ${genResult.effective_rate?.toFixed(2)}/t
            </span>
            <button type="button" onClick={() => setGenResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }}>
              <X size={14} />
            </button>
          </div>
        )}
        <KpiStrip counts={data?.counts} />
        {/* Phase 142 — per-hauler ageing strip */}
        <SettlementAgeingStrip haulerAging={data?.hauler_aging} />
        {/* Phase 158 — invoiced vs paid by period */}
        <PaymentVelocityChart paymentVelocity={data?.payment_velocity} />
        {ageing && <AgeingPanel ageing={ageing} />}
        <FilterRow
          periods={data?.periods ?? []}
          statements={data?.statements ?? []}
          counts={data?.counts}
          periodFilter={periodFilter}
          setPeriodFilter={setPeriodFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
        />
        {!data ? (
          <p style={muted}>Loading…</p>
        ) : filtered.length === 0 ? (
          <p style={emptyBox}>No settlements match the current filters.</p>
        ) : (
          <SettlementsList
            statements={filtered}
            openId={openId}
            onToggle={(id) => setOpenId(openId === id ? null : id)}
            canMarkPaid={canMarkPaid}
            canDispute={canDispute}
            onPay={setPayingId}
            onDispute={setDisputingId}
            onResolve={setResolvingId}
          />
        )}
      </div>

      {payingId && (
        <MarkPaidModal
          statement={data.statements.find((s) => s.id === payingId)}
          onClose={() => setPayingId(null)}
          onSaved={() => { setPayingId(null); load(); }}
        />
      )}
      {disputingId && (
        <DisputeModal
          statement={data.statements.find((s) => s.id === disputingId)}
          onClose={() => setDisputingId(null)}
          onSaved={() => { setDisputingId(null); load(); loadAgeing(); }}
        />
      )}
      {resolvingId && (
        <ResolveDisputeModal
          statement={data.statements.find((s) => s.id === resolvingId)}
          onClose={() => setResolvingId(null)}
          onSaved={() => { setResolvingId(null); load(); loadAgeing(); }}
        />
      )}
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ counts }) {
  const total       = counts?.total       ?? 0;
  const pending     = counts?.pending     ?? 0;
  const disputed    = counts?.disputed    ?? 0;
  const outstanding = counts?.outstanding_usd ?? 0;
  const paid        = counts?.paid        ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile label="Statements" value={total} sub="across visible scope" tone="text" />
      <Tile label="Outstanding" value={`$${(outstanding / 1000).toFixed(0)}k`} sub={`${pending} pending`} tone={pending > 0 ? 'amber' : 'green'} />
      <Tile label="Disputed" value={disputed} sub={disputed > 0 ? `$${((counts?.disputed_usd || 0) / 1000).toFixed(0)}k contested` : 'none open'} tone={disputed > 0 ? 'rust' : 'green'} />
      <Tile label="Paid" value={paid} sub="settled this scope" tone={paid > 0 ? 'green' : 'tertiary'} />
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

function FilterRow({ periods, periodFilter, setPeriodFilter, statusFilter, setStatusFilter, counts }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 'var(--space-3)',
      alignItems: 'center',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>FILTER</span>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>PERIOD</span>
      <Chip
        label="All"
        active={!periodFilter}
        onClick={() => setPeriodFilter(null)}
      />
      {periods.slice().reverse().map((p) => (
        <Chip
          key={p}
          label={p}
          active={periodFilter === p}
          onClick={() => setPeriodFilter((f) => f === p ? null : p)}
        />
      ))}
      <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} />
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>STATUS</span>
      {Object.keys(STATUS_LABEL).map((s) => {
        const n = counts?.[s] ?? 0;
        if (n === 0 && s !== 'paid') return null;
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

function SettlementsList({ statements, openId, onToggle, canMarkPaid, canDispute, onPay, onDispute, onResolve }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      {statements.map((s) => (
        <SettlementRow
          key={s.id}
          statement={s}
          expanded={openId === s.id}
          onToggle={() => onToggle(s.id)}
          canMarkPaid={canMarkPaid}
          canDispute={canDispute}
          onPay={() => onPay(s.id)}
          onDispute={() => onDispute(s.id)}
          onResolve={() => onResolve(s.id)}
        />
      ))}
    </div>
  );
}

function SettlementRow({ statement: s, expanded, onToggle, canMarkPaid, canDispute, onPay, onDispute, onResolve }) {
  const tone = STATUS_TONE[s.status] || 'var(--text-secondary)';
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
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
          borderLeft: `3px solid ${tone}`,
        }}
      >
        {expanded
          ? <ChevronDown size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
          : <ChevronRight size={14} strokeWidth={1.6} color="var(--text-tertiary)" />}
        <div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {s.hauler_id} · {s.period_label ?? s.period}
            {s.generated && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', border: '1px solid var(--border-soft)', borderRadius: 4, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Generated</span>}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            issued {s.issued_at.slice(0, 10)} · due {s.due_date.slice(0, 10)}
          </div>
        </div>
        <span className="tabular" style={{
          fontSize: 'var(--ts-body-size)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          ${s.net_usd.toLocaleString()}
        </span>
        <StatusPill label={STATUS_LABEL[s.status]} tone={tone} />
        {s.paid_at && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            paid {s.paid_at.slice(0, 10)}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{
          padding: '0 14px 14px 28px',
          background: 'var(--surface)',
        }}>
          <LineItemsTable items={s.line_items} grossUsd={s.gross_usd} deductionsUsd={s.deductions_usd} netUsd={s.net_usd} />

          {s.dispute && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: '8px 12px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--bauxite-rust)',
              borderLeft: '3px solid var(--bauxite-rust)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div className="micro" style={{ color: 'var(--bauxite-rust)', marginBottom: 4 }}>
                DISPUTE OPEN
              </div>
              <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                {s.dispute.reason}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                opened by {s.dispute.opened_by} · {s.dispute.opened_at.slice(0, 10)}
              </div>
            </div>
          )}

          {s.payment_ref && (
            <div style={{
              marginTop: 'var(--space-3)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
            }}>
              Payment ref · <span className="mono" style={{ color: 'var(--text-secondary)' }}>{s.payment_ref}</span>
              {s.paid_amount_usd != null && (
                <> · ${s.paid_amount_usd.toLocaleString()} received</>
              )}
            </div>
          )}

          <div style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            gap: 6,
            justifyContent: 'flex-end',
          }}>
            {canMarkPaid && s.status !== 'paid' && !s.dispute && (
              <button type="button" onClick={onPay} style={primaryBtn}>
                <Check size={11} strokeWidth={1.8} />
                Mark paid
              </button>
            )}
            {canDispute && s.status !== 'paid' && !s.dispute && (
              <button type="button" onClick={onDispute} style={secondaryBtn}>
                <AlertTriangle size={11} strokeWidth={1.6} />
                Dispute
              </button>
            )}
            {canMarkPaid && s.dispute && (
              <button type="button" onClick={onResolve} style={primaryBtn}>
                <CheckCircle size={11} strokeWidth={1.8} />
                Resolve dispute
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LineItemsTable({ items, grossUsd, deductionsUsd, netUsd }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)', marginTop: 'var(--space-3)' }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
          <th style={th}>Type</th>
          <th style={th}>Description</th>
          <th style={{ ...th, textAlign: 'right' }}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id} style={{ borderBottom: '1px solid var(--border-hairline)' }}>
            <td style={{ ...td, textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
              {it.type.replace(/_/g, ' ')}
            </td>
            <td style={td}>{it.description}</td>
            <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: it.sign === 'debit' ? 'var(--bauxite-rust)' : 'var(--text)' }}>
              {it.sign === 'debit' ? '−' : ''}${it.amount_usd.toLocaleString()}
            </td>
          </tr>
        ))}
        <tr style={{ background: 'var(--surface-raised)' }}>
          <td colSpan={2} style={{ ...td, textAlign: 'right', color: 'var(--text-secondary)' }}>
            Gross
          </td>
          <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
            ${grossUsd.toLocaleString()}
          </td>
        </tr>
        <tr style={{ background: 'var(--surface-raised)' }}>
          <td colSpan={2} style={{ ...td, textAlign: 'right', color: 'var(--bauxite-rust)' }}>
            Deductions
          </td>
          <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--bauxite-rust)' }}>
            −${deductionsUsd.toLocaleString()}
          </td>
        </tr>
        <tr style={{ background: 'var(--surface-raised)', borderTop: '2px solid var(--text)' }}>
          <td colSpan={2} style={{ ...td, textAlign: 'right', fontWeight: 'var(--fw-medium)' }}>
            Net settlement
          </td>
          <td style={{ ...td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 'var(--fw-medium)', fontSize: 'var(--ts-body-size)' }}>
            ${netUsd.toLocaleString()}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function StatusPill({ label, tone }) {
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 10, fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

// ── Modals ────────────────────────────────────────────────────────

function MarkPaidModal({ statement, onClose, onSaved }) {
  const [amount, setAmount] = useState(statement.net_usd);
  const [ref, setRef]       = useState('');
  const [date, setDate]     = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]   = useState(null);

  async function save() {
    setPosting(true); setError(null);
    try {
      const r = await authFetch(`/api/settlements/${statement.id}/mark-paid`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paid_amount_usd: Number(amount),
          payment_ref:     ref.trim() || null,
          paid_at:         date ? new Date(date + 'T12:00:00Z').toISOString() : null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  return (
    <Modal open onClose={onClose} width={500}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow">Mark paid</div>
          <h2 style={modalH2}>{statement.hauler_id} · {statement.period}</h2>
          <p style={modalSub}>Net settlement: <span className="tabular">${statement.net_usd.toLocaleString()}</span></p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Amount received (USD)">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Payment reference">
            <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. WIRE-202604-01" maxLength={120} style={inputStyle} />
          </Field>
          <Field label="Paid date (optional)">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </Field>
        </div>

        <div style={modalFooter}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || 'Audit-logged. Reflected on the lender pack at next refresh.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={posting || !amount}>
              {posting ? 'Saving…' : 'Mark paid'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function DisputeModal({ statement, onClose, onSaved }) {
  const [reason, setReason] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]   = useState(null);

  async function save() {
    if (!reason.trim()) return;
    setPosting(true); setError(null);
    try {
      const r = await authFetch(`/api/settlements/${statement.id}/dispute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dispute_reason: reason }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  return (
    <Modal open onClose={onClose} width={520}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow">Open dispute</div>
          <h2 style={modalH2}>{statement.hauler_id} · {statement.period}</h2>
          <p style={modalSub}>Net settlement: <span className="tabular">${statement.net_usd.toLocaleString()}</span></p>
        </header>

        <Field label="Reason for dispute">
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            rows={5} maxLength={1000}
            placeholder="Which line item is contested, and why? What does the hauler/operator believe is correct?"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={modalFooter}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || 'Status flips to disputed; resolved by AXIS ops after review.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={posting || !reason.trim()}>
              {posting ? 'Opening…' : 'Open dispute'}
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

// ── Ageing panel ──────────────────────────────────────────────────

function AgeingPanel({ ageing }) {
  const { bands, total_outstanding_usd } = ageing;
  const fmtK = (n) => n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
  const total = total_outstanding_usd || 1;

  const buckets = [
    { key: 'current',   label: 'Current',    color: 'var(--signal-green)',  val: bands.current },
    { key: 'days30',    label: '1–30d',       color: 'var(--signal-amber)',  val: bands.days30 },
    { key: 'days60',    label: '31–60d',      color: '#D97706',              val: bands.days60 },
    { key: 'days90plus',label: '60d+',        color: 'var(--bauxite-rust)', val: bands.days90plus },
  ];

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">Receivables ageing — outstanding</div>
        <span className="tabular" style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
          {fmtK(total_outstanding_usd)} total
        </span>
      </div>

      {/* Bar */}
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 'var(--space-3)' }}>
        {buckets.map(({ key, color, val }) => val > 0 && (
          <div key={key} style={{ flex: val / total, background: color, minWidth: val > 0 ? 2 : 0 }} />
        ))}
      </div>

      {/* Buckets */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
        {buckets.map(({ key, label, color, val }) => (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</span>
            </div>
            <div className="tabular" style={{ fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-black)', color: val > 0 ? color : 'var(--text-tertiary)' }}>
              {fmtK(val)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {val === 0 ? 'clear' : `${((val / total) * 100).toFixed(0)}% of outstanding`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Resolve dispute modal ─────────────────────────────────────────

function ResolveDisputeModal({ statement, onClose, onSaved }) {
  const [status, setStatus]   = useState('pending');
  const [note, setNote]       = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  if (!statement) return null;

  async function save() {
    setPosting(true); setError(null);
    try {
      const r = await authFetch(`/api/settlements/${statement.id}/resolve-dispute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution_status: status }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  const opts = [
    { value: 'pending', label: 'Revert to pending' },
    { value: 'paid',    label: 'Mark as paid' },
    { value: 'partial', label: 'Mark as partial' },
  ];

  return (
    <Modal open onClose={onClose} width={500}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{ marginBottom: 'var(--space-4)' }}>
          <div className="eyebrow">Resolve dispute</div>
          <h2 style={modalH2}>{statement.hauler_id} · {statement.period_label ?? statement.period}</h2>
          {statement.dispute && (
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--bauxite-rust)' }}>
              <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>"{statement.dispute.reason}"</p>
              <p style={{ margin: '4px 0 0', fontSize: 10, color: 'var(--text-tertiary)' }}>
                Opened by {statement.dispute.opened_by} · {statement.dispute.opened_at?.slice(0, 10)}
              </p>
            </div>
          )}
        </header>

        <Field label="Resolution outcome">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {opts.map((o) => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 'var(--ts-body-sm-size)' }}>
                <input type="radio" name="resolution_status" value={o.value} checked={status === o.value}
                  onChange={() => setStatus(o.value)} style={{ accentColor: 'var(--bauxite-rust)' }} />
                {o.label}
              </label>
            ))}
          </div>
        </Field>

        <div style={modalFooter}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || 'Dispute cleared. Audit-logged.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={posting}>
              {posting ? 'Resolving…' : 'Resolve'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
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
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 500 };
const td = { padding: '8px 10px', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' };
const muted = { color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' };
const errorBox = { padding: 'var(--space-3) var(--space-4)', background: 'var(--surface-raised)', border: '1px solid var(--bauxite-rust)', borderRadius: 'var(--radius-md)', color: 'var(--text)', fontSize: 'var(--ts-body-sm-size)' };
const emptyBox = { margin: 0, padding: 'var(--space-5)', background: 'var(--surface-raised)', border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-md)', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', fontStyle: 'italic', textAlign: 'center' };
const modalH2 = { margin: '4px 0 0', fontSize: 'var(--ts-h2-size)', fontWeight: 'var(--fw-medium)' };
const modalSub = { margin: '4px 0 0', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' };
const modalFooter = { marginTop: 'var(--space-5)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-hairline)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const primaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'var(--bauxite-rust)', color: 'var(--bone)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)', cursor: 'pointer', fontFamily: 'inherit' };
const secondaryBtn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: 'transparent', color: 'var(--bauxite-rust)', border: '1px solid var(--bauxite-rust)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--ts-caption-size)', cursor: 'pointer', fontFamily: 'inherit' };
