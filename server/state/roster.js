'use strict';

/*
 * LP-4 — Roster is now a thin adapter over haulerStore (SQLite).
 *
 * All haulers — mock-seeded and UI-onboarded alike — live in the `haulers`
 * table. The three-layer system (mock array + hauler_field_overrides +
 * hauler_records) is superseded.
 *
 * This module preserves the existing roster.list / roster.find / roster.add /
 * roster.update / roster.nextId API so all callers continue to work without
 * modification.
 */

const haulerStore = require('./haulerStore');

module.exports = {
  /** All non-deactivated haulers, sorted by onboarded_date. */
  list:   ()        => haulerStore.list(),

  /** Find a single hauler by id — includes deactivated (for admin/route use). */
  find:   (id)      => haulerStore.findById(id),

  /** Persist a new hauler and return it. */
  add:    (h)       => haulerStore.create(h),

  /**
   * Update mutable fields. Only keys present in `fields` are written.
   * Returns the updated hauler object.
   */
  update: (id, fields) => haulerStore.update(id, fields),

  /** Generate the next sequential haul-NN id. */
  nextId: ()        => haulerStore.nextId(),
};
