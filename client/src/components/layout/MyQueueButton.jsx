/*
 * MyQueueButton — Phase 45.
 *
 * Topbar dropdown showing the current user's assigned action items.
 * Lender persona is hidden (cannot own items). Pulls /api/today/action-items/mine
 * which carries both raw assignments and a join against the live synth
 * (so resolved items can be shown greyed out as recently-completed).
 *
 * The dot/badge on the button is the count of LIVE assignments (active
 * action items that still need attention). Resolved items still show in
 * the dropdown for one tick so the user sees their wins.
 */

import { useEffect, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const REFRESH_MS = 60_000;

export default function MyQueueButton() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen]   = useState(false);
  const ref = useRef(null);

  // Lenders are read-only; no inbox.
  const visible = user && user.role !== 'lender';

  useEffect(() => {
    if (!visible) return undefined;
    let abort = false;
    const load = async () => {
      try {
        const r = await authFetch('/api/today/action-items/mine');
        if (!r.ok) return;
        const j = await r.json();
        if (!abort) setItems(j.items ?? []);
      } catch { /* silent */ }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { abort = true; clearInterval(t); };
  }, [visible, user?.id]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!visible) return null;

  // Phase 48 — split the queue into active / snoozed / resolved.
  // Snoozed items are LIVE but dormant — counted separately from
  // active so the badge reflects what actually needs work.
  const activeItems = items.filter((i) => i.live && !i.snoozed);
  const snoozedItems = items.filter((i) => i.snoozed);
  const resolvedItems = items.filter((i) => !i.live);
  const overdue = activeItems.filter((i) => i.overdue).length;
  const dueSoon = activeItems.filter((i) => {
    if (!i.due_date || i.overdue) return false;
    const d = (new Date(i.due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    return d >= 0 && d <= 2;
  }).length;

  const dotColor =
    overdue > 0  ? 'var(--bauxite-rust)' :
    dueSoon > 0  ? 'var(--signal-amber)' :
    activeItems.length > 0 ? 'var(--text)' : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Your assigned action items"
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
        <Inbox size={14} strokeWidth={1.7} color="var(--text-secondary)" />
        {activeItems.length > 0 && (
          <span
            className="tabular"
            style={{
              marginLeft: 6,
              fontSize: 11,
              fontWeight: 'var(--fw-medium)',
              color: dotColor ?? 'var(--text)',
              minWidth: 12,
              textAlign: 'center',
            }}
          >
            {activeItems.length}
          </span>
        )}
        {dotColor && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor,
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
          minWidth: 320,
          maxWidth: 380,
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
          }}>
            <span className="eyebrow">Your queue</span>
            <span className="mono" style={{
              fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.08em',
            }}>
              {activeItems.length} active{snoozedItems.length > 0 ? ` · ${snoozedItems.length} snoozed` : ''} · {resolvedItems.length} resolved
            </span>
          </header>

          {items.length === 0 ? (
            <div style={{
              padding: 'var(--space-4)',
              textAlign: 'center',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
            }}>
              Nothing assigned to you. The desk is yours.
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[...activeItems, ...snoozedItems, ...resolvedItems].map((it) => (
                <QueueRow
                  key={it.action_item_id}
                  assignment={it}
                  onOpen={() => {
                    setOpen(false);
                    if (it.live && it.action_item?.link?.path) {
                      navigate(it.action_item.link.path);
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function QueueRow({ assignment, onOpen }) {
  const a       = assignment;
  const live    = a.live;
  const snoozed = a.snoozed;
  const overdue = a.overdue;
  const item    = a.action_item;
  const due     = a.due_date;
  const tone    = overdue ? 'var(--bauxite-rust)'
                : snoozed ? 'var(--signal-amber)'
                : live && due
                  ? (() => {
                      const d = (new Date(due).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
                      if (d <= 2) return 'var(--signal-amber)';
                      return 'var(--text-secondary)';
                    })()
                  : 'var(--text-tertiary)';

  // Status pill — phase 48 adds snoozed.
  const statusLabel = !live ? 'resolved'
                    : snoozed ? 'snoozed'
                    : overdue ? 'overdue'
                    : (item?.priority ?? 'open');
  const statusColor = !live ? 'var(--signal-green)'
                    : snoozed ? 'var(--signal-amber)'
                    : overdue ? 'var(--bauxite-rust)'
                    : 'var(--text-tertiary)';

  const dimmed = !live || snoozed;
  return (
    <li
      onClick={live && !snoozed ? onOpen : undefined}
      style={{
        padding: '10px 12px',
        borderTop: '1px solid var(--border-hairline)',
        cursor: live && !snoozed ? 'pointer' : 'default',
        opacity: dimmed ? 0.65 : 1,
        transition: 'background 100ms ease',
      }}
      onMouseEnter={live && !snoozed ? (e) => { e.currentTarget.style.background = 'var(--accent-tint)'; } : undefined}
      onMouseLeave={live && !snoozed ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          lineHeight: 'var(--ts-body-sm-lh)',
        }}>
          {item?.body ?? '(action item resolved)'}
        </span>
      </div>
      <div style={{
        marginTop: 4,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <span className="mono" style={{
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: statusColor,
        }}>
          {statusLabel}
        </span>
        {snoozed && a.snooze?.until ? (
          <span className="tabular" style={{
            fontSize: 10,
            color: tone,
            fontWeight: 'var(--fw-medium)',
          }}>
            until {new Date(a.snooze.until).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </span>
        ) : due && (
          <span className="tabular" style={{
            fontSize: 10,
            color: tone,
            fontWeight: 'var(--fw-medium)',
          }}>
            due {new Date(due).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
          </span>
        )}
      </div>
    </li>
  );
}
