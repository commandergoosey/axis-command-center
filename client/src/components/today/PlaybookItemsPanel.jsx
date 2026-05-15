/*
 * PlaybookItemsPanel — Phase 80.
 *
 * Open playbook items across all active runs, surfaced on
 * Today's right rail so an operator with a routine in flight
 * sees the next checkbox right where they're working from.
 *
 * Hidden when there are no open items. Each row shows the parent
 * playbook name + item title + owner + due-date pill. Click
 * navigates to the Playbooks page; the per-row check toggles
 * complete inline.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListChecks, Check, Calendar, ArrowRight } from 'lucide-react';
import { authFetch } from '../../lib/auth';
import { useAuth } from '../../lib/AuthContext';

const WRITE_ROLES = new Set(['axis_admin', 'axis_ops']);
const MAX_VISIBLE = 5;

export default function PlaybookItemsPanel({ refreshKey }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user && WRITE_ROLES.has(user.role);
  const [items, setItems] = useState(null);

  const load = useCallback(() => {
    // Two-fetch composition: get recent runs, then fetch each
    // run's items if any are still open. We could add a dedicated
    // endpoint but the volume is tiny (≤10 runs × ≤6 items) and
    // the round-trip is sub-ms in practice.
    authFetch('/api/playbooks')
      .then((r) => (r.ok ? r.json() : null))
      .then(async (j) => {
        if (!j || !j.recent_runs) { setItems([]); return; }
        const runsWithOpen = j.recent_runs.filter((r) => (r.counts?.total ?? 0) > (r.counts?.done ?? 0));
        if (runsWithOpen.length === 0) { setItems([]); return; }
        const all = [];
        for (const run of runsWithOpen) {
          const rr = await authFetch(`/api/playbooks/runs/${run.id}`);
          if (!rr.ok) continue;
          const detail = await rr.json();
          for (const item of detail.items) {
            if (item.status === 'open') {
              all.push({ ...item, playbook_name: run.playbook_name, run_id: run.id });
            }
          }
        }
        // Sort: due-date asc, no-due last; within tie by run start.
        all.sort((a, b) => {
          if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return 0;
        });
        setItems(all);
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!items || items.length === 0) return null;

  async function complete(item, e) {
    e.stopPropagation();
    if (!canWrite) return;
    const r = await authFetch(`/api/playbooks/runs/items/${item.id}/complete`, { method: 'POST' });
    if (r.ok) load();
  }

  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;

  return (
    <section style={{
      background: 'var(--surface-raised)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ListChecks size={12} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Playbook items</span>
        </div>
        <button
          type="button"
          onClick={() => navigate('/playbooks')}
          style={{
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer',
            fontSize: 'var(--ts-caption-size)',
            color: 'var(--bauxite-rust)',
            fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 2,
          }}
        >
          all playbooks
          <ArrowRight size={10} strokeWidth={1.6} />
        </button>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {visible.map((item) => {
          const dueDays = item.due_date
            ? Math.ceil((new Date(item.due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
            : null;
          const overdue = dueDays != null && dueDays < 0;
          const dueSoon = dueDays != null && dueDays >= 0 && dueDays <= 1;
          const tone = overdue ? 'var(--bauxite-rust)' : dueSoon ? 'var(--signal-amber)' : 'var(--text-secondary)';
          return (
            <div
              key={item.id}
              onClick={() => navigate('/playbooks')}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                columnGap: 8,
                alignItems: 'center',
                padding: '6px 8px',
                background: 'var(--surface)',
                border: '1px solid var(--border-hairline)',
                borderLeft: `2px solid ${tone}`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              <button
                type="button"
                onClick={(e) => complete(item, e)}
                disabled={!canWrite}
                title="Mark done"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14, height: 14,
                  borderRadius: 3,
                  border: '1.5px solid var(--border-soft)',
                  background: 'transparent',
                  cursor: canWrite ? 'pointer' : 'default',
                  padding: 0,
                  lineHeight: 0,
                }}
              >
                <Check size={10} strokeWidth={2.5} color="transparent" />
              </button>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text)',
                  fontWeight: 'var(--fw-medium)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {item.title}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--text-tertiary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {item.playbook_name}
                  {item.owner_display && <span> · {item.owner_display}</span>}
                </div>
              </div>
              {item.due_date && (
                <span className="mono tabular" style={{
                  fontSize: 9, color: tone, letterSpacing: '0.04em',
                }}>
                  {overdue ? `${-dueDays}d` : dueDays === 0 ? 'today' : dueDays === 1 ? 'tom' : `+${dueDays}d`}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {overflow > 0 && (
        <div style={{
          marginTop: 6,
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text-tertiary)',
          textAlign: 'center',
        }}>
          +{overflow} more open
        </div>
      )}
    </section>
  );
}
