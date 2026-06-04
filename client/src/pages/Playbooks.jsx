/*
 * Playbooks — Phase 80.
 *
 * Reusable named checklists for routines operators run on a
 * cadence: Monday compliance pass, Friday EOM reconciliation,
 * weekly hauler chase. Each playbook is a template; clicking
 * "Run now" materializes its items into a tracked PlaybookRun
 * with per-item completion state.
 *
 * Page layout:
 *   - Templates list — each card shows name, schedule label,
 *     description, item titles, last-run timestamp, and a Run
 *     button.
 *   - Recent runs section — every recent execution with done/total
 *     counter, click to expand the run drawer.
 *   - Run drawer — checklist with per-item complete/reopen
 *     toggle.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Play, Plus, Edit3, Archive, X, Calendar, Check, RotateCcw, ChevronRight, Trash2,
} from 'lucide-react';
import PageShell from '../components/layout/PageShell';
import Modal from '../components/primitives/Modal';
import Button from '../components/primitives/Button';
import { authFetch } from '../lib/auth';
import { useAuth } from '../lib/AuthContext';
import PlaybookCompletionStrip from '../components/playbooks/PlaybookCompletionStrip';

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);

export default function Playbooks() {
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | playbook
  const [openRunId, setOpenRunId] = useState(null);

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/playbooks')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runPlaybook(playbookId) {
    const r = await authFetch(`/api/playbooks/${playbookId}/run`, { method: 'POST' });
    if (!r.ok) return;
    const j = await r.json();
    load();
    setOpenRunId(j.run.id);
  }
  async function archivePlaybook(playbookId) {
    if (!confirm('Archive this playbook? It can be restored later.')) return;
    const r = await authFetch(`/api/playbooks/${playbookId}/archive`, { method: 'POST' });
    if (r.ok) load();
  }

  return (
    <PageShell
      eyebrow="Operations"
      title="Playbooks"
      description="Named checklists for the routines you run on a cadence — Monday compliance, Friday reconciliation, weekly hauler chases. Click Run to materialize a checklist; tick items off as the routine completes."
      actions={canWrite ? (
        <Button variant="primary" onClick={() => setEditing('new')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={12} strokeWidth={1.8} />
            New playbook
          </span>
        </Button>
      ) : null}
    >
      {error && <div style={errorBox}>Playbook feed unavailable — {error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {/* ── Templates section ──────────────────────────────── */}
        <section>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 'var(--space-3)',
          }}>
            <h2 style={sectionH}>Templates</h2>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              {data?.playbooks?.length ?? 0} active
            </span>
          </div>
          {!data ? (
            <p style={muted}>Loading…</p>
          ) : data.playbooks.length === 0 ? (
            <p style={emptyBox}>
              No playbooks yet.{canWrite ? ' Add the first to capture a routine you run repeatedly.' : ''}
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 'var(--space-3)' }}>
              {data.playbooks.map((pb) => (
                <PlaybookCard
                  key={pb.id}
                  playbook={pb}
                  canWrite={canWrite}
                  onRun={() => runPlaybook(pb.id)}
                  onEdit={() => setEditing(pb)}
                  onArchive={() => archivePlaybook(pb.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Phase 145 — completion rate strip */}
        <PlaybookCompletionStrip rates={data?.completion_rates} />

        {/* ── Recent runs section ────────────────────────────── */}
        <section>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: 'var(--space-3)',
          }}>
            <h2 style={sectionH}>Recent runs</h2>
            <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
              {data?.recent_runs?.length ?? 0} shown
            </span>
          </div>
          {!data || data.recent_runs.length === 0 ? (
            <p style={emptyBox}>
              No runs yet. Click <strong>Run</strong> on any playbook above to materialize it.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.recent_runs.map((r) => (
                <RunRow key={r.id} run={r} onOpen={() => setOpenRunId(r.id)} />
              ))}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <PlaybookFormModal
          playbook={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {openRunId && (
        <RunDrawer
          runId={openRunId}
          canWrite={canWrite}
          onClose={() => setOpenRunId(null)}
          onChange={load}
        />
      )}
    </PageShell>
  );
}

// ── Template card ────────────────────────────────────────────────

function PlaybookCard({ playbook, canWrite, onRun, onEdit, onArchive }) {
  return (
    <div style={card}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
      }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{
            margin: 0,
            fontSize: 'var(--ts-h3-size)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
          }}>
            {playbook.name}
          </h3>
          {playbook.schedule_label && (
            <div style={{
              marginTop: 4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              border: '1px solid var(--border-hairline)',
              borderRadius: 999,
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
            }}>
              <Calendar size={10} strokeWidth={1.6} />
              {playbook.schedule_label}
            </div>
          )}
        </div>
        {canWrite && (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <IconBtn title="Edit" onClick={onEdit}>
              <Edit3 size={12} strokeWidth={1.6} />
            </IconBtn>
            <IconBtn title="Archive" onClick={onArchive}>
              <Archive size={12} strokeWidth={1.6} />
            </IconBtn>
          </span>
        )}
      </header>

      {playbook.description && (
        <p style={{
          margin: '8px 0 0',
          fontSize: 'var(--ts-body-sm-size)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}>
          {playbook.description}
        </p>
      )}

      <ul style={{
        margin: '12px 0 0',
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {playbook.items.map((item, i) => (
          <li key={i} style={{
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--text)',
            display: 'flex',
            gap: 6,
            alignItems: 'baseline',
          }}>
            <span style={{ color: 'var(--text-tertiary)' }} className="tabular">{i + 1}.</span>
            <span style={{ flex: 1 }}>{item.title}</span>
            {item.default_owner_display && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                {item.default_owner_display}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div style={{
        marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)',
        borderTop: '1px dashed var(--border-hairline)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {playbook.items.length} item{playbook.items.length === 1 ? '' : 's'}
        </span>
        {canWrite && (
          <button
            type="button"
            onClick={onRun}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              background: 'var(--bauxite-rust)',
              color: 'var(--bone)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--ts-caption-size)',
              fontWeight: 'var(--fw-medium)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Play size={11} strokeWidth={1.8} />
            Run now
          </button>
        )}
      </div>
    </div>
  );
}

// ── Run row in the recent-runs list ──────────────────────────────

function RunRow({ run, onOpen }) {
  const counts = run.counts || { done: 0, total: 0 };
  const done = counts.done === counts.total;
  const tone = done ? 'var(--signal-green)' : 'var(--signal-amber)';
  const ts = new Date(run.started_at).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  });
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto',
        columnGap: 12,
        alignItems: 'center',
        padding: '10px 14px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderLeft: `3px solid ${tone}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>
          {run.playbook_name}
        </div>
        <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', marginTop: 2 }}>
          {run.started_by?.display_name ?? '—'} · started {ts} UTC
        </div>
      </div>
      <span className="tabular" style={{
        fontSize: 'var(--ts-body-sm-size)',
        color: tone,
        fontWeight: 'var(--fw-medium)',
      }}>
        {counts.done}/{counts.total}
      </span>
      <ChevronRight size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
    </div>
  );
}

// ── Run drawer ──────────────────────────────────────────────────

function RunDrawer({ runId, canWrite, onClose, onChange }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    authFetch(`/api/playbooks/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, [runId]);
  useEffect(() => { load(); }, [load]);

  async function toggle(item) {
    const path = item.status === 'done'
      ? `/api/playbooks/runs/items/${item.id}/reopen`
      : `/api/playbooks/runs/items/${item.id}/complete`;
    const r = await authFetch(path, { method: 'POST' });
    if (r.ok) {
      load();
      onChange?.();
    }
  }

  if (!data) return null;
  const counts = data.items.reduce((m, it) => {
    m.total++;
    if (it.status === 'done') m.done++;
    return m;
  }, { total: 0, done: 0 });

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
              Run #{data.run.id}
            </div>
            <h2 style={{
              margin: 0,
              fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {data.run.playbook_name}
            </h2>
            <p style={{
              margin: '4px 0 0',
              fontSize: 'var(--ts-body-sm-size)',
              color: 'var(--text-secondary)',
            }}>
              Started by {data.run.started_by?.display_name ?? '—'} · {' '}
              {new Date(data.run.started_at).toLocaleString('en-GB', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
              })} UTC
              {' · '}
              <span style={{
                color: counts.done === counts.total ? 'var(--signal-green)' : 'var(--signal-amber)',
                fontWeight: 'var(--fw-medium)',
              }}>
                {counts.done}/{counts.total} done
              </span>
            </p>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            <X size={18} />
          </button>
        </header>

        {error && <p style={{ color: 'var(--bauxite-rust)' }}>{error}</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.items.map((item) => {
            const done = item.status === 'done';
            const dueDays = item.due_date
              ? Math.ceil((new Date(item.due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
              : null;
            const overdue = !done && dueDays != null && dueDays < 0;
            const dueSoon = !done && dueDays != null && dueDays >= 0 && dueDays <= 1;
            return (
              <div
                key={item.id}
                onClick={canWrite ? () => toggle(item) : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  columnGap: 10,
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: done ? 'transparent' : 'var(--surface)',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-sm)',
                  opacity: done ? 0.65 : 1,
                  cursor: canWrite ? 'pointer' : 'default',
                }}
              >
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18, height: 18,
                  borderRadius: 4,
                  border: `1.5px solid ${done ? 'var(--signal-green)' : 'var(--border-soft)'}`,
                  background: done ? 'var(--signal-green)' : 'transparent',
                  color: done ? 'var(--bone)' : 'transparent',
                }}>
                  {done && <Check size={12} strokeWidth={2.5} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 'var(--ts-body-sm-size)',
                    color: 'var(--text)',
                    textDecoration: done ? 'line-through' : 'none',
                  }}>
                    {item.title}
                  </div>
                  <div style={{
                    fontSize: 'var(--ts-caption-size)',
                    color: 'var(--text-tertiary)',
                    marginTop: 2,
                  }}>
                    {item.owner_display && <span>{item.owner_display}</span>}
                    {item.due_date && (
                      <span style={{
                        marginLeft: 8,
                        color: overdue ? 'var(--bauxite-rust)' : dueSoon ? 'var(--signal-amber)' : 'var(--text-tertiary)',
                      }}>
                        <Calendar size={9} strokeWidth={1.6} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                        {dueDays === 0 ? 'today' : dueDays === 1 ? 'tomorrow' : dueDays < 0 ? `${-dueDays}d overdue` : `in ${dueDays}d`}
                      </span>
                    )}
                    {done && item.completed_by && (
                      <span style={{ marginLeft: 8 }}>· done by {item.completed_by}</span>
                    )}
                  </div>
                </div>
                {canWrite && done && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggle(item); }}
                    title="Reopen"
                    style={iconBtn}
                  >
                    <RotateCcw size={11} strokeWidth={1.6} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Form modal ──────────────────────────────────────────────────

function PlaybookFormModal({ playbook, onClose, onSaved }) {
  const isEdit = !!playbook;
  const [form, setForm] = useState(() => ({
    name:           playbook?.name           || '',
    description:    playbook?.description    || '',
    schedule_label: playbook?.schedule_label || '',
    items:          playbook?.items?.length ? playbook.items : [{ title: '', default_owner_display: '', default_due_offset_days: '' }],
  }));
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function setItem(i, field, v) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) => idx === i ? { ...it, [field]: v } : it),
    }));
  }
  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { title: '', default_owner_display: '', default_due_offset_days: '' }] }));
  }
  function removeItem(i) {
    setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    if (!form.name.trim() || posting) return;
    if (form.items.length === 0 || !form.items[0].title.trim()) {
      setError('At least one item required');
      return;
    }
    setPosting(true); setError(null);
    try {
      const body = {
        name: form.name,
        description: form.description,
        schedule_label: form.schedule_label,
        items: form.items.map((it) => ({
          title: it.title,
          default_owner_display: it.default_owner_display || null,
          default_due_offset_days: it.default_due_offset_days === '' ? null : Number(it.default_due_offset_days),
        })),
      };
      const r = await authFetch(
        isEdit ? `/api/playbooks/${playbook.id}` : '/api/playbooks',
        {
          method:  isEdit ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body:    JSON.stringify(body),
        },
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      onSaved();
    } catch (err) { setError(err.message); }
    finally { setPosting(false); }
  }

  return (
    <Modal open onClose={onClose} width={700}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              {isEdit ? `Edit playbook · #${playbook.id}` : 'New playbook'}
            </div>
            <h2 style={{
              margin: 0, fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {form.name || 'Capture a routine'}
            </h2>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle}>
            <X size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Name">
            <input
              type="text" value={form.name} maxLength={120}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="e.g. Monday compliance pass"
              style={inputStyle}
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={form.description} maxLength={500} rows={2}
              onChange={(e) => setField('description', e.target.value)}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="What this playbook covers and when to run it."
            />
          </Field>
          <Field label="Schedule label (optional, informational)">
            <input
              type="text" value={form.schedule_label} maxLength={80}
              onChange={(e) => setField('schedule_label', e.target.value)}
              placeholder="e.g. Weekly · Monday morning"
              style={inputStyle}
            />
          </Field>

          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 6,
            }}>
              <span className="micro" style={{ color: 'var(--text-tertiary)' }}>ITEMS</span>
              <button
                type="button"
                onClick={addItem}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--bauxite-rust)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Plus size={11} strokeWidth={1.8} />
                Add item
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {form.items.map((item, i) => (
                <div key={i} style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 2.5fr 1fr 80px auto',
                  gap: 6,
                  alignItems: 'center',
                }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }} className="tabular">{i + 1}.</span>
                  <input
                    type="text" value={item.title} maxLength={200}
                    onChange={(e) => setItem(i, 'title', e.target.value)}
                    placeholder="Step title"
                    style={inputStyle}
                  />
                  <input
                    type="text" value={item.default_owner_display}
                    onChange={(e) => setItem(i, 'default_owner_display', e.target.value)}
                    placeholder="Default owner"
                    style={inputStyle}
                  />
                  <input
                    type="number" value={item.default_due_offset_days}
                    onChange={(e) => setItem(i, 'default_due_offset_days', e.target.value)}
                    placeholder="+d"
                    title="Days from run date to due date (optional)"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    disabled={form.items.length === 1}
                    title="Remove item"
                    style={{ ...iconBtn, opacity: form.items.length === 1 ? 0.4 : 1 }}
                  >
                    <Trash2 size={11} strokeWidth={1.6} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{
          marginTop: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--border-hairline)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 'var(--ts-caption-size)', color: error ? 'var(--bauxite-rust)' : 'var(--text-tertiary)' }}>
            {error || `${form.items.length} item${form.items.length === 1 ? '' : 's'}`}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!form.name.trim() || posting}>
              {posting ? 'Saving…' : isEdit ? 'Save changes' : 'Create playbook'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro" style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

function IconBtn({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      style={iconBtn}
    >
      {children}
    </button>
  );
}

const card = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-4) var(--space-5)',
};
const sectionH = {
  margin: 0,
  fontSize: 'var(--ts-h3-size)',
  fontWeight: 'var(--fw-medium)',
  color: 'var(--text)',
};
const muted = { color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' };
const emptyBox = {
  margin: 0,
  padding: 'var(--space-5)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--ts-body-sm-size)',
  color: 'var(--text-tertiary)',
  fontStyle: 'italic',
  textAlign: 'center',
};
const errorBox = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--surface-raised)',
  border: '1px solid var(--bauxite-rust)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text)',
  fontSize: 'var(--ts-body-sm-size)',
  marginBottom: 'var(--space-4)',
};
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
const iconBtn = {
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  padding: 4,
  cursor: 'pointer',
  color: 'var(--text-secondary)',
  fontFamily: 'inherit',
  lineHeight: 0,
};
const closeBtnStyle = {
  padding: 4, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-tertiary)',
};
