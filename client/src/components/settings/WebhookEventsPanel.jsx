/*
 * WebhookEventsPanel — LP-23.
 *
 * Shows the recent webhook_events log with filter controls (hauler,
 * source, status). Failed events (processed = -1) can be retried.
 * axis_admin only — the panel hides itself for lower roles.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, RotateCcw, ChevronRight, ChevronLeft } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth }   from '../../lib/AuthContext';

const STATUS_OPTS = [
  { value: '',   label: 'All' },
  { value: '0',  label: 'Pending' },
  { value: '1',  label: 'Processed' },
  { value: '-1', label: 'Failed' },
];

function statusBadge(p) {
  if (p === 1)  return { label: 'OK',      bg: 'rgba(46,107,63,.10)',  fg: 'var(--signal-green)' };
  if (p === -1) return { label: 'FAILED',  bg: 'rgba(139,46,26,.10)', fg: 'var(--bauxite-rust)' };
  return               { label: 'PENDING', bg: 'rgba(217,158,55,.10)',fg: 'var(--signal-amber)' };
}

export default function WebhookEventsPanel() {
  const { user } = useAuth();
  const [events,  setEvents]  = useState([]);
  const [total,   setTotal]   = useState(0);
  const [offset,  setOffset]  = useState(0);
  const [filter,  setFilter]  = useState({ source: '', processed: '' });
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [error,   setError]   = useState(null);

  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: LIMIT, offset });
      if (filter.source)    qs.set('source',    filter.source);
      if (filter.processed) qs.set('processed', filter.processed);
      const res = await authFetch(`/api/admin/webhooks?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setEvents(j.events ?? []);
      setTotal(j.total ?? 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [offset, filter]);

  useEffect(() => { if (user?.role === 'axis_admin') load(); }, [load, user]);

  const retry = async (id) => {
    setRetrying(id);
    try {
      const res = await authFetch(`/api/admin/webhooks/${id}/retry`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRetrying(null);
    }
  };

  if (user?.role !== 'axis_admin') return null;

  const pages = Math.ceil(total / LIMIT);
  const page  = Math.floor(offset / LIMIT) + 1;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Webhook events</span>

        {/* Filters */}
        <select
          value={filter.source}
          onChange={(e) => { setFilter((f) => ({ ...f, source: e.target.value })); setOffset(0); }}
          style={selectStyle}
        >
          <option value="">All sources</option>
          <option value="loconav">Loconav</option>
          <option value="custom">Custom</option>
        </select>

        <select
          value={filter.processed}
          onChange={(e) => { setFilter((f) => ({ ...f, processed: e.target.value })); setOffset(0); }}
          style={selectStyle}
        >
          {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{ ...iconBtnStyle, marginLeft: 'auto' }}
        >
          <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>

        {/* Pagination */}
        {pages > 1 && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
            <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0} style={iconBtnStyle}>
              <ChevronLeft size={11} />
            </button>
            {page} / {pages}
            <button onClick={() => setOffset(offset + LIMIT)} disabled={page >= pages} style={iconBtnStyle}>
              <ChevronRight size={11} />
            </button>
          </span>
        )}
      </header>

      {error && (
        <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--bauxite-rust)', background: 'rgba(139,46,26,.06)' }}>
          {error}
        </div>
      )}

      {!loading && events.length === 0 ? (
        <div style={{ padding: '24px 16px', fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)', textAlign: 'center' }}>
          No events match the current filter.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {events.map((ev) => {
            const badge = statusBadge(ev.processed);
            return (
              <li key={ev.id} style={{
                padding: '8px 16px',
                borderTop: '1px solid var(--border-hairline)',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center',
                gap: 12,
                opacity: ev.processed === 1 ? 0.75 : 1,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--text)' }}>{ev.id}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                      textTransform: 'uppercase', padding: '1px 6px', borderRadius: 999,
                      background: badge.bg, color: badge.fg,
                    }}>{badge.label}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                      {ev.source} · {ev.event_type ?? 'unknown'}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {ev.hauler_id}
                    </span>
                  </div>
                  {ev.raw_preview && (
                    <div className="mono" style={{
                      fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {ev.raw_preview}
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {new Date(ev.received_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })}
                  </div>
                </div>

                {ev.processed === -1 && (
                  <button
                    onClick={() => retry(ev.id)}
                    disabled={retrying === ev.id}
                    title="Retry this event"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', fontSize: 10, fontWeight: 600,
                      border: '1px solid var(--border-hairline)',
                      background: 'var(--surface)', borderRadius: 999,
                      color: 'var(--text-secondary)', cursor: 'pointer',
                      fontFamily: 'inherit', letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}
                  >
                    <RotateCcw size={9} />
                    {retrying === ev.id ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}

const selectStyle = {
  fontSize: 10, padding: '3px 6px',
  border: '1px solid var(--border-hairline)',
  background: 'var(--surface)', color: 'var(--text)',
  borderRadius: 4, fontFamily: 'inherit',
};

const iconBtnStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, padding: 0,
  border: '1px solid var(--border-hairline)',
  background: 'var(--surface)', borderRadius: 4,
  color: 'var(--text-secondary)', cursor: 'pointer',
};
