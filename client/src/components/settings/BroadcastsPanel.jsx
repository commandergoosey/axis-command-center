/*
 * BroadcastsPanel — Phase 85.
 *
 * Settings-page admin surface for managing corridor broadcasts.
 * Lists active + archived broadcasts, lets axis_admin/axis_ops
 * post new ones, archive/unarchive, edit, delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Plus, Edit3, Archive, X, RotateCcw, Trash2 } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import Modal from '../primitives/Modal';
import Button from '../primitives/Button';

const SEVERITY_LABEL = { urgent: 'Urgent', warn: 'Warning', info: 'Info' };
const AUDIENCE_LABEL = { all: 'Everyone', operators: 'Operators only', haulers: 'Haulers only' };
const SEVERITY_TONE = {
  urgent: 'var(--bauxite-rust)',
  warn:   'var(--signal-amber)',
  info:   'var(--text-secondary)',
};

export default function BroadcastsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | broadcast

  const load = useCallback(() => {
    setError(null);
    authFetch('/api/broadcasts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function archive(id) {
    if (!confirm('Archive this broadcast?')) return;
    const r = await authFetch(`/api/broadcasts/${id}/archive`, { method: 'POST' });
    if (r.ok) load();
  }
  async function unarchive(id) {
    const r = await authFetch(`/api/broadcasts/${id}/unarchive`, { method: 'POST' });
    if (r.ok) load();
  }
  async function remove(id) {
    if (!confirm('Permanently delete this broadcast? This cannot be undone.')) return;
    const r = await authFetch(`/api/broadcasts/${id}`, { method: 'DELETE' });
    if (r.ok) load();
  }

  const active   = (data?.broadcasts ?? []).filter((b) => !b.archived_at);
  const archived = (data?.broadcasts ?? []).filter((b) =>  b.archived_at);

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
            <Megaphone size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
            Corridor announcements
          </h2>
          <p style={{
            margin: '4px 0 0',
            fontSize: 'var(--ts-body-sm-size)',
            color: 'var(--text-secondary)',
          }}>
            One-to-many broadcasts that surface as banners on Today + MyHauler.
            Audience filter controls who sees what.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Plus size={12} strokeWidth={1.8} />
            New broadcast
          </span>
        </Button>
      </header>

      {error && <p style={{ color: 'var(--bauxite-rust)' }}>{error}</p>}

      {!data ? (
        <p style={muted}>Loading…</p>
      ) : (
        <>
          {active.length === 0 && archived.length === 0 ? (
            <p style={emptyBox}>No broadcasts yet. Post the first to surface it on every operator's Today.</p>
          ) : (
            <>
              <Subhead label="Active" count={active.length} />
              {active.length === 0 ? (
                <p style={muted}>No active broadcasts.</p>
              ) : (
                <List
                  rows={active}
                  onEdit={setEditing}
                  onArchive={archive}
                  onUnarchive={null}
                  onDelete={remove}
                />
              )}
              {archived.length > 0 && (
                <>
                  <Subhead label="Archived" count={archived.length} />
                  <List
                    rows={archived}
                    onEdit={setEditing}
                    onArchive={null}
                    onUnarchive={unarchive}
                    onDelete={remove}
                    archived
                  />
                </>
              )}
            </>
          )}
        </>
      )}

      {editing && (
        <BroadcastFormModal
          broadcast={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </section>
  );
}

// ── Bits ─────────────────────────────────────────────────────────

function Subhead({ label, count }) {
  return (
    <div className="micro" style={{
      color: 'var(--text-tertiary)',
      margin: 'var(--space-3) 0 8px',
      letterSpacing: '0.06em',
    }}>
      {label.toUpperCase()} · {count}
    </div>
  );
}

function List({ rows, onEdit, onArchive, onUnarchive, onDelete, archived }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((b) => {
        const tone = SEVERITY_TONE[b.severity] || 'var(--text)';
        return (
          <div key={b.id} style={{
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--border-hairline)',
            borderLeft: `3px solid ${tone}`,
            borderRadius: 'var(--radius-sm)',
            opacity: archived ? 0.7 : 1,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 4,
            }}>
              <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <Pill label={SEVERITY_LABEL[b.severity]} tone={tone} />
                <span style={{
                  fontSize: 'var(--ts-body-sm-size)',
                  color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                }}>
                  {b.title}
                </span>
              </div>
              <span style={{
                fontSize: 10,
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
              }}>
                {AUDIENCE_LABEL[b.audience]}
                {' · '}
                <span className="mono">
                  {new Date(b.posted_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
                {b.posted_by?.display_name && <> · {b.posted_by.display_name}</>}
              </span>
            </div>
            <p style={{
              margin: 0,
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}>
              {b.body}
            </p>
            {b.expires_at && (
              <div style={{
                marginTop: 4,
                fontSize: 10,
                color: 'var(--text-tertiary)',
              }}>
                Auto-expires {new Date(b.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
              </div>
            )}
            <div style={{
              marginTop: 6,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 4,
            }}>
              {!archived && (
                <IconBtn title="Edit" onClick={() => onEdit(b)}>
                  <Edit3 size={11} strokeWidth={1.6} />
                </IconBtn>
              )}
              {onArchive && (
                <IconBtn title="Archive" onClick={() => onArchive(b.id)}>
                  <Archive size={11} strokeWidth={1.6} />
                </IconBtn>
              )}
              {onUnarchive && (
                <IconBtn title="Restore" onClick={() => onUnarchive(b.id)}>
                  <RotateCcw size={11} strokeWidth={1.6} />
                </IconBtn>
              )}
              <IconBtn title="Delete" onClick={() => onDelete(b.id)}>
                <Trash2 size={11} strokeWidth={1.6} />
              </IconBtn>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pill({ label, tone }) {
  return (
    <span style={{
      padding: '1px 6px',
      borderRadius: 999,
      background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${tone} 30%, transparent)`,
      color: tone,
      fontSize: 9,
      fontWeight: 'var(--fw-medium)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
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

function BroadcastFormModal({ broadcast, onClose, onSaved }) {
  const isEdit = !!broadcast;
  const [form, setForm] = useState({
    title:      broadcast?.title    || '',
    body:       broadcast?.body     || '',
    severity:   broadcast?.severity || 'info',
    audience:   broadcast?.audience || 'all',
    expires_at: broadcast?.expires_at ? broadcast.expires_at.slice(0, 10) : '',
  });
  const [posting, setPosting] = useState(false);
  const [error, setError]     = useState(null);
  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.title.trim() || !form.body.trim() || posting) return;
    setPosting(true); setError(null);
    try {
      const body = {
        title:    form.title,
        body:     form.body,
        severity: form.severity,
        audience: form.audience,
        expires_at: form.expires_at ? new Date(form.expires_at + 'T23:59:59Z').toISOString() : null,
      };
      const r = await authFetch(
        isEdit ? `/api/broadcasts/${broadcast.id}` : '/api/broadcasts',
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
    <Modal open onClose={onClose} width={600}>
      <div style={{ padding: 'var(--space-5)' }}>
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-4)',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              {isEdit ? `Edit broadcast · #${broadcast.id}` : 'New broadcast'}
            </div>
            <h2 style={{
              margin: 0, fontSize: 'var(--ts-h2-size)',
              fontWeight: 'var(--fw-medium)',
            }}>
              {form.title || 'Post a corridor announcement'}
            </h2>
          </div>
          <button type="button" onClick={onClose} style={closeBtn}>
            <X size={18} />
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <Field label="Title">
            <input
              type="text" value={form.title} maxLength={120}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="e.g. Diesel reading +6.2% from 5 May"
              style={inputStyle}
            />
          </Field>
          <Field label="Body">
            <textarea
              value={form.body} maxLength={2000} rows={5}
              onChange={(e) => setField('body', e.target.value)}
              placeholder="What's the change, when does it land, what action (if any) is needed?"
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
            <Field label="Severity">
              <select value={form.severity} onChange={(e) => setField('severity', e.target.value)} style={inputStyle}>
                <option value="info">Info — context only</option>
                <option value="warn">Warning — change of state</option>
                <option value="urgent">Urgent — read immediately</option>
              </select>
            </Field>
            <Field label="Audience">
              <select value={form.audience} onChange={(e) => setField('audience', e.target.value)} style={inputStyle}>
                <option value="all">Everyone</option>
                <option value="operators">Operators only</option>
                <option value="haulers">Haulers only</option>
              </select>
            </Field>
            <Field label="Expires (optional)">
              <input
                type="date" value={form.expires_at}
                onChange={(e) => setField('expires_at', e.target.value)}
                style={inputStyle}
              />
            </Field>
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
            {error || (form.expires_at ? `Auto-archives end of ${form.expires_at}.` : 'Stays active until manually archived.')}
          </span>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={!form.title.trim() || !form.body.trim() || posting}>
              {posting ? 'Posting…' : isEdit ? 'Save changes' : 'Post broadcast'}
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
const closeBtn = {
  padding: 4, background: 'transparent', border: 'none',
  cursor: 'pointer', color: 'var(--text-tertiary)',
};
const muted = { color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' };
const emptyBox = {
  margin: 0, padding: 'var(--space-4)',
  background: 'var(--surface)', border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)',
  fontStyle: 'italic', textAlign: 'center',
};
