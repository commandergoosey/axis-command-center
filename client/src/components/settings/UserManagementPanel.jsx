/*
 * LP-2 — UserManagementPanel.
 *
 * Replaces the read-only UsersPanel in Settings. axis_admin sees full CRUD:
 *   • Add user   — opens UserFormModal in create mode
 *   • Edit row   — opens UserFormModal in edit mode
 *   • Set pwd    — opens PasswordModal for any user
 *   • Deactivate / Reactivate — inline toggle with confirm
 *
 * Non-admin callers receive a read-only table (no action column).
 * Clicking a non-lender row still opens the UserQueueDialog (bulk reassign).
 */

import { useState, useCallback } from 'react';
import { Users, UserPlus, Pencil, KeyRound, UserX, UserCheck, X, Loader, Eye, EyeOff } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';
import UserQueueDialog from './UserQueueDialog';

/* ── Constants ──────────────────────────────────────────────────────── */

const ROLE_OPTIONS = [
  { value: 'axis_admin',   label: 'AXIS Admin' },
  { value: 'axis_ops',     label: 'AXIS Ops' },
  { value: 'hauler_admin', label: 'Hauler Admin' },
  { value: 'lender',       label: 'Lender' },
];

const ROLE_LABEL = {
  axis_admin:   'AXIS Admin',
  axis_ops:     'AXIS Ops',
  hauler_admin: 'Hauler admin',
  lender:       'Lender',
};

const ROLE_TONE = {
  axis_admin:   { color: 'var(--bauxite-rust)',  border: 'rgba(139,46,26,0.3)',  bg: 'rgba(139,46,26,0.06)' },
  axis_ops:     { color: 'var(--bauxite-rust)',  border: 'rgba(139,46,26,0.3)',  bg: 'rgba(139,46,26,0.06)' },
  hauler_admin: { color: 'var(--signal-amber)',  border: 'rgba(217,158,55,0.3)', bg: 'rgba(217,158,55,0.06)' },
  lender:       { color: 'var(--signal-green)',  border: 'rgba(46,107,63,0.3)',  bg: 'rgba(46,107,63,0.06)' },
};

function RoleChip({ role }) {
  const tone = ROLE_TONE[role] ?? ROLE_TONE.axis_ops;
  return (
    <span className="mono" style={{
      fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
      padding: '2px 8px',
      background: tone.bg, color: tone.color, border: `1px solid ${tone.border}`,
      borderRadius: 2, whiteSpace: 'nowrap',
    }}>
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/* ── Main panel ─────────────────────────────────────────────────────── */

export default function UserManagementPanel({ users, onRefresh }) {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'axis_admin';

  const [formOpen,  setFormOpen]  = useState(false);
  const [editUser,  setEditUser]  = useState(null);   // null = create mode
  const [pwdUser,   setPwdUser]   = useState(null);
  const [queueUser, setQueueUser] = useState(null);
  const [busy,      setBusy]      = useState(null);   // user id being toggled
  const [err,       setErr]       = useState(null);

  const openCreate = () => { setEditUser(null); setFormOpen(true); };
  const openEdit   = (u) => { setEditUser(u);   setFormOpen(true); };

  const toggleActive = useCallback(async (u) => {
    const action = u.active ? 'deactivate' : 'reactivate';
    if (u.active && !window.confirm(`Deactivate ${u.display_name}? They will be immediately signed out.`)) return;
    setBusy(u.id);
    setErr(null);
    try {
      const res = await authFetch(`/api/admin/users/${u.id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b.error || `Could not ${action} user`);
      } else {
        onRefresh();
      }
    } catch {
      setErr('Network error');
    } finally {
      setBusy(null);
    }
  }, [onRefresh]);

  const activeCount = users.filter((u) => u.active).length;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">User directory</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {activeCount} active · {users.length} total
          </span>
          {isAdmin && (
            <button type="button" onClick={openCreate} style={addBtnStyle}>
              <UserPlus size={12} strokeWidth={1.8} />
              Add user
            </button>
          )}
        </div>
      </header>

      {err && (
        <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'rgba(139,46,26,0.06)', color: 'var(--signal-red)', fontSize: 'var(--ts-caption-size)' }}>
          {err}
        </div>
      )}

      {/* Table */}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {users.map((u) => {
          const inactive   = !u.active;
          const canQueue   = u.role !== 'lender' && u.active;
          const isSelf     = u.id === me?.id;

          return (
            <li
              key={u.id}
              onClick={canQueue ? () => setQueueUser(u) : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: isAdmin
                  ? 'minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,0.8fr) auto auto'
                  : 'minmax(0,1.5fr) minmax(0,1.1fr) minmax(0,0.8fr) auto',
                gap: 'var(--space-3)',
                alignItems: 'center',
                padding: 'var(--space-3) var(--space-4)',
                borderTop: '1px solid var(--border-hairline)',
                cursor: canQueue ? 'pointer' : 'default',
                opacity: inactive ? 0.5 : 1,
                transition: 'background 100ms ease',
              }}
              onMouseEnter={canQueue ? (e) => { e.currentTarget.style.background = 'var(--accent-tint)'; } : undefined}
              onMouseLeave={canQueue ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
            >
              {/* Name + email */}
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                    {u.display_name}
                  </span>
                  {inactive && (
                    <span style={{
                      fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
                      padding: '1px 5px', borderRadius: 2,
                      background: 'rgba(139,46,26,0.08)', color: 'var(--bauxite-rust)',
                      border: '1px solid rgba(139,46,26,0.2)',
                    }}>
                      Inactive
                    </span>
                  )}
                  {isSelf && (
                    <span style={{ fontSize: 9, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>you</span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {u.email}
                </div>
              </div>

              {/* Org */}
              <span style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.organisation || '—'}
              </span>

              {/* Role chip */}
              <RoleChip role={u.role} />

              {/* Hauler id — in admin mode this is folded into the actions column */}
              {!isAdmin && (
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {u.hauler_id || '—'}
                </span>
              )}

              {/* Action buttons — admin only */}
              {isAdmin && (
                <div
                  onClick={(e) => e.stopPropagation()} // don't trigger queue dialog
                  style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}
                >
                  <IconBtn
                    icon={Pencil}
                    title="Edit user"
                    onClick={() => openEdit(u)}
                  />
                  <IconBtn
                    icon={KeyRound}
                    title="Set password"
                    onClick={() => setPwdUser(u)}
                  />
                  {!isSelf && (
                    busy === u.id
                      ? <span style={{ padding: '4px 6px' }}><Loader size={12} strokeWidth={1.8} style={{ animation: 'spin 1s linear infinite' }} /></span>
                      : u.active
                        ? <IconBtn icon={UserX}     title="Deactivate" onClick={() => toggleActive(u)} danger />
                        : <IconBtn icon={UserCheck} title="Reactivate" onClick={() => toggleActive(u)} positive />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Modals */}
      <UserFormModal
        open={formOpen}
        editUser={editUser}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); onRefresh(); }}
      />
      <PasswordModal
        user={pwdUser}
        onClose={() => setPwdUser(null)}
        onSaved={() => setPwdUser(null)}
      />
      <UserQueueDialog
        open={Boolean(queueUser)}
        user={queueUser}
        onClose={() => setQueueUser(null)}
      />
    </section>
  );
}

/* ── User create/edit modal ─────────────────────────────────────────── */

function UserFormModal({ open, editUser, onClose, onSaved }) {
  const isEdit = Boolean(editUser);

  const [displayName,  setDisplayName]  = useState('');
  const [email,        setEmail]        = useState('');
  const [role,         setRole]         = useState('axis_ops');
  const [organisation, setOrganisation] = useState('');
  const [haulerId,     setHaulerId]     = useState('');
  const [password,     setPassword]     = useState('');
  const [showPw,       setShowPw]       = useState(false);
  const [busy,         setBusy]         = useState(false);
  const [err,          setErr]          = useState(null);

  // Populate fields when edit user changes
  const prevOpen = useState(false);
  if (open && editUser && displayName !== editUser.display_name && !busy) {
    setDisplayName(editUser.display_name || '');
    setEmail(editUser.email || '');
    setRole(editUser.role || 'axis_ops');
    setOrganisation(editUser.organisation || '');
    setHaulerId(editUser.hauler_id || '');
    setPassword('');
    setErr(null);
  }
  if (open && !editUser && prevOpen[0] !== open) {
    setDisplayName(''); setEmail(''); setRole('axis_ops');
    setOrganisation(''); setHaulerId(''); setPassword(''); setErr(null);
  }
  prevOpen[0] = open;

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const payload = isEdit
        ? { display_name: displayName.trim(), role, organisation: organisation.trim() || null, hauler_id: haulerId.trim() || null }
        : { display_name: displayName.trim(), email: email.trim().toLowerCase(), role, organisation: organisation.trim() || null, hauler_id: haulerId.trim() || null, password };

      const url    = isEdit ? `/api/admin/users/${editUser.id}` : '/api/admin/users';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Save failed'); return; }
      onSaved();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        <div style={modalHeaderStyle}>
          <span className="eyebrow">{isEdit ? 'Edit user' : 'Add user'}</span>
          <button type="button" onClick={onClose} style={closeBtnStyle}><X size={16} strokeWidth={1.5} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
          <Field label="Display name" required>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} placeholder="Kwame Boateng" required />
          </Field>

          {!isEdit && (
            <Field label="Email address" required>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="kwame@axis.gh" required />
            </Field>
          )}
          {isEdit && (
            <Field label="Email address">
              <div style={{ ...inputStyle, color: 'var(--text-tertiary)', cursor: 'not-allowed' }}>{email}</div>
            </Field>
          )}

          <Field label="Role" required>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <Field label="Organisation">
              <input value={organisation} onChange={(e) => setOrganisation(e.target.value)} style={inputStyle} placeholder="AXIS Operations" />
            </Field>
            <Field label={`Hauler ID${role === 'hauler_admin' ? ' *' : ''}`}>
              <input
                value={haulerId}
                onChange={(e) => setHaulerId(e.target.value)}
                style={inputStyle}
                placeholder="haul-01"
                required={role === 'hauler_admin'}
                disabled={role !== 'hauler_admin'}
              />
            </Field>
          </div>

          {!isEdit && (
            <Field label="Password" required>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ ...inputStyle, paddingRight: 36 }}
                  placeholder="Min 8 characters"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }}
                >
                  {showPw ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                </button>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>
                User will be asked to change this on first login (LP-5).
              </div>
            </Field>
          )}

          {err && <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-red)' }}>{err}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={busy} style={submitBtnStyle(busy)}>
              {busy ? <><Loader size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</> : isEdit ? 'Save changes' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Password reset modal ────────────────────────────────────────────── */

function PasswordModal({ user, onClose, onSaved }) {
  const [newPw,   setNewPw]   = useState('');
  const [showPw,  setShowPw]  = useState(false);
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState(null);
  const [done,    setDone]    = useState(false);

  function reset() { setNewPw(''); setErr(null); setDone(false); setShowPw(false); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (newPw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setErr(null);
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/users/${user.id}/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPw }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(data.error || 'Failed to set password'); return; }
      setDone(true);
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) { reset(); onClose(); } }}>
      <div style={{ ...modalStyle, maxWidth: 400 }}>
        <div style={modalHeaderStyle}>
          <span className="eyebrow">Set password — {user.display_name}</span>
          <button type="button" onClick={() => { reset(); onClose(); }} style={closeBtnStyle}><X size={16} strokeWidth={1.5} /></button>
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          {done ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)' }}>
                Password updated. {user.display_name}'s existing sessions have been revoked.
              </div>
              <button type="button" onClick={() => { reset(); onSaved(); }} style={submitBtnStyle(false)}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-secondary)' }}>
                Setting a new password will immediately sign {user.display_name} out of all active sessions.
              </div>
              <Field label="New password" required>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    style={{ ...inputStyle, paddingRight: 36 }}
                    placeholder="Min 8 characters"
                    minLength={8}
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2 }}
                  >
                    {showPw ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
                  </button>
                </div>
              </Field>
              {err && <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--signal-red)' }}>{err}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { reset(); onClose(); }} style={cancelBtnStyle}>Cancel</button>
                <button type="submit" disabled={busy} style={submitBtnStyle(busy)}>
                  {busy ? <><Loader size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />Setting…</> : 'Set password'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Small helpers ───────────────────────────────────────────────────── */

function Field({ label, required, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: 'var(--bauxite-rust)', marginLeft: 2 }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function IconBtn({ icon: Icon, title, onClick, danger, positive }) {
  const color = danger ? 'var(--signal-red)' : positive ? 'var(--signal-green)' : 'var(--text-tertiary)';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26,
        background: 'transparent',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        color,
        cursor: 'pointer',
        transition: 'background 100ms, border-color 100ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-tint)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={12} strokeWidth={1.8} />
    </button>
  );
}

/* ── Shared style tokens ─────────────────────────────────────────────── */

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'var(--space-4)',
};

const modalStyle = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
  width: '100%',
  maxWidth: 520,
  maxHeight: '90vh',
  overflowY: 'auto',
};

const modalHeaderStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border-hairline)',
};

const closeBtnStyle = {
  background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4,
  display: 'flex', alignItems: 'center',
};

const inputStyle = {
  width: '100%', padding: '7px 10px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const addBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '5px 10px',
  background: 'var(--bauxite-rust)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  letterSpacing: '0.01em',
};

const cancelBtnStyle = {
  padding: '7px 14px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

const submitBtnStyle = (busy) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '7px 16px',
  background: busy ? 'var(--surface-sunk)' : 'var(--bauxite-rust)',
  color: busy ? 'var(--text-tertiary)' : '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  fontFamily: 'inherit',
  cursor: busy ? 'not-allowed' : 'pointer',
});
