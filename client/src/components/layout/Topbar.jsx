import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown, Sunset, CalendarRange, Search as SearchIcon, Activity } from 'lucide-react';
import AxisWordmark from '../brand/AxisWordmark';
import MyQueueButton from './MyQueueButton';
import NotificationBell from './NotificationBell';
import DayInReview from './DayInReview';
import WeekInReview from './WeekInReview';
import QuickSwitcher from './QuickSwitcher';
import { useAuth } from '../../lib/AuthContext';

const ROLE_LABEL = {
  axis_admin:   'AXIS Admin',
  axis_ops:     'AXIS Ops',
  hauler_admin: 'Hauler admin',
  lender:       'Lender',
};

const ROLE_TONE = {
  axis_admin:   { bg: 'rgba(139, 46, 26, 0.08)', color: 'var(--bauxite-rust)',  border: 'rgba(139, 46, 26, 0.3)' },
  axis_ops:     { bg: 'rgba(139, 46, 26, 0.08)', color: 'var(--bauxite-rust)',  border: 'rgba(139, 46, 26, 0.3)' },
  hauler_admin: { bg: 'rgba(217, 158, 55, 0.08)', color: 'var(--signal-amber)', border: 'rgba(217, 158, 55, 0.3)' },
  lender:       { bg: 'rgba(46, 107, 63, 0.08)', color: 'var(--signal-green)',  border: 'rgba(46, 107, 63, 0.3)' },
};

/*
 * Topbar — AXIS Command Center.
 * Wordmark + page title left. Corridor + clock right. No gradient pills, no vendor badges.
 * Register per DESIGN_SYSTEM §2: port authority notice, not dashboard chrome.
 */

const PAGE_TITLES = {
  '/':             'Today',
  '/calendar':     'Calendar',
  '/corridor':     'Corridor',
  '/convoys':      'Convoys',
  '/trips':        'Trips',
  '/drivers':      'Drivers',
  '/coaching':     'Coaching',
  '/compliance':   'Compliance',
  '/inbox':        'Inbox',
  '/my-hauler':    'My hauler',
  '/haulers':      'Haulers',
  '/fleet':        'Fleet',
  '/maintenance':  'Maintenance',
  '/contract':     'GIBDLC contract',
  '/tariff':       'Tariff',
  '/diesel':       'Diesel watch',
  '/tranches':     'Tranches',
  '/financials':   'Financials',
  '/risks':        'Risks',
  '/playbooks':    'Playbooks',
  '/handovers':    'Handovers',
  '/leaderboard':  'Driver Leaderboard',
  '/audit':        'Audit log',
  '/settlements':  'Settlements',
  '/claims':       'Claims',
  '/sensitivity':  'Sensitivity',
  '/alerts':       'Alerts',
  '/reports':      'Reports',
  '/settings':     'Settings',
  '/me/activity':  'My activity',
  '/analytics':    'Performance analytics',
};

function formatClock(d) {
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Accra',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDate(d) {
  // "14 January 2026" — long form per §2 number conventions.
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Accra',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function Topbar() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] || 'Today';

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Phase 76 — global Cmd-K / Ctrl-K listener for QuickSwitcher.
  // Mounted at the Topbar so the shortcut works on every page.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 'var(--sidebar-w)',
        right: 0,
        height: 'var(--topbar-h)',
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--border-hairline)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--content-pad)',
        zIndex: 40,
      }}
    >
      {/* Left — wordmark + page title */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <AxisWordmark size={16} />
        <span
          style={{
            width: 1,
            height: 18,
            background: 'var(--border-soft)',
            alignSelf: 'center',
          }}
          aria-hidden="true"
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text)',
            letterSpacing: '-0.005em',
          }}
        >
          {title}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            letterSpacing: '0.06em',
          }}
        >
          NYINAHIN · TAKORADI · 300 KM
        </span>
      </div>

      {/* Right — date + clock + user */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span
          className="tabular"
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            letterSpacing: '0.01em',
          }}
        >
          {formatDate(now)}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: 'var(--text)',
            letterSpacing: '0.04em',
          }}
        >
          {formatClock(now)} GMT
        </span>
        <span style={{ width: 1, height: 18, background: 'var(--border-soft)' }} aria-hidden="true" />
        <SearchButton onOpen={() => setSearchOpen(true)} />
        <WeekInReviewButton />
        <DayInReviewButton />
        <NotificationBell />
        <MyQueueButton />
        <UserMenu />
      </div>
      <QuickSwitcher open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}

// Phase 76 — Topbar search button. Visible affordance for the
// Cmd-K shortcut. Shows the keyboard hint so first-time users
// learn the keybind.
function SearchButton({ onOpen }) {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Search anything"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px 4px 8px',
        fontSize: 11,
        color: 'var(--text-tertiary)',
        background: 'transparent',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <SearchIcon size={12} strokeWidth={1.6} />
      <span>Search</span>
      <span style={{
        padding: '1px 5px',
        border: '1px solid var(--border-soft)',
        borderRadius: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: 'var(--text-tertiary)',
        background: 'var(--surface)',
        marginLeft: 4,
      }}>
        {isMac ? '⌘K' : '^K'}
      </span>
    </button>
  );
}

// Phase 68 — Topbar trigger for the "Week in review" weekly synthesis
// modal. All roles get this — lender included; the synthesis is
// strategic and read-only.
function WeekInReviewButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Last seven days: tonnage, action item flow, top themes, hauler ranking"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          background: 'transparent',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <CalendarRange size={12} strokeWidth={1.6} />
        Week in review
      </button>
      <WeekInReview open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Phase 51 — Topbar trigger for the "Day in review" close-out modal.
// Hidden for the lender persona (the endpoint also gates them out).
function DayInReviewButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user || user.role === 'lender') return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="End-of-day close-out: queue, what you shipped, forecast delta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-secondary)',
          background: 'transparent',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Sunset size={12} strokeWidth={1.6} />
        Day in review
      </button>
      <DayInReview open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user) return null;
  const tone = ROLE_TONE[user.role] || ROLE_TONE.axis_admin;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px 4px 4px',
          background: 'transparent',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontFamily: 'var(--font-primary)',
        }}
      >
        <span style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          color: tone.color,
          fontSize: 10,
          fontWeight: 'var(--fw-medium)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: 0,
        }}>
          {user.display_name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase()}
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}>
          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 'var(--fw-medium)' }}>{user.display_name}</span>
          <span className="mono" style={{ fontSize: 9, color: tone.color, letterSpacing: '0.08em' }}>
            {ROLE_LABEL[user.role] || user.role}
          </span>
        </span>
        <ChevronDown size={12} strokeWidth={1.6} color="var(--text-tertiary)" />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 240,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
          padding: 'var(--space-2)',
          zIndex: 100,
        }}>
          <div style={{
            padding: '8px 10px',
            borderBottom: '1px solid var(--border-hairline)',
            marginBottom: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 'var(--fw-medium)', color: 'var(--text)' }}>{user.display_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{user.email}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{user.organisation}</div>
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); navigate('/me/activity'); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text)',
              fontFamily: 'var(--font-primary)',
              fontSize: 12,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Activity size={12} strokeWidth={1.8} />
            My activity
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); logout(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--bauxite-rust)',
              fontFamily: 'var(--font-primary)',
              fontSize: 12,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <LogOut size={12} strokeWidth={1.8} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
