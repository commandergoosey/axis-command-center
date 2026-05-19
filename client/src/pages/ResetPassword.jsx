/*
 * ResetPassword — LP-5.
 *
 * Handles both password-reset and first-login invite flows.
 * Reads ?token=XXX from the URL, lets the user set a new password,
 * then redirects to Login with a success banner.
 *
 * This page is intentionally chrome-less — it sits outside the
 * authenticated Shell so it renders whether or not a session exists.
 */

import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { API_BASE } from '../lib/auth';
import AxisWordmark from '../components/brand/AxisWordmark';

export default function ResetPassword() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const token      = params.get('token') || '';

  const [password, setPassword]   = useState('');
  const [confirm,  setConfirm]    = useState('');
  const [busy,     setBusy]       = useState(false);
  const [error,    setError]      = useState(null);
  const [done,     setDone]       = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, new_password: password }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || `Error ${res.status}`);
        return;
      }
      setDone(true);
      // Redirect to login after a brief moment so the user can read the confirmation.
      setTimeout(() => navigate('/', { replace: true }), 2400);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-5)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5)',
      }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <AxisWordmark size={18} />
        </div>

        {!token ? (
          <div style={alertStyle('amber')}>
            No reset token found. Use the link from your email, or request a new one from the login page.
          </div>
        ) : done ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
            <CheckCircle2 size={32} strokeWidth={1.4} color="var(--signal-green)" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 'var(--ts-body-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)', marginBottom: 6 }}>
              Password set
            </div>
            <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
              Redirecting to sign-in…
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-2)' }}>
              <KeyRound size={16} strokeWidth={1.6} color="var(--bauxite-rust)" />
              <h1 style={headingStyle}>Set your password</h1>
            </div>
            <p style={subStyle}>
              Choose a password for your AXIS Command Center account. Must be at least 8 characters.
            </p>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <Field label="New password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  disabled={busy}
                  autoFocus
                />
              </Field>
              <Field label="Confirm password">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setError(null); }}
                  disabled={busy}
                />
              </Field>

              {error && (
                <div style={alertStyle('red')}>{error}</div>
              )}

              <button type="submit" disabled={busy || !password || !confirm} style={btnStyle(busy)}>
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </form>

            <div style={{ marginTop: 'var(--space-4)', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                style={ghostBtnStyle}
              >
                Back to sign in
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        input[type="password"] {
          width: 100%;
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border-hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: var(--font-primary);
          font-size: var(--ts-body-size);
          outline: none;
          box-sizing: border-box;
        }
        input[type="password"]:focus {
          border-color: var(--bauxite-rust);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      {children}
    </label>
  );
}

function alertStyle(tone) {
  const colors = {
    red:   { bg: 'rgba(139,46,26,0.08)',   border: 'rgba(139,46,26,0.3)',   color: 'var(--bauxite-rust)' },
    amber: { bg: 'rgba(217,158,55,0.08)',  border: 'rgba(217,158,55,0.3)',  color: 'var(--signal-amber)' },
  };
  const c = colors[tone] || colors.red;
  return {
    padding: '8px 12px',
    background: c.bg,
    border: `1px solid ${c.border}`,
    borderRadius: 'var(--radius-sm)',
    color: c.color,
    fontSize: 'var(--ts-caption-size)',
  };
}

function btnStyle(busy) {
  return {
    padding: '10px 16px',
    background: 'var(--bauxite-rust)',
    color: 'var(--bone)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-primary)',
    fontSize: 'var(--ts-body-size)',
    fontWeight: 'var(--fw-medium)',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };
}

const ghostBtnStyle = {
  background: 'none',
  border: 'none',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--ts-caption-size)',
  cursor: 'pointer',
  fontFamily: 'var(--font-primary)',
  padding: 0,
  textDecoration: 'underline',
};

const headingStyle = {
  margin: 0,
  fontSize: 'var(--ts-heading-sm-size)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text)',
};

const subStyle = {
  margin: '0 0 var(--space-4)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-secondary)',
};
