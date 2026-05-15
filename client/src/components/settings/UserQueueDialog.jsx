/*
 * UserQueueDialog — Phase 56.
 *
 * Admin-only modal showing a single user's assigned action items, with
 * a bulk-reassign action that transfers the entire queue to another
 * user in one shot. Each transfer is audit-logged individually.
 *
 * Use case: operator goes on leave → admin opens their row in the
 * User directory → sees what's on their plate → reassigns all to a
 * teammate.
 */

import { useEffect, useState } from 'react';
import { X, ArrowRight } from 'lucide-react';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';
import { authFetch } from '../../lib/auth';

const ROLE_LABEL = {
  axis_admin:   'AXIS Admin',
  axis_ops:     'AXIS Ops',
  hauler_admin: 'Hauler Admin',
};

export default function UserQueueDialog({ open, user, onClose, onReassigned }) {
  const [data, setData]               = useState(null);
  const [error, setError]             = useState(null);
  const [allUsers, setAllUsers]       = useState([]);
  const [transferTarget, setTransferTarget] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [result, setResult]           = useState(null);

  useEffect(() => {
    if (!open || !user) return;
    setData(null); setError(null); setResult(null); setTransferTarget('');
    let abort = false;
    Promise.all([
      authFetch(`/api/today/action-items/by-user/${user.id}`).then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      authFetch('/api/auth/users').then((r) => r.ok ? r.json() : { users: [] }),
    ]).then(([queue, list]) => {
      if (abort) return;
      setData(queue);
      // Filter target picker: writable users that aren't the source.
      setAllUsers((list.users ?? []).filter((u) => u.id !== user.id));
    }).catch((err) => { if (!abort) setError(err.message); });
    return () => { abort = true; };
  }, [open, user]);

  if (!open || !user) return null;

  const submit = async () => {
    if (!transferTarget) { setError('Pick a destination user'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch('/api/today/action-items/bulk-reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_user_id: user.id,
          to_user_id:   transferTarget,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const body = await r.json();
      setResult(body);
      onReassigned?.(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const items = data?.items ?? [];
  const liveItems     = items.filter((i) => i.live);
  const resolvedItems = items.filter((i) => !i.live);
  const targetName = allUsers.find((u) => u.id === transferTarget)?.display_name ?? '…';

  return (
    <Modal open={open} onClose={onClose} width={620}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>User queue</div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {user.display_name}
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              {ROLE_LABEL[user.role] ?? user.role}
              {user.organisation ? ` · ${user.organisation}` : ''}
              {user.hauler_id ? ` · ${user.hauler_id}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: 4, background: 'transparent', border: 'none',
              cursor: 'pointer', color: 'var(--text-tertiary)',
            }}
          >
            <X size={18} />
          </button>
        </header>

        {error && (
          <div style={{
            padding: '8px 10px',
            background: 'rgba(139, 46, 26, 0.08)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--bauxite-rust)',
            fontSize: 'var(--ts-caption-size)',
            marginBottom: 'var(--space-3)',
          }}>
            {error}
          </div>
        )}

        {/* ── Queue listing ─────────────────────────────────────── */}
        {data && (
          <section style={{ marginBottom: 'var(--space-4)' }}>
            <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
              {liveItems.length} live · {resolvedItems.length} resolved
            </div>

            {liveItems.length === 0 ? (
              <p style={{
                margin: 0,
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text-tertiary)',
                fontStyle: 'italic',
              }}>
                No live items assigned to this user.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {liveItems.map((i) => (
                  <li key={i.action_item_id} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    columnGap: 'var(--space-3)',
                    padding: '6px 10px',
                    background: 'var(--surface)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-hairline)',
                    fontSize: 'var(--ts-body-sm-size)',
                  }}>
                    <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {i.action_item?.body ?? i.action_item_id}
                    </span>
                    <span className="mono" style={{
                      fontSize: 10,
                      color: i.overdue ? 'var(--bauxite-rust)' : i.snoozed ? 'var(--signal-amber)' : 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}>
                      {i.overdue ? 'OVERDUE' : i.snoozed ? 'SNOOZED' : (i.action_item?.priority ?? '')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ── Bulk reassign ─────────────────────────────────────── */}
        {liveItems.length > 0 && !result && (
          <section style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-4)',
            background: 'var(--surface)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
              Bulk reassign
            </div>
            <p style={{
              margin: '0 0 var(--space-3)',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
              lineHeight: 'var(--ts-body-sm-lh)',
            }}>
              Transfer all {liveItems.length} live item{liveItems.length === 1 ? '' : 's'}{' '}
              from {user.display_name} to {transferTarget ? <strong>{targetName}</strong> : 'another user'}.
              Each transfer is audit-logged individually.
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto',
              columnGap: 'var(--space-3)',
              alignItems: 'center',
            }}>
              <select
                value={transferTarget}
                onChange={(e) => setTransferTarget(e.target.value)}
                style={{
                  padding: '6px 8px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--ts-body-sm-size)',
                  fontFamily: 'inherit',
                  color: 'var(--text)',
                }}
              >
                <option value="">— Pick destination user —</option>
                {allUsers
                  .filter((u) => u.role !== 'lender')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name} · {ROLE_LABEL[u.role] ?? u.role}
                      {u.hauler_id ? ` (${u.hauler_id})` : ''}
                    </option>
                  ))}
              </select>
              <ArrowRight size={14} color="var(--text-tertiary)" />
              <Button
                variant="primary"
                disabled={submitting || !transferTarget}
                onClick={submit}
              >
                {submitting ? 'Transferring…' : `Transfer ${liveItems.length}`}
              </Button>
            </div>
          </section>
        )}

        {/* ── Success summary ───────────────────────────────────── */}
        {result && (
          <section style={{
            marginTop: 'var(--space-4)',
            padding: 'var(--space-4)',
            background: 'rgba(46, 107, 63, 0.06)',
            border: '1px solid rgba(46, 107, 63, 0.3)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{
              fontSize: 'var(--ts-body-size)',
              color: 'var(--signal-green)',
              fontWeight: 'var(--fw-medium)',
              marginBottom: 4,
            }}>
              Transferred {result.transferred_count} item{result.transferred_count === 1 ? '' : 's'}
              {result.skipped_count > 0 ? ` · ${result.skipped_count} skipped` : ''}
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              The audit trail captures every transfer individually. Close this dialog and
              the destination user's queue will reflect the change immediately.
            </div>
          </section>
        )}

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
