/*
 * Audit panel — platform-wide write history. AXIS Admin only; the server
 * returns 403 for other roles and the panel hides itself in that case.
 * Paginated by a "Load more" button; filter chips narrow by entity type.
 */

import { authFetch } from '../../lib/auth';
import { useCallback, useEffect, useState } from 'react';
import { History, Search, Download } from 'lucide-react';

// Phase 41 — chip filters extended to cover the lifecycle entity types
// added in Phases 30–38 (HSE incidents, driver licences, dispatcher
// coaching, workshop work orders). Order: highest-volume operational
// streams first, then governance.
const ENTITY_FILTERS = [
  { value: '',                 label: 'All' },
  { value: 'alert',            label: 'Alerts' },
  { value: 'hse_incident',     label: 'HSE' },
  { value: 'licence',          label: 'Licences' },
  { value: 'coaching_session', label: 'Coaching' },
  { value: 'workorder',        label: 'Work orders' },
  { value: 'filing',           label: 'Filings' },
  { value: 'report',           label: 'Reports' },
  { value: 'hauler',           label: 'Haulers' },
  { value: 'integration',      label: 'Integrations' },
];

const ACTION_TONE = {
  // Lifecycle progressors
  create:      'var(--text-secondary)',
  open:        'var(--signal-amber)',
  progress:    'var(--text-secondary)',
  close:       'var(--signal-green)',
  resolve:     'var(--signal-green)',
  renew:       'var(--signal-green)',
  auto_clear:  'var(--signal-green)',
  // Earlier governance verbs
  reopen:      'var(--signal-amber)',
  snooze:      'var(--signal-amber)',
  assign:      'var(--text-secondary)',
  unassign:    'var(--text-tertiary)',
  note:        'var(--text-secondary)',
  mark_filed:  'var(--signal-green)',
  generate:    'var(--text-secondary)',
  onboard:     'var(--signal-green)',
  probe_ok:    'var(--signal-green)',
  probe_failed:'var(--bauxite-rust)',
  csv_upload:  'var(--text-secondary)',
  rotate_token:'var(--signal-amber)',
};

const ENTITY_LABEL = {
  alert:            'Alert',
  hse_incident:     'HSE',
  licence:          'Licence',
  coaching_session: 'Coaching',
  workorder:        'Work order',
  filing:           'Filing',
  report:           'Report',
  hauler:           'Hauler',
  integration:      'Integration',
};

const PAGE_SIZE = 25;

export default function AuditPanel() {
  const [rows,       setRows]       = useState([]);
  const [total,      setTotal]      = useState(0);
  const [entityType, setEntityType] = useState('');
  // Phase 55 — full-text search. `query` is the field state (controlled
  // input); `appliedQuery` is what's actually been sent to the server.
  // The user has to press Enter (or click outside) to commit, so keystrokes
  // don't fire one fetch each.
  const [query,        setQuery]        = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  // Phase 66 — date range pickers + actor filter. Since/until are
  // YYYY-MM-DD strings; we expand them to ISO timestamps server-side
  // (since = start of day UTC, until = end of day UTC).
  const [sinceDate, setSinceDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [actorId,   setActorId]   = useState('');
  const [users,     setUsers]     = useState([]);
  const [forbidden,  setForbidden]  = useState(false);
  const [error,      setError]      = useState(null);
  const [loading,    setLoading]    = useState(false);

  // Pull the user roster once so the actor dropdown has names.
  useEffect(() => {
    authFetch('/api/auth/users')
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((j) => setUsers(j.users ?? []))
      .catch(() => { /* dropdown is decorative if fetch fails */ });
  }, []);

  // Compose the filter query string — shared between list + export.
  const buildQs = useCallback(() => {
    const qs = new URLSearchParams();
    if (entityType)   qs.set('entity_type', entityType);
    if (appliedQuery) qs.set('q',           appliedQuery);
    if (sinceDate)    qs.set('since',       `${sinceDate}T00:00:00Z`);
    if (untilDate)    qs.set('until',       `${untilDate}T23:59:59Z`);
    if (actorId)      qs.set('actor_user_id', actorId);
    return qs;
  }, [entityType, appliedQuery, sinceDate, untilDate, actorId]);

  const load = useCallback(async ({ reset = false } = {}) => {
    setLoading(true);
    try {
      const offset = reset ? 0 : rows.length;
      const qs = buildQs();
      qs.set('limit', String(PAGE_SIZE));
      qs.set('offset', String(offset));
      const res = await authFetch(`/api/audit?${qs.toString()}`);
      if (res.status === 403) { setForbidden(true); return; }
      if (!res.ok) throw new Error(`audit ${res.status}`);
      const body = await res.json();
      setRows((prev) => (reset ? body.rows : [...prev, ...body.rows]));
      setTotal(body.total);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, appliedQuery, sinceDate, untilDate, actorId]);

  useEffect(() => { load({ reset: true }); }, [load]);

  // Phase 55 — Export CSV opens a download via authFetch (we have to
  // keep the bearer token in the header) and feeds it to the browser
  // through a temporary blob URL. Phase 66 — uses the same buildQs()
  // so the export reflects whatever filter set is currently applied.
  const exportCsv = async () => {
    const qs = buildQs();
    try {
      const res = await authFetch(`/api/audit/export.csv?${qs.toString()}`);
      if (!res.ok) throw new Error(`export ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const filename = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]
        ?? 'axis-audit.csv';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`Export failed — ${err.message}`);
    }
  };

  if (forbidden) return null;

  const remaining = Math.max(0, total - rows.length);

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        gap: 'var(--space-3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Audit log</span>
        </div>
        {/* Phase 55 — search + export. Search submits on Enter to keep
            the request rate sane. Export streams a CSV under the same
            entity/q filter so what you see is what gets exported. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
          <div style={{ position: 'relative', maxWidth: 280, flex: 1 }}>
            <Search
              size={11}
              strokeWidth={1.8}
              color="var(--text-tertiary)"
              style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setAppliedQuery(query.trim()); }}
              onBlur={() => setAppliedQuery(query.trim())}
              placeholder="Search summary, actor, entity, payload…"
              style={{
                width: '100%',
                padding: '4px 8px 4px 24px',
                fontSize: 11,
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <button
            type="button"
            onClick={exportCsv}
            title="Download the current filter set as CSV"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Download size={11} strokeWidth={1.6} />
            Export
          </button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {rows.length} of {total}
          </span>
        </div>
      </header>

      {/* Phase 66 — date range pickers + actor filter. Sits above the
          entity-type chips so the operator's mental model is "narrow
          by who/when" → "narrow by what kind of write". */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto auto auto 1fr',
        gap: 'var(--space-3)',
        alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
      }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          From
          <input
            type="date"
            value={sinceDate}
            onChange={(e) => setSinceDate(e.target.value)}
            style={dateInputStyle}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          To
          <input
            type="date"
            value={untilDate}
            onChange={(e) => setUntilDate(e.target.value)}
            style={dateInputStyle}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Actor
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            style={dateInputStyle}
          >
            <option value="">Any</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name}</option>
            ))}
          </select>
        </label>
        {(sinceDate || untilDate || actorId) && (
          <button
            type="button"
            onClick={() => { setSinceDate(''); setUntilDate(''); setActorId(''); }}
            style={{
              fontSize: 11,
              color: 'var(--bauxite-rust)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: '2px 6px',
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        {ENTITY_FILTERS.map((f) => {
          const active = entityType === f.value;
          return (
            <button
              key={f.value || 'all'}
              type="button"
              onClick={() => setEntityType(f.value)}
              style={{
                padding: '5px 10px',
                background: active ? 'var(--bauxite-rust)' : 'transparent',
                border: `1px solid ${active ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
                color: active ? 'var(--bone)' : 'var(--text-secondary)',
                borderRadius: 999,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border-hairline)',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--bauxite-rust)',
        }}>
          Audit feed unavailable — {error}
        </div>
      )}

      {rows.length === 0 && !loading ? (
        <div style={{
          padding: 'var(--space-5)',
          textAlign: 'center',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-tertiary)',
        }}>
          No audit entries yet. Write actions appear here.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {rows.map((r) => (
            <li key={r.id} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 140px) minmax(0, 90px) minmax(0, 80px) minmax(0, 1fr) minmax(0, 160px)',
              gap: 'var(--space-3)',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--border-hairline)',
            }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {fmtTs(r.ts)}
              </span>
              <span className="mono" style={{
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-secondary)',
              }}>
                {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
              </span>
              <span className="mono" style={{
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: ACTION_TONE[r.action] ?? 'var(--text-secondary)',
              }}>
                {r.action}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {r.summary || `${r.entity_type}/${r.entity_id}`}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {r.entity_id}
                </div>
              </div>
              <div style={{ minWidth: 0, textAlign: 'right' }}>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
                  {r.actor?.display_name ?? '—'}
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {r.actor?.role ?? '—'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {remaining > 0 && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          textAlign: 'center',
        }}>
          <button
            type="button"
            onClick={() => load({ reset: false })}
            disabled={loading}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              color: 'var(--text-secondary)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, remaining)} more`}
          </button>
        </div>
      )}
    </section>
  );
}

function fmtTs(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Phase 66 — shared style for date inputs + actor select. Compact,
// matches the chip-row visual register.
const dateInputStyle = {
  padding: '4px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11,
  color: 'var(--text)',
  fontFamily: 'inherit',
};
