'use strict';

/*
 * GET /api/search?q=… — Phase 76.
 *
 * Global search / quick switcher backend. Pure read-side, role-
 * aware composition over the corridor's primary entity types.
 * Returns flat result list + per-type counts so the client can
 * render either a single keyboard-nav list or grouped sections.
 */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const searchIndex = require('../services/searchIndex');

router.get('/', requireAuth, (req, res) => {
  const q = (req.query.q || '').toString().slice(0, 80);
  res.json(searchIndex.compose({
    q,
    role:      req.user?.role,
    hauler_id: req.user?.hauler_id,
  }));
});

module.exports = router;
