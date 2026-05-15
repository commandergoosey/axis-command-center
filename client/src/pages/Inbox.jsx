/*
 * Inbox — Phase 82.
 *
 * Full notifications history. The Topbar bell shows the 10 most
 * recent; this page is for triaging the long tail — filter by
 * event type, read/unread, date range; bulk mark-read; per-row
 * deep-link to the originating entity.
 *
 * Phase 99 — direct message compose. "New message" button in the
 * page header opens an inline compose panel. Recipient list is
 * fetched from /api/notifications/compose/recipients (role-scoped:
 * AXIS can message anyone; hauler_admin and lender can only address
 * AXIS operators). Sent messages land in the recipient's notification
 * feed as event_type: 'direct_message'.
 *
 * Backed by /api/notifications/inbox with paging.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellOff, ArrowRight, CheckCheck, Filter,
  ChevronLeft, ChevronRight, Send, X, Loader, MessageSquare,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';

const EVENT_LABEL = {
  assignment:      'Assigned to you',
  comment:         'Comment',
  bulk_reassign:   'Bulk reassignment',
  escalation:      'Escalation',
  handover:        'Shift handover',
  direct_message:  'Direct message',   // Phase 99
};

const PAGE_SIZE = 50;

export default function Inbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    event_type:  null,
    unread_only: false,
    since:       '',
    until:       '',
  });
  const [offset, setOffset] = useState(0);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    const qs = new URLSearchParams({
      limit:  String(PAGE_SIZE),
      offset: String(offset),
    });
    if (filters.event_type)  qs.set('event_type', filters.event_type);
    if (filters.unread_only) qs.set('unread_only', 'true');
    if (filters.since)       qs.set('since', filters.since + 'T00:00:00Z');
    if (filters.until)       qs.set('until', filters.until + 'T23:59:59Z');
    authFetch(`/api/notifications/inbox?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); }, [filters.event_type, filters.unread_only, filters.since, filters.until]);

  async function markRead(notification) {
    if (notification.read_at) return;
    await authFetch(`/api/notifications/${notification.id}/read`, { method: 'POST' });
    load();
  }
  async function markAllRead() {
    if (!confirm('Mark every visible notification as read?')) return;
    await authFetch('/api/notifications/read-all', { method: 'POST' });
    load();
  }
  function clickRow(notification) {
    markRead(notification);
    if (notification.link?.path) navigate(notification.link.path);
  }

  const totalPages  = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Lender can compose — they can reach AXIS operators.
  const canCompose = Boolean(user);

  return (
    <PageShell
      eyebrow="Activity"
      title="Inbox"
      description="Your notification history. The Topbar bell is the live feed; this is the long tail — filter and triage older items."
      actions={
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {canCompose && (
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px',
                background: composing ? 'var(--accent-tint)' : 'transparent',
                color: composing ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
                border: `1px solid ${composing ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
                fontWeight: composing ? 'var(--fw-medium)' : 'normal',
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              <MessageSquare size={12} strokeWidth={1.8} />
              New message
            </button>
          )}
          {data?.unread_count > 0 && (
            <button type="button" onClick={markAllRead} style={primaryBtnStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckCheck size={12} strokeWidth={1.8} />
                Mark all read
              </span>
            </button>
          )}
        </div>
      }
    >
      {error && <div style={errorBox}>Inbox unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* Phase 99 — compose panel, slides in below header */}
        {composing && (
          <ComposePanel
            onClose={() => setComposing(false)}
            onSent={() => { setComposing(false); load(); }}
          />
        )}

        <KpiStrip data={data} />
        <FilterRow
          filters={filters}
          setFilters={setFilters}
          types={data?.types_summary ?? []}
        />

        {!data ? (
          <p style={emptyBox}>Loading…</p>
        ) : data.rows.length === 0 ? (
          <p style={emptyBox}>
            {filters.event_type || filters.unread_only || filters.since || filters.until
              ? 'No notifications match the current filters.'
              : 'No notifications in the inbox yet.'}
          </p>
        ) : (
          <>
            <NotificationList rows={data.rows} onClick={clickRow} />
            {totalPages > 1 && (
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPrev={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                onNext={() => setOffset(offset + PAGE_SIZE)}
                disablePrev={offset === 0}
                disableNext={offset + PAGE_SIZE >= data.total}
              />
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}

// ── Compose panel (Phase 99) ──────────────────────────────────────

function ComposePanel({ onClose, onSent }) {
  const [recipients, setRecipients] = useState([]);
  const [toId,  setToId]   = useState('');
  const [body,  setBody]   = useState('');
  const [busy,  setBusy]   = useState(false);
  const [err,   setErr]    = useState(null);
  const [sent,  setSent]   = useState(false);

  useEffect(() => {
    authFetch('/api/notifications/compose/recipients')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setRecipients(d.recipients ?? []);
        if (d.recipients?.length > 0) setToId(d.recipients[0].id);
      })
      .catch(() => setErr('Could not load recipients'));
  }, []);

  async function handleSend(e) {
    e.preventDefault();
    if (!toId || !body.trim()) { setErr('Recipient and message are required.'); return; }
    setErr(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/notifications/compose', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ to_user_id: toId, body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Send failed'); return; }
      setSent(true);
      setTimeout(onSent, 800);
    } catch {
      setErr('Network error — message not sent.');
    } finally {
      setBusy(false);
    }
  }

  const selectedRecipient = recipients.find((r) => r.id === toId);

  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <div className="eyebrow">New direct message</div>
        <button type="button" onClick={onClose} style={ghostIconBtn} title="Close">
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {sent ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(46,107,63,0.08)',
          border: '1px solid rgba(46,107,63,0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--signal-green)',
        }}>
          <Send size={14} strokeWidth={1.8} />
          Message delivered to {selectedRecipient?.display_name ?? 'recipient'}
        </div>
      ) : (
        <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

          {/* To */}
          <label style={labelStyle}>
            <span style={labelTextStyle}>To</span>
            {recipients.length === 0 ? (
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                {err ? err : 'Loading recipients…'}
              </span>
            ) : (
              <select
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                style={inputStyle}
                required
              >
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name} · {r.organisation}
                  </option>
                ))}
              </select>
            )}
          </label>

          {/* Message */}
          <label style={labelStyle}>
            <span style={labelTextStyle}>Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Write your message…"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
              required
            />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'right' }}>
              {body.length} / 1,000
            </span>
          </label>

          {err && (
            <div style={{
              padding: '6px 10px',
              background: 'rgba(180,40,30,0.08)',
              border: '1px solid rgba(180,40,30,0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--signal-red)',
            }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button
              type="submit"
              disabled={busy || !toId || !body.trim() || recipients.length === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 16px',
                background: (busy || !toId || !body.trim() || recipients.length === 0)
                  ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
                color: (busy || !toId || !body.trim() || recipients.length === 0)
                  ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                fontWeight: 'var(--fw-medium)',
                fontFamily: 'inherit',
                cursor: (busy || !toId || !body.trim() || recipients.length === 0) ? 'not-allowed' : 'pointer',
              }}
            >
              {busy
                ? <><Loader size={13} strokeWidth={1.8} style={{ animation: 'spin 1s linear infinite' }} />Sending…</>
                : <><Send size={13} strokeWidth={1.8} />Send message</>
              }
            </button>
            <button type="button" onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ data }) {
  const total  = data?.total ?? 0;
  const unread = data?.unread_count ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile label="Inbox" value={total} sub="matching current filters" tone={total === 0 ? 'tertiary' : 'text'} />
      <Tile label="Unread" value={unread} sub={unread > 0 ? 'across all event types' : 'inbox is clean'} tone={unread > 0 ? 'rust' : 'green'} />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
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

function FilterRow({ filters, setFilters, types }) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-3) var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
    }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>FILTER</span>
      <Chip
        label="All types"
        active={!filters.event_type}
        onClick={() => setFilters((f) => ({ ...f, event_type: null }))}
      />
      {types.map((t) => (
        <Chip
          key={t.event_type}
          label={`${EVENT_LABEL[t.event_type] || t.event_type} · ${t.n}`}
          active={filters.event_type === t.event_type}
          onClick={() => setFilters((f) => ({ ...f, event_type: f.event_type === t.event_type ? null : t.event_type }))}
        />
      ))}
      <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} />
      <Chip
        label="Unread only"
        active={filters.unread_only}
        onClick={() => setFilters((f) => ({ ...f, unread_only: !f.unread_only }))}
        leadingIcon={filters.unread_only ? Bell : BellOff}
      />
      <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
        From
        <input
          type="date"
          value={filters.since}
          onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
          style={dateInput}
        />
        To
        <input
          type="date"
          value={filters.until}
          onChange={(e) => setFilters((f) => ({ ...f, until: e.target.value }))}
          style={dateInput}
        />
        {(filters.since || filters.until) && (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, since: '', until: '' }))}
            style={clearLink}
          >
            Clear
          </button>
        )}
      </span>
    </div>
  );
}

function Chip({ label, active, onClick, leadingIcon: Icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 10px',
        background: active ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${active ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
        borderRadius: 999,
        fontSize: 'var(--ts-caption-size)',
        color: active ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {Icon && <Icon size={11} strokeWidth={1.6} />}
      {label}
    </button>
  );
}

// ── Notification list ─────────────────────────────────────────────

function NotificationList({ rows, onClick }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((n) => <NotificationRow key={n.id} notification={n} onClick={() => onClick(n)} />)}
      </div>
    </div>
  );
}

function NotificationRow({ notification, onClick }) {
  const unread = !notification.read_at;
  const ts = relTime(notification.created_at);
  const eventLabel = EVENT_LABEL[notification.event_type] || notification.event_type;
  const isDM = notification.event_type === 'direct_message';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-hairline)',
        cursor: 'pointer',
        background: unread ? 'var(--accent-tint)' : 'transparent',
      }}
    >
      <span style={{
        display: 'inline-block',
        width: 6, height: 6,
        borderRadius: '50%',
        background: unread ? 'var(--bauxite-rust)' : 'var(--border-soft)',
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontWeight: unread ? 'var(--fw-medium)' : 'normal',
        }}>
          {notification.body || '(no body)'}
        </div>
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 2,
        }}>
          <span className="mono" style={{ letterSpacing: '0.04em' }}>{eventLabel.toUpperCase()}</span>
          {isDM && notification.actor?.display_name && (
            <span> · from {notification.actor.display_name}</span>
          )}
          <span> · {ts}</span>
          {notification.link?.label && <span> · {notification.link.label}</span>}
        </div>
      </div>
      {notification.link?.path && (
        <ArrowRight size={12} strokeWidth={1.6} color="var(--text-tertiary)" />
      )}
    </div>
  );
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60)  return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14)    return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// ── Pagination ────────────────────────────────────────────────────

function Pagination({ page, totalPages, onPrev, onNext, disablePrev, disableNext }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '6px 12px',
    }}>
      <button type="button" onClick={onPrev} disabled={disablePrev}
        style={{ ...iconBtn, opacity: disablePrev ? 0.4 : 1 }}>
        <ChevronLeft size={12} strokeWidth={1.6} />
        Prev
      </button>
      <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
        Page {page} of {totalPages}
      </span>
      <button type="button" onClick={onNext} disabled={disableNext}
        style={{ ...iconBtn, opacity: disableNext ? 0.4 : 1 }}>
        Next
        <ChevronRight size={12} strokeWidth={1.6} />
      </button>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────

const labelStyle     = { display: 'flex', flexDirection: 'column', gap: 4 };
const labelTextStyle = { fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', letterSpacing: '0.02em' };

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

const dateInput = {
  padding: '4px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  marginLeft: 4,
  marginRight: 4,
};

const clearLink = {
  background: 'transparent',
  border: 'none',
  padding: '0 0 0 6px',
  cursor: 'pointer',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--bauxite-rust)',
  fontFamily: 'inherit',
};

const primaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  background: 'var(--bauxite-rust)',
  color: 'var(--bone)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const secondaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const ghostIconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 4,
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

const iconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 10px',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
};

const emptyBox = {
  margin: 0,
  padding: 'var(--space-5)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
  textAlign: 'center',
};
