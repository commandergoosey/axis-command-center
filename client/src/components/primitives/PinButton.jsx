/*
 * PinButton — Phase 78.
 *
 * Reusable pin/unpin toggle for any pinnable entity (hauler,
 * risk, alert, contact, filing). Reads the user's current pins
 * once on mount, then optimistically toggles with rollback on
 * failure. Bumps a window-level event so PinboardPanel
 * elsewhere refetches.
 *
 * Compact icon-only by default; pass `label` for the verbose
 * variant.
 */

import { useEffect, useState, useCallback } from 'react';
import { Pin, PinOff } from 'lucide-react';
import { authFetch } from '../../lib/auth';

// Module-level cache of the current user's pin set so the button
// doesn't trigger N requests when N pinnable rows mount on a
// page. Populated once and refreshed on pin events.
let pinCache = null;
let pinCachePromise = null;

function loadCache() {
  if (pinCachePromise) return pinCachePromise;
  pinCachePromise = authFetch('/api/me/pins')
    .then((r) => (r.ok ? r.json() : { pins: [] }))
    .then((j) => {
      pinCache = new Set((j.pins || []).map((p) => `${p.entity_type}:${p.entity_id}`));
      return pinCache;
    })
    .catch(() => {
      pinCache = new Set();
      return pinCache;
    })
    .finally(() => { pinCachePromise = null; });
  return pinCachePromise;
}

export default function PinButton({ entityType, entityId, label, size = 12 }) {
  const key = `${entityType}:${entityId}`;
  const [pinned, setPinned] = useState(pinCache?.has(key) ?? false);
  const [busy, setBusy] = useState(false);

  // Sync from cache on mount + on pin events.
  const sync = useCallback(async () => {
    if (!pinCache) await loadCache();
    setPinned(pinCache?.has(key) ?? false);
  }, [key]);

  useEffect(() => {
    sync();
    function onChange() { sync(); }
    window.addEventListener('axis:pins-changed', onChange);
    return () => window.removeEventListener('axis:pins-changed', onChange);
  }, [sync]);

  async function toggle(e) {
    e?.stopPropagation();
    if (busy || !entityId) return;
    setBusy(true);
    const wasPinned = pinned;
    setPinned(!wasPinned); // optimistic
    try {
      if (wasPinned) {
        await authFetch('/api/me/pins/by-ref', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
        });
        pinCache?.delete(key);
      } else {
        await authFetch('/api/me/pins', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
        });
        pinCache?.add(key);
      }
      window.dispatchEvent(new CustomEvent('axis:pins-changed'));
    } catch {
      // rollback
      setPinned(wasPinned);
    } finally {
      setBusy(false);
    }
  }

  const Icon = pinned ? Pin : Pin;
  const tone = pinned ? 'var(--bauxite-rust)' : 'var(--text-tertiary)';

  if (label) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={pinned ? 'Unpin from your pinboard' : 'Pin to your pinboard'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: pinned ? 'var(--accent-tint)' : 'transparent',
          border: `1px solid ${pinned ? 'var(--bauxite-rust)' : 'var(--border-hairline)'}`,
          borderRadius: 999,
          fontSize: 'var(--ts-caption-size)',
          color: tone,
          cursor: busy ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {pinned
          ? <PinOff size={size} strokeWidth={1.6} />
          : <Pin    size={size} strokeWidth={1.6} />}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={pinned ? 'Unpin' : 'Pin to your pinboard'}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 4,
        cursor: busy ? 'wait' : 'pointer',
        color: tone,
        lineHeight: 0,
        opacity: pinned ? 1 : 0.6,
      }}
    >
      <Icon
        size={size}
        strokeWidth={1.6}
        // Filled-look when pinned via fill prop on lucide icons:
        fill={pinned ? 'currentColor' : 'none'}
      />
    </button>
  );
}
