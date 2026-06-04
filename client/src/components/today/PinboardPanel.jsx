/*
 * PinboardPanel — Phase 78.
 *
 * Personal watchlist on Today's right rail. Shows the current
 * user's pinned haulers, risks, alerts, contacts, and filings —
 * each row hydrated server-side against its source primitive so
 * the panel always reflects today's state. Per-row unpin button.
 *
 * Hidden when the user has no pins. Pinning happens elsewhere
 * (PinButton component on Risks, Haulers, etc.).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pin, PinOff, Building2, ShieldAlert, AlertTriangle, Phone, FileSignature,
} from 'lucide-react';
import { authFetch } from '../../lib/auth';

const TYPE_META = {
  hauler:  { icon: Building2 },
  risk:    { icon: ShieldAlert },
  alert:   { icon: AlertTriangle },
  contact: { icon: Phone },
  filing:  { icon: FileSignature },
};

const TONE = {
  warn:     'var(--bauxite-rust)',
  info:     'var(--text-secondary)',
  tertiary: 'var(--text-tertiary)',
};

export default function PinboardPanel({ refreshKey }) {
  const navigate = useNavigate();
  const [pins, setPins] = useState(null);

  const load = useCallback(() => {
    authFetch('/api/me/pins')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setPins(j.pins || []); })
      .catch(() => { /* advisory */ });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Listen for cross-component pin changes — any PinButton bumps
  // a custom event so this panel refetches without prop-drilling.
  useEffect(() => {
    function onPinChange() { load(); }
    window.addEventListener('axis:pins-changed', onPinChange);
    return () => window.removeEventListener('axis:pins-changed', onPinChange);
  }, [load]);

  if (!pins || pins.length === 0) return null;

  async function unpin(pin) {
    await authFetch(`/api/me/pins/${pin.pin_id}`, { method: 'DELETE' });
    load();
    window.dispatchEvent(new CustomEvent('axis:pins-changed'));
  }

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
          <Pin size={12} strokeWidth={1.6} color="var(--bauxite-rust)" />
          <span className="eyebrow">Your pins</span>
        </div>
        <span style={{ fontSize: 'var(--ts-caption-size)', color: 'var(--text-tertiary)' }}>
          {pins.length}
        </span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {pins.map((p) => <PinRow key={p.pin_id} pin={p} navigate={navigate} onUnpin={() => unpin(p)} />)}
      </div>
    </section>
  );
}

function PinRow({ pin, navigate, onUnpin }) {
  const h = pin.hydrated || {};
  const Icon = TYPE_META[pin.entity_type]?.icon || Pin;
  const tone = TONE[h.severity] || TONE.info;
  const clickable = !h.tombstone && h.link?.path;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      columnGap: 8,
      alignItems: 'center',
      padding: '6px 8px',
      background: 'var(--surface)',
      borderRadius: 'var(--radius-sm)',
      borderLeft: `2px solid ${tone}`,
      opacity: h.tombstone ? 0.55 : 1,
      cursor: clickable ? 'pointer' : 'default',
    }}
    onClick={clickable ? () => navigate(h.link.path) : undefined}>
      <Icon size={11} strokeWidth={1.6} color={tone} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--ts-caption-size)',
          color: 'var(--text)',
          fontWeight: 'var(--fw-medium)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {h.title || pin.label || `${pin.entity_type} ${pin.entity_id}`}
        </div>
        {h.subtitle && (
          <div style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {h.subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onUnpin(); }}
        title="Unpin"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: 'var(--text-tertiary)',
          lineHeight: 0,
        }}
      >
        <PinOff size={11} strokeWidth={1.6} />
      </button>
    </div>
  );
}
