/*
 * MitigationSteps — Phase 74.
 *
 * Inline checklist of structured mitigation steps for a risk.
 * Mounted beneath each risk row on the Risks page when expanded.
 *
 * Each step: title, optional owner, optional due date, status
 * (open/done). Operators (axis_admin / axis_ops) can add, edit,
 * complete/reopen, and delete steps. Lender + hauler_admin see
 * read-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, RotateCcw, Trash2, Calendar } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function MitigationSteps({ riskId, summary, onChange }) {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [steps, setSteps]   = useState(null);
  const [error, setError]   = useState(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    authFetch(`/api/risks/${riskId}/steps`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setSteps(j.steps || []))
      .catch((err) => setError(err.message));
  }, [riskId]);

  useEffect(() => { load(); }, [load]);

  const refresh = () => { load(); onChange?.(); };

  return (
    <div style={{
      padding: 'var(--space-3) 0 var(--space-3) var(--space-4)',
      background: 'var(--surface)',
      borderTop: '1px dashed var(--border-hairline)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
        paddingRight: 'var(--space-4)',
      }}>
        <div className="micro" style={{ color: 'var(--text-tertiary)' }}>
          MITIGATION STEPS
          {summary && summary.total_count > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
              {summary.done_count} of {summary.total_count} done
            </span>
          )}
        </div>
        {canWrite && !composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={addBtnStyle}
          >
            <Plus size={11} strokeWidth={1.8} />
            Add step
          </button>
        )}
      </header>

      {error && (
        <p style={{ color: 'var(--bauxite-rust)', fontSize: 'var(--ts-caption-size)' }}>{error}</p>
      )}

      {composing && (
        <ComposeStep
          riskId={riskId}
          onCancel={() => setComposing(false)}
          onPosted={() => { setComposing(false); refresh(); }}
        />
      )}

      {steps == null ? (
        <p style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : steps.length === 0 ? (
        <p style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          fontStyle: 'italic',
          margin: 0,
        }}>
          {canWrite
            ? 'No steps yet. Add the first to break the mitigation plan into trackable units of work.'
            : 'No structured steps recorded yet.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginRight: 'var(--space-4)' }}>
          {steps.map((s) => (
            <StepRow key={s.id} step={s} riskId={riskId} canWrite={canWrite} onChange={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, riskId, canWrite, onChange }) {
  const [busy, setBusy] = useState(false);
  const done = step.status === 'done';
  const dueDays = step.due_date
    ? Math.ceil((new Date(step.due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const overdue = !done && dueDays != null && dueDays < 0;
  const dueSoon = !done && dueDays != null && dueDays >= 0 && dueDays <= 3;
  const dueLabel = dueDays == null ? null
                  : overdue ? `${-dueDays}d overdue`
                  : dueDays === 0 ? 'today'
                  : dueDays === 1 ? 'tomorrow'
                  : `in ${dueDays}d`;
  const dueTone = done ? 'var(--text-tertiary)'
                : overdue ? 'var(--bauxite-rust)'
                : dueSoon ? 'var(--signal-amber)'
                : 'var(--text-tertiary)';

  async function toggle(e) {
    e.stopPropagation();
    if (busy || !canWrite) return;
    setBusy(true);
    try {
      const path = done
        ? `/api/risks/${riskId}/steps/${step.id}/reopen`
        : `/api/risks/${riskId}/steps/${step.id}/complete`;
      const r = await authFetch(path, { method: 'POST' });
      if (r.ok) onChange();
    } finally { setBusy(false); }
  }

  async function remove(e) {
    e.stopPropagation();
    if (busy || !canWrite) return;
    if (!confirm(`Delete step "${step.title}"?`)) return;
    setBusy(true);
    try {
      const r = await authFetch(`/api/risks/${riskId}/steps/${step.id}`, { method: 'DELETE' });
      if (r.ok) onChange();
    } finally { setBusy(false); }
  }

  return (
    <div
      onClick={canWrite ? toggle : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        columnGap: 10,
        alignItems: 'center',
        padding: '6px 10px',
        background: done ? 'transparent' : 'var(--surface-raised)',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-hairline)',
        opacity: done ? 0.65 : 1,
        cursor: canWrite ? 'pointer' : 'default',
      }}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16, height: 16,
        borderRadius: 4,
        border: `1.5px solid ${done ? 'var(--signal-green)' : 'var(--border-soft)'}`,
        background: done ? 'var(--signal-green)' : 'transparent',
        color: done ? 'var(--bone)' : 'transparent',
      }}>
        {done && <Check size={11} strokeWidth={2.5} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <span style={{
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text)',
          textDecoration: done ? 'line-through' : 'none',
        }}>
          {step.title}
        </span>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginLeft: 8 }}>
          {step.owner?.display_name && (
            <span>{step.owner.display_name}</span>
          )}
          {step.owner?.display_name && dueLabel && <span> · </span>}
          {dueLabel && (
            <span style={{ color: dueTone, fontWeight: overdue || dueSoon ? 'var(--fw-medium)' : 'inherit' }}>
              <Calendar size={9} strokeWidth={1.6} style={{ verticalAlign: 'middle', marginRight: 2 }} />
              {dueLabel}
            </span>
          )}
          {done && step.completed_by && (
            <span> · done by {step.completed_by}</span>
          )}
        </span>
      </div>
      {canWrite && (
        <span style={{ display: 'inline-flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          {done && (
            <button type="button" onClick={toggle} disabled={busy} title="Reopen step" style={iconBtnStyle}>
              <RotateCcw size={11} strokeWidth={1.6} />
            </button>
          )}
          <button type="button" onClick={remove} disabled={busy} title="Delete step" style={iconBtnStyle}>
            <Trash2 size={11} strokeWidth={1.6} />
          </button>
        </span>
      )}
    </div>
  );
}

function ComposeStep({ riskId, onCancel, onPosted }) {
  const [title, setTitle]     = useState('');
  const [owner, setOwner]     = useState('');
  const [dueDate, setDueDate] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  async function post() {
    if (!title.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const r = await authFetch(`/api/risks/${riskId}/steps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          owner_display: owner.trim() || null,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally { setPosting(false); }
  }

  return (
    <div style={{
      padding: 'var(--space-3)',
      marginBottom: 8,
      marginRight: 'var(--space-4)',
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderLeft: '3px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-sm)',
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr',
      gap: 8,
    }}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What's the step?"
        maxLength={200}
        style={inputStyle}
      />
      <input
        type="text"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        placeholder="Owner (optional)"
        style={inputStyle}
      />
      <input
        type="datetime-local"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        title="Due date (optional)"
        style={inputStyle}
      />
      <div style={{
        gridColumn: '1 / span 3',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{
          fontSize: 'var(--ts-caption-size)',
          color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
        }}>
          {error || `${title.length} / 200`}
        </span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" onClick={onCancel} disabled={posting} style={cancelBtnStyle}>Cancel</button>
          <button
            type="button"
            onClick={post}
            disabled={!title.trim() || posting}
            style={{
              ...primaryBtnStyle,
              opacity: !title.trim() || posting ? 0.55 : 1,
              cursor: !title.trim() || posting ? 'not-allowed' : 'pointer',
            }}
          >
            {posting ? 'Adding…' : 'Add step'}
          </button>
        </span>
      </div>
    </div>
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
const addBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--bauxite-rust)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  padding: 0,
};
const iconBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  padding: 4,
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  lineHeight: 0,
};
const cancelBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  padding: '5px 10px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const primaryBtnStyle = {
  background: 'var(--bauxite-rust)',
  border: '1px solid var(--bauxite-rust)',
  padding: '5px 10px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-caption-size)',
  color: 'white',
  fontFamily: 'inherit',
};
