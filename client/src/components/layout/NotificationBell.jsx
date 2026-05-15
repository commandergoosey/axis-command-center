/*
 * NotificationBell — Phase 59 + Phase 100.
 *
 * Topbar bell icon + dropdown listing the current user's
 * notifications. Click on the bell marks the dropdown open.
 * Click on a notification navigates to its link path AND marks
 * that one read; "Mark all read" marks the whole feed read.
 *
 * Phase 100 — SSE live push replaces the 60-second polling loop.
 * An EventSource is opened to GET /api/notifications/stream?token=…
 * on mount. The server pushes a `notification` event whenever
 * notifications.emit() fires for this user, updating the bell
 * count immediately. A `connected` event on each (re)connect
 * seeds the current state without a separate REST call.
 *
 * If EventSource is unavailable (rare: Opera Mini, some IE shims)
 * we fall back to the old 60 s poll. The poll also fires once on
 * mount to cover any notifications that arrived before the SSE
 * stream opened.
 *
 * Lender persona is included — they receive their share of
 * notifications (covenant breaches, assignment if axis admin
 * assigns them something — though Phase 45 disallows lender
 * assignment, so the bell will mostly be quiet for them).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, Settings as SettingsIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authFetch, getToken, API_BASE } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import Modal from '../primitives/Modal';
import NotificationPrefsPanel from '../settings/NotificationPrefsPanel';

const POLL_FALLBACK_MS = 60_000;  // used only when SSE unavailable
const SSE_URL = (token) => `${API_BASE}/api/notifications/stream?token=${encodeURIComponent(token)}`;

const EVENT_TYPE_LABEL = {
  assignment:     'Assigned',
  comment:        'Comment',
  bulk_reassign:  'Reassigned',
  direct_message: 'Message',
  escalation:     'Escalation',
  handover:       'Handover',
};

export default function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems]       = useState([]);
  const [unread, setUnread]     = useState(0);
  const [open, setOpen]         = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState('idle'); // 'idle' | 'connected' | 'error'
  const ref = useRef(null);
  const esRef = useRef(null);

  const applyFeed = useCallback((data) => {
    setItems(data.items ?? []);
    setUnread(data.unread_count ?? 0);
  }, []);

  // REST refresh — used on demand (mark-read, open dropdown) and as
  // SSE fallback.
  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await authFetch('/api/notifications');
      if (!r.ok) return;
      applyFeed(await r.json());
    } catch { /* silent */ }
  }, [user, applyFeed]);

  // SSE connection lifecycle.
  useEffect(() => {
    if (!user) return undefined;

    // Seed immediately (covers the window before SSE opens).
    load();

    const token = getToken();

    if (!token || typeof EventSource === 'undefined') {
      // Fallback: plain polling.
      const t = setInterval(load, POLL_FALLBACK_MS);
      return () => clearInterval(t);
    }

    function connect() {
      if (esRef.current) esRef.current.close();

      const es = new EventSource(SSE_URL(token));
      esRef.current = es;

      es.addEventListener('connected', (e) => {
        setLiveStatus('connected');
        try { applyFeed(JSON.parse(e.data)); } catch { /* malformed */ }
      });

      es.addEventListener('notification', (e) => {
        try { applyFeed(JSON.parse(e.data)); } catch { /* malformed */ }
      });

      es.onerror = () => {
        setLiveStatus('error');
        // EventSource auto-reconnects; just track status.
      };

      es.onopen = () => setLiveStatus('connected');
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      setLiveStatus('idle');
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;

  const onItemClick = async (n) => {
    setOpen(false);
    if (!n.read) {
      try { await authFetch(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch {/* ok */}
    }
    if (n.link?.path) navigate(n.link.path);
    load(); // re-sync read state; SSE will push any concurrent arrivals
  };

  const markAllRead = async () => {
    try { await authFetch('/api/notifications/read-all', { method: 'POST' }); } catch {/* ok */}
    load(); // re-sync read flags; SSE does not push on read-state changes
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Notifications${liveStatus === 'connected' ? ' · live' : liveStatus === 'error' ? ' · reconnecting' : ''}`}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          padding: 6,
          background: 'transparent',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
        }}
      >
        <Bell size={14} strokeWidth={1.7} color="var(--text-secondary)" />
        {unread > 0 && (
          <span
            className="tabular"
            style={{
              marginLeft: 6,
              fontSize: 11,
              fontWeight: 'var(--fw-medium)',
              color: 'var(--bauxite-rust)',
              minWidth: 12,
              textAlign: 'center',
            }}
          >
            {unread}
          </span>
        )}
        {/* Unread pip — rust dot in corner */}
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--bauxite-rust)',
            }}
            aria-hidden="true"
          />
        )}
        {/* SSE live-status dot — bottom-left corner, only when no unread pip */}
        {unread === 0 && liveStatus !== 'idle' && (
          <span
            title={liveStatus === 'connected' ? 'Live updates active' : 'Reconnecting…'}
            style={{
              position: 'absolute',
              bottom: 3,
              right: 3,
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: liveStatus === 'connected'
                ? 'var(--signal-green)'
                : 'var(--signal-amber)',
            }}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 360,
          maxWidth: 420,
          maxHeight: 480,
          overflow: 'auto',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
          zIndex: 100,
        }}>
          <header style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-hairline)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 8,
          }}>
            <span className="eyebrow">Notifications</span>
            {/* Phase 82 — Inbox link to the full history page. */}
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/inbox'); }}
              title="Open full inbox"
              style={{
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--bauxite-rust)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginLeft: 'auto',
              }}
            >
              Open inbox →
            </button>
            {/* Phase 63 — preferences shortcut. Always visible at the
                top of the dropdown so users can opt out of noisy
                event types without going to Settings. */}
            <button
              type="button"
              onClick={() => { setOpen(false); setPrefsOpen(true); }}
              title="Manage notification preferences"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-tertiary)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <SettingsIcon size={11} strokeWidth={1.6} />
              Manage
            </button>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--bauxite-rust)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Check size={11} />
                Mark all read
              </button>
            ) : (
              <span className="mono" style={{
                fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em',
              }}>
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
            )}
          </header>

          {items.length === 0 ? (
            <div style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}>
              No notifications yet.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {items.map((n) => (
                <NotificationRow key={n.id} n={n} onClick={() => onItemClick(n)} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Phase 63 — preferences modal. Opened from the Manage link in
          the dropdown header. Available to every authenticated role,
          unlike Settings which is axis_admin-gated. */}
      <Modal open={prefsOpen} onClose={() => setPrefsOpen(false)} width={520}>
        <div style={{ padding: 'var(--space-5)' }}>
          <header style={{ marginBottom: 'var(--space-4)' }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Your preferences</div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              Notification preferences
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              Toggle which event types push to your bell. Default-on policy —
              every type is enabled until you opt out.
            </p>
          </header>
          <NotificationPrefsPanel />
          <div style={{
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--border-hairline)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}>
            <button
              type="button"
              onClick={() => setPrefsOpen(false)}
              style={{
                padding: '6px 14px',
                background: 'var(--bauxite-rust)',
                color: 'var(--bone)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'inherit',
                fontSize: 'var(--ts-body-sm-size)',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function NotificationRow({ n, onClick }) {
  const label = EVENT_TYPE_LABEL[n.event_type] ?? n.event_type;
  return (
    <li
      onClick={onClick}
      style={{
        padding: '10px 12px',
        borderTop: '1px solid var(--border-hairline)',
        cursor: 'pointer',
        background: n.read ? 'transparent' : 'var(--accent-tint)',
        transition: 'background 100ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-tint)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? 'transparent' : 'var(--accent-tint)'; }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 6,
      }}>
        <span className="mono" style={{
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: n.read ? 'var(--text-tertiary)' : 'var(--bauxite-rust)',
          fontWeight: 'var(--fw-medium)',
        }}>
          {label}
        </span>
        <span className="tabular" style={{
          fontSize: 10, color: 'var(--text-tertiary)',
        }}>
          {fmtRelative(n.created_at)}
        </span>
      </div>
      <div style={{
        marginTop: 4,
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text)',
        lineHeight: 'var(--ts-body-sm-lh)',
      }}>
        {n.body}
      </div>
    </li>
  );
}

function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
