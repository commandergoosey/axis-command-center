'use strict';

/*
 * LP-1 — Auth routes.
 *
 * POST /api/auth/login           { email, password }           → { user, token, expires_at }
 * POST /api/auth/logout                                         → { ok: true }
 * GET  /api/auth/me                                             → { user }
 * GET  /api/auth/users                                          → { users: [...] }  (assignee picker)
 * POST /api/auth/change-password { current_password, new_password }  (own account)
 * POST /api/auth/request-reset   { email }    → { ok }         (admin-less reset flow)
 * POST /api/auth/reset-password  { token, new_password }       → { ok }
 *
 * GET  /api/auth/sessions          → list own active sessions
 * DELETE /api/auth/sessions/:prefix → revoke one session
 * GET  /api/auth/demo  — returns quick-login hints for dev/staging only.
 *                         Disabled in NODE_ENV=production.
 */

const express = require('express');
const router  = express.Router();

const users    = require('../state/users');
const sessions = require('../services/sessions');
const mailer   = require('../services/mailer');
const { requireAuth } = require('../middleware/auth');
const { writeAudit }  = require('../db/audit');

const PROD = process.env.NODE_ENV === 'production';

/* ── Login ──────────────────────────────────────────────────────────── */
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = users.findByCredentials(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const meta = {
    ip:         req.ip || req.headers['x-forwarded-for'] || null,
    user_agent: req.headers['user-agent'] || null,
  };

  const { token, expires_at } = sessions.issue(user, meta);

  // writeAudit reads actor from req.user; synthesise it for the login case
  // since requireAuth middleware hasn't run yet.
  writeAudit({
    req: { user: users.publicShape(user) },
    entity_type: 'auth',
    entity_id:   user.id,
    action:      'login',
    summary:     `${user.email} signed in`,
  });

  res.json({ user: users.publicShape(user), token, expires_at });
});

/* ── Logout ─────────────────────────────────────────────────────────── */
router.post('/logout', (req, res) => {
  const h = req.headers.authorization || '';
  const [, token] = h.split(' ');
  sessions.revoke(token);
  res.json({ ok: true });
});

/* ── Current user ───────────────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/* ── Change own password ────────────────────────────────────────────── */
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  // Re-verify current credentials
  const verified = users.findByCredentials(req.user.email, current_password);
  if (!verified) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  users.setPassword(req.user.id, new_password);
  // Revoke all sessions after a password change, then re-issue one for this request.
  sessions.revokeAll(req.user.id);
  const { token, expires_at } = sessions.issue(users.findById(req.user.id));

  writeAudit({
    req,
    entity_type: 'auth',
    entity_id:   req.user.id,
    action:      'change_password',
    summary:     `${req.user.email} changed their password`,
  });

  res.json({ ok: true, token, expires_at });
});

/* ── Request a password reset ───────────────────────────────────────── */
router.post('/request-reset', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Always return 200 to avoid leaking which emails exist.
  const row = users.findByEmail(email);
  const u   = row && row.active ? row : null;

  if (u) {
    const resetToken = users.createResetToken(u.id);
    mailer.sendPasswordReset(u, resetToken).catch((err) => {
      console.error('[auth] Failed to send reset email:', err.message);
    });
    writeAudit({
      req: { user: users.publicShape(u) },
      entity_type: 'auth',
      entity_id:   u.id,
      action:      'request_password_reset',
      summary:     `Password reset requested for ${u.email}`,
    });
  }

  res.json({ ok: true, message: 'If that email exists, a reset link has been issued.' });
});

/* ── Consume a password reset token ─────────────────────────────────── */
router.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) {
    return res.status(400).json({ error: 'token and new_password are required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const userId = users.consumeResetToken(token);
  if (!userId) {
    return res.status(400).json({ error: 'Reset token is invalid or has expired' });
  }

  users.setPassword(userId, new_password);
  sessions.revokeAll(userId); // invalidate all existing sessions

  const u = users.findById(userId);
  writeAudit({
    req: { user: users.publicShape(u) },
    entity_type: 'auth',
    entity_id:   u.id,
    action:      'reset_password',
    summary:     `Password reset completed for ${u.email}`,
  });

  res.json({ ok: true });
});

/* ── User directory (assignee picker) ───────────────────────────────── */
router.get('/users', requireAuth, (_req, res) => {
  res.json({
    users: users.list()
      .filter((u) => u.role !== 'lender' && u.active)
      .map((u) => ({
        id:           u.id,
        display_name: u.display_name,
        role:         u.role,
        hauler_id:    u.hauler_id,
        organisation: u.organisation,
      })),
  });
});

/* ── Demo account list — dev/staging only ───────────────────────────── */
/* ── LP-19: Session management — own account ───────────────────────
 * GET    /api/auth/sessions          → list current user's active sessions
 * DELETE /api/auth/sessions/:prefix  → revoke one session by token prefix
 */

router.get('/sessions', requireAuth, (req, res) => {
  const active = sessions.list(req.user.id);
  res.json({ sessions: active });
});

router.delete('/sessions/:prefix', requireAuth, (req, res) => {
  const prefix = req.params.prefix;
  if (!prefix || prefix.length < 8) return res.status(400).json({ error: 'Invalid token prefix' });

  const { ok, user_id } = sessions.revokeByPrefix(prefix);
  if (!ok) return res.status(404).json({ error: 'Session not found' });
  if (user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });

  res.json({ ok: true });
});

router.get('/demo', (_req, res) => {
  if (PROD) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ accounts: users.DEMO_USERS });
});

module.exports = router;
