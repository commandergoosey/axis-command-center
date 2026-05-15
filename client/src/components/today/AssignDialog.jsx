/*
 * AssignDialog — Phase 45.
 *
 * Modal for assigning an action item. Lists assignable users (axis_admin,
 * axis_ops, hauler_admin from /api/auth/users — lender excluded server-side)
 * plus an optional due date and a free-text note. Hauler admins are
 * restricted server-side to self-assignment, so this dialog hides the
 * picker for that role and pre-selects the current user.
 */

import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';

const ROLE_LABEL = {
  axis_admin:   'AXIS Admin',
  axis_ops:     'AXIS Ops',
  hauler_admin: 'Hauler Admin',
};

export default function AssignDialog({ open, item, onClose, onAssigned }) {
  const { user } = useAuth();
  const [users, setUsers]               = useState([]);
  const [assigneeId, setAssigneeId]     = useState('');
  const [dueDate, setDueDate]           = useState('');
  const [notes, setNotes]               = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState(null);
  // Phase 48 — snooze controls. Shown when an item is already
  // assigned (you can't snooze something with no owner).
  const [snoozeUntil, setSnoozeUntil]   = useState('');
  const [snoozeReason, setSnoozeReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotes(item?.assignment?.notes ?? '');
    setDueDate(item?.assignment?.due_date ?? '');
    setAssigneeId(
      item?.assignment?.assignee?.user_id ??
      (user?.role === 'hauler_admin' ? user.id : ''),
    );
    setSnoozeUntil(item?.assignment?.snooze?.until ?? '');
    setSnoozeReason(item?.assignment?.snooze?.reason ?? '');
    authFetch('/api/auth/users')
      .then((r) => r.ok ? r.json() : { users: [] })
      .then((j) => setUsers(j.users ?? []))
      .catch(() => { /* empty list — server-side validation will still run */ });
  }, [open, item, user]);

  if (!open || !item) return null;

  const isHaulerAdmin = user?.role === 'hauler_admin';
  const visibleUsers = isHaulerAdmin
    ? users.filter((u) => u.id === user.id)
    : users;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!assigneeId) { setError('Pick an assignee'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch(`/api/today/action-items/${item.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_user_id: assigneeId,
          due_date: dueDate || null,
          notes: notes || null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Assign failed (${r.status})`);
      }
      const body = await r.json();
      onAssigned?.(body.assignment);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const snooze = async () => {
    if (!snoozeUntil) { setError('Pick a snooze date'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch(`/api/today/action-items/${item.id}/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ until: snoozeUntil, reason: snoozeReason || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Snooze failed (${r.status})`);
      }
      const body = await r.json();
      onAssigned?.(body.assignment);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const unsnooze = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await authFetch(`/api/today/action-items/${item.id}/snooze`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Unsnooze failed (${r.status})`);
      }
      onAssigned?.(null);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const unassign = async () => {
    if (!item.assignment) return onClose?.();
    setSubmitting(true);
    try {
      const r = await authFetch(`/api/today/action-items/${item.id}/assign`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Unassign failed (${r.status})`);
      }
      onAssigned?.(null);
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={460}>
      <form onSubmit={submit} style={{ padding: 'var(--space-5)' }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          {item.assignment ? 'Reassign action item' : 'Assign action item'}
        </div>
        <p style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--ts-body-sm-lh)',
        }}>
          {item.body}
        </p>

        <Field label="Assignee">
          {isHaulerAdmin ? (
            <div style={{
              padding: '8px 10px',
              background: 'var(--surface)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              {user.display_name} <span style={{ color: 'var(--text-tertiary)' }}>· (hauler admins can only self-assign)</span>
            </div>
          ) : (
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              style={inputStyle}
            >
              <option value="">— Pick an assignee —</option>
              {visibleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} · {ROLE_LABEL[u.role] ?? u.role}
                  {u.hauler_id ? ` (${u.hauler_id})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Due date" hint="Optional. Picker formats to YYYY-MM-DD.">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field label="Notes" hint="Optional. Visible to assignee + audited.">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Context, owner-of-record, escalation path, etc."
            style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
          />
        </Field>

        {/* Phase 48 — snooze panel. Only meaningful when an
            assignment already exists; otherwise the panel is hidden
            (you assign first, then snooze). */}
        {item.assignment && (
          <details style={{
            background: 'var(--surface)',
            borderRadius: 'var(--radius-sm)',
            padding: '8px 12px',
            marginBottom: 'var(--space-3)',
            fontFamily: 'inherit',
          }} open={Boolean(item.assignment.snooze)}>
            <summary style={{
              fontSize: 'var(--ts-caption-size)',
              color: item.assignment.snooze ? 'var(--signal-amber)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}>
              {item.assignment.snooze
                ? `Snoozed until ${item.assignment.snooze.until}${item.assignment.snooze.reason ? ` — ${item.assignment.snooze.reason}` : ''}`
                : 'Snooze this item'}
            </summary>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
              <input
                type="date"
                value={snoozeUntil}
                onChange={(e) => setSnoozeUntil(e.target.value)}
                style={inputStyle}
              />
              <input
                type="text"
                value={snoozeReason}
                onChange={(e) => setSnoozeReason(e.target.value)}
                placeholder="Reason (optional)"
                style={inputStyle}
              />
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              {item.assignment.snooze && (
                <button
                  type="button"
                  onClick={unsnooze}
                  disabled={submitting}
                  style={{
                    fontSize: 'var(--ts-caption-size)',
                    padding: '4px 10px',
                    background: 'transparent',
                    border: '1px solid var(--border-hairline)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Wake now
                </button>
              )}
              <button
                type="button"
                onClick={snooze}
                disabled={submitting || !snoozeUntil}
                style={{
                  fontSize: 'var(--ts-caption-size)',
                  padding: '4px 10px',
                  background: 'transparent',
                  border: '1px solid var(--signal-amber)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--signal-amber)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {item.assignment.snooze ? 'Update snooze' : 'Snooze'}
              </button>
            </div>
          </details>
        )}

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

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'var(--space-4)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--border-hairline)',
        }}>
          <div>
            {item.assignment && (
              <button
                type="button"
                onClick={unassign}
                disabled={submitting}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 12px',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--bauxite-rust)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Unassign
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={submitting || !assigneeId}>
              {submitting ? 'Saving…' : item.assignment ? 'Update' : 'Assign'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          marginTop: 4,
        }}>
          {hint}
        </div>
      )}
    </label>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
};
