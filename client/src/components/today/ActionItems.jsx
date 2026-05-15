/*
 * ActionItems — right column, 5 max.
 *
 * Phase 36 — for action items with a single-write close (filing,
 * licence, hse_incident), clicking the row expands an inline
 * QuickAction form underneath instead of navigating to the source
 * page. Operator can mark filed / renew / close right from the
 * cockpit. Read-only roles (lender, hauler) keep the deep-link
 * behaviour.
 *
 * Other types (alert, maintenance, receivables) still deep-link to
 * their source page where the richer triage UI lives.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, UserCircle2, MessageSquare, CheckSquare, Square, Clock, X } from 'lucide-react';

import { useAuth } from '../../lib/AuthContext';
import { authFetch } from '../../lib/auth';
import QuickAction, { INLINE_ACTION_TYPES } from './QuickAction';
import AssignDialog from './AssignDialog';
import CommentsThread from './CommentsThread';

const ROLES_THAT_WRITE  = new Set(['axis_admin', 'axis_ops']);
const ROLES_THAT_ASSIGN = new Set(['axis_admin', 'axis_ops', 'hauler_admin']);

const PRIORITY_MAP = {
  high:   { color: 'var(--bauxite-rust)', label: 'High' },
  medium: { color: 'var(--iron)',         label: 'Medium' },
  low:    { color: 'var(--slate)',        label: 'Low' },
};

export default function ActionItems({ items, onMutate }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite  = user && ROLES_THAT_WRITE.has(user.role);
  const canAssign = user && ROLES_THAT_ASSIGN.has(user.role);
  const [expandedId, setExpandedId] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  // Phase 57 — separate expansion state for the comments thread so the
  // operator can have comments open without triggering quick-close.
  const [commentsOpenId, setCommentsOpenId] = useState(null);
  // Phase 83 — multi-select mode for bulk snooze / unassign.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); }

  return (
    <section>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 'var(--space-3)',
      }}>
        <div className="eyebrow">Action items</div>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          {canAssign && (items?.length ?? 0) > 0 && (
            selectMode ? (
              <button
                type="button"
                onClick={exitSelect}
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  cursor: 'pointer',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSelectMode(true)}
                title="Select multiple items for bulk actions"
                style={{
                  background: 'transparent', border: 'none', padding: 0,
                  cursor: 'pointer',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--bauxite-rust)',
                  fontFamily: 'inherit',
                }}
              >
                Select
              </button>
            )
          )}
          <span
            className="mono"
            style={{
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-tertiary)',
              letterSpacing: '0.08em',
            }}
          >
            {items?.length ?? 0} / 5
          </span>
        </span>
      </header>
      <ol style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}>
        {items?.map((item) => {
          const p = PRIORITY_MAP[item.priority] ?? PRIORITY_MAP.low;
          const inlineable = canWrite && INLINE_ACTION_TYPES.has(item.source?.type);
          const linked = !inlineable && !!item.link?.path;
          const isExpanded = expandedId === item.id;

          const onClick = inlineable
            ? () => setExpandedId(isExpanded ? null : item.id)
            : linked
              ? () => navigate(item.link.path)
              : undefined;

          const interactive = inlineable || linked;
          const isSelected = selected.has(item.id);
          return (
            <li
              key={item.id}
              style={{
                background: isSelected ? 'var(--accent-tint)' : 'var(--surface-raised)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-hairline)',
                borderLeft: `3px solid ${p.color}`,
                padding: '10px 12px',
                display: 'grid',
                gridTemplateColumns: selectMode ? 'auto 1fr' : '1fr',
                gridTemplateRows: 'auto auto',
                columnGap: 10,
              }}
            >
              {selectMode && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                  title={isSelected ? 'Deselect' : 'Select for bulk action'}
                  style={{
                    gridRow: '1 / span 2',
                    alignSelf: 'start',
                    background: 'transparent',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: isSelected ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
                    lineHeight: 0,
                    marginTop: 4,
                  }}
                >
                  {isSelected ? <CheckSquare size={16} strokeWidth={1.6} /> : <Square size={16} strokeWidth={1.6} />}
                </button>
              )}
              <div
                onClick={selectMode ? () => toggleSelect(item.id) : onClick}
                onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                style={{
                  cursor: interactive ? 'pointer' : 'default',
                  borderRadius: 'var(--radius-sm)',
                  margin: '-2px -4px',
                  padding: '2px 4px',
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={interactive ? (e) => { e.currentTarget.style.background = 'var(--accent-tint)'; } : undefined}
                onMouseLeave={interactive ? (e) => { e.currentTarget.style.background = 'transparent'; } : undefined}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 9,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: p.color,
                    }}
                  >
                    {p.label}
                  </span>
                  {inlineable ? (
                    <span
                      className="mono"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {isExpanded ? 'Cancel' : 'Quick close'}
                      <ChevronDown
                        size={11}
                        strokeWidth={1.6}
                        style={{
                          transition: 'transform 160ms ease',
                          transform: isExpanded ? 'rotate(180deg)' : 'none',
                        }}
                      />
                    </span>
                  ) : linked ? (
                    <span
                      className="mono"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'var(--text-tertiary)',
                      }}
                    >
                      {item.link.label || 'Open'}
                      <ArrowUpRight size={11} strokeWidth={1.6} />
                    </span>
                  ) : null}
                </div>
                <p style={{
                  margin: 0,
                  fontSize: 'var(--ts-body-sm-size)',
                  lineHeight: 'var(--ts-body-sm-lh)',
                  color: 'var(--text)',
                }}>
                  {item.body}
                </p>
              </div>

              {/* Phase 45 — assignment row. Shows owner chip + due if
                  assigned; otherwise shows a subtle "Assign" button for
                  writable roles. Click stops propagation so it doesn't
                  toggle the QuickAction expand. */}
              {(item.assignment || canAssign) && (
                <div
                  style={{
                    marginTop: 4,
                    paddingTop: 6,
                    borderTop: '1px dashed var(--border-hairline)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {item.assignment ? (
                    <AssigneeChip assignment={item.assignment} />
                  ) : (
                    <span style={{
                      fontSize: 'var(--ts-caption-size)',
                      color: 'var(--text-tertiary)',
                      fontStyle: 'italic',
                    }}>
                      Unassigned
                    </span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Phase 57 — comments toggle. Always visible (even
                        when no comments exist) for write roles, so the
                        affordance is discoverable. Count is rendered when
                        > 0. Click stops propagation so it doesn't fire
                        QuickAction expand. */}
                    {canAssign && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCommentsOpenId((id) => (id === item.id ? null : item.id));
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 'var(--ts-caption-size)',
                          color: item.comment_count > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                          padding: '2px 6px',
                          background: 'transparent',
                          border: '1px solid var(--border-hairline)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <MessageSquare size={11} strokeWidth={1.6} />
                        {item.comment_count > 0 ? item.comment_count : ''}
                      </button>
                    )}
                    {canAssign && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAssignTarget(item); }}
                        style={{
                          fontSize: 'var(--ts-caption-size)',
                          color: 'var(--bauxite-rust)',
                          padding: '2px 6px',
                          background: 'transparent',
                          border: '1px solid var(--border-hairline)',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        {item.assignment ? 'Reassign' : 'Assign'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Phase 57 — inline comment thread. Renders below the
                  assignment row when toggled. Closes itself if you
                  click the icon again. */}
              {commentsOpenId === item.id && (
                <CommentsThread
                  itemId={item.id}
                  initialCount={item.comment_count}
                  onChange={() => onMutate?.()}
                />
              )}

              {inlineable && isExpanded && (
                <QuickAction
                  item={item}
                  onCancel={() => setExpandedId(null)}
                  onDone={() => {
                    setExpandedId(null);
                    onMutate?.();
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>

      {selectMode && (
        <BulkActionBar
          selected={selected}
          onClear={() => setSelected(new Set())}
          onCancel={exitSelect}
          onMutate={() => { onMutate?.(); exitSelect(); }}
        />
      )}

      <AssignDialog
        open={Boolean(assignTarget)}
        item={assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => {
          setAssignTarget(null);
          onMutate?.();
        }}
      />
    </section>
  );
}

// Phase 83 — sticky bar shown when multi-select is active. Bulk
// snooze + bulk unassign endpoints handle per-item permission
// re-checks server-side; we show a friendly summary on completion.
function BulkActionBar({ selected, onClear, onCancel, onMutate }) {
  const count = selected.size;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (count === 0) {
    return (
      <div style={bulkBarStyle}>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          Select items to bulk-snooze or unassign
        </span>
        <button type="button" onClick={onCancel} style={bulkBtn('ghost')}>
          <X size={11} strokeWidth={1.6} /> Cancel
        </button>
      </div>
    );
  }

  async function bulkSnooze() {
    const days = parseInt(prompt('Snooze for how many days?', '7') || '0', 10);
    if (!Number.isFinite(days) || days <= 0) return;
    const reason = prompt('Reason (optional):') || null;
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setBusy(true); setError(null);
    try {
      const r = await authFetch('/api/today/action-items/bulk-snooze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action_item_ids: [...selected], until, reason }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.skipped_count > 0) {
        alert(`Snoozed ${j.snoozed_count}. Skipped ${j.skipped_count} (not assigned or not permitted).`);
      }
      onMutate();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function bulkUnassign() {
    if (!confirm(`Unassign ${count} item${count === 1 ? '' : 's'}?`)) return;
    setBusy(true); setError(null);
    try {
      const r = await authFetch('/api/today/action-items/bulk-unassign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action_item_ids: [...selected] }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.skipped_count > 0) {
        alert(`Unassigned ${j.unassigned_count}. Skipped ${j.skipped_count} (not assigned or not permitted).`);
      }
      onMutate();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={bulkBarStyle}>
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--bauxite-rust)',
        fontWeight: 'var(--fw-medium)',
      }}>
        {count} selected
      </span>
      {error && (
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{error}</span>
      )}
      <span style={{ flex: 1 }} />
      <button type="button" onClick={onClear} disabled={busy} style={bulkBtn('ghost')}>
        Clear
      </button>
      <button type="button" onClick={bulkSnooze} disabled={busy} style={bulkBtn('secondary')}>
        <Clock size={11} strokeWidth={1.6} /> Snooze
      </button>
      <button type="button" onClick={bulkUnassign} disabled={busy} style={bulkBtn('primary')}>
        <X size={11} strokeWidth={1.6} /> Unassign
      </button>
    </div>
  );
}

const bulkBarStyle = {
  marginTop: 'var(--space-3)',
  padding: '8px 12px',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  position: 'sticky',
  bottom: 'var(--space-3)',
};

function bulkBtn(variant) {
  if (variant === 'primary') {
    return {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 10px',
      background: 'var(--bauxite-rust)', color: 'var(--bone)',
      border: 'none', borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--ts-caption-size)', fontWeight: 'var(--fw-medium)',
      cursor: 'pointer', fontFamily: 'inherit',
    };
  }
  if (variant === 'secondary') {
    return {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '4px 10px',
      background: 'transparent', color: 'var(--bauxite-rust)',
      border: '1px solid var(--bauxite-rust)',
      borderRadius: 'var(--radius-sm)',
      fontSize: 'var(--ts-caption-size)',
      cursor: 'pointer', fontFamily: 'inherit',
    };
  }
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 10px',
    background: 'transparent', color: 'var(--text-tertiary)',
    border: 'none',
    fontSize: 'var(--ts-caption-size)',
    cursor: 'pointer', fontFamily: 'inherit',
  };
}

// Phase 45 — owner badge. Shows assignee + due date (rust if past due,
// amber if ≤2d, neutral otherwise). Hover title carries the notes.
// Phase 48 — when an item is overdue (due < now and not snoozed) the
// chip shows an "OVERDUE" pill in rust. Snoozed items show "snoozed
// until X" in amber instead of the due date.
function AssigneeChip({ assignment }) {
  const due = assignment.due_date;
  const snoozed = assignment.snooze?.until && new Date(assignment.snooze.until).getTime() > Date.now();
  const days = due ? Math.floor((new Date(due).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
  const overdue = !snoozed && days != null && days < 0;
  const dueTone = overdue ? 'var(--bauxite-rust)'
                : days != null && days <= 2 ? 'var(--signal-amber)'
                : 'var(--text-tertiary)';
  const dueLabel = due
    ? new Date(due).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : null;
  return (
    <div
      title={assignment.notes ? `Notes: ${assignment.notes}` : ''}
      style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}
    >
      <UserCircle2 size={12} strokeWidth={1.6} color="var(--text-tertiary)" />
      <span style={{
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {assignment.assignee.display_name}
      </span>
      {snoozed ? (
        <span className="tabular" style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--signal-amber)',
          fontWeight: 'var(--fw-medium)',
        }}>
          · snoozed until {new Date(assignment.snooze.until).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
        </span>
      ) : (
        <>
          {dueLabel && (
            <span className="tabular" style={{
              fontSize: 'var(--ts-caption-size)',
              color: dueTone,
              fontWeight: 'var(--fw-medium)',
            }}>
              · due {dueLabel}
            </span>
          )}
          {overdue && (
            <span className="mono" style={{
              fontSize: 9,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--bone)',
              background: 'var(--bauxite-rust)',
              padding: '1px 5px',
              borderRadius: 2,
              fontWeight: 'var(--fw-medium)',
            }}>
              Overdue
            </span>
          )}
          {/* Phase 61 — escalation badge. Solid bauxite-rust pill,
              one tier louder than the OVERDUE pill so admins can see
              "this has bubbled up" at a glance. Tooltip carries the
              escalation timestamp for context. */}
          {assignment.escalation && (
            <span
              className="mono"
              title={`Escalated ${new Date(assignment.escalation.escalated_at).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false })} UTC${assignment.escalation.acknowledged_at ? ' · ack' : ' · pending review'}`}
              style={{
                fontSize: 9,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--bone)',
                background: 'var(--bauxite-rust)',
                padding: '1px 5px',
                borderRadius: 2,
                fontWeight: 'var(--fw-medium)',
                border: '1px solid var(--bone)',
                outline: '1px solid var(--bauxite-rust)',
              }}
            >
              ↑ Escalated
            </span>
          )}
        </>
      )}
    </div>
  );
}
