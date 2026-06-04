/*
 * Audit Log — Phase 95.
 *
 * Every write on the AXIS platform calls writeAudit(). This page
 * surfaces the full log so the axis_admin can answer "who changed
 * what, and when?" — a requirement for GIADEC oversight and GIBDLC
 * lender reporting.
 *
 * Route: GET /api/audit (Phase 55)
 *   Params: entity_type, action, actor_user_id, q, since, until,
 *           limit, offset
 * Export: GET /api/audit/export.csv — same scope, up to 5,000 rows.
 *
 * Access: axis_admin only (enforced at the API layer via requireRole;
 * the client Guard + ROLE_PAGES adds a second check at the UI layer).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, ChevronLeft, ChevronRight, X } from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import { authFetch } from '../lib/auth';

/* ── Action chip colours ─────────────────────────────────────────── */
const ACTION_TONE = {
  create:   { bg: 'rgba(46,107,63,0.1)',   color: 'var(--signal-green)'  },
  resolve:  { bg: 'rgba(46,107,63,0.1)',   color: 'var(--signal-green)'  },
  close:    { bg: 'rgba(46,107,63,0.1)',   color: 'var(--signal-green)'  },
  renew:    { bg: 'rgba(46,107,63,0.1)',   color: 'var(--signal-green)'  },
  generate: { bg: 'rgba(46,107,63,0.1)',   color: 'var(--signal-green)'  },
  assign:   { bg: 'rgba(217,158,55,0.1)',  color: 'var(--signal-amber)'  },
  reassign: { bg: 'rgba(217,158,55,0.1)',  color: 'var(--signal-amber)'  },
  unassign: { bg: 'rgba(217,158,55,0.1)',  color: 'var(--signal-amber)'  },
  comment:  { bg: 'rgba(217,158,55,0.1)',  color: 'var(--signal-amber)'  },
  open:     { bg: 'rgba(139,46,26,0.08)',  color: 'var(--bauxite-rust)'  },
  delete:   { bg: 'rgba(139,46,26,0.08)',  color: 'var(--bauxite-rust)'  },
  update:   { bg: 'rgba(139,46,26,0.08)',  color: 'var(--bauxite-rust)'  },
};

function actionTone(action) {
  return ACTION_TONE[action] || { bg: 'rgba(0,0,0,0.05)', color: 'var(--text-tertiary)' };
}

/* ── Entity type display labels ──────────────────────────────────── */
const ENTITY_LABEL = {
  action_item:       'Action item',
  hse_incident:      'HSE incident',
  lender_pack:       'Lender pack',
  workorder:         'Work order',
  licence:           'Licence',
  risk_step:         'Risk step',
  risk_comment:      'Risk comment',
  risk:              'Risk',
  coaching_session:  'Coaching session',
  alert:             'Alert',
  broadcast:         'Broadcast',
  handover_note:     'Handover note',
  filing:            'Filing',
  report:            'Report',
  integration:       'Integration',
  hauler:            'Hauler',
  settlement:        'Settlement',
  claim:             'Claim',
};

function entityLabel(type) {
  return ENTITY_LABEL[type] || type?.replace(/_/g, ' ') || '—';
}

/* ── Time helpers ────────────────────────────────────────────────── */
function formatFull(ts) {
  return new Date(ts).toLocaleString('en-GB', {
    timeZone: 'Africa/Accra',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function formatRelative(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return formatFull(ts).slice(0, 11);
}

/* ── Role badge ──────────────────────────────────────────────────── */
const ROLE_META = {
  axis_admin: { label: 'Admin',  color: 'var(--bauxite-rust)' },
  axis_ops:   { label: 'Ops',    color: 'var(--bauxite-rust)' },
  lender:     { label: 'Lender', color: 'var(--signal-green)' },
  hauler_admin: { label: 'Hauler', color: 'var(--signal-amber)' },
};

const PAGE_SIZE = 50;

/* ══════════════════════════════════════════════════════════════════ */
/*  Page                                                             */
/* ══════════════════════════════════════════════════════════════════ */

export default function AuditLog() {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(0);

  /* Filters */
  const [entityType, setEntityType] = useState('');
  const [action,     setAction]     = useState('');
  const [q,          setQ]          = useState('');
  const [since,      setSince]      = useState('');
  const [until,      setUntil]      = useState('');

  const qInputRef = useRef(null);

  const load = useCallback(async (pg = 0) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('limit',  String(PAGE_SIZE));
      qs.set('offset', String(pg * PAGE_SIZE));
      if (entityType) qs.set('entity_type', entityType);
      if (action)     qs.set('action',      action);
      if (q.trim())   qs.set('q',           q.trim());
      if (since)      qs.set('since',       since);
      if (until)      qs.set('until',       until + 'T23:59:59Z');
      const r = await authFetch(`/api/audit?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [entityType, action, q, since, until]);

  /* Reset to page 0 whenever a filter changes */
  useEffect(() => {
    setPage(0);
    load(0);
  }, [load]);

  function goPage(p) {
    setPage(p);
    load(p);
  }

  /* Build export CSV URL with current filters */
  function exportUrl() {
    const qs = new URLSearchParams();
    if (entityType) qs.set('entity_type', entityType);
    if (action)     qs.set('action',      action);
    if (q.trim())   qs.set('q',           q.trim());
    if (since)      qs.set('since',       since);
    if (until)      qs.set('until',       until + 'T23:59:59Z');
    return `/api/audit/export.csv?${qs.toString()}`;
  }

  /* Derived */
  const rows    = data?.rows   ?? [];
  const total   = data?.total  ?? 0;
  const pages   = Math.ceil(total / PAGE_SIZE);
  const anyFilter = entityType || action || q || since || until;

  /* Build entity_type options from current result set */
  const entityOptions = useMemo(() => {
    const known = Object.keys(ENTITY_LABEL).sort();
    return ['', ...known];
  }, []);

  const actionOptions = [
    '', 'assign', 'close', 'comment', 'create', 'delete',
    'generate', 'open', 'reassign', 'renew', 'resolve', 'unassign', 'update',
  ];

  function clearFilters() {
    setEntityType('');
    setAction('');
    setQ('');
    setSince('');
    setUntil('');
    if (qInputRef.current) qInputRef.current.value = '';
  }

  return (
    <PageShell
      eyebrow="Platform"
      title="Audit Log"
      description="Every state-changing action on the AXIS platform is recorded here. Filter by entity type, action, or free-text search across summaries. Export to CSV for GIADEC regulatory submissions or GIBDLC side-letter audit packs."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

        {/* ── KPI strip ─────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--space-3)',
        }}>
          <KpiTile label="Total entries" value={loading ? '…' : total.toLocaleString()} />
          <KpiTile
            label="Showing"
            value={loading ? '…' : rows.length.toLocaleString()}
            sub={anyFilter ? 'filtered' : `page ${page + 1} of ${pages || 1}`}
          />
          <KpiTile
            label="Newest entry"
            value={rows[0] ? formatRelative(rows[0].ts) : '—'}
            sub={rows[0] ? formatFull(rows[0].ts) : ''}
          />
          <div style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
          }}>
            <a
              href={exportUrl()}
              download
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text)',
                fontWeight: 'var(--fw-medium)',
                textDecoration: 'none',
                fontFamily: 'inherit',
              }}
            >
              <Download size={13} strokeWidth={1.6} />
              Export CSV
            </a>
          </div>
        </div>

        {/* ── Filter bar ────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: 'var(--space-3)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
        }}>
          {/* Entity type */}
          <FilterSelect
            label="Type"
            value={entityType}
            onChange={setEntityType}
            options={entityOptions.map((v) => [v, v ? entityLabel(v) : 'All types'])}
          />

          {/* Action */}
          <FilterSelect
            label="Action"
            value={action}
            onChange={setAction}
            options={actionOptions.map((v) => [v, v || 'All actions'])}
          />

          {/* Since date */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="micro" style={{ color: 'var(--text-tertiary)' }}>From</span>
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          </label>

          {/* Until date */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="micro" style={{ color: 'var(--text-tertiary)' }}>To</span>
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
          </label>

          {/* Free text search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <input
              ref={qInputRef}
              type="text"
              defaultValue={q}
              onBlur={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setQ(e.target.value); }}
              placeholder="Search summaries…"
              style={{
                width: '100%',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          {anyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 10px',
                background: 'transparent',
                border: '1px dashed var(--border-hairline)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <X size={11} strokeWidth={1.6} />
              Clear
            </button>
          )}

          <span style={{
            marginLeft: 'auto',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap',
          }}>
            {loading ? 'Loading…' : `${total.toLocaleString()} entries`}
          </span>
        </div>

        {/* ── Error ─────────────────────────────────────────────── */}
        {error && (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--signal-amber)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text)',
            fontSize: 'var(--ts-body-sm-size)',
          }}>
            Audit feed unavailable — {error}
          </div>
        )}

        {/* ── Rows ──────────────────────────────────────────────── */}
        <section>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
            {anyFilter
              ? `Filtered results · ${rows.length}`
              : `Entries ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`
            }
          </div>

          {!loading && rows.length === 0 && (
            <div style={{
              padding: 'var(--space-6)',
              textAlign: 'center',
              background: 'var(--surface-raised)',
              border: '1px dashed var(--border-hairline)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-tertiary)',
              fontSize: 'var(--ts-body-sm-size)',
            }}>
              No audit entries match these filters.
            </div>
          )}

          <div style={{
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}>
            {rows.map((row, idx) => (
              <AuditRow
                key={row.id}
                row={row}
                isLast={idx === rows.length - 1}
              />
            ))}
          </div>
        </section>

        {/* ── Pagination ────────────────────────────────────────── */}
        {pages > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-3)',
          }}>
            <button
              type="button"
              onClick={() => goPage(page - 1)}
              disabled={page === 0}
              style={pagerBtnStyle(page === 0)}
            >
              <ChevronLeft size={14} strokeWidth={1.6} />
              Prev
            </button>
            <span style={{
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              Page {page + 1} of {pages}
            </span>
            <button
              type="button"
              onClick={() => goPage(page + 1)}
              disabled={page >= pages - 1}
              style={pagerBtnStyle(page >= pages - 1)}
            >
              Next
              <ChevronRight size={14} strokeWidth={1.6} />
            </button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/* ── Audit row ───────────────────────────────────────────────────── */

function AuditRow({ row, isLast }) {
  const tone = actionTone(row.action);
  const roleMeta = ROLE_META[row.actor?.role] || { label: row.actor?.role || '?', color: 'var(--text-tertiary)' };
  const initials = (row.actor?.display_name || '?')
    .split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '130px 160px auto 1fr',
      gap: 'var(--space-3)',
      alignItems: 'start',
      padding: 'var(--space-3) var(--space-4)',
      borderBottom: isLast ? 'none' : '1px solid var(--border-hairline)',
    }}>
      {/* Timestamp */}
      <div>
        <div
          style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: '0.01em' }}
          title={formatFull(row.ts)}
        >
          {formatRelative(row.ts)}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 2, letterSpacing: '0.01em' }}>
          {formatFull(row.ts).slice(0, 12)}
        </div>
      </div>

      {/* Actor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 24, height: 24,
          borderRadius: '50%',
          background: `${roleMeta.color}1a`,
          border: `1px solid ${roleMeta.color}4d`,
          color: roleMeta.color,
          fontSize: 9,
          fontWeight: 'var(--fw-medium)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          letterSpacing: 0,
        }}>
          {initials}
        </span>
        <div>
          <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)', lineHeight: 1.2 }}>
            {row.actor?.display_name || 'System'}
          </div>
          <div className="mono" style={{ fontSize: 9, color: roleMeta.color, letterSpacing: '0.06em' }}>
            {roleMeta.label}
          </div>
        </div>
      </div>

      {/* Action + Entity */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          padding: '2px 8px',
          borderRadius: 3,
          fontSize: 'var(--ts-caption-size)',
          fontWeight: 'var(--fw-medium)',
          background: tone.bg,
          color: tone.color,
          display: 'inline-block',
          width: 'fit-content',
          letterSpacing: '0.01em',
        }}>
          {row.action}
        </span>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.01em',
        }}>
          {entityLabel(row.entity_type)}
          {row.entity_id ? ` · ${row.entity_id}` : ''}
        </span>
      </div>

      {/* Summary */}
      <div style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text-secondary)',
        lineHeight: 1.5,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {row.summary || '—'}
      </div>
    </div>
  );
}

/* ── KPI tile ─────────────────────────────────────────────────────── */

function KpiTile({ label, value, sub }) {
  return (
    <div style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
    }}>
      <div className="eyebrow" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--ts-h3-size)',
        fontWeight: 'var(--fw-semibold)',
        color: 'var(--text)',
        letterSpacing: '-0.01em',
        lineHeight: 1.1,
        marginBottom: sub ? 4 : 0,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

/* ── Filter select ────────────────────────────────────────────────── */

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      >
        {options.map(([v, lbl]) => (
          <option key={`${label}-${v}`} value={v}>{lbl}</option>
        ))}
      </select>
    </label>
  );
}

/* ── Pager button style ───────────────────────────────────────────── */

function pagerBtnStyle(disabled) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-hairline)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--ts-body-sm-size)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.5 : 1,
  };
}
