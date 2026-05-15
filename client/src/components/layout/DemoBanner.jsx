import { useEffect, useState } from 'react';
import { authFetch } from '../../lib/auth';

/*
 * DemoBanner.
 * Shown when the server reports mock mode (no hauler API tokens configured).
 * Fixed bottom strip, 36px tall, Charcoal on Bone. Deliberately undemonstrative.
 */

export default function DemoBanner() {
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    authFetch('/api/config')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(cfg => setIsDemo(!!cfg.demo_mode))
      .catch(() => setIsDemo(true));
  }, []);

  if (!isDemo) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 'var(--sidebar-w)',
        right: 0,
        height: 36,
        background: 'var(--charcoal)',
        color: 'var(--bone)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        zIndex: 60,
        borderTop: '1px solid var(--border-strong)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          background: 'var(--bauxite-rust)',
        }}
        aria-hidden="true"
      />
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        Demonstration mode — no hauler APIs connected
      </span>
    </div>
  );
}
