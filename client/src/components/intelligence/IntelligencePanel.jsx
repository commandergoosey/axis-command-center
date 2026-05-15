/*
 * IntelligencePanel — page-specific AXIS Intelligence surface.
 * Hits /api/intelligence/observe?page=<page> on mount, renders 2–4 short
 * observations with severity tone, then offers suggestion chips that drop
 * into the IntelligenceInput chat. Drop into any page below the page hero
 * to give the operator a context-specific read of the data on screen.
 */

import { authFetch } from '../../lib/auth';

import { useEffect, useState } from 'react';
import { Sparkle, AlertTriangle, Info } from 'lucide-react';
import IntelligenceInput from '../today/IntelligenceInput';

const SEV = {
  warn: { icon: AlertTriangle, color: 'var(--signal-amber)' },
  info: { icon: Info,          color: 'var(--iron)' },
};

export default function IntelligencePanel({ page }) {
  const [data,    setData]    = useState(null);
  const [mode,    setMode]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [observe, status] = await Promise.all([
          authFetch(`/api/intelligence/observe?page=${encodeURIComponent(page)}`).then((r) => r.json()),
          authFetch('/api/intelligence/status').then((r) => r.json()).catch(() => ({ mode: 'demonstration' })),
        ]);
        if (cancelled) return;
        setData(observe);
        setMode(status.mode);
      } catch (_err) {
        if (!cancelled) setData({ observations: [], chips: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [page]);

  return (
    <section style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
      gap: 'var(--space-4)',
      alignItems: 'stretch',
    }}>
      <div style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4) var(--space-5)',
      }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
          <Sparkle size={14} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">AXIS Intelligence · observations</span>
        </header>

        {loading && (
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            Reading the corridor…
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {(data?.observations ?? []).map((o) => {
            const sev = SEV[o.severity] ?? SEV.info;
            const Icon = sev.icon;
            return (
              <article key={o.id} style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '10px var(--space-3)',
                background: 'var(--surface-sunk)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <Icon size={14} strokeWidth={1.5} color={sev.color} style={{ marginTop: 2, flexShrink: 0 }} />
                <p style={{
                  margin: 0,
                  fontSize: 'var(--ts-body-sm-size)',
                  lineHeight: 'var(--ts-body-sm-lh)',
                  color: 'var(--text)',
                }}>
                  {o.body}
                </p>
              </article>
            );
          })}
        </div>

        {!loading && (data?.observations?.length ?? 0) === 0 && (
          <p style={{ margin: 0, fontSize: 'var(--ts-body-sm-size)', color: 'var(--text-tertiary)' }}>
            No observations to publish for this view.
          </p>
        )}
      </div>

      <IntelligenceInput page={page} chips={data?.chips ?? []} mode={mode} />
    </section>
  );
}
