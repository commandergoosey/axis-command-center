/*
 * IntegrationHealthPanel — Phase 88.
 *
 * Per-hauler API sync log + summary. Shows what's actually
 * flowing into the cockpit from each hauler's integration:
 *   - 24h / 7d success rate + average latency
 *   - Top error codes with counts
 *   - Last successful sync timestamp
 *   - Recent attempts (sparkline-style row of dots)
 *   - Manual retry button (write roles only)
 *
 * Mounted on Settings between Users and existing Integrations
 * panels — gives operators the per-hauler trail behind the
 * api_status badge.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const STATUS_TONE = {
  connected: 'var(--signal-green)',
  degraded:  'var(--signal-amber)',
  failed:    'var(--bauxite-rust)',
  manual:    'var(--text-tertiary)',
  pending:   'var(--text-tertiary)',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

export default function IntegrationHealthPanel({ haulers }) {
  const { user } = useAuth();
  const canRetry = user && WRITE_ROLES.has(user.role);
  const [openHaulerId, setOpenHaulerId] = useState(null);

  // Filter to integrated haulers (skip manual, since they don't
  // have a sync log). Settings payload is flattened —
  // integration.type lives at the top level as `type`.
  const integrated = (haulers || []).filter((h) => {
    const type = h.type ?? h.integration?.type;
    return type && type !== 'manual';
  });

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4) var(--space-5)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-medium)', color: 'var(--text)',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <Activity size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
            Integration health
          </h2>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            Per-hauler API sync log. Click any hauler to see attempts, errors, and a manual retry.
          </p>
        </div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {integrated.length} integrated · checks every 5 min
        </span>
      </header>

      {integrated.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
          No integrated haulers yet.
        </p>
      ) : (
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-hairline)',
          overflow: 'hidden',
        }}>
          {integrated.map((h) => {
            // Normalise both shapes (raw hauler vs flattened settings entry).
            const id   = h.id ?? h.hauler_id;
            const type = h.type ?? h.integration?.type;
            const name = h.display_name;
            const normalised = { id, hauler_id: id, display_name: name, integration: { type } };
            return (
              <HaulerRow
                key={id}
                hauler={normalised}
                expanded={openHaulerId === id}
                onToggle={() => setOpenHaulerId(openHaulerId === id ? null : id)}
                canRetry={canRetry}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── Per-hauler row + expandable detail ───────────────────────────

function HaulerRow({ hauler, expanded, onToggle, canRetry }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authFetch(`/api/haulers/${hauler.id}/integration-health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, [hauler.id]);

  useEffect(() => {
    if (expanded && !data) load();
  }, [expanded, data, load]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const r = await authFetch(`/api/haulers/${hauler.id}/integration-retry`, { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      load();
    } catch (err) { setError(err.message); }
    finally { setRetrying(false); }
  }

  // Header tone uses the hauler's known api_status (from the
  // settings payload). The detail data refreshes on expand.
  const apiStatus = data?.api_status ?? hauler.api_status ?? 'connected';
  const tone = STATUS_TONE[apiStatus] || 'var(--text-tertiary)';

  return (
    <div style={{ borderBottom: '1px solid var(--border-hairline)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          padding: '12px 14px',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto auto auto',
          alignItems: 'center',
          columnGap: 12,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          textAlign: 'left',
        }}
      >
        {expanded ? <ChevronDown size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
                  : <ChevronRight size={14} strokeWidth={1.6} color="var(--text-tertiary)" />}
        <div>
          <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
            {hauler.display_name}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {hauler.id} · {hauler.integration?.type ?? 'manual'}
          </div>
        </div>
        <StatusPill label={apiStatus} tone={tone} />
        {data && (
          <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
            <span className="tabular" style={{ fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
              {data.health.last_24h.success_rate ?? '—'}%
            </span>
            <span> 24h · </span>
            <span className="tabular">{data.health.last_24h.avg_latency_ms ?? '—'}ms</span>
          </span>
        )}
        {data?.health?.last_success && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            last ok {relTime(data.health.last_success.attempted_at)}
          </span>
        )}
      </button>

      {expanded && (
        <div style={{
          padding: '0 14px 12px 28px',
          background: 'var(--surface-raised)',
        }}>
          {error && <p style={{ color: 'var(--bauxite-rust)' }}>{error}</p>}
          {!data ? (
            <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>Loading…</p>
          ) : (
            <Detail data={data} canRetry={canRetry} retrying={retrying} onRetry={retry} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail block ──────────────────────────────────────────────────

function Detail({ data, canRetry, retrying, onRetry }) {
  const h = data.health;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 'var(--space-3)',
      }}>
        <Metric label="24h success" value={h.last_24h.success_rate != null ? `${h.last_24h.success_rate}%` : '—'} sub={`${h.last_24h.successes} / ${h.last_24h.attempts} attempts`} tone={successRateTone(h.last_24h.success_rate)} />
        <Metric label="24h latency" value={h.last_24h.avg_latency_ms != null ? `${h.last_24h.avg_latency_ms}ms` : '—'} sub="successful syncs only" />
        <Metric label="7d success" value={h.last_7d.success_rate != null ? `${h.last_7d.success_rate}%` : '—'} sub={`${h.last_7d.successes} / ${h.last_7d.attempts} attempts`} tone={successRateTone(h.last_7d.success_rate)} />
        <Metric label="Last success" value={h.last_success ? relTime(h.last_success.attempted_at) : 'never'} sub={h.last_success ? new Date(h.last_success.attempted_at).toLocaleString('en-GB', { hour12: false }) : '—'} tone={h.last_success ? null : 'rust'} />
      </div>

      {h.top_errors && h.top_errors.length > 0 && (
        <div>
          <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
            TOP ERRORS · 24h
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {h.top_errors.map((e) => (
              <div key={e.error_code} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
                padding: '6px 10px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderLeft: '3px solid var(--bauxite-rust)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
              }}>
                <span>
                  <span className="mono" style={{ color: 'var(--bauxite-rust)', fontWeight: 'var(--fw-medium)', letterSpacing: '0.04em' }}>
                    {e.error_code}
                  </span>
                  <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>{e.error_message}</span>
                </span>
                <span className="tabular" style={{ color: 'var(--text-tertiary)' }}>
                  {e.n}×
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
          RECENT ATTEMPTS · last 30
        </div>
        <div style={{
          display: 'flex',
          gap: 2,
          flexWrap: 'wrap',
        }}>
          {h.recent_attempts.map((a) => (
            <span
              key={a.id}
              title={`${new Date(a.attempted_at).toLocaleTimeString('en-GB', { hour12: false })} · ${a.success ? 'OK · ' + a.latency_ms + 'ms' : a.error_code + ': ' + a.error_message}`}
              style={{
                width: 8, height: 14,
                borderRadius: 1,
                background: a.success ? 'var(--signal-green)' : 'var(--bauxite-rust)',
                opacity: a.success ? 0.8 : 1,
              }}
            />
          ))}
        </div>
      </div>

      {canRetry && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            style={{
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
              cursor: retrying ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              opacity: retrying ? 0.6 : 1,
            }}
          >
            <RefreshCw size={11} strokeWidth={1.8} />
            {retrying ? 'Retrying…' : 'Manual retry'}
          </button>
        </div>
      )}
    </div>
  );
}

function successRateTone(pct) {
  if (pct == null) return 'tertiary';
  if (pct >= 95) return 'green';
  if (pct >= 85) return 'amber';
  return 'rust';
}

function Metric({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: '8px 10px',
      background: 'var(--surface)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)' }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-body-size)',
        fontWeight: 'var(--fw-medium)',
        color,
        marginTop: 2,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function StatusPill({ label, tone }) {
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 10,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>
      {label}
    </span>
  );
}

function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
