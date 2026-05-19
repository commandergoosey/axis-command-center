'use strict';

/*
 * AlertRulesPanel — Settings panel for managing alert thresholds.
 *
 * Shows all global and hauler-specific alert rules. Supports:
 *   - Toggle enabled / disabled per rule
 *   - Inline threshold + severity editing
 *   - Create new rules (global or hauler-scoped)
 *   - Delete rules
 *
 * axis_admin only — hides itself for lower roles.
 */

import { useCallback, useEffect, useState } from 'react';
import { Bell, Plus, Trash2, X, Check } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth }   from '../../lib/AuthContext';

const SEVERITIES = ['info', 'warning', 'critical'];

const SEV_STYLE = {
  info:     { bg: 'rgba(100,100,100,.10)', fg: 'var(--text-secondary)' },
  warning:  { bg: 'rgba(180,83,9,.10)',    fg: 'var(--signal-amber)' },
  critical: { bg: 'rgba(162,62,35,.10)',   fg: 'var(--bauxite-rust)' },
};

function SevBadge({ severity }) {
  const s = SEV_STYLE[severity] ?? SEV_STYLE.info;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 3,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.04em',
      background: s.bg,
      color: s.fg,
      textTransform: 'uppercase',
    }}>
      {severity}
    </span>
  );
}

const TH = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 'var(--ts-caption-size)',
  color: 'var(--text-tertiary)',
  fontWeight: 'var(--fw-medium)',
  borderBottom: '1px solid var(--border-hairline)',
  whiteSpace: 'nowrap',
};
const TD = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border-hairline)',
  fontSize: 'var(--ts-body-sm-size)',
  verticalAlign: 'middle',
};

const inputStyle = {
  padding: '5px 8px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-body-sm-size)',
  width: '100%',
  boxSizing: 'border-box',
};

/* ── Single row (view + inline edit) ─────────────────────────────────────── */

function RuleRow({ rule, onSaved, onDeleted }) {
  const [editing, setEditing]     = useState(false);
  const [draft, setDraft]         = useState({});
  const [saving, setSaving]       = useState(false);
  const [toggling, setToggling]   = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const [error, setError]         = useState(null);

  function startEdit() {
    setDraft({
      label:     rule.label ?? '',
      threshold: String(rule.threshold),
      severity:  rule.severity,
    });
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/alert-rules/${rule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          label:     draft.label || null,
          threshold: Number(draft.threshold),
          severity:  draft.severity,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onSaved(d.alert_rule);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled() {
    setToggling(true);
    try {
      const r = await authFetch(`/api/admin/alert-rules/${rule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: !rule.enabled }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onSaved(d.alert_rule);
    } catch (err) {
      setError(err.message);
    } finally {
      setToggling(false);
    }
  }

  async function deleteRule() {
    if (!window.confirm(`Delete rule "${rule.label ?? rule.rule_type}"?`)) return;
    setDeleting(true);
    try {
      const r = await authFetch(`/api/admin/alert-rules/${rule.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onDeleted(rule.id);
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  const dimmed = { opacity: rule.enabled ? 1 : 0.45 };

  return (
    <>
      <tr
        style={{ cursor: 'pointer', background: editing ? 'var(--accent-tint)' : 'transparent' }}
        onClick={!editing ? startEdit : undefined}
      >
        <td style={TD}>
          <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--text-tertiary)', ...dimmed }}>
            {rule.rule_type}
          </span>
        </td>
        <td style={{ ...TD, ...dimmed }}>{rule.label ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
        <td style={{ ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...dimmed }}>{rule.threshold}</td>
        <td style={TD}><SevBadge severity={rule.severity} /></td>
        <td style={{ ...TD, color: 'var(--text-tertiary)', fontSize: 11, ...dimmed }}>
          {rule.hauler_id ?? 'Global'}
        </td>
        <td style={{ ...TD, textAlign: 'center' }}>
          <button
            onClick={(e) => { e.stopPropagation(); toggleEnabled(); }}
            disabled={toggling}
            title={rule.enabled ? 'Disable rule' : 'Enable rule'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: rule.enabled ? 'var(--signal-green)' : 'var(--text-tertiary)',
              padding: 2, fontSize: 14,
            }}
          >
            {rule.enabled ? '●' : '○'}
          </button>
        </td>
        <td style={{ ...TD, textAlign: 'right' }}>
          <button
            onClick={(e) => { e.stopPropagation(); deleteRule(); }}
            disabled={deleting}
            title="Delete rule"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>

      {editing && (
        <tr>
          <td colSpan={7} style={{ padding: '12px 16px', background: 'var(--accent-tint)', borderBottom: '1px solid var(--border-hairline)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 140px', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Label</div>
                <input
                  style={inputStyle}
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="Human-readable description"
                />
              </div>
              <div>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Threshold</div>
                <input
                  style={inputStyle}
                  type="number"
                  value={draft.threshold}
                  onChange={(e) => setDraft((d) => ({ ...d, threshold: e.target.value }))}
                />
              </div>
              <div>
                <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Severity</div>
                <select
                  style={inputStyle}
                  value={draft.severity}
                  onChange={(e) => setDraft((d) => ({ ...d, severity: e.target.value }))}
                >
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {error && (
              <div style={{ marginBottom: 8, fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                onClick={save}
                disabled={saving || draft.threshold === ''}
                style={{
                  padding: '5px 14px',
                  background: 'var(--bauxite-rust)', color: 'white',
                  border: 'none', borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-primary)', fontSize: 'var(--ts-caption-size)',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : <><Check size={12} style={{ marginRight: 4 }} />Save</>}
              </button>
              <button
                onClick={() => setEditing(false)}
                style={{
                  padding: '5px 14px',
                  background: 'transparent', color: 'var(--text-secondary)',
                  border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
                  fontFamily: 'var(--font-primary)', fontSize: 'var(--ts-caption-size)',
                  cursor: 'pointer',
                }}
              >
                <X size={12} style={{ marginRight: 4 }} />Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ── New rule form ────────────────────────────────────────────────────────── */

function AddRuleForm({ onAdded, onClose }) {
  const [fields, setFields] = useState({ rule_type: 'speed', threshold: '', severity: 'warning', label: '', hauler_id: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);
  const set = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        rule_type: fields.rule_type,
        threshold: Number(fields.threshold),
        severity:  fields.severity,
        label:     fields.label || null,
        hauler_id: fields.hauler_id || null,
      };
      const r = await authFetch('/api/admin/alert-rules', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      onAdded(d.alert_rule);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td colSpan={7} style={{ padding: '12px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border-hairline)' }}>
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 120px 140px 160px', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Type</div>
              <input style={inputStyle} value={fields.rule_type} onChange={set('rule_type')} placeholder="speed" required />
            </div>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Label</div>
              <input style={inputStyle} value={fields.label} onChange={set('label')} placeholder="Speed > 120 km/h" />
            </div>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Threshold</div>
              <input style={inputStyle} type="number" value={fields.threshold} onChange={set('threshold')} required />
            </div>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Severity</div>
              <select style={inputStyle} value={fields.severity} onChange={set('severity')}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)', marginBottom: 3 }}>Hauler ID (optional)</div>
              <input style={inputStyle} value={fields.hauler_id} onChange={set('hauler_id')} placeholder="haul-01 or leave blank" />
            </div>
          </div>
          {error && <div style={{ marginBottom: 8, fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              type="submit"
              disabled={saving || !fields.rule_type || fields.threshold === ''}
              style={{
                padding: '5px 14px',
                background: 'var(--bauxite-rust)', color: 'white',
                border: 'none', borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-primary)', fontSize: 'var(--ts-caption-size)',
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Adding…' : 'Add rule'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '5px 14px',
                background: 'transparent', color: 'var(--text-secondary)',
                border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-primary)', fontSize: 'var(--ts-caption-size)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

export default function AlertRulesPanel() {
  const { user }              = useAuth();
  const [rules, setRules]     = useState(null);
  const [error, setError]     = useState(null);
  const [adding, setAdding]   = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await authFetch('/api/admin/alert-rules');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setRules((d.alert_rules ?? []).map((r) => ({ ...r, enabled: Boolean(r.enabled) })));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { if (user?.role === 'axis_admin') load(); }, [load, user]);

  if (user?.role !== 'axis_admin') return null;

  function onSaved(updated) {
    setRules((prev) => prev.map((r) => r.id === updated.id ? { ...updated, enabled: Boolean(updated.enabled) } : r));
  }
  function onDeleted(id) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }
  function onAdded(rule) {
    setRules((prev) => [...prev, { ...rule, enabled: Boolean(rule.enabled) }]);
  }

  const enabledCount = rules?.filter((r) => r.enabled).length ?? 0;
  const totalCount   = rules?.length ?? 0;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderBottom: '1px solid var(--border-hairline)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Alert rules</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {rules != null && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {enabledCount} enabled · {totalCount} total
            </span>
          )}
          <button
            onClick={() => setAdding((a) => !a)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px',
              background: adding ? 'var(--accent-tint)' : 'transparent',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-primary)',
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            <Plus size={12} />Add rule
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--ts-caption-size)', color: 'var(--bauxite-rust)' }}>
          {error}
        </div>
      )}

      {rules === null && !error ? (
        <div style={{ padding: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--ts-caption-size)' }}>
          Loading…
        </div>
      ) : rules?.length === 0 && !adding ? (
        <div style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--ts-body-sm-size)' }}>
          No alert rules configured. Click <strong>Add rule</strong> to create the first one.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr style={{ background: 'var(--surface)' }}>
                <th style={TH}>Type</th>
                <th style={TH}>Label</th>
                <th style={{ ...TH, textAlign: 'right' }}>Threshold</th>
                <th style={TH}>Severity</th>
                <th style={TH}>Scope</th>
                <th style={{ ...TH, textAlign: 'center' }}>On</th>
                <th style={{ ...TH, width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {adding && <AddRuleForm onAdded={onAdded} onClose={() => setAdding(false)} />}
              {rules?.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onSaved={onSaved}
                  onDeleted={onDeleted}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
