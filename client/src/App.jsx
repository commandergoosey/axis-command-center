import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, Component } from 'react';

/* Root error boundary — catches any render crash and shows a readable
   message instead of a blank page. In development React already shows
   the error overlay; this is the production safety net. */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#f5f0eb',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          padding: 32,
          gap: 16,
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', color: '#8b2e1a' }}>AXIS — APPLICATION ERROR</div>
          <pre style={{
            maxWidth: 720,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: '12px 16px',
            fontSize: 12,
            color: '#333',
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.href = '/'; }}
            style={{
              padding: '8px 20px',
              background: '#8b2e1a',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Reload app
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import DemoBanner from './components/layout/DemoBanner';
import { SidebarProvider } from './lib/SidebarContext';
import Today from './pages/Today';
import Corridor from './pages/Corridor';
import Convoys from './pages/Convoys';
import Trips from './pages/Trips';
import Drivers from './pages/Drivers';
import Compliance from './pages/Compliance';
import Haulers from './pages/Haulers';
import Fleet from './pages/Fleet';
import Maintenance from './pages/Maintenance';
import Devices from './pages/Devices';
import Contract from './pages/Contract';
import Tariff from './pages/Tariff';
import Diesel from './pages/Diesel';
import Tranches from './pages/Tranches';
import Financials from './pages/Financials';
import Risks from './pages/Risks';
import Calendar from './pages/Calendar';
import Sensitivity from './pages/Sensitivity';
import MyHauler from './pages/MyHauler';
import Playbooks from './pages/Playbooks';
import Coaching from './pages/Coaching';
import Handovers from './pages/Handovers';
import Leaderboard from './pages/Leaderboard';
import AuditLog from './pages/AuditLog';
import Inbox from './pages/Inbox';
import MyActivity from './pages/MyActivity';
import Settlements from './pages/Settlements';
import Claims from './pages/Claims';
import Alerts from './pages/Alerts';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import TodayDigest from './pages/TodayDigest';
import HaulerScorecard from './pages/HaulerScorecard';
import DriverScorecard from './pages/DriverScorecard';
import LenderPack from './pages/LenderPack';
import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { canAccess } from './lib/auth';

/* Scroll the window to the top on every route change. Without this,
   navigating between pages preserves the previous scroll position. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function Shell() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <ScrollToTop />
      <Sidebar />
      <Topbar />
      <main
        style={{
          marginLeft: 'var(--sidebar-w)',
          marginTop: 'var(--topbar-h)',
          minHeight: 'calc(100vh - var(--topbar-h))',
          transition: 'margin-left 180ms ease',
        }}
      >
        <Routes>
          <Route path="/"              element={<Guard path="/"><Today /></Guard>} />
          <Route path="/corridor"      element={<Guard path="/corridor"><Corridor /></Guard>} />
          <Route path="/convoys"       element={<Guard path="/convoys"><Convoys /></Guard>} />
          <Route path="/trips"         element={<Guard path="/trips"><Trips /></Guard>} />
          <Route path="/drivers"       element={<Guard path="/drivers"><Drivers /></Guard>} />
          <Route path="/compliance"    element={<Guard path="/compliance"><Compliance /></Guard>} />
          <Route path="/haulers"       element={<Guard path="/haulers"><Haulers /></Guard>} />
          <Route path="/fleet"         element={<Guard path="/fleet"><Fleet /></Guard>} />
          <Route path="/maintenance"   element={<Guard path="/maintenance"><Maintenance /></Guard>} />
          <Route path="/devices"       element={<Guard path="/devices"><Devices /></Guard>} />
          <Route path="/contract"      element={<Guard path="/contract"><Contract /></Guard>} />
          <Route path="/tariff"        element={<Guard path="/tariff"><Tariff /></Guard>} />
          <Route path="/diesel"        element={<Guard path="/diesel"><Diesel /></Guard>} />
          <Route path="/tranches"      element={<Guard path="/tranches"><Tranches /></Guard>} />
          <Route path="/financials"    element={<Guard path="/financials"><Financials /></Guard>} />
          <Route path="/risks"         element={<Guard path="/risks"><Risks /></Guard>} />
          <Route path="/calendar"      element={<Guard path="/calendar"><Calendar /></Guard>} />
          <Route path="/sensitivity"   element={<Guard path="/sensitivity"><Sensitivity /></Guard>} />
          <Route path="/my-hauler"     element={<Guard path="/my-hauler"><MyHauler /></Guard>} />
          <Route path="/playbooks"     element={<Guard path="/playbooks"><Playbooks /></Guard>} />
          <Route path="/coaching"      element={<Guard path="/coaching"><Coaching /></Guard>} />
          <Route path="/handovers"     element={<Guard path="/handovers"><Handovers /></Guard>} />
          <Route path="/leaderboard"   element={<Guard path="/leaderboard"><Leaderboard /></Guard>} />
          <Route path="/audit"         element={<Guard path="/audit"><AuditLog /></Guard>} />
          <Route path="/inbox"         element={<Guard path="/inbox"><Inbox /></Guard>} />
          <Route path="/me/activity"   element={<Guard path="/me/activity"><MyActivity /></Guard>} />
          <Route path="/settlements"   element={<Guard path="/settlements"><Settlements /></Guard>} />
          <Route path="/claims"        element={<Guard path="/claims"><Claims /></Guard>} />
          <Route path="/alerts"        element={<Guard path="/alerts"><Alerts /></Guard>} />
          <Route path="/reports"       element={<Guard path="/reports"><Reports /></Guard>} />
          <Route path="/settings"      element={<Guard path="/settings" require="settings"><Settings /></Guard>} />
          <Route path="/analytics"     element={<Guard path="/analytics"><Analytics /></Guard>} />
        </Routes>
      </main>
      <DemoBanner />
    </div>
  );
}

function Guard({ path, children }) {
  const { user } = useAuth();
  if (!user) return null;
  // Phase 79 — hauler_admin lands on /my-hauler instead of /
  // (the operator Today page assumes corridor-wide context).
  if (path === '/' && user.role === 'hauler_admin') {
    return <Navigate to="/my-hauler" replace />;
  }
  // Settings and Audit log are AXIS-admin-only — enforced via capability in lib/auth.
  if ((path === '/settings' || path === '/audit') && user.role !== 'axis_admin') {
    return <Navigate to="/" replace />;
  }
  if (!canAccess(user.role, path)) return <Navigate to="/" replace />;
  return children;
}

function Gate() {
  const { status, user } = useAuth();
  const loc = useLocation();

  if (status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--ts-caption-size)',
        letterSpacing: '0.06em',
      }}>
        <span className="mono">RESOLVING SESSION…</span>
      </div>
    );
  }

  if (!user) {
    // Unauthenticated: allow reset-password flow; everything else → Login.
    return <Routes>
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<Login />} />
    </Routes>;
  }

  // The digest is a chrome-less, print-optimized artifact (Phase 40).
  // It sits OUTSIDE Shell so there's no sidebar/topbar to hide on
  // print and the on-screen view is exactly what gets rasterized.
  // Phase 49 — same pattern for the per-hauler weekly scorecard.
  return (
    <Routes>
      <Route path="/today/digest" element={<TodayDigest />} />
      <Route path="/haulers/:id/scorecard" element={<HaulerScorecard />} />
      <Route path="/drivers/:id/scorecard" element={<DriverScorecard />} />
      <Route path="/lender/pack" element={<LenderPack />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<Shell key={loc.pathname === '/login' ? 'home' : 'shell'} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <SidebarProvider>
            <Gate />
          </SidebarProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
