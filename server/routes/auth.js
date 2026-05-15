'use strict';

/*
 * POST /api/auth/login  { email, password }   → { user, token, expires_at }
 * POST /api/auth/logout                         → { ok: true }
 * GET  /api/auth/me                             → { user }
 * GET  /api/auth/demo                           → { accounts: [...] }  demo helper
 */

const express = require('express');
const router  = express.Router();

const users    = require('../state/users');
const sessions = require('../services/sessions');
const { requireAuth } = require('../middleware/auth');

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.findByCredentials(email, password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const { token, expires_at } = sessions.issue(user);
  res.json({ user: users.publicShape(user), token, expires_at });
});

router.post('/logout', (req, res) => {
  const h = req.headers.authorization || '';
  const [, token] = h.split(' ');
  sessions.revoke(token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/*
 * User directory — used by the alerts assignee picker. Authenticated only;
 * lenders are filtered out since they can't be assigned (read-only role).
 */
router.get('/users', requireAuth, (_req, res) => {
  res.json({
    users: users.list()
      .filter((u) => u.role !== 'lender')
      .map((u) => ({
        id:           u.id,
        display_name: u.display_name,
        role:         u.role,
        hauler_id:    u.hauler_id,
        organisation: u.organisation,
      })),
  });
});

/* Demo-mode account list — keeps Login.jsx readable. Hidden in prod. */
router.get('/demo', (_req, res) => {
  res.json({
    accounts: users.list().map((u) => ({
      email:        u.email,
      display_name: u.display_name,
      role:         u.role,
      organisation: u.organisation,
      hauler_id:    u.hauler_id,
      password_hint: u.role === 'axis_admin' || u.role === 'axis_ops' ? 'axis'
                   : u.role === 'hauler_admin' ? 'hauler'
                   : 'lender',
    })),
  });
});

module.exports = router;
