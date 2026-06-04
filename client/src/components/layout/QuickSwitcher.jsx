/*
 * QuickSwitcher — Phase 76.
 *
 * Cmd-K (or Ctrl-K) global search + jump-to-anything modal.
 * Type to filter haulers, drivers, risks, alerts, hauler contacts,
 * filings, and audit rows. Keyboard-navigable: arrow keys move
 * the highlight, Enter navigates, Escape closes.
 *
 * Mounted globally from Topbar so the keyboard shortcut works on
 * every page. Results filtered server-side to surfaces the user
 * can access.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Building2, User, ShieldAlert, AlertTriangle, Phone, FileSignature,
  ScrollText, ArrowUpDown, CornerDownLeft,
} from 'lucide-react';
import { authFetch } from '../../lib/auth';

const TYPE_META = {
  hauler:  { label: 'Hauler',  icon: Building2 },
  driver:  { label: 'Driver',  icon: User },
  risk:    { label: 'Risk',    icon: ShieldAlert },
  alert:   { label: 'Alert',   icon: AlertTriangle },
  contact: { label: 'Contact', icon: Phone },
  filing:  { label: 'Filing',  icon: FileSignature },
  audit:   { label: 'Audit',   icon: ScrollText },
};

const GROUP_ORDER = ['haulers', 'drivers', 'risks', 'alerts', 'contacts', 'filings', 'audit'];
const GROUP_LABEL = {
  haulers:  'Haulers',
  drivers:  'Drivers',
  risks:    'Risks',
  alerts:   'Alerts',
  contacts: 'Hauler contacts',
  filings:  'Filings',
  audit:    'Audit log',
};

const HINTS = ['hauler 05', 'DSCR', 'DVLA', 'Yaw', 'covenant', '02 May'];

export default function QuickSwitcher({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery]   = useState('');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // Reset on open + focus the input.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setData(null);
    setHighlight(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) { setData(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      authFetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => { setData(j); setHighlight(0); })
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    }, 80);
    return () => clearTimeout(t);
  }, [query, open]);

  const groupedResults = useMemo(() => {
    if (!data?.results) return [];
    // Re-group flat results so each section renders in declared order.
    const map = new Map();
    for (const r of data.results) {
      // Re-derive group key from type — server returned by_type already
      // in the right order; we just need to bucket.
      const key = r.type === 'hauler'  ? 'haulers'
                : r.type === 'driver'  ? 'drivers'
                : r.type === 'risk'    ? 'risks'
                : r.type === 'alert'   ? 'alerts'
                : r.type === 'contact' ? 'contacts'
                : r.type === 'filing'  ? 'filings'
                : r.type === 'audit'   ? 'audit'
                : 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k) }));
  }, [data]);

  const flat = useMemo(() => groupedResults.flatMap((g) => g.items), [groupedResults]);
  const total = flat.length;

  // Keyboard nav.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, total - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        const item = flat[highlight];
        if (item?.link?.path) {
          onClose?.();
          navigate(item.link.path);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, highlight, total, flat, navigate, onClose]);

  // Scroll the highlighted row into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-search-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 31, 31, 0.32)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '14vh',
        zIndex: 200,
        animation: 'fade-in 140ms ease-out',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 600,
          background: 'var(--surface-raised)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-soft)',
          boxShadow: '0 24px 60px rgba(31, 31, 31, 0.22)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-hairline)',
        }}>
          <Search size={16} strokeWidth={1.6} color="var(--text-tertiary)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search haulers, drivers, risks, alerts, contacts, filings, audit…"
            maxLength={80}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              fontSize: 'var(--ts-body-size, 14px)',
              color: 'var(--text)',
            }}
          />
          {loading && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>…</span>
          )}
          <kbd style={kbdStyle}>esc</kbd>
        </div>

        <div ref={listRef} style={{
          maxHeight: '60vh',
          overflowY: 'auto',
        }}>
          {!query.trim() ? (
            <Hints onPick={(h) => setQuery(h)} />
          ) : total === 0 ? (
            <Empty query={query} loading={loading} />
          ) : (
            groupedResults.map((g, gIdx) => (
              <Group
                key={g.key}
                label={GROUP_LABEL[g.key]}
                items={g.items}
                indexOffset={groupedResults.slice(0, gIdx).reduce((s, x) => s + x.items.length, 0)}
                highlight={highlight}
                setHighlight={setHighlight}
                onPick={(item) => {
                  onClose?.();
                  if (item.link?.path) navigate(item.link.path);
                }}
              />
            ))
          )}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderTop: '1px solid var(--border-hairline)',
          fontSize: 11,
          color: 'var(--text-tertiary)',
        }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowUpDown size={11} strokeWidth={1.6} /> navigate
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CornerDownLeft size={11} strokeWidth={1.6} /> open
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <kbd style={kbdStyle}>esc</kbd> close
            </span>
          </div>
          {total > 0 && (
            <span>{total} result{total === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────

function Hints({ onPick }) {
  return (
    <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
      <div className="micro" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>
        TRY SEARCHING
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {HINTS.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onPick(h)}
            style={{
              padding: '4px 10px',
              background: 'var(--surface)',
              border: '1px solid var(--border-hairline)',
              borderRadius: 999,
              fontSize: 'var(--ts-caption-size)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {h}
          </button>
        ))}
      </div>
      <p style={{
        margin: '12px 0 0',
        fontSize: 'var(--ts-caption-size)',
        color: 'var(--text-tertiary)',
        lineHeight: 1.5,
      }}>
        One keystroke to anywhere. Searches haulers, drivers, risks, alerts, hauler contacts, filings, and the audit log — filtered to what your role can open.
      </p>
    </div>
  );
}

function Empty({ query, loading }) {
  if (loading) {
    return (
      <p style={{
        padding: 'var(--space-5)',
        textAlign: 'center',
        fontSize: 'var(--ts-body-sm-size)',
        color: 'var(--text-tertiary)',
      }}>
        Searching for "{query}"…
      </p>
    );
  }
  return (
    <p style={{
      padding: 'var(--space-5)',
      textAlign: 'center',
      fontSize: 'var(--ts-body-sm-size)',
      color: 'var(--text-tertiary)',
    }}>
      No results for "{query}".
    </p>
  );
}

function Group({ label, items, indexOffset, highlight, setHighlight, onPick }) {
  return (
    <div>
      <div style={{
        padding: '6px 16px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-hairline)',
        borderTop: '1px solid var(--border-hairline)',
      }} className="micro">
        <span style={{ color: 'var(--text-tertiary)' }}>{label.toUpperCase()}</span>
        <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>· {items.length}</span>
      </div>
      {items.map((item, i) => {
        const idx = indexOffset + i;
        const meta = TYPE_META[item.type] || { icon: Search, label: item.type };
        const Icon = meta.icon;
        const active = idx === highlight;
        return (
          <button
            key={`${item.type}-${item.id}-${idx}`}
            type="button"
            data-search-idx={idx}
            onMouseEnter={() => setHighlight(idx)}
            onClick={() => onPick(item)}
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '10px 16px',
              background: active ? 'var(--accent-tint)' : 'transparent',
              borderLeft: `2px solid ${active ? 'var(--bauxite-rust)' : 'transparent'}`,
              border: 'none',
              borderBottom: '1px solid var(--border-hairline)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              textAlign: 'left',
            }}
          >
            <Icon size={14} strokeWidth={1.6} color={active ? 'var(--bauxite-rust)' : 'var(--text-tertiary)'} />
            <span style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--ts-body-sm-size)',
                color: 'var(--text)',
                fontWeight: 'var(--fw-medium)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {item.title}
              </div>
              {item.subtitle && (
                <div style={{
                  fontSize: 'var(--ts-caption-size)',
                  color: 'var(--text-tertiary)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {item.subtitle}
                </div>
              )}
            </span>
            {active && item.link?.label && (
              <span style={{
                fontSize: 10,
                color: 'var(--bauxite-rust)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }} className="mono">
                {item.link.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const kbdStyle = {
  padding: '1px 6px',
  border: '1px solid var(--border-soft)',
  borderRadius: 4,
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-tertiary)',
  background: 'var(--surface)',
};
