import { NavLink } from 'react-router-dom';
import {
  LayoutGrid,
  Route as RouteIcon,
  Truck,
  Users,
  ShieldCheck,
  Building2,
  ClipboardList,
  Wrench,
  FileSignature,
  Percent,
  Layers,
  LineChart,
  ShieldAlert,
  CalendarDays,
  SlidersHorizontal,
  AlertTriangle,
  FileText,
  Home,
  ListChecks,
  GraduationCap,
  Wallet,
  ShieldQuestion,
  Fuel,
  ScrollText,
  Trophy,
  History,
  BarChart2,
  Cpu,
  Settings as SettingsIcon,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';
import AxisMark from '../brand/AxisMark';
import { useAuth } from '../../lib/AuthContext';
import { canAccess, can } from '../../lib/auth';
import { useSidebar, SIDEBAR_COLLAPSED_W, SIDEBAR_EXPANDED_W } from '../../lib/SidebarContext';

/*
 * Sidebar — AXIS Command Center.
 * Collapsible: icons-only (64px) ↔ icons + labels (220px).
 * Toggle button at top. State persisted in localStorage.
 * Sections: Corridor, Operations, Fleet, Contract, Capital, Platform.
 */

const NAV = [
  {
    heading: 'Corridor',
    items: [
      { path: '/',           label: 'Today',       icon: LayoutGrid },
      { path: '/calendar',   label: 'Calendar',    icon: CalendarDays },
      { path: '/corridor',   label: 'Corridor',    icon: RouteIcon },
      { path: '/analytics',  label: 'Analytics',   icon: BarChart2 },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { path: '/convoys',     label: 'Convoys',    icon: Truck },
      { path: '/trips',       label: 'Trips',      icon: RouteIcon },
      { path: '/drivers',     label: 'Drivers',    icon: Users },
      { path: '/coaching',    label: 'Coaching',   icon: GraduationCap },
      { path: '/compliance',  label: 'Compliance', icon: ShieldCheck },
      { path: '/playbooks',   label: 'Playbooks',  icon: ListChecks },
      { path: '/handovers',    label: 'Handovers',  icon: ScrollText },
      { path: '/leaderboard',  label: 'Leaderboard', icon: Trophy },
    ],
  },
  {
    heading: 'Fleet',
    items: [
      { path: '/my-hauler',    label: 'My hauler',   icon: Home },
      { path: '/haulers',      label: 'Haulers',     icon: Building2 },
      { path: '/fleet',        label: 'Fleet',       icon: ClipboardList },
      { path: '/maintenance',  label: 'Maintenance', icon: Wrench },
      { path: '/devices',      label: 'Devices',     icon: Cpu },
    ],
  },
  {
    heading: 'Contract',
    items: [
      { path: '/contract',  label: 'Contract',     icon: FileSignature },
      { path: '/tariff',    label: 'Tariff',       icon: Percent },
      { path: '/diesel',    label: 'Diesel watch', icon: Fuel },
    ],
  },
  {
    heading: 'Capital',
    items: [
      { path: '/tranches',    label: 'Tranches',    icon: Layers },
      { path: '/financials',  label: 'Financials',  icon: LineChart },
      { path: '/risks',       label: 'Risks',       icon: ShieldAlert },
      { path: '/sensitivity', label: 'Sensitivity', icon: SlidersHorizontal },
      { path: '/settlements', label: 'Settlements', icon: Wallet },
      { path: '/claims',      label: 'Claims',      icon: ShieldQuestion },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { path: '/alerts',    label: 'Alerts',    icon: AlertTriangle },
      { path: '/reports',   label: 'Reports',   icon: FileText },
      { path: '/audit',     label: 'Audit log', icon: History },
      { path: '/settings',  label: 'Settings',  icon: SettingsIcon },
    ],
  },
];

export function visibleFor(role) {
  return NAV
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.path === '/settings') return can(role, 'settings');
        if (item.path === '/audit')    return role === 'axis_admin';
        return canAccess(role, item.path);
      }),
    }))
    .filter((section) => section.items.length > 0);
}

export default function Sidebar() {
  const { user } = useAuth();
  const { expanded, toggle } = useSidebar();
  const sections = visibleFor(user?.role || 'axis_admin');
  const w = expanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W;

  return (
    <nav
      aria-label="Primary"
      style={{
        position: 'fixed',
        left: 0, top: 0, bottom: 0,
        width: w,
        background: 'var(--surface-raised)',
        borderRight: '1px solid var(--border-hairline)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        transition: 'width 180ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Mark + toggle */}
      <div
        style={{
          height: 'var(--topbar-h)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: expanded ? 'space-between' : 'center',
          borderBottom: '1px solid var(--border-hairline)',
          flexShrink: 0,
          padding: expanded ? '0 12px 0 16px' : 0,
        }}
      >
        {expanded && (
          <span style={{
            fontFamily: 'var(--font-primary)',
            fontSize: 13,
            fontWeight: 'var(--fw-black)',
            letterSpacing: '0.12em',
            color: 'var(--bauxite-rust)',
            textTransform: 'uppercase',
          }}>
            AXIS
          </span>
        )}
        {!expanded && <AxisMark size={22} />}
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 6,
            cursor: 'pointer',
            color: 'var(--text-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.background = 'var(--accent-tint)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {expanded
            ? <PanelLeftClose size={16} strokeWidth={1.5} />
            : <PanelLeftOpen  size={16} strokeWidth={1.5} />}
        </button>
      </div>

      {/* Sections */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {sections.map((section, idx) => (
          <div
            key={section.heading}
            style={{
              borderBottom: idx < sections.length - 1 ? '1px solid var(--border-hairline)' : 'none',
              paddingBlock: 4,
            }}
          >
            {expanded && (
              <div style={{
                padding: '5px 12px 1px',
                fontSize: 8.5,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-tertiary)',
                fontWeight: 'var(--fw-medium)',
                whiteSpace: 'nowrap',
              }}>
                {section.heading}
              </div>
            )}
            {section.items.map((item) =>
              expanded
                ? <ExpandedLink key={item.path} path={item.path} label={item.label} Icon={item.icon} />
                : <IconLink     key={item.path} path={item.path} label={item.label} Icon={item.icon} />
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}

function IconLink({ path, label, Icon }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      title={label}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 36,
        width: '100%',
        borderLeft: `2px solid ${isActive ? 'var(--bauxite-rust)' : 'transparent'}`,
        background: isActive ? 'var(--accent-tint)' : 'transparent',
        color: isActive ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
        transition: 'background 120ms ease, color 120ms ease',
        textDecoration: 'none',
      })}
    >
      <Icon size={15} strokeWidth={1.5} />
    </NavLink>
  );
}

function ExpandedLink({ path, label, Icon }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        padding: '0 10px 0 12px',
        borderLeft: `2px solid ${isActive ? 'var(--bauxite-rust)' : 'transparent'}`,
        background: isActive ? 'var(--accent-tint)' : 'transparent',
        color: isActive ? 'var(--bauxite-rust)' : 'var(--text-secondary)',
        transition: 'background 120ms ease, color 120ms ease',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      })}
      onMouseEnter={(e) => { if (!e.currentTarget.classList.contains('active')) e.currentTarget.style.background = 'var(--accent-tint)'; }}
      onMouseLeave={(e) => { if (!e.currentTarget.classList.contains('active')) e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={13} strokeWidth={1.5} style={{ flexShrink: 0 }} />
      <span style={{
        fontSize: 12,
        fontWeight: 'var(--fw-regular)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </span>
    </NavLink>
  );
}
