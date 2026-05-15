/*
 * SchedulesPanel — management view for all scheduled reports.
 *
 * Shows a table of active/inactive schedules with toggle, edit (opens
 * ScheduleDrawer), and delete controls. Batch select + delete supported.
 *
 * Props:
 *   schedules   — Schedule[] from /api/reports/schedules
 *   onRefresh   — () => void   (reload after mutation)
 */

import { useState } from 'react';
import { Clock, Trash2, ToggleLeft, ToggleRight, ChevronDown, ChevronUp, Play } from 'lucide-react';
import { authFetch } from '../../lib/auth';

export default function SchedulesPanel({ schedules, onRefresh }) {
  const [selected,  setSelected]  = useState(new Set());
  const [busy,      setBusy]      = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  if (!schedules) return null;

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(schedules.map((s) => s.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function runNow(id) {
    setBusy(`run-${id}`);
    try {
      await authFetch(`/api/reports/schedules/${id}/run`, { method: 'POST' });
      onRefresh?.();
    } finally {
      setBusy(null);
    }
  }

  async function deleteSchedule(id) {
    if (!window.confirm('Delete this schedule?')) return;
    setBusy(id);
    try {
      await authFetch(`/api/reports/schedules/${id}`, { method: 'DELETE' });
      onRefresh?.();
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(schedule) {
    setBusy(schedule.id);
    try {
      await authFetch(`/api/reports/schedules/${schedule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: !schedule.active }),
      });
      onRefresh?.();
    } finally {
      setBusy(null);
    }
  }

  async function deleteSelected() {
    if (!selected.size || !window.confirm(`Delete ${selected.size} schedule(s)?`)) return;
    setBusy('batch');
    try {
      await Promise.all(
        [...selected].map((id) =>
          authFetch(`/api/reports/schedules/${id}`, { method: 'DELETE' })
        )
      );
      setSelected(new Set());
      onRefresh?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      {/* Section header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: collapsed ? 0 : 'var(--space-3)',
      }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, padding: 0,
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            <Clock size={11} strokeWidth={1.6} style={{ verticalAlign: 'middle', marginRight: 5 }} />
            Scheduled · {schedules.length}
          </div>
          {collapsed
            ? <ChevronDown size={14} strokeWidth={1.6} color="var(--text-tertiary)" />
            : <ChevronUp   size={14} strokeWidth={1.6} color="var(--text-tertiary)" />}
        </button>

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
                {selected.size} selected
              </span>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={busy === 'batch'}
                style={{
                  padding: '4px 10px',
                  background: 'rgba(139, 46, 26, 0.08)',
                  border: '1px solid rgba(139, 46, 26, 0.2)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--bauxite-rust)',
                  fontFamily: 'var(--font-primary)',
                  fontSize: 'var(--ts-caption-size)',
                  cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                <Trash2 size={11} strokeWidth={1.6} />
                Delete {selected.size}
              </button>
              <button type="button" onClick={clearAll} style={ghostBtnStyle}>
                Clear
              </button>
            </>
          )}
          {selected.size === 0 && (
            <button type="button" onClick={selectAll} style={ghostBtnStyle}>
              Select all
            </button>
          )}
        </div>
      </header>

      {!collapsed && schedules.length === 0 && (
        <div style={{
          padding: 'var(--space-4)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-tertiary)',
          fontSize: 'var(--ts-caption-size)',
          textAlign: 'center',
        }}>
          No scheduled reports yet — click the <Clock size={10} style={{ verticalAlign: 'middle' }} /> icon on any report tile to create one.
        </div>
      )}

      {!collapsed && schedules.length > 0 && (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '20px 1fr 140px 150px 130px 100px 96px',
            gap: 12,
            padding: '8px 16px',
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border-hairline)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}>
            <span />
            <span>Report</span>
            <span>Frequency</span>
            <span>Next run</span>
            <span>Last run</span>
            <span>Status</span>
            <span />
          </div>

          {schedules.map((s, idx) => (
            <ScheduleRow
              key={s.id}
              schedule={s}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
              onToggleActive={() => toggleActive(s)}
              onRunNow={() => runNow(s.id)}
              onDelete={() => deleteSchedule(s.id)}
              busy={busy === s.id}
              runBusy={busy === `run-${s.id}`}
              striped={idx % 2 === 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function fmtRunTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short',
  }) + ' · ' + new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  }) + ' UTC';
}

function ScheduleRow({ schedule, selected, onToggleSelect, onToggleActive, onRunNow, onDelete, busy, runBusy, striped }) {
  const nextRun = schedule.active ? fmtRunTime(schedule.next_run_at) : 'Paused';
  const lastRun = fmtRunTime(schedule.last_run_at);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '20px 1fr 140px 150px 130px 100px 96px',
      gap: 12,
      padding: '10px 16px',
      alignItems: 'center',
      background: striped ? 'var(--surface)' : 'transparent',
      borderBottom: '1px solid var(--border-hairline)',
      opacity: busy ? 0.6 : 1,
      transition: 'opacity 150ms ease',
    }}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        style={{ width: 13, height: 13, accentColor: 'var(--bauxite-rust)', cursor: 'pointer' }}
      />

      {/* Report info */}
      <div>
        <div style={{ fontSize: 'var(--ts-body-sm-size)', fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>
          {schedule.title}
        </div>
        {schedule.recipients?.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
            → {schedule.recipients.join(', ')}
          </div>
        )}
      </div>

      {/* Frequency */}
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-secondary)' }}>
        {schedule.frequency_human}
      </div>

      {/* Next run */}
      <div style={{ fontSize: 'var(--ts-caption-size)', color: schedule.active ? 'var(--text)' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
        {nextRun}
      </div>

      {/* Last run */}
      <div style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
        {lastRun}
      </div>

      {/* Active toggle */}
      <div>
        <button
          type="button"
          onClick={onToggleActive}
          disabled={busy}
          title={schedule.active ? 'Pause schedule' : 'Activate schedule'}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11,
            color: schedule.active ? 'var(--bauxite-rust)' : 'var(--text-tertiary)',
            padding: 0,
          }}
        >
          {schedule.active
            ? <ToggleRight size={18} strokeWidth={1.5} />
            : <ToggleLeft  size={18} strokeWidth={1.5} />}
          <span style={{ fontSize: 10 }}>{schedule.active ? 'Active' : 'Paused'}</span>
        </button>
      </div>

      {/* Actions — Run now + Delete */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <button
          type="button"
          onClick={onRunNow}
          disabled={runBusy || busy}
          title="Run now — generate and send immediately"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 4, borderRadius: 'var(--radius-sm)',
            opacity: runBusy ? 0.5 : 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bauxite-rust)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <Play size={12} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          title="Delete schedule"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-tertiary)', padding: 4, borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bauxite-rust)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          <Trash2 size={13} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}

const ghostBtnStyle = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid var(--border-hairline)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-primary)',
  fontSize: 'var(--ts-caption-size)',
  cursor: 'pointer',
};
