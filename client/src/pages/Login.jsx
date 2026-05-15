/*
 * Login — AXIS Command Center sign-in.
 * Two columns: the form (left) and a demo-account register (right) that
 * lists every seeded account so a reviewer can one-click into each role.
 */

import { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { API_BASE } from '../lib/auth';
import AxisWordmark from '../components/brand/AxisWordmark';

const ROLE_LABEL = {
  axis_admin:   'AXIS Admin',
  axis_ops:     'AXIS Ops',
  hauler_admin: 'Hauler admin',
  lender:       'Lender · GIBDLC',
};

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState(null);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/demo`)
      .then((r) => r.json())
      .then((b) => setAccounts(b.accounts || []))
      .catch(() => { /* demo endpoint optional */ });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      // AuthProvider will flip status to 'ready'; App.jsx's gate will render the
      // real Shell and React Router will take it from there. Nothing to do here.
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(acc) {
    setEmail(acc.email);
    setPassword(acc.password_hint);
    setError(null);
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--surface)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 480px) minmax(0, 1fr)',
      gap: 0,
    }}>
      {/* Form panel */}
      <div style={{
        background: 'var(--surface-raised)',
        borderRight: '1px solid var(--border-hairline)',
        padding: 'var(--space-6) var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
      }}>
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <AxisWordmark size={20} />
          <div className="mono" style={{
            marginTop: 6,
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-tertiary)',
          }}>
            NYINAHIN · TAKORADI · 300 KM
          </div>
        </div>

        <h1 style={{
          margin: '0 0 4px',
          fontSize: 'var(--ts-h1-size)',
          lineHeight: 'var(--ts-h1-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
          letterSpacing: '-0.01em',
        }}>
          Sign in
        </h1>
        <p style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
        }}>
          AXIS Command Center · Corridor operations control.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@axis.gh"
              disabled={busy}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </Field>

          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(139, 46, 26, 0.08)',
              border: '1px solid rgba(139, 46, 26, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--bauxite-rust)',
              fontSize: 'var(--ts-caption-size)',
            }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            marginTop: 6,
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
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}>
            <LogIn size={14} strokeWidth={1.8} />
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{
          marginTop: 'var(--space-6)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
        }}>
          Demonstration mode · v0.1.0 · Phase 11 replaces this screen with an identity provider.
        </div>
      </div>

      {/* Demo account register */}
      <div style={{
        padding: 'var(--space-6) var(--space-5)',
        background: 'var(--surface)',
      }}>
        <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--text-tertiary)' }}>
          Demo accounts
        </div>
        <h2 style={{
          margin: '0 0 4px',
          fontSize: 'var(--ts-h2-size)',
          lineHeight: 'var(--ts-h2-lh)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text)',
        }}>
          Four roles, four perspectives
        </h2>
        <p style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          maxWidth: 560,
        }}>
          Each account shows a different slice of the corridor. Click any card to fill the form, then sign in to see the role-scoped navigation and available actions.
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--space-3)',
          maxWidth: 720,
        }}>
          {accounts.map((acc) => (
            <button
              key={acc.email}
              type="button"
              onClick={() => fillDemo(acc)}
              style={{
                textAlign: 'left',
                padding: 'var(--space-3)',
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                fontFamily: 'var(--font-primary)',
              }}
            >
              <div className="mono" style={{
                fontSize: 10,
                letterSpacing: '0.08em',
                color: 'var(--bauxite-rust)',
                marginBottom: 2,
              }}>
                {ROLE_LABEL[acc.role] || acc.role}
              </div>
              <div style={{ fontSize: 'var(--ts-body-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
                {acc.display_name}
              </div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
                {acc.organisation}
              </div>
              <div style={{
                marginTop: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-tertiary)',
              }}>
                {acc.email} · pw: {acc.password_hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      <style>{`
        input[type="email"], input[type="password"] {
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
        input[type="email"]:focus, input[type="password"]:focus {
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
