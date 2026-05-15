/*
 * IntegrationPanel — per-hauler live-adapter controls inside HaulerDetail.
 * Loconav: paste API token, Probe. Geotab: database + username + password.
 * Manual: paste or drop a CSV payload with the three required columns.
 *
 * The probe endpoint responds with { live, ok, account_name, fleet_vehicles,
 * note }. We render that verbatim so the operator can see whether the stored
 * token is routable to the real Loconav tenant or landed in sandbox-degrade.
 */

import { authFetch } from '../../lib/auth';

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, Upload, KeyRound, Trash2 } from 'lucide-react';

const LIVE_TONE     = { color: 'var(--signal-green)', bg: 'rgba(46, 107, 63, 0.08)',  border: 'rgba(46, 107, 63, 0.3)' };
const SIM_TONE      = { color: 'var(--signal-amber)', bg: 'rgba(217, 158, 55, 0.08)', border: 'rgba(217, 158, 55, 0.3)' };
const FAIL_TONE     = { color: 'var(--bauxite-rust)', bg: 'rgba(139, 46, 26, 0.08)',  border: 'rgba(139, 46, 26, 0.3)' };

const SAMPLE_CSV = 'date,truck,tonnes,delay_min,note\n2026-04-19,H05-001,39.8,4,Cleared Nyinahin 07:42\n2026-04-20,H05-002,40.1,0,';

export default function IntegrationPanel({ hauler, onSynced }) {
  const type    = hauler.integration.type;
  const adapter = hauler.integration.adapter;

  const [state,   setState]   = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState(null);

  // Loconav
  const [token, setToken] = useState('');
  // Geotab
  const [database,  setDatabase]  = useState('');
  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  // Manual
  const [csv, setCsv] = useState('');

  const loadState = useCallback(async () => {
    try {
      const res = await authFetch(`/api/haulers/${hauler.id}/integration`);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.json();
      setState(body.state);
      setResult(body.state?.last_probe || null);
    } catch (err) {
      setError(err.message);
    }
  }, [hauler.id]);

  useEffect(() => { loadState(); }, [loadState]);

  async function probe() {
    setBusy(true);
    setError(null);
    try {
      let body;
      if (type === 'loconav')                     body = { token };
      else if (type === 'custom' && adapter === 'geotab') body = { database, username, password };
      else if (type === 'manual')                 body = { csv_text: csv };
      else throw new Error(`Unsupported integration type "${type}"`);
      const res = await authFetch(`/api/haulers/${hauler.id}/integration/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `probe ${res.status}`);
      setResult(payload.probe);
      setState(payload.state);
      onSynced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCsv() {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/haulers/${hauler.id}/integration/csv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv_text: csv }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `csv ${res.status}`);
      setResult({
        ok: true,
        live: false,
        account_name: 'Manual CSV',
        rows_parsed: payload.rows_loaded,
        note: payload.errors?.length ? `${payload.errors.length} row(s) skipped` : 'Parsed cleanly',
      });
      setState(payload.state);
      onSynced?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearToken() {
    setBusy(true);
    try {
      const res = await authFetch(`/api/haulers/${hauler.id}/integration/token`, { method: 'DELETE' });
      const payload = await res.json();
      setState(payload.state);
      setResult(null);
      setToken('');
      onSynced?.();
    } finally {
      setBusy(false);
    }
  }

  const hasCreds = state?.has_credentials;
  const isLive   = state?.live;

  return (
    <section style={{ marginBottom: 'var(--space-4)' }}>
      <h3 className="micro" style={{ margin: '0 0 10px', color: 'var(--text-tertiary)' }}>
        Integration setup
      </h3>
      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--radius-sm)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}>
        <StatusRow state={state} type={type} />

        {type === 'loconav' && (
          <Field label="Loconav API token">
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="loc_••••••••"
              disabled={busy}
            />
          </Field>
        )}

        {type === 'custom' && adapter === 'geotab' && (
          <>
            <Field label="MyGeotab database">
              <input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="axis_corridor" disabled={busy} />
            </Field>
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="integration@axis.gh" disabled={busy} />
            </Field>
            <Field label="Password">
              <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </Field>
          </>
        )}

        {type === 'manual' && (
          <Field label="CSV payload · date,truck,tonnes,delay_min,note">
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={SAMPLE_CSV}
              rows={6}
              disabled={busy}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </Field>
        )}

        {error && (
          <div style={{
            padding: '6px 10px',
            background: FAIL_TONE.bg,
            border: `1px solid ${FAIL_TONE.border}`,
            borderRadius: 'var(--radius-sm)',
            color: FAIL_TONE.color,
            fontSize: 'var(--ts-caption-size)',
          }}>
            {error}
          </div>
        )}

        {result && <ProbeResult result={result} />}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          {hasCreds ? (
            <button
              type="button"
              onClick={clearToken}
              disabled={busy}
              style={secondaryBtn}
            >
              <Trash2 size={12} strokeWidth={1.6} /> Clear credentials
            </button>
          ) : <span />}

          {type === 'manual' ? (
            <button
              type="button"
              onClick={uploadCsv}
              disabled={busy || !csv.trim()}
              style={primaryBtn(busy)}
            >
              <Upload size={12} strokeWidth={1.8} />
              {busy ? 'Loading…' : 'Load CSV'}
            </button>
          ) : (
            <button
              type="button"
              onClick={probe}
              disabled={busy || (type === 'loconav' ? token.length < 12 : !database || !username || !password)}
              style={primaryBtn(busy)}
            >
              <KeyRound size={12} strokeWidth={1.8} />
              {busy ? 'Probing…' : (hasCreds ? 'Re-probe' : 'Probe connection')}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusRow({ state, type }) {
  const defaultTone = { color: 'var(--text-tertiary)', bg: 'var(--surface-raised)', border: 'var(--border-hairline)' };
  let tone = defaultTone;
  let label = 'NO CREDENTIALS';
  if (type === 'manual') {
    if (state?.csv_rows > 0) { tone = LIVE_TONE; label = `CSV LOADED · ${state.csv_rows} rows`; }
    else                      { label = 'NO CSV UPLOADED'; }
  } else if (state?.live) {
    tone = LIVE_TONE;
    label = 'LIVE · credentials accepted';
  } else if (state?.has_credentials) {
    tone = SIM_TONE;
    label = 'STORED · not yet live';
  }
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '6px 10px',
      background: tone.bg,
      border: `1px solid ${tone.border}`,
      borderRadius: 'var(--radius-sm)',
    }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: tone.color }}>
        {label}
      </span>
      {state?.last_sync && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          sync · {new Date(state.last_sync).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}

function ProbeResult({ result }) {
  const tone = result.live ? LIVE_TONE : result.ok ? SIM_TONE : FAIL_TONE;
  const Icon = result.ok ? CheckCircle2 : AlertTriangle;
  return (
    <div style={{
      padding: '10px 12px',
      background: tone.bg,
      border: `1px solid ${tone.border}`,
      borderRadius: 'var(--radius-sm)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: tone.color, fontSize: 'var(--ts-body-sm-size)' }}>
        <Icon size={14} strokeWidth={1.8} />
        <span style={{ fontWeight: 'var(--fw-medium)' }}>{result.account_name}</span>
        {result.fleet_vehicles != null && <span style={{ color: 'var(--text-secondary)' }}>· {result.fleet_vehicles} vehicles</span>}
        {result.rows_parsed != null && <span style={{ color: 'var(--text-secondary)' }}>· {result.rows_parsed} rows</span>}
      </div>
      {result.note && (
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
          {result.note}
        </span>
      )}
    </div>
  );
}

const primaryBtn = (busy) => ({
  padding: '6px 14px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bauxite-rust)',
  color: 'var(--bone)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-caption-size)',
  fontWeight: 'var(--fw-medium)',
  cursor: busy ? 'wait' : 'pointer',
  opacity: busy ? 0.7 : 1,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
});

const secondaryBtn = {
  padding: '6px 10px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-caption-size)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <span className="int-field" style={{ display: 'block' }}>{children}</span>
      <style>{`
        .int-field input, .int-field textarea {
          width: 100%;
          padding: 8px 10px;
          background: var(--surface-raised);
          border: 1px solid var(--border-hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-family: var(--font-primary);
          font-size: var(--ts-body-sm-size);
          outline: none;
          box-sizing: border-box;
        }
        .int-field textarea { resize: vertical; }
        .int-field input:focus, .int-field textarea:focus {
          border-color: var(--bauxite-rust);
        }
      `}</style>
    </label>
  );
}
