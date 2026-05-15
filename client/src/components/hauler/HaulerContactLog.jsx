/*
 * HaulerContactLog — Phase 69.
 *
 * Per-hauler structured contact log. Mounted in the HaulerDetail
 * drawer. Operators see the last N contacts as a chronological
 * strip — channel badge, direction arrow, counterparty name,
 * outcome chip, follow-up countdown — and can compose a new
 * contact inline (axis_admin / axis_ops / hauler_admin scoped to
 * own hauler). Lender sees the log but no compose form.
 *
 * Mirrors the receivables chase log (Phase 64) but generalized
 * per-hauler. Closes the loop: handover note (Phase 67) tells the
 * narrative; contact log gives structured per-hauler memory the
 * next operator can query.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Phone, MessageCircle, Mail, MapPin, Users,
  ArrowDownLeft, ArrowUpRight, ChevronDown, Send, Check,
} from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const CHANNEL_META = {
  phone:      { label: 'Phone',      icon: Phone },
  whatsapp:   { label: 'WhatsApp',   icon: MessageCircle },
  email:      { label: 'Email',      icon: Mail },
  site_visit: { label: 'Site visit', icon: MapPin },
  meeting:    { label: 'Meeting',    icon: Users },
};

const OUTCOMES = [
  { id: 'committed',         label: 'Committed',         tone: 'green' },
  { id: 'partial',           label: 'Partial',           tone: 'amber' },
  { id: 'no_response',       label: 'No response',       tone: 'rust'  },
  { id: 'disputed',          label: 'Disputed',          tone: 'rust'  },
  { id: 'escalation_needed', label: 'Escalation needed', tone: 'rust'  },
  { id: 'resolved',          label: 'Resolved',          tone: 'green' },
];

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

export default function HaulerContactLog({ haulerId, haulerName }) {
  const { user } = useAuth();
  const canWrite = user
    && WRITE_ROLES.has(user.role)
    && (user.role !== 'hauler_admin' || user.hauler_id === haulerId);

  const [contacts, setContacts] = useState(null);
  const [error, setError] = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    if (!haulerId) return;
    setError(null);
    authFetch(`/api/haulers/${haulerId}/contacts?limit=20`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setContacts(j.contacts))
      .catch((err) => setError(err.message));
  }, [haulerId]);

  useEffect(() => { load(); }, [load]);

  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-2)',
      }}>
        <h3 style={{
          margin: 0,
          fontSize: 'var(--ts-h3-size)',
          lineHeight: 'var(--ts-h3-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          Contact log
        </h3>
        {canWrite && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--bauxite-rust)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            + Log contact
          </button>
        )}
      </div>

      {error && (
        <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)' }}>
          {error}
        </p>
      )}

      {composing && (
        <ComposeForm
          haulerId={haulerId}
          onCancel={() => setComposing(false)}
          onPosted={() => { setComposing(false); load(); }}
        />
      )}

      {contacts == null ? (
        <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Loading…
        </p>
      ) : contacts.length === 0 ? (
        <p style={{
          margin: 0,
          padding: 'var(--space-3) 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
        }}>
          No contact logged yet for {haulerName}. {canWrite ? 'Log the first.' : ''}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} canWrite={canWrite} onResolve={load} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Row ──────────────────────────────────────────────────────────

function ContactRow({ contact, canWrite, onResolve }) {
  const meta = CHANNEL_META[contact.channel] || { label: contact.channel, icon: Phone };
  const Icon = meta.icon;
  const Direction = contact.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;
  const dirColor  = contact.direction === 'inbound' ? 'var(--signal-green)' : 'var(--text-secondary)';
  const outcome = OUTCOMES.find((o) => o.id === contact.outcome) || { label: contact.outcome, tone: 'text' };
  const followUp = contact.follow_up_at ? followUpInfo(contact) : null;

  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
      borderLeft: `3px solid ${outcomeColor(outcome.tone)}`,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: 8,
        alignItems: 'center',
        marginBottom: 4,
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon size={12} strokeWidth={1.6} color="var(--text-secondary)" />
          <Direction size={11} strokeWidth={1.8} color={dirColor} />
          <span className="mono" style={{
            fontSize: 10, color: 'var(--text-tertiary)',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            {meta.label}
          </span>
        </span>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-secondary)',
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        }}>
          {contact.counterparty_name || '—'}
          {contact.counterparty_role && (
            <span style={{ color: 'var(--text-tertiary)' }}>
              {' · '}{contact.counterparty_role}
            </span>
          )}
        </span>
        <OutcomeChip outcome={outcome} />
      </div>
      <p style={{
        margin: 0,
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        lineHeight: 1.45,
      }}>
        {contact.summary}
      </p>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 6,
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <span>
          {contact.author?.display_name ?? 'Unknown'}
          {' · '}
          <span className="mono">{relTime(contact.created_at)}</span>
        </span>
        {followUp && (
          <FollowUpPill
            followUp={followUp}
            haulerId={contact.hauler_id}
            contactId={contact.id}
            canWrite={canWrite}
            resolved={contact.follow_up_resolved}
            onResolve={onResolve}
          />
        )}
      </div>
    </div>
  );
}

function OutcomeChip({ outcome }) {
  const color = outcomeColor(outcome.tone);
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${color} 8%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      color,
      fontSize: 10,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {outcome.label}
    </span>
  );
}

function FollowUpPill({ followUp, haulerId, contactId, canWrite, resolved, onResolve }) {
  const [busy, setBusy] = useState(false);
  if (resolved) {
    return (
      <span style={{ color: 'var(--signal-green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Check size={11} strokeWidth={2} /> Followed up
      </span>
    );
  }
  const tone = followUp.overdueDays >= 0 ? 'var(--bauxite-rust)' : 'var(--signal-amber)';
  const label = followUp.overdueDays > 0
    ? `Follow-up ${followUp.overdueDays}d overdue`
    : followUp.overdueDays === 0
      ? 'Follow-up today'
      : `Follow-up in ${-followUp.overdueDays}d`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: tone, fontWeight: 'var(--fw-medium)' }}>{label}</span>
      {canWrite && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await authFetch(`/api/haulers/${haulerId}/contacts/${contactId}/resolve`, {
                method: 'POST',
              });
              onResolve();
            } finally { setBusy(false); }
          }}
          style={{
            background: 'transparent',
            border: '1px solid var(--border-hairline)',
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: 9,
            color: 'var(--text-secondary)',
            cursor: busy ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
          title="Mark this follow-up as resolved"
        >
          mark done
        </button>
      )}
    </span>
  );
}

// ── Compose form ─────────────────────────────────────────────────

function ComposeForm({ haulerId, onCancel, onPosted }) {
  const [channel,   setChannel]   = useState('phone');
  const [direction, setDirection] = useState('outbound');
  const [name,      setName]      = useState('');
  const [role,      setRole]      = useState('');
  const [summary,   setSummary]   = useState('');
  const [outcome,   setOutcome]   = useState('committed');
  const [followUp,  setFollowUp]  = useState('');
  const [posting,   setPosting]   = useState(false);
  const [error,     setError]     = useState(null);

  async function post() {
    if (!summary.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const body = {
        channel, direction,
        counterparty_name: name.trim() || null,
        counterparty_role: role.trim() || null,
        summary,
        outcome,
        follow_up_at: followUp ? new Date(followUp).toISOString() : null,
      };
      const r = await authFetch(`/api/haulers/${haulerId}/contacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
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
  };

  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderLeft: '3px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-sm)',
      marginBottom: 'var(--space-2)',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
    }}>
      <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inputStyle}>
        {Object.entries(CHANNEL_META).map(([id, m]) => (
          <option key={id} value={id}>{m.label}</option>
        ))}
      </select>
      <select value={direction} onChange={(e) => setDirection(e.target.value)} style={inputStyle}>
        <option value="outbound">Outbound (we contacted them)</option>
        <option value="inbound">Inbound (they reached us)</option>
      </select>
      <input
        type="text"
        placeholder="Counterparty name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Counterparty role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={inputStyle}
      />
      <textarea
        placeholder="What was discussed? What was committed?"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={3}
        maxLength={1000}
        style={{ ...inputStyle, gridColumn: '1 / span 2', resize: 'vertical' }}
      />
      <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={inputStyle}>
        {OUTCOMES.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <input
        type="datetime-local"
        value={followUp}
        onChange={(e) => setFollowUp(e.target.value)}
        title="Follow-up at (optional)"
        style={inputStyle}
      />
      <div style={{
        gridColumn: '1 / span 2',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
      }}>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
        }}>
          {error || `${summary.length} / 1000`}
        </span>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={posting}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={post}
            disabled={!summary.trim() || posting}
            style={{
              background: 'var(--bauxite-rust)',
              border: '1px solid var(--bauxite-rust)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              color: 'white',
              cursor: !summary.trim() || posting ? 'not-allowed' : 'pointer',
              opacity: !summary.trim() || posting ? 0.55 : 1,
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Send size={11} strokeWidth={1.8} />
            {posting ? 'Posting…' : 'Log contact'}
          </button>
        </span>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function outcomeColor(tone) {
  return tone === 'green' ? 'var(--signal-green)'
       : tone === 'amber' ? 'var(--signal-amber)'
       : tone === 'rust'  ? 'var(--bauxite-rust)'
       : 'var(--text-secondary)';
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60)        return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24)          return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14)          return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function followUpInfo(contact) {
  const dueMs = new Date(contact.follow_up_at).getTime();
  const overdueDays = Math.floor((Date.now() - dueMs) / (24 * 60 * 60 * 1000));
  return { dueMs, overdueDays };
}
