/*
 * Risks — Phase 72.
 *
 * Forward-looking ledger of risks the corridor is tracking.
 * Distinct from /alerts (reactive: something is wrong now) and
 * incidents (something already went wrong). A risk is something
 * that *might* happen and what we plan to do about it.
 *
 * Page composition:
 *   - Header KPI strip: open / high+critical / stale-review counts
 *   - Filter chips for category + severity
 *   - Risk table (severity tone, status pill, owner, last review)
 *   - Add risk button (axis_admin / axis_ops only)
 *   - Drawer modal for create / edit / review / archive
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, ShieldAlert, RefreshCw, Archive, Edit3, X, ChevronDown, ChevronRight, ListChecks, MessageSquare } from 'lucide-react';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import PageShell from '../components/layout/PageShell';
import Button from '../components/primitives/Button';
import Modal from '../components/primitives/Modal';
import MitigationSteps from '../components/risks/MitigationSteps';
import RiskComments from '../components/risks/RiskComments';
import PinButton from '../components/primitives/PinButton';

const SEVERITY_TONE = {
  critical: 'var(--bauxite-rust)',
  high:     'var(--bauxite-rust)',
  medium:   'var(--signal-amber)',
  low:      'var(--text-secondary)',
};
const STATUS_TONE = {
  open:       'var(--bauxite-rust)',
  mitigating: 'var(--signal-amber)',
  monitoring: 'var(--text)',
  closed:     'var(--signal-green)',
};
const SEVERITY_LABEL = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
};
const LIKELIHOOD_LABEL = {
  rare:           'Rare',
  unlikely:       'Unlikely',
  possible:       'Possible',
  likely:         'Likely',
  almost_certain: 'Almost certain',
};
const CATEGORY_LABEL = {
  operational:  'Operational',
  commercial:   'Commercial',
  financial:    'Financial',
  compliance:   'Compliance',
  reputational: 'Reputational',
  strategic:    'Strategic',
};

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function Risks() {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | risk obj
  const [filters, setFilters] = useState({ category: null, severity: null });

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/risks')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredRisks = useMemo(() => {
    if (!data?.risks) return [];
    return data.risks.filter((r) =>
      (!filters.category || r.category === filters.category) &&
      (!filters.severity || r.severity === filters.severity),
    );
  }, [data, filters]);

  return (
    <PageShell
      eyebrow="Governance"
      title="Risk register"
      description="Forward-looking ledger of risks the corridor is tracking. Reviewed at least every 30 days; reflected in the lender briefing pack."
      actions={canWrite ? (
        <Button variant="primary" onClick={() => setEditing('new')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={12} strokeWidth={1.8} />
            Add risk
          </span>
        </Button>
      ) : null}
    >
      {error && (
        <div style={{
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--bauxite-rust)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text)',
          fontSize: 'var(--ts-body-sm-size)',
          marginBottom: 'var(--space-4)',
        }}>
          Risk feed unavailable — {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <KpiStrip counts={data?.counts} />
        <FilterChips filters={filters} setFilters={setFilters} />

        {filteredRisks.length === 0 ? (
          <p style={{
            margin: 0,
            padding: 'var(--space-5)',
            background: 'var(--surface-raised)',
            border: '1px solid var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-tertiary)',
            fontStyle: 'italic',
            textAlign: 'center',
          }}>
            {data == null ? 'Loading…'
              : filters.category || filters.severity
                ? 'No risks match the current filters.'
                : `No risks in the register yet.${canWrite ? ' Add the first.' : ''}`}
          </p>
        ) : (
          <RisksTable risks={filteredRisks} canWrite={canWrite} onEdit={setEditing} onChange={load} />
        )}
      </div>

      {editing && (
        <RiskFormModal
          risk={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </PageShell>
  );
}

// ── KPI strip ─────────────────────────────────────────────────────

function KpiStrip({ counts }) {
  const open = counts?.open_count ?? 0;
  const high = counts?.high_open_count ?? 0;
  const stale = counts?.stale_count ?? 0;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 'var(--space-3)',
    }}>
      <Tile
        label="Open risks"
        value={open}
        sub="active in the register"
        tone={open === 0 ? 'tertiary' : 'text'}
      />
      <Tile
        label="High & critical"
        value={high}
        sub={high > 0 ? 'require active mitigation' : 'corridor running clean'}
        tone={high > 0 ? 'rust' : 'green'}
      />
      <Tile
        label="Stale reviews"
        value={stale}
        sub={stale > 0 ? '30+ days since last review' : 'all reviews current'}
        tone={stale > 0 ? 'amber' : 'green'}
      />
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  const color = tone === 'rust'  ? 'var(--bauxite-rust)'
              : tone === 'amber' ? 'var(--signal-amber)'
              : tone === 'green' ? 'var(--signal-green)'
              : tone === 'tertiary' ? 'var(--text-tertiary)'
              : 'var(--text)';
  return (
    <div style={{
      padding: 'var(--space-4)',
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
    }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label.toUpperCase()}
      </div>
      <div className="tabular" style={{
        fontSize: 'var(--ts-h1-size, 32px)',
        fontWeight: 'var(--fw-black)',
        color, lineHeight: 1.05,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

// ── Filter chips ──────────────────────────────────────────────────

function FilterChips({ filters, setFilters }) {
  const cats = Object.entries(CATEGORY_LABEL);
  const sevs = ['critical', 'high', 'medium', 'low'];
  return (
    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>FILTER</span>
      <Chip
        label="All categories"
        active={!filters.category}
        onClick={() => setFilters((f) => ({ ...f, category: null }))}
      />
      {cats.map(([id, label]) => (
        <Chip
          key={id}
          label={label}
          active={filters.category === id}
          onClick={() => setFilters((f) => ({ ...f, category: f.category === id ? null : id }))}
        />
      ))}
      <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} />
      <Chip
        label="All severities"
        active={!filters.severity}
        onClick={() => setFilters((f) => ({ ...f, severity: null }))}
      />
      {sevs.map((s) => (
        <Chip
          key={s}
          label={SEVERITY_LABEL[s]}
          tone={SEVERITY_TONE[s]}
          active={filters.severity === s}
          onClick={() => setFilters((f) => ({ ...f, severity: f.severity === s ? null : s }))}
        />
      ))}
    </div>
  );
}

function Chip({ label, active, onClick, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active ? 'var(--accent-tint)' : 'transparent',
        border: `1px solid ${active ? (tone || 'var(--bauxite-rust)') : 'var(--border-hairline)'}`,
        borderRadius: 999,
        fontSize: 'var(--ts-caption-size)',
        color: active ? (tone || 'var(--bauxite-rust)') : 'var(--text-secondary)',
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Table ─────────────────────────────────────────────────────────

function RisksTable({ risks, canWrite, onEdit, onChange }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  return (
    <div style={{
      background: 'var(--surface-raised)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-hairline)',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--ts-body-sm-size)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-hairline)', background: 'var(--surface)' }}>
            <th style={{ ...th, width: 28 }}></th>
            <th style={th}>Risk</th>
            <th style={th}>Category</th>
            <th style={th}>Severity</th>
            <th style={th}>Likelihood</th>
            <th style={th}>Status</th>
            <th style={th}>Owner</th>
            <th style={th}>Steps</th>
            <th style={th}>Last review</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {risks.map((r) => (
            <RiskRow
              key={r.id}
              risk={r}
              canWrite={canWrite}
              onEdit={() => onEdit(r)}
              onChange={onChange}
              expanded={expanded.has(r.id)}
              onToggleExpand={() => toggle(r.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RiskRow({ risk, canWrite, onEdit, onChange, expanded, onToggleExpand }) {
  const sevTone = SEVERITY_TONE[risk.severity] || 'var(--text)';
  const statusTone = STATUS_TONE[risk.status] || 'var(--text)';
  const reviewedDays = risk.last_reviewed_at
    ? Math.floor((Date.now() - new Date(risk.last_reviewed_at).getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const reviewStale = reviewedDays == null || reviewedDays >= 30;
  const steps = risk.steps_summary || { done_count: 0, total_count: 0, open_count: 0 };
  const stepsTone = steps.total_count === 0 ? 'var(--text-tertiary)'
                  : steps.done_count === steps.total_count ? 'var(--signal-green)'
                  : 'var(--text-secondary)';

  async function quickReview(e) {
    e.stopPropagation();
    const r = await authFetch(`/api/risks/${risk.id}/review`, { method: 'POST' });
    if (r.ok) onChange();
  }
  async function archive(e) {
    e.stopPropagation();
    if (!confirm(`Archive "${risk.title}"?`)) return;
    const r = await authFetch(`/api/risks/${risk.id}/archive`, { method: 'POST' });
    if (r.ok) onChange();
  }
  function toggle(e) {
    e.stopPropagation();
    onToggleExpand();
  }

  return (
    <>
    <tr
      onClick={onEdit}
      style={{
        borderBottom: expanded ? 'none' : '1px solid var(--border-hairline)',
        cursor: 'pointer',
      }}
    >
      <td style={{ ...td, borderLeft: `3px solid ${sevTone}`, textAlign: 'center', paddingRight: 0 }} onClick={toggle}>
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? 'Collapse mitigation steps' : 'Expand mitigation steps'}
          style={{
            background: 'transparent', border: 'none', padding: 4,
            cursor: 'pointer', color: 'var(--text-tertiary)',
            lineHeight: 0,
          }}
        >
          {expanded ? <ChevronDown size={14} strokeWidth={1.6} /> : <ChevronRight size={14} strokeWidth={1.6} />}
        </button>
      </td>
      <td style={td}>
        <div style={{ color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
          {risk.title}
        </div>
        {risk.description && (
          <div style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text-tertiary)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            maxWidth: 360,
          }}>
            {risk.description}
          </div>
        )}
      </td>
      <td style={td}>
        <span style={{
          fontSize: 11, color: 'var(--text-secondary)',
          padding: '2px 8px', background: 'var(--surface)',
          border: '1px solid var(--border-hairline)', borderRadius: 999,
        }}>
          {CATEGORY_LABEL[risk.category] || risk.category}
        </span>
      </td>
      <td style={td}>
        <Pill label={SEVERITY_LABEL[risk.severity]} tone={sevTone} />
      </td>
      <td style={{ ...td, color: 'var(--text-secondary)' }}>
        {LIKELIHOOD_LABEL[risk.likelihood] || risk.likelihood}
      </td>
      <td style={td}>
        <Pill label={risk.status} tone={statusTone} />
      </td>
      <td style={{ ...td, color: 'var(--text-secondary)' }}>
        {risk.owner?.display_name || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>unowned</span>}
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          <button
            type="button"
            onClick={toggle}
            title={steps.total_count === 0 ? 'No steps — click to add' : `${steps.done_count} of ${steps.total_count} done`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              background: 'transparent',
              border: '1px solid var(--border-hairline)',
              borderRadius: 999,
              fontSize: 'var(--ts-caption-size)',
              color: stepsTone,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <ListChecks size={11} strokeWidth={1.6} />
            {steps.total_count === 0
              ? 'add steps'
              : <span className="tabular">{steps.done_count}/{steps.total_count}</span>}
          </button>
          {(risk.comments_summary?.count > 0) && (
            <button
              type="button"
              onClick={toggle}
              title={`${risk.comments_summary.count} comment${risk.comments_summary.count === 1 ? '' : 's'} — click to expand`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--border-hairline)',
                borderRadius: 999,
                fontSize: 'var(--ts-caption-size)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <MessageSquare size={11} strokeWidth={1.6} />
              <span className="tabular">{risk.comments_summary.count}</span>
            </button>
          )}
        </span>
      </td>
      <td style={td}>
        {reviewedDays == null
          ? <span style={{ color: 'var(--bauxite-rust)' }}>never</span>
          : reviewStale
            ? <span style={{ color: 'var(--signal-amber)' }}>{reviewedDays}d ago</span>
            : <span className="tabular" style={{ color: 'var(--text-secondary)' }}>{reviewedDays}d ago</span>}
        {risk.last_reviewed_by && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            by {risk.last_reviewed_by}
          </div>
        )}
      </td>
      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <PinButton entityType="risk" entityId={String(risk.id)} />
          {canWrite && (
            <>
              <IconBtn title="Confirm review (bumps last reviewed)" onClick={quickReview}>
                <RefreshCw size={12} strokeWidth={1.6} />
              </IconBtn>
              <IconBtn title="Archive risk" onClick={archive}>
                <Archive size={12} strokeWidth={1.6} />
              </IconBtn>
            </>
          )}
        </span>
      </td>
    </tr>
    {expanded && (
      <tr style={{ borderBottom: '1px solid var(--border-hairline)' }}>
        <td colSpan={10} style={{ padding: 0, background: 'var(--surface)' }}>
          <MitigationSteps
            riskId={risk.id}
            summary={steps}
            onChange={onChange}
          />
          <RiskComments
            riskId={risk.id}
            summary={risk.comments_summary}
            onChange={onChange}
          />
        </td>
      </tr>
    )}
    </>
  );
}

function Pill({ label, tone }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 10%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 10,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function IconBtn({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        padding: 4,
        cursor: 'pointer',
        color: 'var(--text-secondary)',
        fontFamily: 'inherit',
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Form modal ────────────────────────────────────────────────────

function RiskFormModal({ risk, onClose, onSaved }) {
  const isEdit = !!risk;
  const [form, setForm] = useState(() => ({
    title:           risk?.title           || '',
    description:     risk?.description     || '',
    category:        risk?.category        || 'operational',
    severity:        risk?.severity        || 'medium',
    likelihood:      risk?.likelihood      || 'possible',
    status:          risk?.status          || 'open',
    mitigation_plan: risk?.mitigation_plan || '',
  }));
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.title.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const r = await authFetch(
        isEdit ? `/api/risks/${risk.id}` : '/api/risks',
        {
          method:  isEdit ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify(form),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  return (
    <Modal open onClose={onClose} width={640}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              {isEdit ? `Edit risk · #${risk.id}` : 'New risk'}
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              lineHeight: 'var(--ts-h2-lh)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {isEdit ? form.title || risk.title : 'Add a risk to the register'}
            </h2>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Title">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              maxLength={120}
              style={inputStyle}
              placeholder="e.g. Hauler 05 capacity ramp"
            />
          </Field>

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              rows={3}
              maxLength={2000}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="What's the risk, what triggers it, what does it cost if it lands?"
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
            <Field label="Category">
              <select value={form.category} onChange={(e) => setField('category', e.target.value)} style={inputStyle}>
                {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setField('status', e.target.value)} style={inputStyle}>
                <option value="open">Open · not yet mitigated</option>
                <option value="mitigating">Mitigating · plan in flight</option>
                <option value="monitoring">Monitoring · plan in place, watching</option>
                <option value="closed">Closed · risk no longer applicable</option>
              </select>
            </Field>
            <Field label="Severity">
              <select value={form.severity} onChange={(e) => setField('severity', e.target.value)} style={inputStyle}>
                <option value="critical">Critical · existential</option>
                <option value="high">High · materially impacts forecast/covenant</option>
                <option value="medium">Medium · meaningful but contained</option>
                <option value="low">Low · noise-level</option>
              </select>
            </Field>
            <Field label="Likelihood">
              <select value={form.likelihood} onChange={(e) => setField('likelihood', e.target.value)} style={inputStyle}>
                {Object.entries(LIKELIHOOD_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Mitigation plan">
            <textarea
              value={form.mitigation_plan}
              onChange={(e) => setField('mitigation_plan', e.target.value)}
              rows={3}
              maxLength={2000}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="What's the plan if this lands? Who owns each step?"
            />
          </Field>
        </div>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: 'var(--ts-caption-size)',
            color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
          }}>
            {error || (isEdit ? 'Saving will not bump the review timestamp.' : 'New risks are auto-marked as reviewed today.')}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!form.title.trim() || posting}>
              {posting ? 'Saving…' : isEdit ? 'Save changes' : 'Add risk'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  padding: '6px 8px',
  background: 'var(--surface)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  boxSizing: 'border-box',
  width: '100%',
};
const th = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  fontWeight: 500,
};
const td = {
  padding: '10px',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text)',
  lineHeight: 1.4,
  verticalAlign: 'top',
};
