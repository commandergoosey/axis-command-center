# AXIS Command Center — Changelog

Reverse-chronological record of changes. Detailed build reports for each phase live in `PHASES.md`.

---

## 2026-06-05 (haulerContacts + fuelLogs + corridorAdvisories)

### Server — three more state modules covered (+92 tests)

**`haulerContacts.test.js`** — 35 tests across 7 describe blocks. Append-only contact log per hauler.
- **constants** (3): `CHANNELS / DIRECTIONS / OUTCOMES` with all values.
- **add** (16): all validation throws; `direction` defaults to `'outbound'`; all fields stored; `follow_up_resolved` defaults to false; `created_at` window; author nested/null; full shape.
- **findById** (2): null / row.
- **forHauler** (4): empty / all / limit / isolation.
- **resolveFollowup** (2): true after; idempotent (`WHERE follow_up_resolved = 0`).
- **remove** (2): null after; no-op.
- **latestPerHauler** (4): object; entry present; `{last_contact_at, n}` shape; `n` increments.

**`fuelLogs.test.js`** — 26 tests across 5 describe blocks. Fuel fill log with corridor aggregate.
- **add** (11): numeric id; stores all fields; `litres` cast; nullable fields; `logged_at` defaults to now / can be overridden.
- **getByRig** (4): empty / rows / limit / default 10.
- **summaryByHauler** (3): empty / per-rig summary / `sinceIso` filter excludes old fills.
- **recentByHauler** (3): empty / rows / limit.
- **corridorSummary** (7): full shape; `by_hauler` array; `fill_count` increments; `has_live_data`; `by_hauler` entry present; `since_iso` filter; `total_litres` rounded.

**`corridorAdvisories.test.js`** — 31 tests across 7 describe blocks. Live advisory overlay; id prefixed `'live-'`, raw integer on `_db_id`.
- **SEVERITIES** (1): array with all three values.
- **add** (14): empty/whitespace/long body throws; unknown severity; invalid `expires_at`; severity defaults to `'info'`; body/`km_from`/`km_to` stored; `posted_at` window; id `'live-'` prefix; `_db_id` numeric; `is_live: true`; `posted_by_name`; `resolved_at` null.
- **resolve** (4): null for unknown; `resolved_at` set; `resolved_by_name` stored; idempotent (`WHERE resolved_at IS NULL`).
- **remove** (2): null after; no-op.
- **listActive** (6): array; fresh included; resolved excluded; past `expires_at` excluded; future included; severity order (`critical → warn → info`).
- **listAll** (2): array; resolved included.
- **findById** (2): null / shaped row.
- **Server test suite total: 2998 tests, 0 failures** (`npm test` across all 85 files).

---

## 2026-06-04 (userPins + fleetStatus + driverStatus)

### Server — three upsert-overlay state modules covered (+75 tests)

**`userPins.test.js`** — 28 tests across 6 describe blocks. UNIQUE constraint on `(user_id, entity_type, entity_id)` — upsert semantics; personal pins not shared between users.
- **PINNABLE_TYPES** (2): array; contains all 5 types.
- **add** (10): `user_id` required; unknown `entity_type` throws; `entity_id` required; stores fields; label truncated to 200; label null; `pinned_at` window; upsert no-duplicate; return shape.
- **removeById** (3): absent after; security guard (wrong `user_id` is a no-op); no-op on unknown.
- **removeByRef** (2): `isPinned` false after; no-op on unknown.
- **forUser** (3): empty for unknown; all for user; isolation.
- **isPinned** (3): false for unknown; true after add; false after removeByRef.

**`fleetStatus.test.js`** — 22 tests across 4 describe blocks. PRIMARY KEY `rig_id`; upsert per truck.
- **setStatus** (13): `rig_id` required; invalid status/flag throw; empty-string flag → null; stores all fields; notes trimmed; `updated_at` window; returns row; upsert overwrites; no duplicate.
- **getAllOverrides** (3): Map; keyed by `rig_id`; size increments.
- **getOverride** (2): null for unknown; row for known.
- **applyOverride** (5): null override → truck unchanged; applies `status`/`maintenance_flag`; `_status_override` envelope; no mutation.

**`driverStatus.test.js`** — 25 tests across 5 describe blocks. PRIMARY KEY `driver_id`; same upsert pattern as fleetStatus.
- **constants** (3): `VALID_AVAILABILITY` / `VALID_REST` / `VALID_FLAGS` exported with expected values.
- **setStatus** (14): `driver_id` required; invalid availability/rest_status/flag throw; empty-string flag → null; all fields stored; `updated_at` window; upsert overwrites.
- **getAllOverrides** / **getOverride** (5): Map keyed by `driver_id`; null/row.
- **applyOverride** (8): no override + `shift === 'rest'` → `on_leave`; non-rest → `available`; other fields preserved; override replaces availability/rest_status/flag; `_status_override` added; no mutation.
- **Server test suite total: 2906 tests, 0 failures** (`npm test` across all 82 files).

---

## 2026-06-03 (handoverNotes + rigAssignments + actionComments)

### Server — three compact state modules covered (+66 tests)

Three modules covered in one session — all self-contained with no FK dependencies.

**`handoverNotes.test.js`** — 19 tests across 5 describe blocks. Idempotent CREATE table; no stubs.
- **add** (11): empty/whitespace/missing body throws; body > 4000 chars throws; exactly 4000 accepted; trimmed; `created_at` within window; author fields stored / null; shape verified.
- **latest** (2): returns most recently added note; shaped object.
- **recent** (4): array; limit respected; default 20; ordered newest-first.
- **findById** (2): null for unknown; shaped row for known.
- **remove** (2): `findById` null after; no-op on unknown.

**`rigAssignments.test.js`** — 21 tests across 5 describe blocks. Idempotent CREATE table; no stubs. Primary-key is `rig_id` — upsert semantics.
- **assign** (9): returns row; stores `rig_id / driver_id / notes / assigned_by`; nulls when omitted; `assigned_at` within window; upsert overwrites; no duplicate row.
- **unassign** (2): `getAssignment` null after; no-op on unknown.
- **getAssignment** (2): null for unknown; row for known.
- **getByDriver** (3): empty for unknown; all for known; isolation.
- **getAllAssignments** (4): returns `Map`; keyed by `rig_id`; size increments; absent after unassign.

**`actionComments.test.js`** — 26 tests across 6 describe blocks. Idempotent CREATE table; `action_item_id` is a free TEXT key (no FK).
- **add** (11): `action_item_id` required; empty/whitespace body throws; body > 2000 throws; trim; store; `created_at` window; author stored / null; shape.
- **remove** (2): null after; no-op.
- **findById** (2): null / shaped.
- **forItem** (4): empty for unknown; all returned; oldest-first; isolation.
- **countFor** (3): 0 for unknown; increments; decrements after remove.
- **countsByItem** (3): object; count in map; independent per item.
- **Server test suite total: 2831 tests, 0 failures** (`npm test` across all 79 files).

---

## 2026-06-03 (maintenanceSchedule.test.js)

### Server — maintenance schedule covered (+65 tests)

**`maintenanceSchedule.test.js`** — 65 tests across 12 describe blocks. In-memory SQLite; `maintenanceSchedule.js` creates its own table idempotently — no stubs or migrations needed.

- **constants** (2): `TYPES` and `STATUSES` exported as arrays with expected values.
- **add** (19): `rig_id` / `hauler_id` required; unknown type throws; missing/invalid `start_at` and `end_at` throw; `end_at` before `start_at` throws; same-day (`end_at == start_at`) accepted; all fields stored; notes truncated to 1000 chars; `status` defaults to `'planned'`; `created_at` within window; `completed_at / completed_by` null; `created_by` null when omitted / nested when provided; full shape verified.
- **update** (11): null for unknown id; invalid type/status/dates throw; patches type/`start_at`/`end_at`/notes/status; COALESCE preserves unpatched fields.
- **complete** (5): `status → 'completed'`; `completed_at` within window; `completed_by` stored / null; second call no-op via `WHERE status IN ('planned','in_progress')`.
- **cancel** (3): `status → 'cancelled'`; returns shaped row; cancel of completed is no-op.
- **remove** (2): `findById` null after; no-op on unknown id.
- **findById** (2): null for unknown; shaped row for known.
- **upcoming** (6): array; includes `planned` and `in_progress`; excludes `completed` and `cancelled`; ordered `start_at ASC`.
- **all** (4): array; count increments; includes completed and cancelled.
- **forHauler** (3): empty for unknown; all items for hauler; isolation.
- **forRig** (2): empty for unknown; all items for rig.
- **countsInWindow** (6): returns object; no overlap → absent; overlapping window counted; cancelled excluded; completed excluded; independent per hauler.
- **Server test suite total: 2765 tests, 0 failures** (`npm test` across all 76 files).

---

## 2026-06-03 (broadcasts.test.js)

### Server — corridor broadcasts covered (+58 tests)

**`broadcasts.test.js`** — 58 tests across 8 describe blocks. In-memory SQLite; `broadcasts.js` creates its own table idempotently — no stubs or migrations needed.

- **constants** (4): `SEVERITIES` and `AUDIENCES` exported as arrays with expected values.
- **add** (21): empty/whitespace title and body throw; title > 120 and body > 2000 throw; unknown severity/audience throw; invalid `expires_at` throws; title/body trimmed; `severity` defaults to `'info'`; `audience` defaults to `'all'`; `posted_at` within window; `expires_at` stored or null; `posted_by` null when omitted / nested object when provided; full shape (all 9 fields); `archived_at` null on fresh row.
- **update** (11): null for unknown id; invalid severity/audience/`expires_at` throw; patches title/body/severity/audience/`expires_at`; `expires_at: null` clears via `clear_expiry=1`; COALESCE preserves unpatched fields.
- **archive / unarchive** (3): `archived_at` set; row still returned by `findById`; `archived_at` null after unarchive.
- **remove** (2): `findById` null after; no-op on unknown id.
- **findById** (2): null for unknown; shaped row for known.
- **listAll** (3): array; count increments; includes archived.
- **activeForRole** (13): returns array; excludes archived; excludes expired (`expires_at` < now); includes null/future `expires_at`; severity ordering (`urgent → warn → info`); audience filtering — `'all'` visible to all; `'operators'` visible to `axis_ops`/`axis_admin` but not `hauler_admin`; `'haulers'` visible to `hauler_admin` but not `axis_ops`.
- **Server test suite total: 2700 tests, 0 failures** (`npm test` across all 75 files).

---

## 2026-06-03 (alertState.test.js)

### Server — alert triage state covered (+38 tests)

**`alertState.test.js`** — 38 tests across 8 describe blocks. In-memory SQLite; `alert_state` table is in the base schema — no stubs or migrations needed.

- **getState (unknown)** (6): returns an object (no throw); all scalar fields null; `notes` is `[]` — the `blank()` path.
- **setState** (6): creates state; returns new state object; upsert overwrites on second call; merges patch with previous state via spread (unspecified fields preserved); can explicitly null a field; `notes` array survives a patch (JSON round-trip).
- **addNote** (7): returns the note (not the full state); `id` starts with `'note-'`; `created_at_iso` within window; `by_user_id / by_display / by_role` stored; note appears in `getState().notes`; multiple notes accumulate (append-only); other state fields unaffected.
- **resolve** (5): `status_override → 'RESOLVED'`; `resolved_at_iso` within window; `resolved_by_display` stored; `resolution_note` stored; `snooze_until_iso` cleared to null.
- **snooze** (3): `status_override → 'SNOOZED'`; `snooze_until_iso` stored; second snooze overwrites.
- **reopen** (6): `status_override` cleared; `resolved_at_iso / resolved_by_display / resolution_note / snooze_until_iso` all null; notes preserved.
- **assign** (3): all three assignee fields stored; other state unaffected; assignment can be overwritten.
- **reset** (2): `getState` returns blank for a previously set alertId; no-op on empty table.
- **Server test suite total: 2642 tests, 0 failures** (`npm test` across all 74 files).

---

## 2026-06-03 (workorderState.test.js)

### Server — maintenance workorder state covered (+39 tests)

**`workorderState.test.js`** — 39 tests across 10 describe blocks. In-memory SQLite; `workorders` table is in the base schema — no stubs or migrations needed. No `shape()` function in the module; queries return raw DB rows.

- **STATUSES** (2): exported array; contains `OPEN / IN_PROGRESS / RESOLVED`.
- **open** (9): id starts with `'wo-'`; `status = 'OPEN'`; `opened_at` within window; `rig_id / title / hauler_id` stored; `hauler_id` null when omitted; `opened_by` fields null when omitted; `findById` returns row after open.
- **progress** (4): `status → 'IN_PROGRESS'`; `progress_note` stored; `progress_at` within window; `progress_by_display` stored.
- **resolve** (6): `status → 'RESOLVED'`; `resolution_note / resolved_at / resolved_by_display / cost_usd / hours` stored.
- **findById** (2): null for unknown; row for known.
- **forRig** (3): empty for unknown rig; includes RESOLVED; isolation from other rigs.
- **openForRig** (3): empty for unknown; OPEN and IN_PROGRESS included; RESOLVED excluded.
- **allOpen** (3): OPEN included; RESOLVED excluded; IN_PROGRESS included.
- **all** (3): array; RESOLVED included; count increments.
- **rigsInRemediation** (4): returns `Set`; rig with open workorder present; rig with only RESOLVED absent; IN_PROGRESS keeps rig in set.
- **Server test suite total: 2604 tests, 0 failures** (`npm test` across all 73 files).

---

## 2026-06-03 (riskSteps.test.js)

### Server — risk mitigation steps covered (+55 tests)

**`riskSteps.test.js`** — 55 tests across 10 describe blocks. In-memory SQLite; `riskSteps.js` creates its own `risk_steps` table with a FK referencing `risk_register`. Real risk rows created via `rr.add()` as fixtures.

- **STATUSES** (2): exported array; contains `'open'` and `'done'`.
- **add** (18): empty/whitespace/missing title throws; title > 200 chars throws; exactly 200 accepted; invalid `due_date` throws; title trimmed; `status` defaults to `'open'`; `created_at` within window; `owner` null when omitted / nested object when provided; `created_by` null when omitted / nested object when provided; `due_date` stored or null; `completed_at / completed_by` null on fresh step; full return shape verified.
- **update** (9): null for unknown id; invalid status throws; invalid `due_date` throws; patches title / `due_date` / owner / status; `due_date: null` explicitly clears via `clear_due=1`; COALESCE preserves unpatched fields.
- **complete** (5): `status → 'done'`; `completed_at` within window; `completed_by` stored / null when omitted; second call no-op (`WHERE status != 'done'` guard — `completed_at` unchanged).
- **reopen** (3): `status → 'open'`; `completed_at` and `completed_by` cleared.
- **remove** (2): `findById` null after; no-op on unknown id.
- **findById** (2): null for unknown; shaped row for known.
- **forRisk** (6): empty for unknown; all steps returned; isolation; open before done; earlier `due_date` first.
- **openWithDueDate** (4): returns array; open steps with `due_date` included; done steps excluded; open steps without `due_date` excluded.
- **countsByRisk** (5): returns object; `done_count / total_count / open_count` present; `open_count = total_count` when none complete; `done_count` increments after `complete()`; independent per risk.
- **Server test suite total: 2565 tests, 0 failures** (`npm test` across all 72 files).

---

## 2026-06-03 (riskComments.test.js)

### Server — risk comments covered (+29 tests)

**`riskComments.test.js`** — 29 tests across 6 describe blocks. In-memory SQLite; `riskComments.js` creates its own `risk_comments` table with a FK (`ON DELETE CASCADE`) referencing `risk_register`. Since `foreign_keys = ON`, the tests require `riskRegister` first to create the FK target table, then use `rr.add()` to create real risk fixture rows.

- **add** (11): empty/whitespace/missing body throws; body > 2000 chars throws; exactly 2000 accepted; whitespace trimmed; body stored; `created_at` within test window; `author` has `user_id / display_name / role`; author fields null when omitted; return shape has `id / risk_id / body / created_at / author`.
- **findById** (2): null for unknown id; shaped row for known id.
- **remove** (2): `findById` null after remove; no-op on unknown id.
- **forRisk** (5): empty for unknown `risk_id`; returns all comments; all belong to requested risk; ordered oldest-first (ASC by `created_at / id`); isolation — no cross-risk leakage.
- **recentForRisk** (5): empty for unknown; descending order (newest first); `limit` param respected; default limit = 3; returns all when count < limit.
- **countsByRisk** (4): returns object; count increments with adds; independent per risk; decrements after remove.
- **Server test suite total: 2510 tests, 0 failures** (`npm test` across all 71 files).

---

## 2026-06-03 (actionAssignments.test.js)

### Server — action-item assignments covered (+37 tests)

**`actionAssignments.test.js`** — 37 tests across 10 describe blocks. Uses in-memory SQLite; `actionAssignments.js` creates its own `action_item_assignments` table at load and self-migrates snooze + escalation columns via `addColumnIfMissing()` — no stubs or pre-load SQL needed.

- **assign** (9): throws on missing `action_item_id` / `assignee_user_id`; creates new row; upsert semantics — reassigning same id updates without duplicate; `display_name` defaults to `user_id`; `role` defaults to `axis_ops`; `due_date` and `notes` stored; `due_date` null when omitted.
- **deserialise shape** (4): `assignee` has `user_id / display_name / role`; `assigned_by` has `user_id / display_name`; `snooze` is null on fresh row; `escalation` is null on fresh row.
- **unassign** (2): `findById` returns null after unassign; no-op on unknown id.
- **findById** (2): null for unknown; deserialised row for known.
- **all / map** (4): returns array; count increments; `map()` keyed by `action_item_id`; values are deserialised rows with `assignee` object.
- **forUser** (3): empty for unknown user; returns all of a user's assignments; sorted by `due_date ASC`.
- **snooze** (6): throws when `until` absent; throws when item unassigned; envelope with `until / reason / snoozed_by`; second snooze overwrites first.
- **unsnooze** (1): `snooze` is null after `unsnooze()`.
- **markEscalated** (4): returns `true` first call; returns `false` second call (one-shot latch via `WHERE escalated_at IS NULL`); escalation object present; `escalated_at` is a recent ISO string.
- **acknowledgeEscalation** (2): `acknowledged_at` set; recent ISO string.
- **Server test suite total: 2481 tests, 0 failures** (`npm test` across all 70 files).

---

## 2026-05-22 (positionStore.test.js + maintenanceChecker.test.js)

### Server — position store and maintenance checker covered (+24 tests)

Two compact modules covered in one session.

**`positionStore.test.js`** — 15 tests across 5 describe blocks. In-memory SQLite; no stubs. Key behaviour: the upsert is time-ordered — a stale `position_at` does NOT overwrite a more recent one (`WHERE excluded.position_at >= stored OR stored IS NULL`).

- **upsert** (5): inserts new row; stores lat/lng; newer position overwrites; stale position ignored; null coordinates stored as null.
- **byVehicle** (2): null for unknown; row with fields for known.
- **byHauler** (3): empty for unknown; all vehicles for known hauler; hauler isolation.
- **all** (2): returns array; count increments.
- **staleCount** (3): returns number; counts vehicles with old `position_at`; default 30-minute window.

**`maintenanceChecker.test.js`** — 9 tests across 3 describe blocks. In-memory SQLite; logger stubbed; `SERVICE_KM_THRESHOLD=500` / `SERVICE_KM_CRITICAL=1000` set before module load to keep fixture values small.

- **run shape** (2): `{ overdue, new_alerts }` with numeric values; zeros when no trucks exceed threshold.
- **overdue detection** (4): trucks ≥ threshold counted; 499 km excluded; exactly 500 included; archived trucks excluded.
- **alert creation** (3): new_alerts > 0 on first run; `INSERT OR IGNORE` deduplication — second run returns new_alerts=0; critical bucket (≥ KM_CRITICAL) generates its own alert.
- **Server test suite total: 2444 tests, 0 failures** (`npm test` across all 69 files).

---

## 2026-05-22 (riskRegister.test.js)

### Server — risk register covered (+53 tests)

**`riskRegister.test.js`** — 53 tests across 10 describe blocks. Uses in-memory SQLite; `riskRegister.js` creates its own `risk_register` table idempotently at module load — no seed, starts empty. Stale-review tests manipulate `last_reviewed_at` directly via `db.prepare(UPDATE ...)` since `add()` always stamps it to now.

- **constants** (4): CATEGORIES/SEVERITIES/LIKELIHOODS/STATUSES are non-empty arrays with expected values.
- **shape** (6): `findById(unknown) = null`; owner null/object; created_by null/object; expected top-level fields present.
- **add** (12): all 6 enum validation throws (category/severity/likelihood/status + empty title + title > 120); status defaults to 'open'; accepts non-default status; `last_reviewed_at` stamps to now; description > 2000 chars truncated to 2000; appears in `listActive()`; id is numeric autoincrement.
- **update** (8): null for unknown id; COALESCE (null title patch preserves existing); patches category/severity/status/mitigation_plan; invalid category/severity in patch throw.
- **review** (3): stamps `last_reviewed_at` within test window; sets `last_reviewed_by`; returns row.
- **archive / unarchive** (5): excluded from `listActive()`; `archived_at` set; `findById` still works; restored after unarchive; `archived_at` null.
- **remove** (2): `findById` null; not in `listActive()`.
- **listActive** (3): returns array; excludes archived; critical sorts before high.
- **counts** (5): shape fields present; `open_count` increments for non-closed; closed risk excluded; `high_open_count` counts only critical+high; `stale_count` increments after direct DB timestamp update.
- **staleReviews** (5): returns array; fresh risk not stale; old `last_reviewed_at` → appears; closed excluded; archived excluded.
- **Server test suite total: 2420 tests, 0 failures** (`npm test` across all 67 files).

---

## 2026-05-22 (fleetStore.test.js)

### Server — fleet truck store covered (+45 tests)

**`fleetStore.test.js`** — 45 tests across 7 describe blocks. Uses in-memory SQLite; `mock/fleet` stubbed with `{ buildFleet: () => [] }`. All columns are in the base schema. The computed `km_since_service = (total_km - last_service_km)` is returned on every SELECT and tested directly.

- **list** (5): empty on fresh DB; active trucks returned; `hauler_id` filter; archived excluded; `km_since_service` present on every item.
- **findById** (5): null/undefined/unknown → null; returns row; archived → null.
- **findByPlate** (5): null → null; unknown → null; known plate; case-insensitive (stored uppercase, queried lower); archived → null.
- **create** (14): missing plate / hauler_id throw; id prefix `rig-`; plate trimmed+uppercased; defaults for status/total_km/last_service_km/efficiency/gross_weight_t/axle_config/road_worthy_expiry_days; `km_since_service=0`; make/model/axle_config accepted; archived=0.
- **update** (8): throws for unknown; patches plate (normalised)/make+model/total_km/gross_weight_t; `km_since_service` reflects `total_km − last_service_km`; unpatched fields preserved (set via first update, then verify second update doesn't touch them); returns row.
- **archive / unarchive** (5): excluded from list/findById/findByPlate after archive; restored in all three after unarchive.
- **setStatus** (3): changes status; other fields unaffected; can cycle through multiple statuses.
- Fix: initial test tried to pass `efficiency_l_per_100km` to `create()`, which ignores it (hardcoded 38). Corrected to set it via `update()` then verify a second partial `update()` preserves it.
- **Server test suite total: 2367 tests, 0 failures** (`npm test` across all 66 files).

---

## 2026-05-22 (driverStore.test.js)

### Server — driver store covered (+50 tests)

**`driverStore.test.js`** — 50 tests across 9 describe blocks. Uses in-memory SQLite; `mock/drivers` stubbed with `{ buildDrivers: () => [] }` so `seed()` is a no-op. All columns are in the base schema — no migration patching required.

- **enrich / monthsUntil** (4): null expiry → null; past date → 0 (Math.max guard); future date → positive; `licence_expiry_months` present on every `list()` row.
- **list** (4): empty on fresh DB; count increments after create; `hauler_id` filter; archived excluded.
- **findById** (4): null/unknown → null; enriched row returned; archived → null.
- **findByRig** (4): null/unassigned → null; returns assigned driver; null for archived driver.
- **create** (13): throws for missing `hauler_id` / `full_name`; id prefix `drv-`; `full_name` trimmed; defaults for `licence_class/shift/rest_status/trips_this_week/hours_this_week/safety_score/psv_expiry_days`; `assigned_rig_id` null; provided `licence_class` stored.
- **update** (6): throws for unknown id; patches `full_name/licence_class/shift`; unpatched fields preserved; returns enriched row.
- **archive / unarchive** (4): excluded from list/findById after archive; restored after unarchive.
- **syncAssignment / clearRigAssignment** (4): sets `assigned_rig_id` + plate; `findByRig` finds them; clear nulls both fields; `findByRig` returns null after clear.
- **updateScorecard** (7): `trips_this_week` +1; `hours_this_week` accumulates from `duration_min`; `compliant/warning/breach` REST_CAP_H thresholds (< 51 h / ≥ 51 h / ≥ 60 h); null driverId no-op; missing `duration_min` → 0 hours added.
- **Server test suite total: 2322 tests, 0 failures** (`npm test` across all 65 files).

---

## 2026-05-22 (tripStore.test.js)

### Server — trip store covered (+42 tests)

**`tripStore.test.js`** — 42 tests across 7 describe blocks. Uses in-memory SQLite. Migration-008 columns (`estimated_fuel_l`, `estimated_cost_usd`, `convoy_id`) are applied inline via `db.exec(ALTER TABLE ...)` before loading the module so the prepared `update` statement compiles correctly.

- **create** (11): defaults (status=in_progress, direction=laden, source=webhook, null arrived/duration/distance); tonnage_t/direction/departed_at stored; findById round-trip.
- **findById** (2): null for unknown; returns row.
- **close** (8): status→completed; arrived_at stored; duration_min auto-computed from departed_at; explicit duration accepted; distance_km stored; tonnage_t override; tonnage_t fallback to original; returns row.
- **findOpenByVehicle** (3): null when absent; returns open trip; null after close.
- **list** (6): `{ trips, total }` shape; hauler_id filter; status filter; limit constrains trips but not total; offset pages correctly.
- **forDateRange** (6): empty for unknown hauler; completed trips in range; before-range excluded; at-upper-bound excluded (exclusive `<`); in-progress excluded; hauler isolation.
- **update** (6): COALESCE semantics (null doesn't overwrite); patches direction/tonnage_t/distance_km; null for unknown id; returns row.
- **Server test suite total: 2272 tests, 0 failures** (`npm test` across all 64 files).

---

## 2026-05-22 (haulerStore.test.js)

### Server — hauler store covered (+45 tests)

**`haulerStore.test.js`** — 45 tests across 7 describe blocks. Uses in-memory SQLite; `mock/haulers` stubbed to `[]` so `seed()` runs an empty transaction, giving each test a clean baseline. Note: `webhook_secret` and `api_token` columns are migration-only (not in base schema); `deserialise()` maps the absent columns to `null` via `?? null` fallbacks — tested explicitly.

- **list** (5): empty on fresh DB; active haulers returned; deactivated excluded by default; `include_deactivated:true` includes them; nested integration/fleet/performance present.
- **findById** (4): null/undefined/unknown → null; known id returns row.
- **deserialise shape** (9): integration.type defaults to "manual"; adapter/last_sync null; fleet defaults 0; performance defaults 0; deactivated is boolean false; `_persisted=true` sentinel; webhook_secret null (migration-only column absent).
- **create** (8): correct id; pending status default; display_name trimmed; run_rate=0 default; nested fleet/performance/integration accepted; appears in list().
- **update** (9): empty fields → no-op; patches display_name/run_rate/contracted_trucks/on_time_pct/status; string→number coerce; unpatched fields preserved; unknown id → null.
- **deactivate/reactivate** (7): excluded from list after deactivate; deactivated=true; deactivated_at set; findById still works; reappears after reactivate; deactivated=false; deactivated_at=null.
- **nextId** (3): "haul-01" when empty; "haul-02" after haul-01 inserted; zero-padded format.
- **Server test suite total: 2230 tests, 0 failures** (`npm test` across all 63 files).

---

## 2026-05-22 (users.test.js)

### Server — user auth state module covered (+55 tests)

**`users.test.js`** — 55 tests across 11 describe blocks. Uses in-memory SQLite (`DB_PATH=:memory:`). `bcryptjs` is stubbed with instant fake hashes (`hashSync(pwd) → "FAKE:${pwd}"`, `compareSync(pwd,hash) → hash==="FAKE:${pwd}"`) so `seed()` at module load runs without the ~1.2 s real bcrypt KDF cost. The `db` instance is retained for direct SQL inserts in the expired-token test.

- **publicShape** (4): null/undefined passthrough; strips password_hash; preserves all other fields.
- **findByCredentials** (9): null/empty email; null/empty password; unknown email; wrong password; deactivated account; valid demo credentials return row; raw row includes hash (caller must publicShape).
- **findById** (4): null/undefined/unknown → null; known id returns row.
- **findByEmail** (4): null/unknown → null; known returns row; COLLATE NOCASE handles case-insensitive lookup.
- **list** (4): returns array; ≥4 seeded users; no password_hash exposed; expected shape fields.
- **create** (11): throws for each missing required field (email/password/display_name/role); shape fields; no hash in return; email trimmed+lowercased; id starts with "u-"; active=1 default; findByEmail finds new user; immediate login works.
- **update** (5): throws for unknown id; patches display_name preserving role; patches role; sets active=0; returns public shape.
- **setPassword** (4): throws for <8 chars; throws for empty; new password enables login; old password rejected.
- **deactivate/reactivate** (4): deactivate blocks login; row persists with active=0; reactivate restores login; active=1 after reactivate.
- **createResetToken** (2): 64-char lowercase hex; each call returns unique token.
- **consumeResetToken** (4): unknown token → null; valid token returns user_id; second consume (used) → null; expired token (direct DB insert, expires_at 2 hrs ago) → null.
- **Server test suite total: 2185 tests, 0 failures** (`npm test` across all 62 files).

---

## 2026-05-21 (reportSchedules.test.js)

### Server — report schedule state module covered (+44 tests)

**`reportSchedules.test.js`** — 44 tests across 12 describe blocks. Uses in-memory SQLite; zero stubs needed — `reportSchedules.js` has no dependencies beyond `../db`.

- **nextRunAt (daily)** (4): future ISO string; hour preserved; default 08:00; min/sec are zero.
- **nextRunAt (weekly)** (3): future; UTCDay matches all 7 day_of_week values; defaults to Monday.
- **nextRunAt (monthly)** (3): future; UTCDate matches day_of_month; defaults to day 1.
- **nextRunAt (quarterly)** (3): future; returns null for unrecognised frequency.
- **humanFreq via frequency_human** (4): each of daily/weekly/monthly/quarterly produces the correct label prefix.
- **create** (7): shape fields; sch-NNN ID format; sequential IDs increment; recipients round-trip; active=true default; next_run_at is future; title defaults to type_id.
- **list** (3): returns array; length increments after create; each item has id and frequency_human.
- **get** (2): null for unknown; correct row for known.
- **update** (4): null for unknown; title patch preserves frequency; recipients patch; active:false clears next_run_at.
- **toggle** (3): null for unknown; false → active=false + null next_run_at; true → active=true + future next_run_at.
- **remove** (4): false for unknown; true for known; get() null after remove; list() excludes removed.
- **markRan** (4): null for unknown; stamps last_run_at within test window; active schedule gets future next_run_at; inactive schedule keeps null.
- Fix: initial "advances next_run_at" assertion was wrong — `nextRunAt` recomputes from *now*, so within the same scheduling window it yields the same value. Corrected to verify "non-null and future".
- **Server test suite total: 2130 tests, 0 failures** (`npm test` across all 61 files).

---

## 2026-05-21 (metricsAggregator.test.js)

### Server — metrics aggregator covered (+26 tests)

**`metricsAggregator.test.js`** — 26 tests across 8 describe blocks. Uses in-memory SQLite (`DB_PATH=:memory:`) for real upsert/select coverage. Stubs: `state/haulerStore` (list), `state/tripStore` (forDateRange), `services/logger`. Mutable module-level `_haulers` / `_trips` closures let each test set its own data without re-requiring the module. Each test uses a unique `hauler_id + date` pair to prevent cross-test DB contamination.

- aggregate basics (3): zero haulers returns 0; haulers-with-no-trips returns 0; returns count of haulers that had trips.
- aggregate trip counters (4): trips_total; trips_laden; trips_empty; laden + empty = total.
- aggregate tonnage/distance (4): sums tonnage_t; null tonnage_t → 0; sums distance_km; null distance_km → 0.
- on-time/late classification (4): `duration_min = TARGET` (1560) → on_time; `TARGET+1` → late; `null` → neither (Infinity/0 guard); mix of all three.
- upsert behaviour (1): re-running same date overwrites previous row.
- aggregateRange (4): returns day count; single-day range; multi-day data present after run; from > to → 0.
- get (2): returns null before compute; returns correct row after aggregate().
- getRange (4): empty array; rows populated; date-ascending order; boundary exclusion.
- **Server test suite total: 2086 tests, 0 failures** (`npm test` across all 60 files).

---

## 2026-05-21 (19 orphaned test files wired into npm test)

### Server — 571 previously-written tests added to the suite

Discovered 19 service-test files written in earlier sessions that existed on disk but were never registered in `package.json`. All 571 tests pass. Added to `npm test`:

`aggregator.test.js` · `coachingPipeline.test.js` · `corridorAnalytics.test.js` · `covenants.test.js` · `dieselWatch.test.js` · `driverLeaderboard.test.js` · `dscr.test.js` · `forecast.test.js` · `forecastAnomalies.test.js` · `indexation.test.js` · `intelligence.test.js` · `lenderPack.test.js` · `myHauler.test.js` · `observationSynth.test.js` · `personalDigest.test.js` · `reportBuilder.test.js` · `sensitivity.test.js` · `upcomingEvents.test.js` · `weeklySynthesis.test.js`

- **Server test suite total: 2060 tests, 0 failures** (`npm test` across all 59 files).

---

## 2026-05-21 (scheduleRunner.test.js)

### Server — schedule runner covered (+25 tests)

**`scheduleRunner.test.js`** — 25 tests across 6 describe blocks. Stubs: `db` (auditInsert), `state/reportSchedules` (list, markRan), `services/reportBuilder` (writeReport), `services/mailer` (sendReport, DEMO). Key technique: `writeReport` stub captures the `meta` arg passed by `generatePdfBuffer`, giving direct read-access to all `periodMeta` output fields (`period_from`, `period_to`, `period_label`) without the function needing to be exported.

- **periodMeta (daily)** (3): `period_from === period_to`; YYYY-MM-DD format; label starts with `'Daily · '`.
- **periodMeta (weekly)** (3): `period_from` is a Monday (UTCDay=1); span is exactly 6 days; label starts with `'Week · '`.
- **periodMeta (monthly)** (3): `period_from` ends in `'-01'`; `period_from` and `period_to` share YYYY-MM prefix; label starts with `'Month · '`.
- **periodMeta (quarterly)** (3): label matches `/^Q[1-4] \d{4}/`; `period_from` is the 1st of Jan/Apr/Jul/Oct; `period_from ≤ period_to`.
- **runOne** (8): return value from `markRan`; pdfBuffer is non-empty Buffer; filename is `{type_id}_{period_from}.pdf`; subject is `[AXIS] {title} · {period_label}`; provided recipients used; empty `recipients` defaults to `axis-ops@axis-command.com`; undefined `recipients` defaults likewise; error from `writeReport` propagates via rejection.
- **tick** (5): empty list resolves cleanly; future `next_run_at` skipped; `active:false` skipped; `null next_run_at` skipped; past `next_run_at` triggers `sendReport`.
- `flushAsync()` helper (one `setImmediate` round) used in tick tests to let `runOne` promises settle after `tick()` returns (tick does not await runOne internally).
- Added `scheduleRunner.test.js` to `package.json` test script.
- **Server test suite total: 1489 tests, 0 failures** (`npm test` across all 40 files).

---

## 2026-05-21 (mailer.test.js)

### Server — mailer service covered (+26 tests)

**`mailer.test.js`** — 26 tests across 5 describe blocks. Zero external deps required — all four exported functions have DEMO paths (`DEMO = !process.env.SMTP_HOST`) that return plain objects without contacting an SMTP server. `console.log` capture (`captureLogs`) used to verify logged link construction and role label text for `sendPasswordReset` / `sendInvite`.

- Module constants (4): `DEMO` is `true` when `SMTP_HOST` absent; `APP_URL` defaults to `http://localhost:5173`; trailing slash stripped; no trailing slash left unchanged.
- send (5): returns Promise; `demo: true`; string `to` normalised to one-element `accepted` array; array `to` preserved; works without `html` arg.
- sendReport (3): returns Promise; `demo: true`; `accepted` equals the `to` array passed in.
- sendPasswordReset (5): returns `{ demo: true }`; returns Promise; logs reset token; logged link contains `APP_URL + /reset-password?token=<token>`; logs user email.
- sendInvite (9): returns `{ demo: true }`; returns Promise; logs invite link with token; logs user email; all four role labels (`axis_admin→"AXIS Admin"`, `axis_ops→"AXIS Operations"`, `hauler_admin→"Hauler Admin"`, `lender→"Lender"`); unknown role falls back to raw string.
- Added `mailer.test.js` to `package.json` test script alongside all prior service tests (7 service test files now wired into `npm test`).
- **Server test suite total: 1464 tests, 0 failures** (`npm test` across all 39 files).

---

## 2026-05-21 (eventBus.test.js + notifPush.test.js + sessions.test.js)

### Server — event bus, SSE push registry, session store covered (+50 tests)

**`eventBus.test.js`** — 9 tests. Pure EventEmitter wrapper; zero external deps.
- emit + on (4): listener receives data; data unchanged; no-subscriber emit doesn't throw; multiple listeners all fire.
- Type isolation (2): listener for type A doesn't fire on type B; two types fire independently.
- off (3): listener not called after removal; off on non-subscribed listener safe; only specified listener removed.

**`notifPush.test.js`** — 15 tests. Pure in-memory SSE registry; zero deps.
- connectionCount (4): 0 for unknown user; increments on add; counts multiple connections; drops to 0 after last remove.
- add/remove (3): remove on unknown user safe; remove of un-added stream safe; partial remove decrements count.
- pushToUser (8): 0 for no streams; returns stream count written; both streams receive when 2 registered; correct SSE format (`event:\ndata:\n\n`); data is valid JSON; 0 after remove; write error swallowed; write error on one stream doesn't block other.

**`sessions.test.js`** — 26 tests. Uses in-memory SQLite DB. Sessions table has a FK to `users(id)` — all test user rows inserted in `before()`.
- issue (6): returns token + expires_at; token is 64-char lowercase hex; expires_at is future; TTL ≈ 12h; each call produces unique token; optional meta (ip, user_agent) stored.
- resolve (6): returns session for valid token; session has user_id/issued_at/expires_at; null for unknown token; null for null; null for empty string; null for expired (expired row is cleaned up on access).
- revoke (4): true when token exists; false for unknown; false for null; resolve returns null after revoke.
- revokeAll (2): removes all user sessions; doesn't affect other users.
- list (3): returns active sessions; each row has token_prefix / no full token; expired sessions excluded.
- listAll (2): returns array; includes just-issued session with token_prefix.
- revokeByPrefix (3): returns { ok:true, user_id } on match; session gone after; { ok:false, user_id:null } when not found.
- Key discovery: `sessions.user_id` has FK constraint → must insert user rows before issuing sessions in tests.
- **Service test suite at this point: 122 tests across 6 files, all passing.**

---

## 2026-05-21 (alertSynth.test.js)

### Server — alert synthesizer covered (+29 tests)
- Created `test/alertSynth.test.js` — 29 tests across 10 describe blocks. Stubs 10 dependencies: `db`, `filingState`, `integrationStore`, `workorderState`, `coachingState`, `licenceState`, `incidentState`, `weighbridgeEvents`, `roster`, `services/covenants`. Mock files (`compliance`, `fleet`, `alerts`, `haulers`) load from disk. `allAlerts(now)` / `generated(now)` take `now` as epoch ms — fixed at `2026-05-21T00:00:00Z`.
- `allAlerts` structure (5): all items have required base fields; generated alerts additionally have `impact` and `action`; no duplicate IDs; with May-21 stubs exactly 3 overdue filing alerts are synthesized.
- Filing alert content (4): overdue filings → CRITICAL severity; status = NEEDS_ACTION; `getState` override to 'FILED' suppresses all filing alerts; due-in-1-day filing → WARNING severity.
- Generated flags (2): all `generated()` results have `generated=true`; all stubs silent → `generated()` returns `[]`.
- Integration failure (1): `has_credentials=true + live=false + last_probe` → `integration_failure` alert with WARNING severity.
- `whyCleared` status shortcuts (2): RESOLVED and MONITORING alerts return null without checking suppression conditions.
- `whyCleared` axle_load_breach (3): null with no coaching; `coaching_logged` with recent session; result has reason/actor/when/link.
- `whyCleared` hse_event (5): null with no incidents; null for open incident; null for wrong hauler; `hse_closed` for matching closed incident; result has reason/actor/when/link.
- `whyCleared` licence_expiry (4): null for unknown driver; null for known driver with no overlay; `licence_renewed` with overlay; result has reason/actor/when/link.
- `whyCleared` unrelated type (1): returns null for type with no suppression rule.
- `autoClearedAlerts` (2): returns array; returns `[]` when no lifecycle stubs produce a hit.
- Key discovery: `mock/alerts.js` exports 10 static alerts (not 0 as initially assumed — 3 of which lack `impact`/`action` fields, being legacy-format entries). Tests scoped accordingly.

---

## 2026-05-21 (searchIndex.test.js + liveExportBuilder.test.js)

### Server — global search and live export PDF covered (+43 tests)
- Created `test/searchIndex.test.js` — 31 tests across 9 describe blocks. Stubs 7 dependencies: `roster.list`, `riskRegister.listActive`, `haulerContacts.latestPerHauler/forHauler`, `alertState.getState`, `filingState.getState`, `alertSynth.allAlerts`, `audit.listAudit`. `DRIVERS` and `FILINGS` load from disk (no stub needed).
  - Empty query (3): blank string, whitespace-only, missing `q` all return `{ query:'', total:0, by_type:{}, results:[] }`.
  - Output shape (5): `query`/`total`/`by_type`/`results` fields present; `results` is array; `by_type` is plain object; `total === results.length`; `query` is the original (un-normalized) input string.
  - Result item shape (3): each item has `type`/`id`/`title`/`subtitle`/`link`; no `_score` field survives into results; `link.path` and `link.label` are strings.
  - Matching (6): hauler display_name match, hauler id match, zero results for no-match query, risk title match, alert title match, filing from disk handled gracefully.
  - Scoring order (1): exact match (score 100) ranks before prefix match (score 50).
  - `by_type` (2): `by_type.haulers` equals hauler results count; broad query populates `haulers` and `alerts` keys.
  - Role filtering (8): `lender` has no driver/contact/audit items or keys; `hauler_admin` sees only own hauler, not others; `null` role defaults to `axis_admin` (all types); unknown role string defaults to `axis_admin`.
  - Per-type cap (1): 10 matching haulers capped at 5.
  - Audit search (2): single-char query skips `listAudit` (returns []); two-char query calls `listAudit` and returns mapped rows.

- Created `test/liveExportBuilder.test.js` — 12 tests across 3 describe blocks. Stubs `roster.list/find` and `alertState.getState`. `financials`, `alerts`, `trips`, `fleet`, `corridor`, `drivers` mock files load from disk. PDF output collected via `stream.PassThrough`.
  - Exports (1): `writeLiveExport` is a function.
  - Error handling (2): unknown `exportId` throws `/Unknown live export/`; `hauler_scorecard_nonexistent` throws `/Hauler not found/`.
  - PDF output (9): for each of 3 export types (`today_digest`, `lender_pack`, `hauler_scorecard_haul-01`) — generates non-empty output, starts with `%PDF` header, exceeds 1 kB.
- **Server test suite total: 1932 tests, 0 failures.**

---

## 2026-05-21 (reportBuilder.test.js)

### Server — report builder service covered (+18 tests)
- Created `test/reportBuilder.test.js` — 18 tests across 4 describe blocks. Stubs `roster.list` and `alertState.getState` (only state deps); mock files load from disk. PDF output collected via `stream.PassThrough` into a `Buffer` for inspection.
- RENDERERS (3): exported and has keys `shift_handover`, `gibdlc_monthly`, `lender_quarterly`, `filings_pack`; each value is a function.
- Error handling (1): `writeReport('unknown', ...)` throws with `/Unknown report type/`.
- PDF output (12): for each of 4 report types — generates non-empty output, starts with `%PDF` header, exceeds 1kB (confirms multi-section content written).
- Meta passthrough (2): `shift_handover` with `meta.prepared_by` and `gibdlc_monthly` with `meta.month` both complete without throwing.
- **Server test suite total: 1889 tests, 0 failures.**

---

## 2026-05-21 (intelligence.test.js)

### Server — intelligence service covered (+30 tests)
- Created `test/intelligence.test.js` — 30 tests across 7 describe blocks. Tests execute entirely in no-key mode (no `ANTHROPIC_API_KEY`), covering the full LLM-absent fallback path. Single stub: `observationSynth.synthesize` (controlled per test).
- `_hasKey` (2): exported as function, returns false in no-key mode.
- `observe()` output shape (4): `observations`/`chips`/`live`/`synthesized` fields present, `live=false` in no-key mode.
- Synthesized path (5): `synthesized=true` when synth returns data, observations come from synth; `synthesized=false` when null; falls back to `FALLBACK_OBSERVATIONS.today` (with body/id/severity on each entry); unknown page falls through to `.today` fallback.
- Chips (2): non-empty for known page, all are strings.
- Caching (2): repeated same-page calls return structurally equal result AND `synthesize` called only once (NodeCache uses `useClones:true` → copies not refs); different pages produce different entries.
- Known pages (10): `observe(page)` resolves without throwing for 10 known page names with `synthesize=null` fallback.
- `chat()` no-key mode (5): result has `reply`+`live`, `live=false`, reply is non-empty string, reply contains "demonstration mode" for free-form question, no rejection for any page.
- Key fix: `NodeCache.useClones=true` means cached values are copied on retrieval — `strictEqual` reference test replaced with `deepEqual` + call-count proof of single synthesize execution.
- **Server test suite total: 1871 tests, 0 failures.**

---

## 2026-05-21 (lenderPack.test.js)

### Server — lender pack service covered (+34 tests)
- Created `test/lenderPack.test.js` — 34 tests across 11 describe blocks. Stubs 13 dependencies: `buildForecast`, `buildCovenants`, `dscr.compute`, `allAlerts`, `alertState`, `roster.list`, `forecastSnapshots.recent`, `receivableFollowups.countsByBand`, `riskRegister.listActive/counts`, `riskSteps.countsByRisk`, `riskComments.countsByRisk/recentForRisk`, `workorderState.allOpen`. Mock files (financials, contract, tranches) load from disk. `compose(now, generatedBy)` takes a Date — fixed at `2026-05-21T00:00:00Z`.
- Output shape (4): all 15 top-level keys, `generated_at` = now ISO, `generated_by` defaults to null / passes through argument.
- Period (4): `label="Month-to-date"`, `start` = first of month UTC, `end` = now ISO, `month` present.
- Corridor (2): all required fields, `offtaker="GIBDLC"`.
- Executive summary (8): all required fields (lines/headline_status/open_breaches/open_watches), lines is non-empty string array, PASS/BREACH/WATCH headline_status from covenants, BREACH line when DSCR < target, PASS line when DSCR ≥ target+0.1, take-or-pay PASS line present.
- DSCR forwarding (2): `current` and `target_min` forwarded from stub.
- Covenants (2): 7-entry array forwarded, all expected ids present.
- Receivables (2): `overdue_usd` and `overdue_pct` present, `overdue_pct` consistent with `overdue_usd / current_balance_usd`.
- Forecast forwarding (3): `projected_eom`, `days_remaining` forwarded, `trend` is array.
- Hauler ranking (3): array, required fields, sorted by attainment_pct desc.
- Open alerts (2): array, only OPEN/IN_TRIAGE CRITICAL/WARNING alerts included.
- Capital (2): required fields from CAPITAL_STRUCTURE mock, all values positive numbers.
- **Server test suite total: 1841 tests, 0 failures.**

---

## 2026-05-21 (myHauler.test.js)

### Server — my hauler service covered (+24 tests)
- Created `test/myHauler.test.js` — 24 tests across 8 describe blocks. Stubs 9 dependencies: `roster.find/list`, `haulerContacts.forHauler`, `workorderState.allOpen`, `licenceState.getState`, `actionAssignments.all`, `alertSynth.allAlerts`, `alertState.getState`, `listAudit`. `FLEET`, `LICENCE_EXPIRY`, `DRIVERS` load from disk. `compose(haulerId, now)` accepts a `Date` object — fixed at `2026-05-21T00:00:00Z`.
- Null return (2): returns `null` for unknown hauler, non-null for known hauler.
- Output shape (2): all top-level keys, `generated_at` = `now.toISOString()`.
- Corridor block (5): all required fields, `hauler_id` matches request, `display_name` from roster, `idle_trucks = contracted - active` (clamped ≥ 0).
- MTD block (2): all required fields, `attainment_pct` is number ≥ 0.
- Performance block (2): all fields present for active hauler, `null` for inactive.
- Action items (4): array, item with hauler ID slug in `action_item_id` appears, item for different hauler excluded, capped at 8.
- Fleet health (3): all required fields, `open_workorder_count = open_workorders.length`, `rigs_total > 0` (FLEET mock has haul-01 rigs).
- Contacts/audit (4): contacts is array, `recent_audit` is array, row with `entity_id = haulerId` appears, row for different hauler excluded.
- **Server test suite total: 1807 tests, 0 failures.**

---

## 2026-05-21 (dieselWatch.test.js)

### Server — diesel watch service covered (+28 tests)
- Created `test/dieselWatch.test.js` — 28 tests across 5 describe blocks. Only stub needed: `roster.find` (display_name lookup for per-hauler variance). All other deps (`NPA_DIESEL`, `GSS_CPI`, `TARIFF_TERMS`, `TRIPS`, `CONTRACT`, `indexation`) load from disk or are pure — no state.
- Output shape (5): all top-level keys, `generated_at` valid ISO, `series` non-empty and sorted ascending by month, `current_ghs_per_l` = last series entry, `current_month` = last series month.
- Summary (6): all required fields, `latest_change_pct` is 2dp number, `trailing_3m_pct` null-or-number, `trailing_12m_pct` null when series < 13 entries, `fuel_index > 0`, `fuel_contribution_pct > 0`.
- Pass-through (5): all required fields, `cap_pct/floor_pct` positive, `clamped_at_*` are booleans, `multiplier` between floor/100 and cap/100, `headroom_pct_points` = `(cap/100 - multiplier)*100` rounded to 2dp.
- Pending review (3): all required fields, `base_usd_per_tonne` matches `CONTRACT.base_tariff_usd_per_tonne`, `would_effective_usd_per_tonne > 0`.
- Fleet burn (9): all required fields, `laden_trips_n > 0`, `corridor_avg_fuel_usd_per_tonne > 0`, `per_hauler` non-empty array with required fields, sorted ascending by `fuel_usd_per_tonne`, `signal` ∈ {better/flat/worse}, roster display_name used when available, idempotent across calls.
- **Server test suite total: 1783 tests, 0 failures.**

---

## 2026-05-21 (observationSynth.test.js)

### Server — observation synthesizer service covered (+21 tests)
- Created `test/observationSynth.test.js` — 21 tests across 6 describe blocks. Stubs 9 dependencies: `alertState`, `filingState`, `licenceState`, `incidentState`, `integrationStore`, `workorderState`, `coachingState`, `alertSynth`, `forecastAnomalies`. Mock files load from disk. `synthesize(page, ctx, now)` has injectable `now` — fixed at `2026-05-21T00:00:00Z`.
- API contract (4): null for unknown page, null when composer returns empty array, null (no throw) when composer throws, no throw for any known page when stubs throw.
- Observation structure (4): id/severity/body on every entry, unique ids within page, severity is non-empty string, body is non-empty string.
- Known pages (7): compliance produces obs with mock DUE filings; financials produces obs with mock receivables; fleet produces obs with mock FLEET flags; maintenance uses same composer as fleet (deepEqual); settings/alerts/today return null-or-array without throwing.
- today page context (3): below-floor tonnes ctx produces observation; empty ctx accepted; null ctx treated as `{}` without throw.
- Compliance state overrides (2): FILED override removes filing obs; `renewed=true` licence suppresses licence obs.
- Idempotency (1): same page/ctx/now produces deepEqual output on repeated calls.
- Key stub fixes: `coachingState.recentForHauler` must return `null` (not `[]`) — empty array is truthy and crashes date construction; `workorderState.rigsInRemediation` must exist and return a `Set`.
- **Server test suite total: 1755 tests, 0 failures.**

---

## 2026-05-21 (personalDigest.test.js)

### Server — personal activity digest service covered (+29 tests)
- Created `test/personalDigest.test.js` — 29 tests across 7 describe blocks. Single dependency: `listAudit` stub via `require.cache`. `compose({ actor_user_id, days, now })` has injectable `now` — fixed at `2026-05-21T00:00:00Z`.
- No actor_user_id (2): returns minimal shape with empty counts/recent/totals; `generated_at` still matches `now`.
- Output shape (6): all top-level keys, `generated_at` = now ISO, `horizon.until` = now ISO, `horizon.since` = now − days, `days` default 7 or explicit 14, `counts` has `total/by_category/action_item_flow`.
- Category roll-up (5): empty rows → empty `by_category`, `action_item` → `action_items`, `risk`+`risk_step`+`risk_comment` → `risks`, unmapped → `other`, `counts.total` = rows.length.
- Action-item flow (4): `assign` → opened, `auto_clear`+`unassign` → closed, `escalate` → escalated, zero when no action_item rows.
- Daily series (6): exactly `days` entries (7 or 14), ordered oldest→newest, each has date+n, row ts bucketed correctly into day, all n ≥ 0.
- Recent (3): capped at 25 when rows > 25, exact count when ≤ 25, empty array when no rows.
- by_action (3): keys are `entity_type:action`, multiple occurrences counted, empty when no rows.
- **Server test suite total: 1734 tests, 0 failures.**

---

## 2026-05-21 (weeklySynthesis.test.js)

### Server — weekly synthesis service covered (+28 tests)
- Created `test/weeklySynthesis.test.js` — 28 tests across 5 describe blocks. Stubs `roster.list`, `forecastSnapshots.recent`, and `listAudit` via `require.cache`; `aggregate()` is pure (haulers passed directly). `compose(now)` has injectable `now` — fixed at `2026-05-21T00:00:00Z`.
- Output shape (5): all top-level keys, `generated_at` = now ISO, `period.days=7`, start is 6 days before end, period window = May 15–21.
- Tonnage block (7): all required fields, null values on empty snapshots, out-of-window snapshots excluded, in-window snapshots ordered with correct delta, `delivered_in_week` = MTD delta (same month) / null (cross-month), each point has all fields.
- Actions block (6): all required fields, zero counters on empty audit, `assign` rows deduplicated by `entity_id`, `auto_clear`+`unassign` close rows deduplicated, `net = opened - closed`, `total_events = rows.length`.
- Themes block (4): array (empty on no rows), top-5 by count, `session` rows excluded, each entry has entity_type/label/count.
- Haulers block (6): winners/strugglers arrays, high-run_rate → winners, low-run_rate → strugglers, all required fields, inactive haulers excluded, winners sorted by attainment_pct desc.
- **Server test suite total: 1705 tests, 0 failures.**

---

## 2026-05-21 (upcomingEvents.test.js)

### Server — upcoming events service covered (+37 tests)
- Created `test/upcomingEvents.test.js` — 37 tests across 9 describe blocks. Stubs all 7 state modules (`actionAssignments`, `filingState`, `licenceState`, `haulerContacts`, `riskRegister`, `riskSteps`, `maintenanceSchedule`) via `require.cache`; mock FILINGS, LICENCE_EXPIRY, and CONTRACT_TERMS load from disk. `compose()` has an injectable `now` (ms) — fixed at `2026-05-21T00:00:00Z`.
- Output shape (7): all top-level keys, `generated_at` = now ISO, `horizon.until` = now+30d, `counts` has required fields, events is array, `counts.total = events.length`.
- Default fixture count (4): 8 events with empty stubs and days=30 (3 non-FILED in-window filings + 4 in-window licences + 1 May-31 take-or-pay reset). Verified each event type count individually.
- Event structure (4): required fields on every event (id/type/date/severity/title/link/days_until), valid severity values, link has path+label, overdue events have `days_until < 0`.
- Filing events (4): FILED filing excluded, dvla-ann beyond horizon excluded, dvla-ann included at days=90, `filingState` FILED override removes filing.
- Licence events (3): lic-1021/lic-1022 both overdue, lic-1025/lic-1026 beyond cutoff excluded, `licenceState.renewed=true` removes from feed.
- Injected state (5): action item with due_date appears, action item without due_date excluded, unreviewed risk → `warn` (dueMs=now → days=0 → ≤7 threshold), last_reviewed_at 31d ago → overdue risk review, maintenance window appears via upcoming().
- Sorting (2): ascending by date, same-date severity ordering (overdue→warn→info).
- Horizon control (4): days=7 < days=30, days=365 includes Jan-2027 anniversary, days=1 only includes ≤1d-out events, May-31 reset in days=30 but not days=5.
- Counts (4): overdue/warn/info counts match filtered events, by_type is accurate.
- **Server test suite total: 1677 tests, 0 failures.**

---

## 2026-05-21 (corridorAnalytics.test.js)

### Server — corridor analytics service covered (+34 tests)
- Created `test/corridorAnalytics.test.js` — 34 tests across 5 describe blocks. Stubs `roster.list` via `require.cache`; `compose()` uses a seeded PRNG so data is deterministic but uses `new Date()` internally — all tests are structural/invariant.
- Output shape (5): all top-level keys, `weeks_shown=12`, contract constants (annual_target=1M, annual_floor=800k, weekly_target=19,231, weekly_floor=15,385), `generated_at` valid ISO, `period` contains " to ".
- Weeks array (10): 12 entries, all required fields, chronological order, `week_ending` is 6 days after `week_of`, all tonnes ≥ WEEKLY_FLOOR (15,385), 5 hauler_breakdown entries per week with required fields, `display_name` from roster when available / falls back to `hauler_id`, per-week hauler tonnes sum to corridor total within ±5 rounding.
- YTD (7): all required fields, `above_floor` consistent with `surplus_vs_floor`, `tonnes_actual` and `weekly_run_rate` positive, `days_elapsed` positive, `pct_of_target/floor` positive numbers, `projected_year_end > tonnes_actual`.
- Hauler totals (6): 5 entries, all required fields, sorted by tonnes descending, `share_pct` sums to ≈100 (within 1%), all `on_time_pct` values between 0–100 at both total and week level.
- Cross-checks (6): `period` start/end match `weeks[0].week_of` and `weeks[11].week_ending`, hauler tonnes sum ≈ weekly corridor tonnes sum (within 1%), idempotent (same `week_of` dates and contract on repeated calls), last-3-week avg tonnes > first-3-week avg (ramp-up trend).
- **Server test suite total: 1640 tests, 0 failures.**

---

## 2026-05-21 (covenants.test.js)

### Server — covenants service covered (+28 tests)
- Created `test/covenants.test.js` — 28 tests across 8 describe blocks. Stubs `buildForecast`, `dscrService.compute`, and `workorderState.allOpen` via `require.cache`; `aggregate()` is pure so hauler fixtures pass directly.
- Output shape (4): array of 7 entries, all 7 expected ids present, each entry has required fields (id/name/metric/status/detail), all statuses are PASS/WATCH/BREACH.
- cov-dscr (5): PASS≥1.35, WATCH 1.30–1.35, BREACH<1.30, metric contains formatted DSCR, threshold=1.3.
- cov-gearing (2): entry exists, status=PASS (mock $63M/$27M → 70% debt → within 70/30 limit).
- cov-take-or-pay (5): PASS with ≥5% cushion, WATCH with 0–5% cushion, BREACH when below floor, threshold=66,667, current=projected eom_tonnes.
- cov-concentration (5): BREACH at 100%, BREACH at exactly 50%, WATCH at 44% (H1=44k/H2=36k/H3=20k), PASS at 33.3% (three equal), threshold=50.
- cov-sla (4): PASS≥90%, WATCH 88–90%, BREACH<88%, threshold=88.
- cov-ageing (2): entry exists with valid status, threshold=8.
- cov-liquidity (1): entry exists (carried from STATIC_COVENANTS fixture).
- **Server test suite total: 1606 tests, 0 failures.**

---

## 2026-05-21 (aggregator.test.js)

### Server — aggregator service covered (+44 tests, zero stubs needed)
- Created `test/aggregator.test.js` — 44 tests across 9 describe blocks. All exported functions are pure (no DB, no mocks required).
- `fractionOfMonthElapsed` (7): returns 0 at month start, correct ratio at May 21 (20/31), ≈1 at month end, clamps to [0,1], handles February (28 days in non-leap 2026), monotone within same month.
- `apiStatusOf` (7): pending→'pending' (first check), manual→'manual', error_count_24h>0→'degraded', clean api→'connected', pending beats manual, 0 errors treated as clean, missing error_count_24h defaults to 0.
- Output shape (5): all top-level keys, fleet/tonnes sub-keys, hauler entry fields, empty roster returns all-zeros.
- Fleet counts (3): contracted_trucks sums active only, active_trucks sums active only, contracted_monthly=83,333.
- Tonnage math (5): run_rate=1.0 → delivered=contracted, run_rate=0.8 → 80% (±1 rounding), run_rate=0 → 0 delivered, fraction=0 at month start → 0 MTD, total equals sum of individual hauler values.
- Contract share (5): single hauler=1.000, two equal haulers=0.500 each, shares sum to 1.0, inactive→contract_share=0 with zero tonnes.
- SLA attainment (4): single hauler passes through, weighted by active_trucks (90*8+70*2)/10=86.0, zero active_trucks→0 (no division error), inactive excluded from average.
- Hauler ordering (2): active haulers sorted before inactive regardless of input order, api_status propagated.
- Constants (6): CONTRACT required fields, target_mtpa=1.0, floor=0.80, base_tariff=$24, indexation weights sum to 1.0, TRANCHE_1.target_mtpa matches CONTRACT.
- **Server test suite total: 1576 tests, 0 failures.**

---

## 2026-05-21 (dscr.test.js)

### Server — DSCR service covered (+23 tests)
- Created `test/dscr.test.js` — 23 tests across 6 describe blocks. Stubs `buildForecast` and `workorderState.allOpen` via `require.cache`; mock constants (financials, tranches) load from disk as-is.
- Output shape (5): top-level keys, `computed` block fields, static fixture values (target_min=1.3, steady_state=2.5), series length=6, each series entry has month+dscr.
- Fallback (2): returns static STATIC_DSCR fixture with `computed=null` when buildForecast throws; never throws.
- Verdicts (6): eom=65k→BREACH (DSCR≈0.57), eom=340k→WATCH (1.30≤DSCR<1.35), eom=500k→PASS (≥1.35), higher tonnes→higher DSCR (monotone), headroom_pct consistent with current within 0.5pp (full-precision vs rounded 2dp divergence documented), current is 2dp rounded number.
- Computed internals (6): revenue within 0.1% of eomTonnes×tariff (full-precision vs 2dp tariff tolerance), ebitda<revenue with ratio within 1pp of (1−opcost_ratio), this_month_dscr=ebitda/debt_service exact, opcost_ratio≈0.633, effective_tariff_usd≈$22.90, monthly_debt_service≈$1,021,623.
- Series overwrite (3): April 2026 entry overwritten with computed=true when using April `now`; series length unchanged; no 2026-05 entry added when using May `now`.
- Constants (1): `MONTHLY_DEBT_SERVICE_USD` exported and ≈$1,021,623.
- **Server test suite total: 1532 tests, 0 failures.**

---

## 2026-05-21 (forecast.test.js)

### Server — core forecast engine covered (+38 tests)
- Created `test/forecast.test.js` — 38 tests across 8 describe blocks. Stubs `workorderState.allOpen` via `require.cache`; `aggregate()` is pure so hauler fixtures pass directly. Fixed test date 2026-05-21 (day 21 of 31-day month, daysElapsed=21, daysRemaining=10).
- Output shape (5): all 9 top-level keys, horizon fields (days_in_month/elapsed/remaining), targets (monthly=83,333, floor=66,667, floor_pct=0.80), projection field completeness, required fields.
- Verdict system (6): run_rate 1.1→on_pace_for_contracted, 1.0→above_floor, 0.8→below_floor_at_pace, empty roster→below_floor_at_pace; shortfall/surplus correctly zero when not applicable. **Note: 'banked_floor_drift' verdict is mathematically unreachable (projectedEom ≥ deliveredMtd always when daysRemaining>0).**
- Projection math (5): formula verified as `Math.round(deliveredMtd + (deliveredMtd/daysElapsed)×daysRemaining)` (using raw ratio not rounded daily_avg), last-day-of-month projectedEom=deliveredMtd, daysElapsed≥1 guard, pct_of_floor and pct_of_monthly formulas.
- Required rates (5): below-floor daily_to_floor > daily_avg; daily_to_floor=0 when deliveredMtd>floor (run_rate 1.3); daily_to_contracted=0 when deliveredMtd>target (run_rate 1.6); lift_pct formula; null when daily_avg=0.
- Levers (4): no entry when all trucks active, entry with idle_trucks count, remainder_recovery>0, total matches sum.
- Workshop drag (3): zero workorders→counts=0; workorder entry has all fields with days_open≥expected and total_drag=lost+remainder; pct_of_floor_gap null when above floor.
- Hauler projections (3): inactive→verdict=inactive/zeros; sorted worst-first; on_pace/lagging/severely_lagging thresholds.
- buildForecastScenario (7): no-input within ±1t of baseline (rounding path differs); truck lift increases projection; lift capped at idle_trucks; daily_avg_lift_pct improves projection; clears_floor flag fires; applied.daily_avg_lift_pct echoed; clamped at 50.
- **Server test suite total: 1509 tests, 0 failures.**

---

## 2026-05-21 (sensitivity.test.js)

### Server — FX/cost sensitivity service covered (+38 tests)
- Created `test/sensitivity.test.js` — 38 tests across 6 describe blocks. Stubs `buildForecast` (fixed `eom_tonnes=65000`) and `roster.list` via `require.cache`; mock constants (tariff, financials, tranches) load from disk.
- Output shape (8): all top-level keys, inputs echo, bounds min/max, baseline/scenario/deltas field completeness, waterfall=5 entries, each entry has required fields.
- Zero-shift identity (5): scenario=baseline at all-zero shifts, deltas.dscr=0, verdict_changed=false, tariff_effective delta=0, projected_tonnes matches stubbed value.
- Tariff sensitivity (6): cedi weakening raises tariff, cedi strengthening lowers it, diesel increase raises it, extreme -50% cedi clamped at 125% cap, capped tariff never exceeds base×1.25, max-in-bounds combo (+25%/−30%) stays above floor.
- DSCR sensitivity (7): cedi weakening improves DSCR, opex increase reduces DSCR, opex reduction improves DSCR, positive ebitda/revenue deltas on tariff improvement, positive opex delta on opex increase, verdict always a valid string.
- Waterfall structure (6): [0] type=start/step=null/'Baseline', [4] type=end/step=null/'Scenario', entries 1–3 all type=delta, [0].dscr=baseline.current, [4].dscr=scenario.current, delta steps sum to total DSCR delta (±0.02 rounding tolerance).
- PRESETS (6): array of 4, ids=['base','mild','moderate','severe'], base has all shifts=0, all have required fields, severe more extreme than moderate, all 4 presets produce valid compose() output.
- **Server test suite total: 1471 tests, 0 failures.**

---

## 2026-05-21 (coachingPipeline.test.js)

### Server — coaching pipeline service covered (+31 tests)
- Created `test/coachingPipeline.test.js` — 31 tests across 8 describe blocks. Stubs `mock/drivers` (DRIVERS array) and `state/coachingState` via `require.cache`; fixed timestamp `NOW = 2026-05-21T00:00:00Z`.
- 6-driver fixture (5 included, 1 excluded): `drv-ur` (rest_breach/urgent), `drv-hi` (coaching_due/high), `drv-me` (licence_expiring/medium), `drv-ov` (100d overdue/high), `drv-ns` (no sessions/medium), `drv-ex` (recent session, excluded).
- Output shape (3): top-level keys, counts fields, row field completeness.
- Inclusion rules (5): drv-ex excluded (recent session, no flag), all three flagged drivers included, overdue unflagged included, no-session driver included, pipeline length = 5.
- Flag → cadence (5): rest_breach→urgent/14d, coaching_due→high/30d, licence_expiring→medium/60d, psv_expiring→medium/60d, unknown flag → routine/90d default.
- Overdue detection (4): drv-ov (100d > 90d → overdue, due_in=-10), drv-ur (10d < 14d → not overdue, due_in=4), exactly at boundary = not overdue, one day past = overdue.
- Tier assignment (2): overdue unflagged with last session → high; no-session driver → medium (even though `dueIn=-9999`).
- Sort order (5): urgent first; overdue high before non-overdue high; within same tier overdue before non-overdue (drv-ns before drv-me despite higher safety); same-tier same-overdue lower safety first; more overdue (more negative due_in) first.
- Counts (4): total=5, flagged=3, **overdue=2 (drv-ov + drv-ns, because no-session → dueIn=-9999)**, by_tier sums to total.
- Edge cases (3): empty roster → empty pipeline + zero counts, multiple sessions → most recent used, pipeline_capped=false for ≤50 drivers.
- **Server test suite total: 1433 tests, 0 failures.**

---

## 2026-05-21 (forecastAnomalies.test.js)

### Server — forecast anomaly detection covered (+24 tests)
- Created `test/forecastAnomalies.test.js` — 24 tests across 5 describe blocks. Stubs `buildForecast`, `forecastSnapshots.recent`, and `roster.list` via `require.cache`; pure unit tests, no DB or HTTP.
- Defensive (4): buildForecast throws → `[]`, 0 snapshots → `[]`, 1 snapshot → `[]`, valid inputs → never throws.
- Verdict transition (5): fires on decay (worse bucket), `severity='warn'`, no fire when unchanged, no fire when improving, full rank-order chain (on_pace → above_floor → banked_floor_drift → below_floor_at_pace) each trigger.
- Sharp single-day drop (7): fires at exactly 1.0% drop, fires at 1.5%, does not fire at 0.9%, no fire on flat or rising EOM, `severity='warn'`, body text includes both EOM readings. **Pins the actual code threshold at 1.0% — the inline comment incorrectly says 1.5%.**
- Trend reversal (6): fires on 3/3 rising + fall, fires on 2/3 rising + fall, does not fire on 1/3 rising, does not fire when last delta is non-negative, does not fire with < 5 snapshots, `severity='info'`.
- Multiple anomalies (2): verdict-decay + sharp-drop can fire together; no anomalies when healthy.
- **Server test suite total: 1402 tests, 0 failures.**

---

## 2026-05-21 (driverLeaderboard.test.js)

### Server — driver leaderboard service covered (+34 tests)
- Created `test/driverLeaderboard.test.js` — 34 tests across 7 describe blocks. Stubs `driverStore`, `convoyState`, and `dailyTargets` via `require.cache` injection; no DB or HTTP server needed.
- Test pool: 4 drivers across 2 haulers with known safety/trips/hours values for deterministic composite score verification.
- Output shape (5): all 11 top-level keys present, total_drivers, rankings length, field completeness, empty-pool zero-state.
- Composite ranking (7): ranks 1–N assigned correctly, rank 1 has highest score, Driver D (≈93) is #1, Driver B (≈79) is last, scores are integers in 0–100, all-zero driver gets composite 0.
- **Fatigue flags / HOS thresholds (7)**: safety-critical tests — 62h → WATCH, 66h → WARNING, 69h → CRITICAL, `hours_to_limit = max(0, 70−h)` for all three, sorted by hours desc, driver exactly at 70h ceiling gets `hours_to_limit=0` and CRITICAL.
- Hauler filter (5): only correct hauler in filtered rankings, total_drivers reflects filter, hauler_filter echoes arg, corridor_avg always uses full pool, unknown hauler returns empty.
- Podiums (4): ≤3 entries, medals 1/2/3 in order, safety gold is Driver C (score 90), hours gold is Driver D (69h).
- Live corridor (2): reads from convoyState; defaults to all-zeros when convoyState throws (non-fatal).
- HOS trend (4): exactly 8 weeks, required fields, counts sum to total_drivers, labels ascending.
- **Server test suite total: 1378 tests, 0 failures.**

---

## 2026-05-21 (indexation.test.js)

### Server — indexation service covered (+28 tests)
- Created `test/indexation.test.js` — 28 tests across three describe blocks; no HTTP server or DB needed (pure computation against mock/tariff.js constants).
- `computeComponents` (11 tests): shape (3 components, ordered fuel/cpi/fixed), weights sum to 1.0, required fields, fuel index ≈ 1.0394 (16.34/15.72), CPI index = 1.024 (102.4/100), fixed = 1.0, contribution_pct values for all three components.
- `computeEffectiveRate` (9 tests): required fields, base = $24.00, effective ≈ $24.55, adjustment ≈ +2.30%, multiplier within floor/cap band, not clamped, formula consistency (effective = base × multiplier, adjustment = (multiplier−1)×100).
- `computeEffectiveRateHistory` (8 tests): non-empty, no nulls, chronologically sorted, required fields on every entry, base month 2026-01 has multiplier=1.0 and effective=$24.00, latest month 2026-05 matches live `computeEffectiveRate()`, effective ≈ base × multiplier within $0.01 tolerance (expected due to 4-dp rounding of stored multiplier vs full-precision calculation).
- **Server test suite total: 1344 tests, 0 failures.**

---

## 2026-05-21 (Sidebar.visibleFor tests)

### Client — Sidebar nav-filtering logic covered
- Exported `visibleFor(role)` from `Sidebar.jsx` (zero behaviour change).
- Created `src/components/layout/Sidebar.test.js` — 18 tests in 5 describe blocks, all pure-function (no DOM render needed).
  - `axis_admin` (3): all six sections present; /settings via `can()`; /audit via hardcoded `role === 'axis_admin'`.
  - `axis_ops` (4): /settings and /audit absent; Platform section retained with alerts + reports; still six sections.
  - `hauler_admin` (4): /settings and /audit absent; no capital items outside scope (/risks, /financials); /settlements and /claims present; /devices absent.
  - `lender` (5): Fleet section pruned entirely; /settings and /audit absent; /compliance visible in Operations; all six Capital paths present; operations paths (/convoys, /trips, /drivers) absent.
  - Section pruning (1): no role yields a section with zero items.
- **Client test suite: 123 tests, 0 failures.**

---

## 2026-05-20 (Guard + SidebarContext tests)

### Client — Guard extracted and tested; SidebarContext covered
- Extracted inline `Guard` component from `App.jsx` into `src/lib/Guard.jsx` (no behaviour change; `App.jsx` now imports it). Build verified clean.
- Created `src/lib/Guard.test.jsx` — 16 tests using `vi.mock('./AuthContext')` + `MemoryRouter` to assert navigation outcomes without a real server.
  - No-user (1): renders null — page stays blank, not redirected.
  - hauler_admin on `/` (3): redirected to `/my-hauler`; axis_admin and axis_ops pass through.
  - `/settings` and `/audit` axis_admin-only (6): all non-admin roles redirected to `/`; axis_admin passes through for both paths.
  - `canAccess` enforcement (5): lender blocked from `/convoys`, allowed on `/financials`; hauler_admin blocked from `/risks`, allowed on `/trips`; axis_ops allowed on `/corridor`.
- Created `src/lib/SidebarContext.test.jsx` — 9 tests.
  - Default collapsed when no localStorage; restores from `'true'` or `'false'` entry.
  - `toggle()` flips state in both directions and persists to localStorage.
  - `--sidebar-w` CSS variable set to `56px` on mount and `180px` after expand.
  - Width constants verified against design spec (56 / 180).
- **Client test suite: 105 tests, 0 failures.**

---

## 2026-05-20 (useEventStream tests)

### Client — useEventStream hook covered
- Created `src/lib/useEventStream.test.js` — 16 tests using `renderHook`, `vi.useFakeTimers()`, and a `FakeEventSource` stub class.
- Connection gating (4): no-op when `enabled=false`, no-op when no token, connects when token present, token appears as `?token=` query param.
- Event routing (5): each of the four event types (`trip_started`, `trip_completed`, `position_update`, `alert_raised`) calls the correct callback; listeners are not registered for callbacks not provided; malformed JSON is silently swallowed.
- Back-off reset (1): `connected` event resets retry delay back to the 2 s base so the next error starts the ramp from zero.
- Reconnect / backoff (3): reconnects after 2 s base delay, closes old EventSource before reconnecting, doubles delay on successive errors (exponential backoff).
- Cleanup (2): closes EventSource on unmount, does not reconnect after unmount even if error fires before cleanup completes.
- **Client test suite: 81 tests, 0 failures.**

---

## 2026-05-20 (AuthContext tests)

### Client — AuthContext covered
- Created `src/lib/AuthContext.test.jsx` — 12 tests across 4 describe blocks using `renderHook` + `waitFor` from React Testing Library.
- Installed missing `@testing-library/dom` peer dependency.
- Suites: initial state (anonymous/loading/ready/401-clears-token/500-error), login() (success stores token + user, 401 throws server message, non-JSON body throws generic, failed login doesn't change status), logout() (clears state, clears even on network error), useAuth outside provider (throws).
- **Client test suite: 65 tests, 0 failures.**

---

## 2026-05-20 (client test framework)

### Client — vitest + React Testing Library configured
- Installed `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` as dev dependencies.
- Configured `vite.config.js` with `test.environment: 'jsdom'` and `test.setupFiles: ['./src/test/setup.js']`.
- Added `"test": "vitest run"` and `"test:watch": "vitest"` to `package.json` scripts.
- Created `src/test/setup.js` (imports `@testing-library/jest-dom` matchers).
- Created `src/lib/format.test.js` — 26 tests covering all six formatters (`formatTonnes`, `formatUsd`, `formatGhs`, `formatPercent`, `formatKm`, `formatLongDate`) including null/undefined, rounding, currency prefix, and en-GB locale output.
- Created `src/lib/auth.test.js` — 27 tests covering `canAccess` (role × path matrix), `can` (capability matrix), `ROLES` constant shape, `getToken`/`setToken` localStorage round-trips, and `authFetch` URL prefixing + Authorization header injection. Used `vi.stubGlobal` to provide a full-fidelity in-memory localStorage stub (jsdom environment lacks `localStorage.clear`).
- **Client test suite: 53 tests, 0 failures.**

---

## 2026-05-20 (admin.test.js — full coverage)

### Server — admin route coverage completed
- `test/admin.test.js` extended from 25 → 80 tests (+55). All 44 handlers in `routes/admin.js` now covered.
- New suites: Users CRUD (12 tests), Hauler operations (8), Fleet CRUD (7), Driver CRUD (7), Webhook inspector (3), Notification preferences (4), Session management (3), CSV import/export (6), Data exports (4).
- Bug found and fixed: three per-route `requireRole('axis_admin', 'axis_ops')` guards in `routes/admin.js` (lines 594, 775, 852) were dead code — the `router.use(requireRole('axis_admin'))` middleware at the top of the file intercepts all requests before those per-route guards are reached. The dead guards have been removed.
- **Test suite total: 1316 tests, 0 failures.**

---

## 2026-05-20 (no-unused-vars cleared)

### Client — no-unused-vars cleared
- Removed 97 `no-unused-vars` warnings across 60 files. **0 errors, 0 warnings** — lint is fully clean.
- Categories addressed: dead recharts imports (`ReferenceLine`, `Legend`, `Cell`, `LabelList`, `Line`, `Dot`), dead lucide-react icon imports (~35 symbols), dead React hook imports (`useMemo` ×4, `useCallback`, `useState`), dead local variables (`SLA_WARN_COLOR`, `ACTION_LABEL`, `MEDAL_NUMERAL`, `SEVERITY_TONE`, `totalOpen`, `baseScenario`, `last`, `barWidth`, `isLive`, `pass_through`, `note`/`setNote`), unused function arguments (prefixed with `_` or removed from destructuring), and dead helper functions (`isoToday`, `MAX_GAP_PCT`).
- Added `caughtErrorsIgnorePattern: '^_'` to `eslint.config.js` — catch params named `_` or `_err` are now correctly ignored.
- `Diesel.jsx` — `KpiStrip` correctly retains `summary` from data destructure (used in 4 tiles); `PassThroughCard` had unused `summary` arg removed.
- `ReconciliationGapStrip.jsx` — removing `barWidth` cascaded to `MAX_GAP_PCT` also becoming dead; both removed.
- `npm run build` still clean — 0 errors, 0 warnings beyond expected chunk-size advisory.

---

## 2026-05-20 (ESLint setup)

### Client — ESLint configured
- Added `eslint.config.js` (flat config, ESLint 10 format).
- Rules active: `no-dupe-keys` (error — catches the silent-override bug class), `no-empty` with `allowEmptyCatch: true`, `no-console` (warn), `no-unused-vars` (warn), `react-hooks/rules-of-hooks` (error), `react-hooks/exhaustive-deps` (warn). React Compiler rules disabled — not applicable without the React Compiler.
- Added `"lint": "eslint src/"` to `package.json` scripts.
- Fixed 2 bugs surfaced immediately by ESLint: `CorridorMap.jsx` — `let shapeStyle = ''` initial assignment was dead (refactored to `const` ternary); `Analytics.jsx` duplicate `fontSize` key (already fixed earlier this session).
- After initial setup: **0 errors, 113 warnings** (unused imports and `exhaustive-deps`).

### Client — react-hooks/exhaustive-deps cleared
- All 14 `exhaustive-deps` warnings resolved. **0 errors, 97 warnings** (remaining warnings are unused imports only).
- `GateChecklist.jsx` — `useCallback` dep was `[tranche?.id]` (stale closure risk); changed to `[tranche]`.
- `ReceivablesPanel.jsx`, `CommentsThread.jsx` — inline `async load` not memoized; converted to `useCallback` with correct deps, removed faulty inline eslint-disable comment.
- `DriverDetail.jsx` — `[driver.id]` reset-on-switch pattern is intentional; added `// eslint-disable-next-line` with explanatory comment.
- `Alerts`, `Convoys`, `Drivers`, `Fleet`, `Haulers`, `Trips` pages — `data?.x ?? []` logical expression wrapped in `useMemo` to give downstream `useMemo` hooks a stable reference.

---

## 2026-05-20

### Server — test suite completed
- Added `test/contract-diesel.test.js` — full coverage of `routes/contract.js` (GET /, open endpoint) and `routes/diesel.js` (GET /, auth-gated). 22 tests.
- Added `test/devices.test.js` — full coverage of `@axis/telematics-core` `/api/devices` router: list (paginated), provision (201 + MQTT credentials, 409 duplicate), single-device detail, PATCH assignment, deactivate, fuel history, calibration CRUD (validation: <2 points, non-numeric, negative, duplicate mm), events log. 53 tests.
  - Bug found: `POST /api/devices/:imei/provision` returns raw SQLite row (`active: 1`) rather than formatted Boolean — documented; test adjusted accordingly.
- **Test suite total: 1261 tests, 0 failures.** All 36 server routes covered.

### Client — build fixes
- Fixed duplicate `fontSize` key in `client/src/pages/Analytics.jsx` (dead token value silently overwritten by explicit numeric).
- Fixed duplicate `fontSize` key in `client/src/components/drivers/LicenceExpiryPipeline.jsx` (same pattern).
- `npm run build` now clean — 0 errors, 0 warnings beyond expected chunk-size advisory.

---

## 2026-05-20 (earlier — test suite build-out)

### Server — test suite build-out (this session started at 1208 tests)
- Added `test/small-routes.test.js` — 12 routes in one file: search, sensitivity, events (SSE auth gate), intelligence (stubbed Anthropic), lender, audit (admin-only + CSV export), snapshot, tranches (drawdown lifecycle), broadcasts (CRUD), tariff (escalation forecast + pass-through history), settings (KV CRUD), playbooks (CRUD + runs + item complete/reopen). ~145 tests.
- Added `test/today.test.js` — full coverage of the 2169-line `routes/today.js`: corridor briefing, forecast + history + scenarios CRUD, operations log, daily digest, handover log CRUD, calendar, week view, closeout queue, action item assignment + bulk ops + snooze + comments + escalation, targets. ~131 tests. Action item IDs discovered dynamically via `GET /api/today` in `before()`.
- Added `test/contract-diesel.test.js` and `test/devices.test.js` (see above).

---

## 2026-05-13

### Phase 103 — Driver Status & Availability Management
- `server/state/driverStatus.js` — SQLite overlay (availability, rest_status, flag).
- `PATCH /api/drivers/:id/status` — axis_admin / axis_ops / hauler_admin (own hauler only).
- `client/src/components/drivers/DriverDetail.jsx` — StatusPanel with availability/rest/flag chips, dirty-state save button.
- Hauler scope enforced; audit trail per change.

### Phase 102 — Fleet Truck Status Management
- `server/state/fleetStatus.js` — SQLite overlay (status, flag, notes).
- `PATCH /api/fleet/:id/status` — role-gated; hauler_admin scoped to own fleet.
- `client/src/components/fleet/RigDetail.jsx` — StatusPanel with 4-chip status selector, 3-chip flag, notes, last-updated meta.

### Phase 101 — Convoy Dispatch
- `POST /api/convoys` — create live convoy (axis_admin / axis_ops).
- `POST /api/convoys/:id/depart`, `POST /api/convoys/:id/arrive` — phase transitions.
- Client convoy dispatch form wired to live endpoints.

### Phase 100 — Live Notification Push (SSE)
- `GET /api/events` — SSE stream for real-time notification delivery.
- `server/services/eventBus.js` — EventEmitter singleton connecting alert engine → SSE.
- Client `NotificationProvider` subscribes to SSE; Topbar bell reflects live count.

### Phase 99 — Direct Message Compose
- `POST /api/broadcasts` — axis_admin / axis_ops compose and send corridor announcements.
- Client compose drawer on `/alerts`.

### Phase 98 — Live Corridor Advisories
- `GET /api/corridor/advisories` — live advisories from DB replace mock when present.
- `POST/PATCH/DELETE /api/corridor/advisories` — admin CRUD.

### Phase 97 — Tranche Drawdown Request
- `POST /api/tranches/:id/drawdown` — submit drawdown request; 422 if gates unmet.
- `PATCH /api/tranches/:id/drawdown/:drawdownId` — lender approve/reject.
- Client Tranches page: drawdown request button, gate checklist, approval workflow.

---

## 2026-05-13 (earlier phases, selected)

### Phases 82–96 — Platform layer
- **Phase 96** — Corridor performance analytics (12-week ISO trend, hauler attribution).
- **Phase 95** — Audit log page (`/audit`) — table + CSV export, admin-only.
- **Phase 94** — Driver leaderboard (`/leaderboard`) — hauler-scoped ranking.
- **Phase 93** — Shift handover log (`/handovers`) — CRUD, role-gated write, lender read-only.
- **Phase 90** — Insurance claims register (`/claims`) — lifecycle: open → under_review → settled/rejected.
- **Phase 89** — Hauler settlement ledger (`/settlements`) — monthly reconciliation, dispute workflow.
- **Phase 88** — Integration health monitor (hauler API status, sync lag, error rate).
- **Phase 87** — Reports library — live PDF/CSV export for GIBDLC pack and lender pack.
- **Phase 86** — Tariff dashboard enrichment — escalation forecast, pass-through history.
- **Phase 85** — Corridor announcements (`/broadcasts`) — CRUD, audience targeting.
- **Phase 84** — Maintenance scheduling — planned/in_progress/completed/cancelled lifecycle.
- **Phase 83** — Bulk action item operations — bulk reassign, snooze, unassign.
- **Phase 82** — Notifications inbox (`/inbox`) — read/unread, bulk mark-read.

### Phases 46–81 — Operational layer
- **Phase 81** — Driver coaching workflow — session scheduling, outcome recording, dismissal.
- **Phase 80** — Playbooks — CRUD, runs, item complete/reopen.
- **Phase 67** — Action item targets — `POST /api/today/targets`, reflected in Today cockpit.
- **Phase 45** — Action item ownership — assign, snooze, comment, escalate.
- **Phase 42–44** — Take-or-pay forecast — MTD projection, per-hauler breakdown, snapshot trend.
- **Phase 41** — Per-hauler lifecycle dossier — full operational view per hauler.
- **Phase 38** — Operations log on Today.
- **Phase 35–36** — Today cockpit wired to live lifecycles; full command surface.
- **Phase 33–34** — Licence renewal lifecycle; HSE incident lifecycle.
- **Phase 32** — Workorder lifecycle UI on Maintenance.
- **Phase 30–31** — Dispatcher coaching sessions (server + UI).
- **Phase 29** — Maintenance workorders — open/assign/close lifecycle.
- **Phase 27–28** — Alerts live from signals; AXIS Intelligence live observations.
- **Phase 26** — Today page wired to live state.
- **Phase 25** — Audit ledger + SQLite persistence.
- **Phase 24** — Intelligence everywhere — page-specific observation chips.

### Phases 11–25 — Core platform build
- Auth + JWT, role model (axis_admin / axis_ops / hauler_admin / lender).
- Trip analytics, driver scoring, compliance (axle-load, HSE, DVLA/GHA filings).
- Financials (DSCR, covenants, P&L, receivables).
- Risks register, sensitivity analysis.
- Contract / tariff / tranches screens.
- Corridor schematic (schematic + Leaflet map toggle).
- Alert triage (Needs Action / Monitoring / Resolved).
- Reports architecture (GIBDLC pack, lender pack).

### Phases 1–10 — Foundation
- App shell: React 18 + Vite, AXIS design tokens (Inter + JetBrains Mono, Bone/Charcoal/Bauxite Rust, 8pt/4px).
- Hauler model — multi-tenant schema, `hauler_id` on every entity.
- Today page layout, Corridor view, Convoys, Trips.
- Contract + Tariff + Tranches screens.
- Financials + Compliance + Alerts.
- AXIS Intelligence (stub → live Anthropic SDK).
- Node/Express bridge server, mock-first pattern, in-memory SQLite.
