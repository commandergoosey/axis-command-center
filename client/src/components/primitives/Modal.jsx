/*
 * Modal — centred overlay with scrim. 12px radius per design system §6.4.
 * Closes on Escape and on scrim click. Body scroll locked while open.
 * Content is injected; no header is imposed — caller frames it.
 */

import { useEffect } from 'react';

export default function Modal({ open, onClose, children, width = 480 }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 31, 31, 0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
        zIndex: 100,
        animation: 'fade-in 140ms ease-out',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: width,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 12px 32px rgba(31, 31, 31, 0.18)',
          border: '1px solid var(--border-soft)',
          maxHeight: 'calc(100vh - 64px)',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
