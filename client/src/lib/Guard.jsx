import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { canAccess } from './auth';

export default function Guard({ path, children }) {
  const { user } = useAuth();
  if (!user) return null;
  // hauler_admin lands on /my-hauler instead of / (Today assumes corridor-wide context)
  if (path === '/' && user.role === 'hauler_admin') {
    return <Navigate to="/my-hauler" replace />;
  }
  // Settings and Audit are axis_admin-only — enforced here independent of ROLE_PAGES
  if ((path === '/settings' || path === '/audit') && user.role !== 'axis_admin') {
    return <Navigate to="/" replace />;
  }
  if (!canAccess(user.role, path)) return <Navigate to="/" replace />;
  return children;
}
