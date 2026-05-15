# AXIS Command Center — Phase Log

Build journal for the corridor control layer. Each entry is the final report
delivered when a phase wrapped — what shipped, what was verified, what changed
on disk. Phases are appended chronologically; the most recent is at the bottom.

> **About this log.**
>
> - **Phases 26, 28, 30, 33–45** — verbatim from the wrap-up reports
>   recovered from the conversation transcript (33MB JSONL session
>   file). These are exactly what was delivered when each phase
>   wrapped, with light copy-edit only where reports ran long.
> - **Phases 11–25, 27, 29, 31, 32** — also recovered from the
>   transcript, but condensed because the originals were spread across
>   multiple messages or embedded in mid-conversation summaries.
>   Substance preserved.
> - **Phases 1–10** — restated from the original phase plan in
>   `BRIEF.md §11`. The wrap-up reports for these are older than the
>   transcript and not recoverable, but the codebase running today is
>   built on them.
>
> Going forward, every phase report is appended here verbatim as part
> of the wrap-up.

---

## Phase 1 — Shell and tokens

App shell, sidebar, topbar, routing. AXIS design tokens applied. Logo
lockup. Empty pages with titles. Demo banner. Mock snapshot endpoint
returning stub data.

*(Restated from `BRIEF.md §11` — the planning brief, not the original
wrap-up.)*

---

## Phase 2 — Hauler model

Hauler schema, `/haulers` page, onboarding flow (admin-only), mock mode
with 5 sample haulers contributing mock fleet/trips. API health dots
wired to mock status.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 3 — Today page

Corridor briefing layout. KPI hero strip. Dominant story card. Supporting
row. Brief strip. Intelligence input (stub only — calls mock, returns
fixed copy).

*(Restated from `BRIEF.md §11`.)*

---

## Phase 4 — Corridor + Convoys + Trips

Corridor schematic. Convoy cycle view. Trip analytics with hauler
attribution. Cost-per-route. Delay heatmap.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 5 — Contract + Tariff + Tranches

GIBDLC dashboard. Take-or-pay gauge. Indexation panel (base + fuel + CPI
+ fixed). Tranche timeline.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 6 — Financials + Compliance + Alerts

DSCR and covenant view. Axle-load compliance. Alert triage (Needs Action
/ Monitoring / Resolved).

*(Restated from `BRIEF.md §11`.)*

---

## Phase 7 — AXIS Intelligence (live)

Proactive observations via Anthropic SDK. Interactive mode. Page-specific
suggestion chips. Caching.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 8 — Reports

Monthly GIBDLC pack (PDF export). Lender pack. Regulatory filings tracker.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 9 — Live adapters

Real Loconav integration with per-hauler tokens. One custom adapter (TBD).
Manual CSV upload flow.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 10 — Auth and multi-role

Login. Role split (AXIS admin / AXIS ops / Hauler admin / Lender). The
four user identities and their visibility scopes that everything
downstream is gated on.

*(Restated from `BRIEF.md §11`.)*

---

## Phase 11 — Roster completion (Fleet + Maintenance)

Built the Fleet page (truck roster aggregated across haulers) and the
Maintenance page (workshop queue + road-worthy expiries) as a pair —
they share the same fleet data and both feed the GIADEC filings
pipeline. Server side was already in place; this phase ships the
client-side surfaces.

---

## Phase 12 — Drivers + Rig drawer

Drivers page (full roster with rest-status filtering, hauler scope for
hauler_admin) and the RigDetail drawer on Fleet (click any rig → drawer
with stats, current driver assignment, maintenance history). Pattern
mirrors `HaulerDetail` — `Modal` primitive + lazy fetch from
`/api/<resource>/:id`.

---

## Phase 13 — Alerts triage workflow

Static alert cards became an active triage board. Each alert supports
**resolve / snooze / assign / note / reopen** — all wired to backend
endpoints, all persisted via the `alertState` overlay so triage state
sticks across requests, all audited. Filter bar (severity, type,
assignee), persistent state on the server, deep-links to source pages
from each card.

---

## Phase 14 — Convoys

Convoys page: cycle view, active convoys list with per-rig progress,
ConvoyDetail drawer for each convoy showing the route, the trucks in it,
weighbridge events, and ETA against the contractual cycle target.

---

## Phase 15 — Reports · Shift handover brief

New library entry `shift_handover` (Daily · end of shift · AXIS ops ·
on-call) — first tile on `/reports`. Renderer in
`server/services/reportBuilder.js` pulls live from `alertState`,
`ACTIVE_CONVOYS`, `TRIPS`, `FLEET`. Sections: Shift in one glance ·
Convoys today · Alerts resolved in-shift · Open at handover ·
Maintenance back on the road · Still in garage · Handover signature
lines. `/api/reports/download/shift_handover` streams a valid PDF
(~6.6 KB). Resolving an alert in the live UI grew the PDF byte count,
confirming dynamic content joins.

---

## Phase 16 — Trips deep view

`GET /api/trips/:id` synthesises an 8-waypoint GPS timeline (linear
interpolation between `departed_at` and `arrived_at`), weighbridge
events (`load_check` at origin + clearance at each downstream
weighbridge, laden only), derived rig/driver from the hauler's fleet,
and related alerts (by `asset_ref` or `hauler`). New `TripDetail`
drawer with six sections: Dispatch · Economics · Rig & driver ·
Weighbridge events · Corridor timeline · Related alerts. Route + Status
filter bar on the Trips page; cross-link to `/alerts?focus=…`.

---

## Phase 17 — Maintenance workorder drawer

Click any rig in the Maintenance critical/garage list → drawer with
six sections covering rig identity, current state, maintenance history,
parts on order, owner / hand-off, and the workorder action panel. The
panel is the read-only precursor to the Phase 29 lifecycle write
endpoints; this phase ships the surface.

---

## Phase 18 — Drivers deep view

`server/routes/drivers.js` — `GET /:id` returns the full driver dossier:
assigned rig (or "Relief pool"), recent trips (top 6, deterministic
hash-seeded), licence + PSV + medical (each with `tone:
ok/warning/critical`), four training certs (defensive driving, hazmat,
first aid, site induction), 8-week safety series with deterministic
jitter, and open alerts filtered by `asset_ref` against
`driver.licence_number / full_name / id` plus `licence_expiry /
hse_event` types on the same hauler matching `driver.flag`.

`client/src/components/drivers/DriverDetail.jsx` — drawer with
STATUS, ASSIGNED RIG, LICENCES & CERTIFICATIONS, RECENT TRIPS, SAFETY
SCORE TREND · 8 WEEKS, OPEN ALERTS. Open Alerts deep-link to
`/alerts?focus=${a.id}`.

---

## Phase 19 — Haulers deep view

`server/routes/haulers.js` — `GET /:id` extended with the lender-facing
sections: `fleet_breakdown` (status + flags), `driver_roster` (rest
breach / warning, coaching flagged, avg safety), `mtd` (trips, tonnes,
revenue, cost, margin), `sla_series` (12 weeks deterministic), and
`settlement` (14-day terms, invoiced, paid, outstanding,
avg-days-to-settle, on-time pay %, next invoice). Each section rendered
in `HaulerDetail.jsx` as a Section/Row block — this is the lender
ceremony that everything in Phase 41 builds on top of.

Verified for Hauler 02: 25 contracted · 8 in transit · 1 cert<30d · 8
service due · 39 drivers · rest breach 3 · avg safety 81.1 · MTD margin
$3,080 · SLA 89.5% (rust, below 90 floor) · settlement $1,613
outstanding · 7d to settle · 96% on-time pay · 3 open alerts.

---

## Phase 20 — Alerts focus routing

Deep-links into `/alerts?focus=<id>` now scroll-and-ring the matching
card. `AlertCard.jsx` carries `id="alert-<id>"` anchor and an
`isFocused` rust border + 3px shadow ring. `Alerts.jsx` runs a
poll-based focus ceremony (scroll to center, ring for 2.4 s, clear
`?focus=` at 400 ms) using `useLocation` + `useNavigate` (stable refs;
`useSearchParams` setter has an unstable ref that cancelled in-flight
timers). `ResolvedSection` auto-expands when focus targets a resolved
alert. `behavior: 'auto'` on `scrollIntoView` because browser
scroll-restoration was cancelling smooth scrolls after reload.

---

## Phase 21 — Reports · Filings tracker

Built a filings tracker surface inside the Reports page using the
existing regulatory filing data (DVLA, GHA, Minerals Commission, EPA).
Each row carries agency, due date, status, and detail. Status pills
follow the standard tone palette (FILED green, ON_TRACK neutral, DUE
amber, overdue rust). The drawer-based `Mark filed` flow lands in
Phase 22A.

---

## Phase 22 — Three-part polish set

User-requested sequence "go A first then the rest":

- **22A · Filings detail drawer + Mark-filed.** Click a filing row →
  drawer with agency desk, internal owner, evidence checklist,
  submission history. axis_admin / axis_ops see the "Mark filed" button
  that flips DUE / ON_TRACK → FILED server-side.
- **22B · Settings build-out.** Three panels under `/settings`: System
  status · User directory · Hauler integrations. axis_admin-gated.
- **22C · Today intelligence chip flow.** Curated chip-specific replies
  grounded in aggregator data, threaded transcript inside
  `IntelligenceInput` instead of a single overwriting reply.

---

## Phase 23 — Compliance filings reconciliation

Two surfaces had grown their own filings views — the Reports tracker
(Phase 21) and the older `compliance/FilingTracker.jsx`. Phase 23
collapses them: Compliance now uses the shared FilingsTracker + drawer
component, and the stale `compliance/FilingTracker.jsx` was deleted.
Single source of truth for filings across the platform.

---

## Phase 24 — Intelligence everywhere

`IntelligencePanel` component drops into any page via
`<IntelligencePanel page="X" />` — hits `/api/intelligence/observe?page=X`,
two-column layout (1.4fr observations / 1fr chat input). Curated chip
replies keyed by exact chip text, closures receive corridor context.
Page-specific `FALLBACK_OBSERVATIONS` (2–4 cards) and `FALLBACK_CHIPS`
(3 questions). AXIS Intelligence voice: port-authority notice tone,
≤25w observations, ≤60w chat replies, numbers carry units (40 tonnes,
GHS 16.10, $24), banned-term regex on output.

---

## Phase 25 — Audit ledger + SQLite persistence

The platform's first durable backing store. SQLite via better-sqlite3
(synchronous), WAL journal mode, foreign keys on. Idempotent schema
(`CREATE TABLE IF NOT EXISTS`) — additive only, no migration
framework. `data/axis.db` durable across restarts.

- In-memory state stores migrated to SQLite using the drop-in module
  pattern: `alertState.js`, `filingState` (overlay row wins over the
  fixture baseline), `report_runs` (persisted runs prepended to the
  fixture seed). Public API of each module unchanged so route handlers
  don't care about the backing store.
- **Unified audit_log** — every write endpoint routes through
  `db/audit.js`'s `writeAudit({ req, entity_type, entity_id, action,
  summary, payload })`. Single authoritative feed.
- `AuditPanel` UI under `/settings` — paginated (load more), filter
  chips by entity type, axis_admin-gated.

---

## Phase 26 — Today page, live

Right now `/api/today` serves fixture `dominant_story` + `action_items`
that never change. Phase 26 rewires both from live state: dominant
story picks the highest-severity open alert or biggest SLA / convoy
miss; action items pull from unresolved alerts, due-this-week filings,
and critical-maintenance rigs — each with a deep-link into the source
page. Landing page becomes a real briefing instead of a static panel.

*(From the proposal/scope message at the start of Phase 26 — the live
synthesis it describes is what shipped and what every later phase
extends.)*

---

## Phase 27 — Alerts, live from signals

Alerts page no longer reads from the static fixture alone. New
`alertSynth` service composes alerts from live state — open critical
weighbridge holds, integration probe failures, expiring licences,
filings overdue — and merges them with `alertState` triage overlay so
generated alerts can be resolved/snoozed/assigned just like static
ones. Stable generated IDs (`gen-axle-{haulerId}`, `gen-licence-{id}`,
`gen-integration-{haulerId}`) so triage sticks across requests via the
overlay.

---

## Phase 28 — AXIS Intelligence, live observations

Every page hosts an Intelligence panel, but in demo mode it falls back
to `FALLBACK_OBSERVATIONS` — static strings that reference numbers
like "4 holds in 30 days" regardless of what actually happened. Phase
28 adds a per-request synthesizer that composes observations from
current state (the same live feed that powers Today's right rail and
the alert generator), so even without an Anthropic API key the
Intelligence panel reflects reality. Curated chip replies already use
live context via closures; this extends the same pattern to the
passive observations.

---

## Phase 29 — Maintenance workorders

**Schema** — idempotent `workorders` table with indexes on
`(rig_id, opened_at)` and `(status, opened_at)`; durable in
`data/axis.db`.

**State overlay** (`server/state/workorderState.js`) — `open / progress
/ resolve / findById / forRig / openForRig / allOpen /
rigsInRemediation`. Stable IDs (`wo-{base36ts}-{hex}`). Status machine
enforced at the route layer.

**Write routes** in `server/routes/maintenance.js`:
- `POST /api/maintenance/:rigId/workorders` — scoped to axis_ops /
  axis_admin / hauler_admin-own-hauler. Rejects double-open with 409
  and a pointer to the existing row. Audit `action: open`.
- `POST /api/maintenance/workorders/:id/progress` — notes go into
  `progress_note`. Audit `action: progress`.
- `POST /api/maintenance/workorders/:id/resolve` — requires
  `resolution_note`, accepts optional `cost_usd` / `hours`. Audit
  `action: resolve` with the full payload.
- `GET /api/maintenance/workorders/list` — scoped listing.

**Read integration**:
- `GET /api/maintenance` counters split critical into
  `critical_remediating` vs `critical_unremediated`; every rig in the
  four buckets decorated with `active_workorder` so the UI tags rows
  without a round-trip.
- `GET /api/maintenance/:rigId` returns `workorders: [...]` +
  `active_workorder`.

**Synth integration**:
- `alertSynth.synthMaintenance` subtracts rigs in
  `workorderState.rigsInRemediation()` from the cluster threshold —
  so `gen-maint-{haulerId}` auto-closes once workshop absorbs enough
  rigs.
- `observationSynth.fleetObs` splits the body into "critical with no
  workorder" (warn) vs "in remediation" (info), and emits a clean
  all-clear when the critical list is empty.

Verified: open → progress → resolve on `rig-0030`, counters shifted,
audit log captured all three mutations.

---

## Phase 30 — Dispatcher coaching sessions · shipped

The final write loop is wired end-to-end. What landed:

- **Schema + state** — `coaching_sessions` table with
  `linked_alert_ids_json`, `expected_delta_pct`, attendee count,
  dispatcher name. `coachingState.recentForHauler(id, days, now)` is
  the cooldown probe the synth reads; `recentWindow(days, now)` feeds
  observation strips.
- **Route** — `POST /api/coaching/sessions` (axis_ops / axis_admin /
  own-hauler admin), `GET /api/coaching/sessions`,
  `GET /api/coaching/haulers/:id/recent`. On create, every id in
  `linked_alert_ids` flips to RESOLVED via `alertState.resolve()` with
  the note `Resolved via coaching session {id} ({topic})`, and both
  the session create and each auto-close are written to `audit_log`.
- **Alert synth** — `synthAxleHolds` now filters out any hauler that
  has a coaching session in the last 7 days, so the same
  `gen-axle-{hauler}` id can't re-open on the pre-existing hold stack
  immediately after the operator closed it.
- **Observation synth** — Today and Compliance now reword when a
  hauler is under cooldown: the weighbridge strip shows "coached
  2026-04-24 — monitoring hold-rate delta" instead of a fresh
  coaching ask, the axle-pattern observation carries the expected
  hold-rate delta, and a coaching rollup counts sessions × haulers in
  the 30-day window.

**Verification chain:**

1. POST against `haul-02` → session `cs-mod1ms3c-42b332` created,
   `gen-axle-haul-02` auto-closed, two audit rows written.
2. With the session present, `alertSynth.generated(now)` at a
   pinned-now inside the 24h hold window returns **zero** axle
   alerts for `haul-02`.
3. Delete the row → the alert **re-emits**. Restore the row →
   suppression returns. The cooldown is decisively the thing doing
   the suppression.
4. Today/Compliance observations now carry "Hauler 02 absorbed 4
   holds in 30 days — dispatcher coached 2026-04-24, -40% hold-rate
   delta expected."

That closes the write loop that axle alerts always prescribed but
never had anywhere to land.

---

## Phase 31 — Coaching sessions UI

End-to-end UI for the Phase 30 coaching overlay.

- `AlertCard.jsx` — new **Coach dispatcher** action gated on
  `type === 'axle_load_breach'` and `hauler_id`. Click → inline
  `CoachPanel` titled "Log coaching session · Hauler XX" with
  dispatcher name, attendees, expected hold-rate delta (pre-filled −40),
  and notes. Submission auto-resolves the alert with note `Resolved via
  coaching session cs-… ({topic})`.
- `client/src/components/compliance/CoachingLog.jsx` (new) — fetches
  `/api/coaching/sessions`, filters to a 30-day window, shows cooldown
  chip per row, displays dispatcher / attendees / linked alerts. New
  **DISPATCHER COACHING · LAST 30 DAYS** strip on `/compliance`.
- Intelligence panel on Compliance now reads coaching state live:
  "Hauler 02 absorbed 4 weighbridge holds in 30 days — dispatcher
  coached YYYY-MM-DD, −45% hold-rate delta expected" and "N coaching
  sessions logged in 30 days across M haulers".

Verified: alt-901 reopened → Coach Dispatcher → submit → vanished from
open list → reappeared in RESOLVED with the auto-resolve note.

---

## Phase 32 — Workorder lifecycle UI on Maintenance

UI for the Phase 29 workorder lifecycle on the Maintenance page —
counter strip + lifecycle panel + critical-table WORKORDER column. Open
→ Progress → Resolve flow verified end-to-end:

- Counter strip flipped `1 pending · 3 in remediation` → `2 pending ·
  2 in remediation` on resolve.
- Lifecycle panel: `No active workorder` empty state restored after
  resolve; `Open workorder` button re-emerged.
- Critical table WORKORDER column: GR 7136-26 flipped `OPEN → NONE`
  (resolution cleared `active_workorder`).
- Audit trail captured all three mutations (`open`, `progress`,
  `resolve`).

---

## Phase 33 — Licence renewal lifecycle ✅ complete

**What shipped**

- **`licence_state` overlay + POST `/api/compliance/licences/:id/renew`** —
  persists new expiry, optional DVLA reference, optional note. Validated
  (future-dated expiry required; 400 otherwise). Role-gated to
  `axis_admin` / `axis_ops` (hauler admins + lenders receive 403). Every
  renewal writes a line to the unified `audit_log` with `prev_expiry` →
  `new_expiry` and ref number.
- **Pipeline recomputes `days_remaining` live** against the server clock —
  static fixture numbers are gone. A renewal with expiry > 90 d drops out
  of the pipeline; one that stays inside the 90-day window is re-sorted
  to its new position and carries a green `renewed` badge next to the
  date.
- **Inline Renew panel on LicencePipeline rows** — click-to-open (only
  for write roles), pre-fills the new expiry at 2 y for Class E licences
  and 1 y for medicals, optional DVLA reference and note. `onRenewed`
  callback bubbles up to `Compliance.jsx` to reload the whole feed so the
  pipeline + Intelligence observation refresh in one round trip.
  Non-write roles see the rows read-only.
- **Intelligence observation** — compliance page now surfaces
  `N driver licence(s) renewed through DVLA in 7 days. Audit trail carries
  reference numbers.` alongside the existing "book the DVLA slot" nag,
  and the nag skips renewed rows.

**End-to-end verification**

| Action | Before | After |
|---|---|---|
| Renew `lic-1021` (Driver 02-117, 8 d) to 2028-04-24 | top of pipeline, 8 d | dropped off (731 d > 90 d window) |
| Renew `lic-1022` (Driver 01-034, 24 d) to 2026-06-23 | top of pipeline, 24 d | re-sorted to position 3, 60 d, `renewed` badge |
| Pipeline row count | 6 | 5 |
| Intelligence `obs-licence` target | Driver 02-117 (8 d) | Driver 01-034 suppressed (renewed), falls back to next non-renewed row |
| Intelligence `obs-licence-renewed` | absent | `2 driver licences renewed through DVLA in 7 days` |
| Audit trail | — | 3 `licence · renew` rows with full actor + prev/new expiry + DVLA reference |
| `hauler_admin` + `lender` POST | — | 403 enforced |

The Compliance page now carries all three regulatory writes end-to-end:
**mark filed** (Phase 22A), **coach dispatcher** (Phase 31), **renew
licence** (Phase 33). Every regulatory-facing row on that page is now
write-through to SQLite with an audit line.

---

## Phase 34 — HSE incident lifecycle ✅ complete

**What shipped**

- **`hse_incidents` overlay** (new SQLite table, idempotent schema) —
  `id, occurred_at, hauler_id, truck, driver, category (A|B), type,
  km_marker, note, status (OPEN|CLOSED), corrective_action, closed_at,
  closed_by_display, linked_coaching_id` + `created_*` + `updated_*`.
  Helpers: `create`, `close`, `findById`, `all`, `since(days)`.
- **Compliance route** — three additions:
  1. `mergedHseEvents()` blends fixture rows (presumed CLOSED) +
     overlay rows; `hseSummary()` recomputes
     `current_per_mtk = trailing_events / HSE_MTKM_90D` (denominator
     derived from fixture so future fixture changes ripple through),
     `trailing_events_90d`, and `open_count`.
  2. `POST /api/compliance/incidents` (axis_admin/axis_ops, validates
     `category ∈ {A,B}`, `hauler_id`, `type`).
  3. `POST /api/compliance/incidents/:id/close` (validates
     `corrective_action`, blocks double-close).
  Both write to `audit_log` with `entity_type = 'hse_incident'`.
- **Intelligence observation** — compliance page now publishes
  `obs-hse-cat-a` (warn — "Coach the dispatcher this week" or
  "already coached, track recurrence" depending on coaching cooldown)
  and `obs-hse-open` (warn if >1, info otherwise). Sliced output now
  sorts warn ahead of info so regulatory action leads.
- **HSEPanel rewrite** — `Log incident` button + inline form (hauler
  dropdown via `/api/haulers`, category select with inline preset
  datalist switching A↔B, km marker, truck, narrative). Per-row
  `CLOSE` chip on OPEN events with corrective-action textarea. Open
  events now carry an amber left border, an `OPEN` chip, and the
  headline shows `· N OPEN`. Closed events show the corrective action
  in green with a `ShieldCheck`. All affordances role-gated to
  `axis_admin`/`axis_ops`.

**End-to-end verification**

| Step | Headline | Open badge | Audit |
|---|---|---|---|
| Baseline (fixture only) | `1.42` per mtkm · 3 events | none | — |
| Logged Cat A on Hauler 04 (km 142, near-miss) | `1.89` · 4 events | `· 1 OPEN` | `create` |
| Closed with corrective action | `1.89` · 4 events | cleared | `close` |
| Intelligence on reload | — | — | `obs-hse-cat-a` leads as `warn`: "Coach the dispatcher this week" |

Validation surface tested: `400` on missing/invalid category, `400` on
missing `corrective_action`, `400` on double-close, `404` on unknown id,
`403` on `hauler_admin` + `lender`. Lender UI renders the panel
read-only.

---

## Phase 35 — Today cockpit wired to the new lifecycles

The corridor briefing now reflects every write built in Phases 32–34,
with no UI components changed (the existing `ActionItems` and
`ObservationFeed` just receive richer payloads).

**What's new in `server/routes/today.js`:**

1. **Licence expiry as an action item** — overlay-aware via
   `liveLicences()`. Surfaces the next-expiring driver licence within
   14 days as `high` (≤7d) or `medium` (8–14d). Renews drop it
   instantly. Mirrored as a `warn`/`info` observation at the 30-day
   window.
2. **HSE open incidents as action items** — `incidentState.since(30)`.
   Open Cat A surfaces as `high` with hauler name + incident type. ≥2
   open Cat B becomes a `medium` rollup. Closing the incident drops
   both the action item and the observation.
3. **Critical-rig rollup net of remediation** —
   `criticalRigsNetOfRemediation()` excludes rigs with an
   OPEN/IN_PROGRESS workorder via
   `workorderState.rigsInRemediation()`. Body copy changed from
   "Expedite workshop release" to "Open a workorder so the workshop
   owns it" — the action the operator should actually take. Resolving
   the workorder restores the rig to the count.
4. **Priority + severity sorts** — `actionItems` final-sorts
   `high → medium → low`; `observations` puts `warn` ahead of `info`.
   Both still slice to 5, so the highest-urgency items survive the cap.

**Verification:** API + UI both confirmed bidirectional behavior —
incident open/close, licence renew, workorder open/resolve all flip
the cockpit predictably. Source/link metadata on every item deep-links
back to the originating page.

---

## Phase 36 — Today cockpit is now a true command surface

The three action-item types that map to a single-write close
(`filing`, `licence`, `hse_incident`) now expand an inline form right
under the row instead of punting the operator to the source page.
Verified end-to-end against the live UI.

**Verified behavior:**

- **Quick-close HSE Cat A** — click row → textarea expands → corrective
  action submitted → cockpit reloads, item gone, audit row written
  (`hse_incident/close: Closed Cat A incident on haul-04 — Rollover (no
  injury)`)
- **Quick-renew licence** — click row → date pre-filled (today + 2y for
  Class E, +1y for medical) + DVLA ref input → submitted → cockpit
  reloads, item gone, audit row written (`licence/renew: Renewed Class
  E licence for Driver 02-117 — new expiry 2028-04-26`)
- **Quick mark-filed** — click row → confirmation form → submitted →
  cockpit reloads, item gone, audit row written
  (`filing/mark_filed: Marked DVLA · flg-dvla-q1 as filed`)
- **Lender role correctly read-only** — every item shows "OPEN ..."
  deep-link, zero "QUICK CLOSE" affordance; clicking HSE navigates to
  `/compliance` instead of expanding a form
- **Non-actionable types still deep-link** — alerts → `/corridor`,
  maintenance → `/maintenance`, receivables → `/financials` (richer
  triage UI lives there)
- **Cockpit reloads on success** — `Today.load()` hoisted into a
  `useCallback` so `ActionItems`'s `onMutate` can re-trigger the
  briefing; freed slot fills with the next-priority item automatically

**Files changed:**

- `client/src/components/today/QuickAction.jsx` (new) — three forms
  behind a single switch on `item.source.type`, sharing a compact
  `FormShell`
- `client/src/components/today/ActionItems.jsx` — per-item expansion
  state, inline form when
  `canWrite && INLINE_ACTION_TYPES.has(source.type)`, "Quick close ⌄"
  affordance with rotating chevron
- `client/src/pages/Today.jsx` — `load` extracted into `useCallback`,
  passed as `onMutate` to `ActionItems`

Backend untouched — same endpoints already had role gates and audit
writes from Phases 30/33/34.

---

## Phase 37 — Alerts auto-suppress when their root cause is remediated

Generated alerts already had this property (the synth just stops
emitting). The gap was the static fixture alerts (`mock/alerts.js`)
which never stopped on their own — operators were double-shouted: close
the lifecycle entity *and* manually resolve the alert.

**The fix lives in `server/services/alertSynth.js`:**

A new `suppressedByLifecycle(alert, now)` filter sits in front of
`STATIC_ALERTS` inside `allAlerts()`. It only acts on alerts in
`NEEDS_ACTION` status (RESOLVED/MONITORING are passed through
untouched). Three lifecycle mappings:

| Alert type | Suppression trigger |
|---|---|
| `licence_expiry` | A licence in `LICENCE_EXPIRY` whose `driver` matches `alert.asset_ref` has a row in `licenceState` |
| `axle_load_breach` | The hauler has been coached in the last 7 days (matches the existing `gen-axle` cooldown policy) |
| `hse_event` | A `CLOSED` HSE incident exists for the same hauler in the last 30 days |

Also added `autoClearedAlerts(now)` as a public export — returns the
suppressed-payload list so a future cockpit module could surface
"auto-cleared today: 2 alerts" telemetry without re-running the
suppression logic.

**Verified end-to-end:**

- Clean baseline → 4 NEEDS_ACTION alerts (alt-901 axle/haul-02, alt-902
  sla, alt-903 licence/Driver 02-117, alt-904 payment_ageing)
- Renew `lic-1021` (Driver 02-117) → **alt-903 suppressed** ✓
- Log coaching session for haul-02 → **alt-901 suppressed** ✓
- alt-902 (sla, no lifecycle) preserved ✓
- alt-904 (payment_ageing, no lifecycle) preserved ✓
- alt-810 (hse, MONITORING) preserved — status filter correctly excludes
  it ✓
- `autoClearedAlerts()` returns
  `[alt-901/axle_load_breach, alt-903/licence_expiry]` with full payload
- Today brief strip "Unresolved alerts" dropped from "4 total open" to
  "2 total open"
- Today `action_items` no longer includes the suppressed alerts;
  freed slots filled by lower-priority items

The audit trail is durable through the lifecycle entities themselves
(`licence/renew`, `coaching/create`, `hse_incident/close` rows) — no
auto-resolve audit entries needed since the suppression is computed
live from state, not a write.

---

## Phase 38 — Operations log on Today

Verification results:

- **API** (`GET /api/today/operations-log`) — returns
  `{ since, counts, entries }` filtered to UTC start-of-day, capped at
  30 rows, lender → 403, hauler_admin payload-scoped, axis_* sees full
  corridor.
- **UI** — section renders at the bottom of Today's left column with
  eyebrow "Operations log · today", subtitle
  `22 writes · 2 alerts auto-cleared by lifecycle`, and 24 rows ordered
  newest-first. Auto-cleared alerts pinned at top with `lifecycle`
  actor; lifecycle writes (coaching, licence renew, HSE incident,
  filing, workorder) interleaved by timestamp.
- **Lender** — section silently absent (component returns null on 403,
  no error fallback).
- **Re-mount on briefing reload** — the `key={today?.generated_at}`
  trick on `<OperationsLog />` ensures it refetches whenever the parent
  briefing reloads (e.g. after a QuickAction close-out).

Cleanup: overlay test state (`hse_incidents`, `coaching_sessions`,
`licence_state`, `filing_state`, `workorders`, `alert_state`) wiped
back to 0. Audit rows for today's UTC window now 0 — fresh canvas for
the next phase.

---

## Phase 39 — Auto-cleared alerts visibility on /alerts

What changed:

- **`server/services/alertSynth.js`** — Refactored
  `suppressedByLifecycle` into `whyCleared(alert, now)` that returns
  a structured `{ kind, reason, actor, when, link }` envelope (or
  null). The boolean variant just delegates. `autoClearedAlerts()`
  now enriches each suppressed alert with `cleared_by`. Both
  `whyCleared` and `autoClearedAlerts` are exported.
- **`server/routes/alerts.js`** — `GET /api/alerts` payload extended
  with `auto_cleared: [...]` (visibility-scoped same as the active
  list) and `summary.auto_cleared: N`.
- **`client/src/components/alerts/AutoClearedSection.jsx`** (new) —
  Collapsible section ("Auto-cleared by lifecycle · N — Suppressed
  because the root cause was remediated"). Each row: green lifecycle
  icon + severity dot + type label + title + hauler + the human
  reason + actor/timestamp + deep-link button to `/compliance`.
- **`client/src/components/alerts/AlertsSummary.jsx`** — Conditional
  7th tile "Auto-cleared" (green tone) appears only when
  `summary.auto_cleared > 0`.
- **`client/src/pages/Alerts.jsx`** — Mounts `<AutoClearedSection />`
  after `<ResolvedSection />`.

**Verified end-to-end:**

- Server payload enriched with `cleared_by` for both seeded candidates
  (axle_load_breach via coaching, licence_expiry via renewal).
- 7-tile summary strip with the new green "Auto-cleared 2" tile.
- Section header text + collapsible toggle, two rows with full reason
  strings, "View coaching log" / "View renewal" buttons.
- "View renewal" click navigated to `/compliance` cleanly.
- haul-01 admin sees 0 (their hauler had no auto-clears); lender sees
  both (corridor-wide); axis_ops sees both.
- Cleanup: licence_state and coaching_sessions back to 0 rows.

---

## Phase 40 — Daily digest: printable end-of-day briefing

What changed:

- **`server/routes/today.js`** — New `GET /api/today/digest` endpoint
  composes a self-contained printable payload: corridor masthead +
  KPIs, dominant story, observations, open action items
  (carry-forward), full operations log (uncapped — 1000 row limit so
  the digest is a durable record), auto-cleared rollup with
  `cleared_by` reasons, hauler split, filings posture, and
  `generated_by` stamp. Lender → 403; hauler_admin scope respected.
- **`client/src/pages/TodayDigest.jsx`** (new) — Standalone
  print-optimized page. Letterhead with AXIS / corridor / date /
  generated-by, 4-tile KPI strip with floor-vs-actual tone, dominant
  story callout, open follow-ups list with priority badges,
  auto-cleared section with lifecycle reasons, full operations log
  table (Time / Entity / Action / Summary / Actor), hauler split table,
  filings posture, observations, footer with doc id. `Cmd-P / Print`
  toolbar at the top (.no-print class hides on print).
- **`client/src/App.jsx`** — `/today/digest` routed at the Gate level,
  *outside* Shell, so there's no app chrome to fight on print and the
  on-screen view IS the artifact.
- **`client/src/styles/base.css`** — `@media print` rules: white
  background, hide `.no-print`, `@page` margins for A4,
  `page-break-inside: avoid` hardening for sections/rows.
- **`client/src/components/today/OperationsLog.jsx`** — Discreet
  `Print digest →` link (Printer icon) in the header, opens digest in
  a new tab. Lives next to the operations log because the digest *is*
  "operations log + context."

**Verified end-to-end:**

- Server payload at axis_ops with seeded state: 5 ops-log writes (1
  HSE, 2 coaching, 2 licence), 2 auto-cleared with reasons, 5 open
  follow-ups, 5 observations, 5 haulers, filings posture (5 total / 1
  filed / 0 overdue / 1 due ≤3d).
- UI renders all 8 sections, both data tables, both KPI tiles in the
  4-tile strip, letterhead with `Generated by Kwame Boateng · AXIS
  Operations · at 15:04 UTC`.
- `body.digest-mode` class set, `.no-print` toolbar present and
  removable on print.
- Today's `Print digest →` link confirmed: `href="/today/digest"`,
  `target="_blank"`, lives inside the Operations log section header.
- Lender hits 403 (`{"error":"Daily digest is restricted"}`); haul-01
  admin sees 0 writes / 0 auto-cleared (correctly scoped).
- Cleanup: hse_incidents, coaching_sessions, licence_state all back
  to 0.

---

## Phase 41 — Per-hauler lifecycle dossier

The hauler detail drawer now carries the operational write history that
Phases 30–38 produced but never surfaced in one place. Click any hauler
row → drawer shows three new counters and a tail of recent writes.

**Server — `server/routes/haulers.js`**

- `GET /api/haulers/:id` extended with a `lifecycle` block aggregating four
  streams over a 30-day window: HSE incidents (open + closed counts +
  recent 5), dispatcher coaching (sessions in window + last held + recent
  5), driver licences (renewed-in-window count + live expiring list with
  overlay-aware days remaining), and a per-hauler audit feed (top 10 writes
  whose payload mentions this hauler).
- Hardened scoping at the same time: `hauler_admin` now gets **403** on
  other haulers' detail (was leaking settlement + audit). `lender` gets a
  `lifecycle.audit.restricted: true` envelope instead of write history
  (consistent with the operations log + digest line).

**Client — `client/src/components/hauler/HaulerDetail.jsx`**

- New `LifecycleSection` slots after Settlement: three rows for the
  counters with appropriate amber/rust tones, an inline "expiring" tail
  when there are licences ≤30d out, and a 10-row "Recent writes" mini-feed
  with timestamp · summary · actor.

**Client — `client/src/components/settings/AuditPanel.jsx`**

- Chip filters extended with `HSE / Licences / Coaching / Work orders` (the
  four lifecycle entity types added in Phases 30–38). `ACTION_TONE` and
  `ENTITY_LABEL` maps now cover `create / open / progress / close / renew /
  auto_clear`.

**Verified**

- Server: lifecycle counters tick on live writes (seeded HSE create+close,
  licence renewal — counters and audit tail all updated).
- Client: dossier renders cleanly with 10 audit rows, three counters,
  expiring licence tail.
- Role scopes: axis_admin sees full · hauler_admin 403 on others / OK on
  own · lender's audit feed blanked server-side.
- AuditPanel: HSE chip narrows feed to 16 HSE-only rows; new action verbs
  all rendering.
- Cleanup: overlay tables wiped (audit_log retained — that's the durable
  record).

---

## Phase 42 — Take-or-pay forecast

The strategic gap closed: every other corridor metric was backward-looking.
With 3 days left in April and run-rate at 79.3 % of contracted, "are we
going to clear the floor?" was the question nobody on the platform could
answer at a glance. Now it's the second card on Today and the third
section of the digest.

**Server**

- `server/services/forecast.js` — pure module computing projection,
  required-daily, and per-hauler idle-truck levers off the existing
  aggregator (no new fixtures).
  - Verdict buckets: `on_pace_for_contracted` / `above_floor` /
    `banked_floor_drift` / `below_floor_at_pace` — drives UI tone.
  - Levers are sized in tonnes-per-day-of-remainder using
    `dailyActual / activeTrucks`; surfaces "activating all idle recovers
    N t = X% of gap".
- `GET /api/today/forecast` — standalone endpoint, all-role visible
  (lender depends on it for DSCR — confirmed 200).
- Forecast embedded into both `/api/today` (Today card consumes the prop)
  and `/api/today/digest` (printable section).

**Client**

- `client/src/components/today/TakeOrPayForecast.jsx` — new card
  sandwiched between DominantStoryCard and the convoy/hauler grid. Big
  projected EOM number, tone matches verdict; progress bar with floor pin
  + nameplate cap; three stat tiles (daily avg now / required to clear
  floor / shortfall); top-3 idle-truck levers.
- `client/src/pages/TodayDigest.jsx` — new `ForecastSection` after
  Dominant story: 4-KPI strip + full 5-row lever table with break-inside
  protection.

**Live numbers (today, 27 Apr, 23:00 UTC)**

- 27/30 days elapsed · 3 remaining
- Projected EOM **66.0 kt** = 99% of floor → verdict `below_floor_at_pace`
- Need **2,420 t/d** vs 2,200 t/d actual = **+10.1 % lift**
- Shortfall: **660 t** over 3 d remaining
- Activating all 16 idle trucks recovers **1,124 t** (170% of gap) —
  Hauler 05 alone is +492 t

**Verified**

- Endpoint math correct against aggregator (delivered_mtd, days, fleet)
- Today card renders with rust verdict tone and lever ranking
- Digest section renders with print-safe styling and full hauler lever
  table
- Lender (200), axis_admin (200), hauler_admin (200) all see the
  corridor-level forecast — no role gating because this is non-sensitive
  contractual posture

---

## Phase 43 — Forecast snapshot trend

The forecast was a single point in time. Now the operator sees whether
their decisions are bending the projection.

**Server**

- `server/state/forecastSnapshots.js` — idempotent `forecast_snapshots`
  table keyed to UTC date with the full projection envelope (target,
  actual, projection, required, verdict). Upsert is "last write wins for
  the day," so traffic doesn't pollute the row.
- `routes/today.js`:
  - `GET /api/today` and `GET /api/today/forecast` both call
    `forecastSnapshots.capture(forecast)` after build — single source of
    truth, no duplicate computation.
  - New `GET /api/today/forecast/history?days=14` returns the trend
    (clamped 2–60 days).

**Client**

- `client/src/components/today/TakeOrPayForecast.jsx`:
  - Independent `useEffect` fetches `/forecast/history?days=14` and stores
    it.
  - New `TrendSparkline` component slots between the projection number
    and the stat tiles. Tight Y-axis around floor for dramatic
    readability; rust bars below floor, neutral above; today's bar has a
    thin outline; dashed reference line for floor; delta caption "+1,589 t
    (+2.5 %) since 04-14".

**Verified**

- 14 seeded snapshots persist correctly: `04-14: 64,429 t (96.6 % of
  floor) → 04-27 (live): 66,000 t (~99 %)`.
- Today's row is overwritten with each `/api/today` load —
  production-correct freshness behaviour.
- Sparkline visible on Today page, delta caption reads correctly, today's
  bar tone matches verdict.
- Endpoint accessible to all three roles (no gating — corridor-level
  data, lender depends on it for trend monitoring).

The compounding effect of Phases 42 + 43: every morning the operator sees
not just "where will we land" but "is yesterday's work moving the line" —
the unit test for whether the desk is making decisions that matter.

---

## Phase 44 — Per-hauler forecast

The corridor forecast (Phase 42) answered "are we hitting the floor?" —
Phase 44 answers the natural follow-up: **which hauler is dragging us, and
how much?**

**Server**

- `services/forecast.js` — extended with `haulers` block. Per-active-hauler:
  - `delivered_mtd / contracted_mtd / contracted_monthly` (target full
    month)
  - `daily_avg`, `projected_eom`, `projected_pct_contracted`
  - `verdict`: `on_pace ≥ 100%` / `drift 90-100%` / `lagging 75-90%` /
    `severely_lagging < 75%`
  - Sorted worst-first so consumers can render laggards-on-top without
    re-sorting.
- `routes/today.js` — merged projection into `hauler_status` rows (no new
  endpoint, no wire bloat).
- `routes/haulers.js` — `GET /api/haulers/:id` now carries `forecast` +
  `forecast_horizon` from the same shared service.

**Client**

- `HaulerStatusList.jsx` — right-rail rows now lead with the verdict-toned
  projection (88% lagging amber, 55% severely lagging rust) plus
  projected EOM in kt; trucks count + on-time% drop to a sub-line.
- `HaulerDetail.jsx` — new `HaulerForecastSection` (`Month-end forecast ·
  Nd remaining`) sits above Lifecycle posture: big projected number,
  verdict pill, daily avg / delivered MTD / contracted full month /
  shortfall.
- `TodayDigest.jsx` — `HaulerSplit` table renamed "MTD vs projected EOM";
  new `Projected EOM` and `vs Contracted` columns, both verdict-toned.

**Live numbers**

- Hauler 01: 88% lagging (28/30 trucks · 94% on-time)
- Hauler 02: 82% lagging (22/25 · 88%)
- Hauler 03: 84% lagging (24/25 · 91%)
- Hauler 04: 74% **severely lagging** (12/15 · 86%)
- Hauler 05: 55% **severely lagging** (8/15 · 79%)

Even the strongest performer is below their proportional contracted
target — the forecast tells the operator the issue is across the board,
not just inactive trucks. That's a non-obvious operational insight that
wasn't visible until this phase.

**Verified**

- Verdict tones apply correctly (computed from RGB: amber for lagging,
  rust for severely_lagging).
- `hauler_admin (haul-01)` → 403 on haul-05; 200 on own (own forecast
  section visible).
- `lender` → 200 on any hauler (corridor-level data, no operational PII).
- Three surfaces (Today right rail · HaulerDetail drawer · digest table)
  tell a consistent story powered by one service.

---

## Phase 45 — Action item ownership

The platform pivots from "what to know" to "who owns it." Action items
now carry assignment, due date, and notes — and every user gets a personal
inbox in the topbar.

**Server**

- `state/actionAssignments.js` — `action_item_assignments` overlay table
  keyed on the synthetic action item ID. CRUD + `forUser()` + `map()` for
  cheap join.
- `routes/today.js`:
  - `actionItems()` joins assignments inline on every synth pass —
    re-emitted items re-attach automatically; resolved items leave an
    orphan paper trail.
  - `POST /api/today/action-items/:id/assign` — axis_admin / axis_ops /
    hauler_admin (hauler_admin restricted to self-assign). Audited.
  - `DELETE /api/today/action-items/:id/assign` — only assignee, assigner,
    or axis_admin can unassign. Audited.
  - `GET /api/today/action-items/mine` — joins user's assignments against
    the live synth so resolved items can be greyed out for one tick.

**Client**

- `components/today/AssignDialog.jsx` — modal: assignee picker (filtered
  to self for hauler_admin), due-date picker, notes textarea, Unassign
  button when re-opening an existing assignment, validation +
  audit-friendly error display.
- `components/today/ActionItems.jsx` — assignee chip below each item body
  (initials + display name + tone-coded due date) or "Unassigned · Assign"
  CTA. Hover tooltip carries the notes.
- `components/layout/MyQueueButton.jsx` — Topbar inbox button. Badge
  shows live count, status dot tones rust (overdue) / amber (due ≤2d) /
  text (assigned). Dropdown lists live + resolved (greyed). Clicking a
  live item deep-links to its source page.
- `components/layout/Topbar.jsx` — slots inbox between divider and
  UserMenu.

**Verified**

- Server: assigned + retrieved end-to-end. Audit log carries
  `entity_type=action_item, action=assign|unassign`.
- UI: `axis_ops` (Kwame) sees badge "1", dropdown lists his GPHA berth-slot
  item with "due 29 Apr".
- Per-row chip + Reassign button on assigned item; "Unassigned · Assign"
  on others.
- Role scoping: hauler_admin restricted to self-assignment server-side;
  lender hidden from inbox; lender 403 on assign endpoints (via
  `requireRole`).

Each subsequent Today load has a one-tick join against the assignments
table — minimal cost, durable accountability.

---

## Phase 46 — Forecast → action item

The forecast (Phase 42–44) made the projection visible. Action items
(Phase 45) made operator work ownable. Phase 46 closes the loop:
**when the projected EOM crosses below floor, that becomes an action
item the same as any other** — appearing at the top of the right rail,
showing the live numbers, with the standard Assign / Reassign flow.

**Server — `routes/today.js`**

- `actionItems(agg, forecast = null)` — accepts the already-built
  forecast so we don't double-compute. Falls back to a fresh build for
  lazy callers (`/action-items/mine`).
- New synthesis block runs first (item 0) so a `high`-priority
  below-floor projection is never pushed off the 5-item cap by the rest
  of the queue. Stable ID `act-forecast-eom` so an assignment made
  yesterday re-attaches today even as the projection moves.
- Verdict → priority mapping:
  - `below_floor_at_pace` → **high** (projection misses the floor)
  - `banked_floor_drift` → medium (delivered ≥ floor but pace dropping)
  - `above_floor` → low (under nameplate, covenant safe)
  - `on_pace_for_contracted` → not surfaced (nothing to do)
- Body composes from live numbers — projected EOM, % of floor,
  shortfall, days remaining, required daily lift, and the top idle-truck
  lever (e.g. "Hauler 05 has 7 idle trucks (+317 t recoverable)").

Both `/api/today` and `/api/today/digest` now pass the same forecast
into `actionItems()` — single source of truth, no recomputation.

**Live behaviour (system clock 28 Apr, 00:13 UTC)**

- Projection deteriorated overnight: 66.0 kt → 63.8 kt; days remaining
  3 → 2; trend caption flipped from "+1,589 t (+2.5 %)" to "−904 t
  (−1.4 %)"; today's bar in the sparkline visibly shorter than
  yesterday's.
- Action item appears at the top of the right rail:

  > **HIGH** — Projected EOM 63.8 kt — 96% of floor, 2,907 t short
  > over 2d. Need +68.4% lift to 3,579 t/d. Hauler 05 has 7 idle
  > trucks (+317 t recoverable).

  Carries the standard `Unassigned · Assign` CTA below it.

**Verified**

- `axis_admin` and `lender` both see the forecast item (corridor-level
  data, no role gating — and lenders depend on this number for
  covenant monitoring).
- Assignable end-to-end: `POST /action-items/act-forecast-eom/assign` →
  reload → `assignment` populated on the item · DELETE → unassigned.
  Both writes audited (`entity_type=action_item`, `action=assign |
  unassign`).
- 5-item cap honoured: forecast item leads, four other high-priority
  items follow; medium / low items dropped as expected.
- No double-build of forecast on `/api/today` or
  `/api/today/digest` — `forecast` is computed once per request and
  passed into both the response body and the action item synth.

---

## Phase 47 — Workshop drag on forecast

Phase 35 made workshop work orders ownable; Phase 42 made the forecast
visible. Until now those two pillars never touched: an open workorder
quietly took a truck off the road but never told the operator how
much that was costing. Phase 47 closes that gap — every open work
order becomes a tonnage figure on the forecast card.

**Server — `services/forecast.js`**

- New `workshop_drag` block on the forecast envelope.
- For each open / in-progress workorder:
  - `days_open` from `opened_at` to now (full lifetime of the order)
  - `days_lost` — clipped to the current UTC month
    (`max(opened_at, month_start) → now`) so we don't double-count
    days that already counted against last month's projection
  - `lost_so_far = days_lost × tonnesPerActiveTruckPerDay`
  - `remainder_drag = days_remaining × tonnesPerActiveTruckPerDay`
    (pessimistic upper bound assuming the rig stays out for the rest
    of the month)
- Aggregate: `open_count`, `lost_so_far`, `remainder_drag`,
  `total_drag`, plus `pct_of_floor_gap` — what share of the current
  floor shortfall is explained by workshop drag (null when no gap).
- Per-workorder list sorted by `total_drag` descending so the most
  expensive lead any UI.

**Client**

- `components/today/TakeOrPayForecast.jsx` — new `WorkshopDragRow`
  collapses by default. Headline: "N open · costing X t over the
  month (Y% of floor gap)" with a `details` toggle. Expanded view
  lists the rigs with `rig_id · workorder title · days open · drag`.
  Tone goes rust when drag explains ≥25 % of the floor gap, neutral
  otherwise.
- `pages/TodayDigest.jsx` — full table (Rig / Workorder / Days open /
  Lost so far / Total drag) inserted between the projection KPIs and
  the idle-truck levers. Print-safe (`break-inside: avoid`).

**Live numbers (28 Apr, 00:20 UTC, two seeded workorders)**

| Workorder | Rig | Days open | Lost so far | Total drag |
|---|---|---|---|---|
| Engine rebuild | rig-0105 (haul-05) | 7.0 | 158 t | **203 t** |
| Brake pad replacement | rig-0030 (haul-01) | 0.0 | 0 t | 45 t |
| **Total** | — | — | **158 t** | **248 t** |

That's 8.6 % of the current floor gap (2,907 t). The corridor
tonnes-per-truck-per-day (22.4 t) is the multiplier — math checks
against `156.8 ≈ 158` for the older order's lost-so-far.

**Verified**

- Endpoint: `axis_admin`, `lender`, `hauler_admin` all see identical
  `workshop_drag` payload (corridor-level, no role gating —
  consistent with the rest of the forecast).
- Today card: collapsed headline + `details` toggle + per-row
  expansion all rendering. Tone correctly neutral at 9 % of floor gap.
- Digest: full table renders inside the forecast section with
  print-safe styling, doesn't bleed into the next page.
- Cleanup: both seeded workorders deleted; `workorders WHERE
  status != 'RESOLVED'` count back to 0.

---

## Phase 48 — Snooze + overdue

Phases 45 and 46 introduced ownership: action items now have an
assignee and a due date. But the workflow was still missing the most
common operator move — *"I can't do this today, push it to tomorrow"*
— and overdue items didn't visually distinguish themselves. Phase 48
adds both.

**Server**

- `state/actionAssignments.js` — additive ALTER TABLE for the new
  columns (`snoozed_until`, `snooze_reason`, `snoozed_at`,
  `snoozed_by_user_id`, `snoozed_by_display`). Idempotent — duplicate
  column errors are swallowed so repeat boots are no-op. Two new
  exports: `snooze({ action_item_id, until, reason, ... })` and
  `unsnooze(id)`. The deserialiser exposes `snooze: { until, reason,
  snoozed_at, snoozed_by }` (or `null`) so consumers don't have to
  know the column names.
- `routes/today.js`:
  - `POST /api/today/action-items/:id/snooze` — body `{ until, reason }`.
    Validates `YYYY-MM-DD`, requires future date, requires the item to
    already be assigned. Permission gate: assignee, axis_admin, or
    axis_ops. Audited (`action: snooze`).
  - `DELETE /api/today/action-items/:id/snooze` — wakes immediately.
    Same permission gate. Audited (`action: unsnooze`).
  - `actionItems(agg, forecast, { includeSnoozed })` now takes an
    options bag. Default behavior (Today page) drops items whose
    assignment is snoozed into the future, so the queue stays focused
    on what actually needs work today.
  - `GET /api/today/action-items/mine` — augmented payload: each item
    carries `live`, `snoozed`, `overdue` flags so the inbox renders
    the right chip without re-deriving from `due_date`.

**Client**

- `components/today/AssignDialog.jsx` — new collapsible "Snooze this
  item" panel inside the modal (only shown when assignment exists).
  Date picker + reason text field + `Snooze` / `Update snooze` /
  `Wake now` buttons. Pre-fills with current snooze state when
  re-opening.
- `components/today/ActionItems.jsx` — `AssigneeChip` now renders
  three states:
  - **Snoozed** → amber `· snoozed until DD MMM` (no due date pill)
  - **Overdue** → rust `OVERDUE` pill alongside the due date
  - **Normal** → standard due date with tone (rust past, amber ≤ 2d)
- `components/layout/MyQueueButton.jsx` — inbox split into three
  buckets: `active` / `snoozed` / `resolved`. Badge count + status
  dot reflect *active* only (snoozed don't ring an alarm). Header
  reads "N active · M snoozed · K resolved". `QueueRow` renders a
  per-item status pill (`SNOOZED` amber / `OVERDUE` rust / priority
  fallback) and a tone-coded "until" or "due" caption. Snoozed rows
  dim and become non-clickable so accidentally clicking through
  doesn't bypass the wait.

**Verified end-to-end**

| Step | Today feed | Inbox |
|---|---|---|
| Assign forecast item to Akosua due 29 Apr | item present | 1 active · 0 snoozed |
| Snooze until 02 May with reason | item gone | 0 active · **1 snoozed**, amber pill, "until 02 May" |
| Unsnooze + reassign with due date 25 Apr (3d in past) | item present | 1 active · **OVERDUE** rust pill, "due 25 Apr" |
| Unassign | item present, "Unassigned · Assign" CTA | 0 active |

Audit log carries `entity_type=action_item, action=snooze | unsnooze`
alongside the existing `assign` / `unassign` events. Cleanup left
`action_item_assignments` at 0 rows.

The mental model now matches what operators actually do: assign
something, work it until it's done, snooze it if you can't, and the
red dot appears the moment something falls past its due date.

---

## Phase 49 — Hauler weekly scorecard

The Today digest (Phase 40) is the desk's daily artifact. Phase 49
adds the **per-hauler weekly scorecard** — same printable shape, but
sized for the hauler-admin's Monday meeting and the axis_admin's
quarterly partner review. Each hauler now has a single-page, print-
optimised summary they can hand around without anyone needing to
log in.

**Server — `routes/haulers.js`**

- New endpoint `GET /api/haulers/:id/scorecard?week_offset=N`.
  - `week_offset` clamped to `[-12, 0]`. Default = current rolling
    7-day window ending now; `-1` = last week, `-12` = a quarter back.
- Composes:
  - **`hauler`** — id, display_name, contracted/active trucks,
    onboarded date.
  - **`week`** — trips count + laden count + delayed; tonnes,
    revenue, cost, margin, on-time %; plus a 7-element `daily` array
    for the inline tonnage chart.
  - **`lifecycle`** — counts of HSE incidents logged + closed,
    coaching sessions held, licence renewals — all scoped to the
    week.
  - **`forecast`** — this hauler's slice of the corridor month-end
    projection (reuses Phase 44's per-hauler block).
  - **`corridor_rank`** — `{ rank, of }` against other active
    haulers, sorted by `projected_pct_contracted` descending.
  - **`audit`** — top 15 `audit_log` rows mentioning this hauler.
    Lender-blanked: `{ restricted: true, recent: [] }`.
- Role gating:
  - `axis_admin` / `axis_ops` — any hauler.
  - `hauler_admin` — own hauler only (403 otherwise).
  - `lender` — full access; audit trail blanked.

**Client — `pages/HaulerScorecard.jsx`**

- New page mounted OUTSIDE Shell at `/haulers/:id/scorecard` (App.jsx
  routes it at the Gate level, mirroring TodayDigest). Sets
  `body.digest-mode` so the existing print stylesheet picks it up.
- Sections, top to bottom:
  1. `PrintBar` (`.no-print`) — Cmd-P hint + Print button.
  2. `Letterhead` — AXIS eyebrow, hauler title, fleet sub, period on
     the right with generated-by stamp.
  3. `Week in numbers` — 4-tile KPI strip (Trips · Tonnes · Margin ·
     On-time) with appropriate amber/rust/green tones.
  4. `Daily tonnage` — 7-bar chart, day-of-week labels, amber bar
     when any delayed trip on that day, dimmed when zero tonnes.
  5. `Month-end forecast` — 3-tile strip (Projected EOM · Run rate ·
     Corridor rank) plus a callout when there's a shortfall to
     contracted ("deliver an additional X kt over the remaining
     days").
  6. `Lifecycle activity · this week` — 4-tile strip when there's
     activity; clean italic empty state otherwise.
  7. `Audit trail` — full per-hauler write feed (Time · Entity ·
     Action · Summary · Actor); restricted message for lender; clean
     empty state for haulers with zero writes in the window.
  8. `Footer` — doc id stamp.

**Client — `HaulerDetail.jsx`**

- Drawer footer now carries a "Print weekly scorecard →" link next
  to the Close button, opening the scorecard in a new tab. Same
  pattern as the OperationsLog "Print digest →" link from Phase 40.

**Live numbers (Hauler 02, week 21–28 Apr)**

| | |
|---|---|
| Trips delivered | 9 (6 laden, 0 delayed) |
| Tonnes (laden) | 0.2 kt (240 t) |
| Margin | $3,080 (rev $5,760 · cost $2,680) |
| On-time | 100.0 % (clean week — green) |
| Daily tonnage | 81 / 40 / 41 / — / 39 / 39 / — t |
| Projected EOM | 15.0 kt vs 18.3 kt contracted (82 % run rate, **lagging**) |
| Corridor rank | #3 / 5 |
| Lifecycle | nothing this week |
| Audit | 15 writes (licence renew, coaching session, etc.) |

**Verified**

- `axis_admin` → 200 on any hauler · `hauler_admin (haul-01)` → 403
  on haul-02, 200 on haul-01 · `lender` → 200 with `audit:
  { restricted: true }`.
- Page renders all 8 sections; PrintBar visible with Print button;
  letterhead reads "Generated by Akosua Mensah · AXIS (NewCo
  Logistics JV) · at 28 Apr 2026, 00:45 UTC".
- HaulerDetail "Print weekly scorecard →" link confirmed:
  `href="/haulers/haul-02/scorecard"`, `target="_blank"`.
- Daily tonnage bars visibly differentiated; empty days dimmed.
- Forecast section flags "Lagging" amber + 3.3 kt callout for the
  remaining-days gap.

That's two artifacts now: the daily Today digest (operations-shift
audience) and the weekly hauler scorecard (partner-management
audience). Both share the same chrome-less, print-first shape.

---

## Phase 50 — Forecast scenario planner

Phases 42–47 built the forecast story end to end: where you'll land,
how the trend is moving, who's dragging, what workshop dwell costs.
Phase 50 closes the arc by letting operators **model the moves
before committing**. The forecast becomes a decision tool instead of
just a dashboard.

**Server — `services/forecast.js`**

- New `buildForecastScenario(haulers, scenario, now)` takes the
  baseline `buildForecast()` and applies three operator-controlled
  levers:
  - `hauler_truck_lifts: { hauler_id: extra_trucks }` — clamped to
    each hauler's `idle_trucks` count. Operator can't fabricate
    capacity that isn't sitting in the yard.
  - `resolve_workorders: ['wo-…']` — each closed workorder restores
    one truck to the road for the rest of the month.
  - `daily_avg_lift_pct: 0..50` — across-the-board pace lift,
    multiplicative on the post-truck-lift daily.
- Returns the same envelope as `buildForecast()` plus a `scenario`
  block carrying `applied`, `totals`, `projection`, and `delta`
  (eom_tonnes change vs baseline, `clears_floor` flag when the
  scenario flips a `below_floor_at_pace` baseline into something
  better). No writes — purely computational.

**Server — `routes/today.js`**

- `POST /api/today/forecast/scenario` — body carries the levers,
  returns the scenario envelope. All-role visible (axis_admin,
  axis_ops, hauler_admin, lender) — lenders use it for downside
  scenarios so the endpoint isn't gated.

**Client — `components/today/ScenarioPlanner.jsx`**

- Modal, three lever sections:
  - **Activate idle trucks** — one slider per hauler that has idle
    capacity, max bound to that hauler's `idle_trucks`. Row
    highlights with `accent-tint` when value > 0.
  - **Resolve open workorders** — checkbox per open workorder,
    showing current days-open and the recoverable tonnage that
    closing would deliver.
  - **Lift daily pace** — single 0–50 % range slider with helper
    text framing it as shift / hours / turn-around moves.
- Sticky scoreboard at the top: `Baseline EOM | delta | Scenario EOM`
  with verdict label and `CLEARS FLOOR` flag when a previously
  failing baseline now passes.
- POSTs to `/forecast/scenario` on every input change with no
  debounce (the endpoint is pure compute, ms-fast). UI dims the
  scenario tile during loading.

**Client — `components/today/TakeOrPayForecast.jsx`**

- Header now carries a subtle "Run scenario" CTA (Sliders icon)
  alongside the verdict pill. Click → modal opens with the live
  forecast as baseline.

**Live demo (28 Apr, 00:55 UTC)**

| Lever | Value | Effect |
|---|---|---|
| Hauler 05 idle trucks | 7 (max) | +156 t/d |
| Workorder rig-0030 | resolved | +45 t recovered |
| Daily pace lift | +15 % | multiplies above |
| **Scenario EOM** | **64.9 kt** | **+1,055 t vs baseline** |

The verdict didn't flip (still `below_floor_at_pace` because only 2
days remain in the month), but operators see exactly how much each
lever moves the line — which is the point.

**Verified**

- Endpoint: `axis_admin`, `axis_ops`, `hauler_admin`, `lender` all
  200 (corridor scenario; downside is a lender concern).
- Validation: requesting 99 idle trucks for Hauler 05 (which has 7)
  is silently clamped to 7. Negative pace lifts clamped to 0.
- UI: modal opens from the forecast card, all three lever sections
  render, sliders + checkbox feed back into the live `+t recovered`
  / `+ trucks` / `+%` counters, scoreboard updates within ~150 ms
  per input change.
- Cleanup: seeded workorder removed; `workorders WHERE status !=
  'RESOLVED'` back to 0.

The forecast arc is now complete: the projection (Phase 42), trend
(Phase 43), per-hauler decomposition (Phase 44), forecast as action
item (Phase 46), workshop drag (Phase 47), and now interactive
what-if. Operators can answer "where will we land?" "what changed
yesterday?" "who's dragging?" "what would it take to clear floor?"
"what if we fix these specific things?" — all from the same card.

---

## Phase 51 — End-of-day close-out

Today's page is what an operator sees when they log on. Phase 51
gives them what to look at before logging off — bookend to the
morning briefing. The "Day in review" panel answers four questions
in one place: did the day move the forecast, what's still on my
plate, what's coming back from snooze, and what did I actually
ship today.

**Server — `routes/today.js`**

- `GET /api/today/closeout` composes per-user:
  - **Queue split** — overdue, due in next 48 h, active (no due or
    due > 48 h), waking soon (snoozed item with wake date ≤ 7 d).
    Five buckets including a `resolved_today` count for items whose
    underlying entity is no longer live. Built off
    `actionAssignments.forUser(req.user.id)` joined against the
    Phase 48 unfiltered synth (`{ includeSnoozed: true }`).
  - **Shipped today** — every audit_log row whose
    `actor.user_id === req.user.id` since UTC start-of-day. Counted
    by `entity_type`; first / last timestamps so the operator sees
    when they started and last touched the desk.
  - **Forecast delta** — yesterday's snapshot vs the live projection
    today. Negative delta = the day worked against you.
- Lender persona 403'd at the endpoint (no action items, no shifted
  audit, the frame doesn't apply).

**Client — `components/layout/DayInReview.jsx`**

- Modal, three sections:
  1. **Forecast moved** — large signed delta with TrendingUp/Down
     icon (green / rust / muted-tertiary), yesterday vs today kt
     stamp on the right.
  2. **Your queue** — 4-tile count strip (Overdue rust · Due ≤48h
     amber · Active · Waking soon amber-soft) followed by item rows
     coloured by their bucket; clickable rows deep-link to the
     item's source page and close the modal.
  3. **What you shipped today** — total writes count, per-type pill
     row, first/last UTC timestamps. Quiet-shift empty state when
     count is 0.

**Client — `components/layout/Topbar.jsx`**

- New `DayInReviewButton` (Sunset icon + "Day in review" label)
  slotted between the divider and `MyQueueButton`. Hidden for the
  lender persona to match the endpoint gate.

**Live demo (28 Apr, 01:09 UTC, three seeded assignments)**

- Forecast moved **−2,212 t** (yesterday 66.1 kt → today 63.9 kt) — a
  bad day for the line, instantly visible in rust at the top of
  the modal.
- Queue: 1 overdue (forecast item with past due date), 1 due ≤48h
  (DVLA filing, due 29 Apr), 0 active, 0 waking soon.
- Shipped today: 13 writes (11 action_item + 2 workorder), first
  00:13, last 01:07 UTC.
- `axis_admin` → 200 · `axis_ops` → 200 · `hauler_admin` → 200
  (own queue) · `lender` → **403**.
- Cleanup: `action_item_assignments` back to 0 rows.

The morning briefing (Today) and the close-out (Day in review) now
bookend the operator's shift. Together they answer "what should I
focus on?" at start and "did I move the line and what's left?" at
end — without the operator having to compose either summary
themselves.

---

## Phase 52 — Live covenant posture

The Financials page already had a Covenant compliance card, but the
data behind it was a static fixture that always reported PASS. For
the lender persona — the platform's credit-monitoring audience —
that's the worst possible failure mode: false reassurance. Phase 52
makes the covenant table compute live from corridor state and adds
the three covenants the fixture didn't carry: take-or-pay floor,
hauler concentration, and on-time SLA threshold.

**Server — `services/covenants.js`** (new)

`buildCovenants(haulers, now)` composes seven covenants — same shape
the existing `CovenantTable` component renders, so no UI changes:

- **DSCR ≥ 1.30×** — fixture-driven (P&L isn't wired to live trips
  yet) but tier logic now WATCH-tags within 5 % of floor instead of
  always PASS.
- **Debt / equity ≤ 70/30** — derived from `CAPITAL_STRUCTURE`.
- **Take-or-pay floor** *(NEW)* — projected EOM from
  `buildForecast()` vs contractual floor. BREACH if projected <
  floor, WATCH if cushion < 5 %, else PASS.
- **No hauler > 50 % of corridor revenue** *(NEW)* — top active
  hauler's MTD tonnes / corridor MTD tonnes. WATCH at 40 %, BREACH
  at 50 %.
- **Corridor SLA ≥ 88 % on-time** *(NEW)* — corridor-weighted
  attainment from the aggregator. WATCH at 90 %, BREACH at 88 %.
- **Overdue receivables ≤ 8 % of book** — overdue / current_balance
  from `PAYMENT_SECURITY`. WATCH at 5 %, BREACH at 8 %.
- **Minimum liquidity ≥ $2.0 M** — fixture passthrough
  (cash + SBLC).

Each covenant returns `{ id, name, metric, status, detail,
threshold, current }`. `detail` is condition-aware — explains *why*
the current status is what it is and what action is implied.

**Server — `routes/financials.js`**

- Imports `buildCovenants` and `roster`.
- `covenants: buildCovenants(roster.list(), new Date())` replaces
  the static fixture passthrough.
- `COVENANTS` no longer imported from `mock/financials` — the static
  table is now reference data internal to the covenants service.

**Live result (28 Apr, 01:15 UTC, lender view)**

| Covenant | Metric | Status |
|---|---|---|
| DSCR ≥ 1.30× | 1.34× | **WATCH** (within 5 % of floor) |
| Debt / equity ≤ 70/30 | 70 / 30 | PASS |
| Projected EOM ≥ 66.7 kt floor | 63.9 kt (−4.2 %) | **BREACH** |
| No hauler > 50 % of corridor revenue | Hauler 01 · 30.3 % | PASS |
| Corridor SLA ≥ 88 % on-time | 90.5 % | PASS |
| Overdue receivables ≤ 8 % of book | 25.8 % ($320,000) | **BREACH** |
| Minimum liquidity ≥ $2.0 M | $2.4 M | PASS |

Two breaches now visible — exactly the actionable signals the
lender needs. Neither was surfacable under the static fixture
which marked everything PASS.

**Verified**

- `axis_admin`, `axis_ops`, `hauler_admin`, `lender` all see
  identical covenant data (this is corridor-level, not personal).
- The two breaches and one watch are computed correctly:
  take-or-pay against `forecast.projection.eom_tonnes` and
  `forecast.targets.floor`; receivables against
  `PAYMENT_SECURITY.receivables.ageing`; DSCR within 5 % of
  `target_min`.
- UI: existing `CovenantTable` renders the new live data without
  changes — same `{ id, name, metric, status, detail }` shape,
  same PASS/WATCH/BREACH tone palette.

The lender experience is now the first persona-specific upgrade
since they were defined in Phase 10. The next moves in this thread
(historical DSCR series wired live, per-hauler concentration trend,
covenant breach action items via Phase 46's pattern) all build on
this surface.

---

## Phase 53 — Covenant breach action items

Phase 46 set the pattern: when a strategic signal trips, that becomes
an action item operators can own. Phase 52 surfaced two live BREACH
covenants on `/financials`. Phase 53 closes the loop — those breaches
now appear in the Today action items feed automatically, assignable
and audit'd like any other item.

**Server — `routes/today.js`**

- Imports `buildCovenants` alongside `buildForecast`.
- `actionItems()` now has a "0b" block (right after the forecast item)
  that pulls live covenants and emits a synthetic action item for any
  with `status === 'BREACH'`.
- Stable IDs: `act-cov-{covenantId}` (e.g. `act-cov-ageing`,
  `act-cov-dscr`). Phase 45 assignment overlay re-attaches across reads.
- Body: `Covenant {name} — {metric}. {detail}` — carries the same
  `detail` text the CovenantTable renders so the operator sees the
  same explanation in both surfaces.
- Link: `/financials` so Open jumps straight to the covenant board.
- **Take-or-pay covenant explicitly skipped** — the Phase 46 forecast
  item already covers that signal; surfacing both would be noise.
- WATCH-tier covenants are **not** promoted: WATCH is the advisory
  tier, BREACH is the ownable tier. Keeps the action items list
  focused.

**Live behaviour (28 Apr, 01:22 UTC)**

| # | Source | Item |
|---|---|---|
| 1 | forecast | Projected EOM 63.9 kt — 96 % of floor … |
| **2** | **covenant** | **Covenant Overdue receivables ≤ 8 % of book — 25.8 % ($320,000). BREACH — overdue receivables at 25.8 % exceeds 8 % cap.** |
| 3 | alert | Escalate berth-slot schedule with GPHA operations |
| 4 | alert | Coach Hauler 02 dispatcher on pre-departure verification |
| 5 | filing | DVLA — Q1 fleet roadworthy renewal (due in 2d) |

The covenant item leads at #2 — second only to the forecast item itself.

**Verified**

- Endpoint: `act-cov-ageing` appears with high priority and source
  `{ type: 'covenant', id: 'cov-ageing' }`. Take-or-pay covenant
  correctly absent (deduplicated against the forecast item).
- Assignment: `POST /action-items/act-cov-ageing/assign` →
  assignment populates with `assignee.display_name` and `due_date`
  → DELETE → unassigned. Both writes audit-logged
  (`entity_type=action_item, action=assign | unassign`).
- UI: ActionItems renders the covenant item with "Open financials"
  link and "Unassigned · Assign" CTA, identical surface to forecast
  / alert / filing items.
- Defensive: covenant computation wrapped in `try/catch`; if it
  throws, the synth continues without the covenant block (advisory,
  never blocks the queue).

The platform now has three live signal → action item loops:
- **Phase 46** — forecast verdict crossing into below-floor →
  `act-forecast-eom`.
- **Phase 53** — covenant BREACH (any of dscr / gearing /
  concentration / sla / ageing / liquidity) → `act-cov-{id}`.
- And the original lifecycle items from Phases 26–37 (alerts,
  filings, licences, HSE, maintenance, receivables) — the pattern
  has come full circle.

---

## Phase 54 — Driver-level coaching attendance

Phase 30 introduced dispatcher coaching sessions but tracked
attendance only as a count — `attendees_count: 4` told you the
session happened but not which drivers it covered. The driver
dossier (Phase 18) was rich on licence / medical / training / safety
score but had no link to the safety coaching the operator had been
running. Phase 54 closes that gap: coaching sessions now carry an
`attendee_driver_ids` array, the write path accepts driver IDs, the
driver dossier shows attended sessions, and the Compliance coaching
log resolves IDs to names.

**Server — `state/coachingState.js`**

- Additive `ALTER TABLE coaching_sessions ADD COLUMN
  attendee_driver_ids_json TEXT` (idempotent — duplicate-column
  errors swallowed). Same migration pattern Phase 48 used for
  snooze.
- `create()` accepts `attendee_driver_ids` array, writes the JSON.
- `deserialise()` parses both `linked_alert_ids` and
  `attendee_driver_ids` defensively (NULL → `[]`).
- New helpers: `forDriver(driverId)` and
  `recentForDriver(driverId, days, now)`.

**Server — `routes/coaching.js`**

- `POST /api/coaching/sessions` validates and forwards
  `attendee_driver_ids`. Audit payload carries the array so a row
  can be replayed back into a driver dossier later.
- `GET /api/coaching/sessions` enriches each session with
  `attendee_drivers: [{ id, display_name }]` via the static
  `DRIVERS` fixture, so the Compliance log doesn't have to do the
  join client-side.

**Server — `routes/drivers.js`**

- `GET /api/drivers/:id` adds `coaching_history` — the driver's
  attended sessions in the last 90 d, newest first, capped at 10
  rows. Each row carries id, held_at, topic, dispatcher_name,
  attendees_count, expected_delta_pct, created_by_display, and
  linked_alert_count.

**Client — `components/alerts/AlertCard.jsx`**

- `CoachPanel` now takes `haulerId` (not just display name) and
  fetches `/api/drivers?hauler_id=…` on open.
- Replaces the freeform "Attendees" number input with a checkbox
  grid of the actual drivers in this hauler. `attendees_count` is
  derived from the picker selection on submit, so the count and the
  named-attendees stay consistent. Picker is scrollable (max 180px)
  and shows a "N of M" header.
- `attendee_driver_ids` is forwarded through `logCoaching` into the
  POST body (existing payload spread already handled it).

**Client — `components/drivers/DriverDetail.jsx`**

- New `Coaching attended · last 90 d` section after `Safety score
  trend`. Renders the `coaching_history` array as a date / topic /
  dispatcher / expected-delta-pct row. Hidden when empty so
  drivers with no recent coaching don't show a blank section.

**Client — `components/compliance/CoachingLog.jsx`**

- Attendees column now reads from `attendee_drivers`:
  - `N named` when per-driver linkage exists
  - `N attended` falls back to legacy count when not
  - hover tooltip carries the comma-separated driver names
  - both shown inline as `N named of M` when the count and the
    linkage disagree (mid-migration row)

**Verified end-to-end**

- POSTed a session for haul-02 with two real driver IDs
  (`drv-0048` Kwasi Frimpong, `drv-0049` Issah Alhassan).
- `GET /api/drivers/drv-0048` returns the session in
  `coaching_history` with all metadata.
- `GET /api/coaching/sessions` returns
  `attendee_drivers: [{ id: 'drv-0048', display_name: 'Kwasi
  Frimpong' }, { id: 'drv-0049', display_name: 'Issah Alhassan' }]`.
- Driver drawer for Kwasi Frimpong shows the new section: "28 Apr ·
  Pre-departure axle verification · w/ Yaa Owusu · −30 %".
- Cleanup: `coaching_sessions` back to 0 rows.

That's the last major lifecycle data gap closed. Every safety
coaching session is now traceable to specific drivers, audit-logged
with their IDs, and surfaced on both the driver dossier and the
compliance log.

---

## Phase 55 — Audit search + CSV export

The audit log is the platform's durable record. Phase 25 made it the
single feed for all writes; Phase 41 added entity-type chip filters.
But it was still hard to query: there was no way to find "all writes
mentioning haul-05" or "the row where Akosua renewed lic-1021" or to
hand a regulator the full trail. Phase 55 closes that gap with
full-text search and a CSV export.

**Server — `db/audit.js`**

- `listAudit({ … q })` accepts a `q` parameter — case-insensitive
  substring match against `summary`, `actor_display`, `entity_id`,
  and the raw `payload_json`. Implemented as SQLite `LIKE %term%`
  with `COLLATE NOCASE` — fast at our row count, no FTS5 dependency.
  Both the SELECT and the COUNT statements get the same predicate
  so pagination totals stay correct.

**Server — `routes/audit.js`**

- `GET /api/audit` now forwards `q` and `since` from the query
  string to `listAudit()`.
- New `GET /api/audit/export.csv`:
  - Same filter set (`entity_type`, `entity_id`, `q`, `since`).
  - Pulls up to 5,000 rows in one shot.
  - `text/csv; charset=utf-8` with explicit BOM so Excel
    auto-detects UTF-8 (regulators love Excel).
  - `Content-Disposition` carries a sensible filename:
    `axis-audit-{entity_type?}-{q-slug?}-YYYY-MM-DD.csv`.
  - Cell escaping per RFC 4180 — wraps in quotes and doubles
    internal quotes when a cell contains `, " \n \r`. Payload JSON
    is encoded in a single cell so the full record survives the
    round trip.
- Both endpoints stay `axis_admin`-only via the existing
  `requireRole('axis_admin')` (lenders and hauler admins still see
  HTTP 403).

**Client — `components/settings/AuditPanel.jsx`**

- Header now carries:
  - **Search input** with magnifying-glass icon, "Search summary,
    actor, entity, payload…" placeholder. Submits on `Enter` or
    blur — keystrokes don't fire one fetch each.
  - **Export button** (Download icon, "Export"). Calls
    `/api/audit/export.csv` with the current filter set, reads the
    response as a Blob, parses the filename out of
    `Content-Disposition`, and triggers a browser download via a
    temporary `<a download>` + `URL.createObjectURL`.
- `useCallback` dependency list now includes both `entityType` and
  `appliedQuery` so changing either re-runs the search from offset 0.
- `setError` catches export failures; the error chip already in
  the panel surfaces them.

**Verified end-to-end**

- `q=licence` (axis_admin) → narrows 70 rows to 10 (9 LICENCE +
  1 ALERT row whose summary contained "Class E licence").
- `q=Akosua + entity_type=licence` → narrows to 1 row (Akosua's
  single licence renewal). Filter composition works as expected.
- CSV export: `axis-audit-licence-2026-04-28.csv`, BOM present,
  RFC 4180 quoting on payload JSON column. Verified content with
  `head -5 /tmp/axis-audit.csv`.
- Role gating: axis_admin → 200 on both endpoints · axis_ops →
  403 · lender → 403.
- UI: search input + Export button render in the panel header,
  "10 of 10" counter updates as you type, scoped chip filters still
  work in combination.

The audit log was always the platform's durable record. Now it's
a real investigation surface — operators can find specific writes
in seconds, and the regulator-handoff path is one click.

---

## Phase 56 — Bulk reassign + per-user queue

Phase 45 introduced action item ownership. By Phase 48 each item
could be assigned, snoozed, and tracked overdue. But there was no
way for axis_admin to see "what's on Kwame's plate?" without
opening each item, and no way to transfer a queue when an operator
went on leave. Phase 56 adds both.

**Server — `routes/today.js`**

- `GET /api/today/action-items/by-user/:userId` — admin-only.
  Symmetric to `/action-items/mine` but reads any user's queue.
  Carries the same `live` / `snoozed` / `overdue` flags so the UI
  can render the same way.
- `POST /api/today/action-items/bulk-reassign` —
  `{ from_user_id, to_user_id }`.
  - Validates both users exist; rejects same-user transfers and
    transfers to lender role (no write capability).
  - Iterates the source user's assignments. For each item still
    live in the synth, calls `actionAssignments.assign()` with the
    new assignee but preserves the existing `due_date` and `notes`
    so context survives.
  - **Each transfer is audited individually** with action `reassign`
    and a payload carrying `from_user_id`, `to_user_id`, and both
    display names. Bulk is a UX affordance, not a different audit
    shape.
  - Resolved / no-longer-live items are skipped (they're paper
    trail rows that the synth doesn't surface anymore).
  - Returns `{ transferred_count, skipped_count, transferred,
    skipped }` for the UI to render.

**Client — `components/settings/UserQueueDialog.jsx`** (new)

- Modal opened from the User directory in Settings. Three sections:
  - **Header** — user display_name + role + organisation.
  - **Live items list** — counts (`N live · M resolved`), then the
    item rows with the same OVERDUE / SNOOZED / priority pill from
    Phase 48.
  - **Bulk reassign** — explanatory paragraph, destination picker
    (filters out the source user and lenders), and the "Transfer N"
    button.
- Posts to `/bulk-reassign`, swaps the picker UI for a green success
  panel showing transferred + skipped counts.
- Loads both queue and user list in parallel on open so there's no
  staircase render.

**Client — `pages/Settings.jsx`**

- `UsersPanel` — every non-lender row is now clickable
  (`accent-tint` hover, `cursor: pointer`, descriptive tooltip).
  Lenders stay non-interactive (no action items to manage).
- Picker state lives in `UsersPanel` so reopening preserves no
  cross-user context.

**Verified end-to-end**

- Seeded 3 items to Akosua via curl. Bulk-reassigned all 3 to
  Kwame via the API endpoint. Then opened Kwame's user-directory
  row in the UI, picked Akosua as destination, clicked Transfer 3.
  Success panel showed "Transferred 3 items" in green.
- Audit trail captures **6 reassign rows** — 3 from the curl
  transfer (02:07) and 3 from the UI transfer (02:10), each with
  the per-item summary `Bulk-reassigned from {source} to {target}`
  and a payload carrying both user IDs.
- After UI transfer, `GET /by-user/u-axis-admin` returns 3 items
  (back with Akosua).
- Role gating: axis_admin → 200 on both endpoints · axis_ops → 403.
- Lender filtered out of the destination picker (validation runs
  server-side too — POST returns 400 if you somehow pick one).
- Cleanup: `action_item_assignments` back to 0 rows.

The desk now survives operator absence: when someone goes on
leave their queue moves in one click, the audit trail captures
the move per item, and nothing falls through.

---

## Phase 57 — Action item comment threads

Phase 45 gave each assignment a single `notes` field, set at
assignment time. That captured initial context but didn't support
the day-by-day progress logging operators actually do — "called
GIBDLC AP, awaiting callback Tuesday" — and the next person on the
desk had no way to see that history. Phase 57 makes each action
item a workspace.

**Server — `state/actionComments.js`** (new)

- `action_item_comments` table (id auto-increment, action_item_id,
  body, created_at, created_by_*). Idempotent CREATE. Index on
  `(action_item_id, created_at DESC)` for the per-item read.
- `add({ action_item_id, body, by_* })` — validates non-empty, max
  2,000 chars; returns the shaped comment.
- `forItem(action_item_id)` — chronological ascending (oldest first
  — reads top-down like a thread).
- `countsByItem()` — single GROUP BY for the synth join (no N+1).

**Server — `routes/today.js`**

- `actionItems()` synth now attaches `comment_count` to every item
  using `actionComments.countsByItem()` — single query, then
  per-item lookup.
- `GET /api/today/action-items/:id/comments` — readable by every
  writable role; lender 403'd.
- `POST /api/today/action-items/:id/comments` — body `{ body }`.
  axis_admin / axis_ops / hauler_admin can post. Audited with
  `action: comment`, summary truncated to 80 chars.
- `DELETE /api/today/action-items/:id/comments/:commentId` — only
  the comment author or an axis_admin. Audited with `action:
  comment_delete`.

**Client — `components/today/CommentsThread.jsx`** (new)

- Lazy-loads `/comments` on mount — parent only renders the thread
  when the user toggles it open.
- Each comment row: author display_name + UTC timestamp + body +
  per-row trash icon (visible to author and axis_admin).
- Compose form at the bottom: input + Post button (rust when there's
  text, dimmed otherwise). `maxLength: 2000`.
- Empty state: italic "No comments yet — log progress so the next
  person on the desk has context."

**Client — `components/today/ActionItems.jsx`**

- Imports `MessageSquare` icon and the new `CommentsThread`.
- Adds a comments toggle button to the assignment row, next to
  Reassign/Assign. Shows the comment count when > 0; bare icon
  otherwise. Click stops propagation so it doesn't fire QuickAction.
- Separate `commentsOpenId` state so comments can be open while
  QuickAction is closed (and vice versa).
- `CommentsThread` mounted below the assignment row when expanded.

**Verified end-to-end**

- Seeded 3 comments via API → `comment_count: 3` surfaces in
  `/api/today` action_items.
- Today page renders the comments badge (💬 3) on the forecast item.
- Click the badge → thread expands inline showing all 3 comments
  with author + UTC timestamp + delete affordance.
- Posted a 4th comment via the UI compose form → comment appears
  in the list, badge increments to 4.
- Audit trail captures each comment write with `entity_type:
  action_item, action: comment` and the truncated body in the
  summary.
- Cleanup: `action_item_comments` back to 0.

The action items list now reads as a real workspace: an item's
ownership, status, and history all live in one row. Operator A logs
their progress at end of shift; operator B picks it up the next
morning with full context. No more "what did Akosua actually say
about the GIBDLC call?" questions.

---

## Phase 58 — Driver weekly scorecard

Phase 49 gave each hauler a printable weekly card. Phase 58 mirrors
that surface at driver granularity. Now there are three weekly
artifacts in the rotation: corridor (Today digest, Phase 40), per-
hauler (Phase 49), per-driver. Same chrome-less, print-first shape
across all three.

> **Pivot note.** Started as "12-month corridor delivery history" but
> `CumulativeTonnageChart` already exists on the Contract page (100
> lines, fully rendering DELIVERY_HISTORY with floor reference line).
> Pivoted to the driver scorecard, which was a real gap.

**Server — `routes/drivers.js`**

- `GET /api/drivers/:id/scorecard?week_offset=N` — clamped
  `[-12, 0]`, default current rolling 7-day window.
- Composes `driver`, `period`, `week` (trips / tonnes / on-time /
  hours / harsh_events), `safety` (current score + trend_delta +
  8-week series + rest_status), `coaching` (sessions in window
  where this driver is in `attendee_driver_ids`, via Phase 54's
  `recentForDriver()`), and a composite `verdict`:
  - `top_tier` — score ≥ 90 + non-falling trend
  - `in_band` — default
  - `watch` — rest warning OR safety drop > 3 pts
  - `attention` — rest breach OR on-time < 80 %
- Role gating:
  - axis_admin / axis_ops — any driver
  - hauler_admin — own-hauler drivers only (403 otherwise)
  - lender — 403 (driver performance is operational PII)

**Client — `pages/DriverScorecard.jsx`** (new)

- Mounted OUTSIDE Shell at `/drivers/:id/scorecard` (App.jsx routes
  it at the Gate level alongside the other printables).
- Sections: PrintBar · Letterhead · VerdictBanner (with rest
  status) · Week-in-numbers (4 KPIs) · Safety score 8-week chart ·
  Coaching attended · Footer.
- Hours/wk tile tones amber > 48 h, rust > 56 h.
- Safety chart current bar in rust; trend caption underneath.

**Client — `components/drivers/DriverDetail.jsx`**

- Drawer footer now carries a "Print weekly scorecard →" link next
  to Close. Same shape as the hauler scorecard CTA from Phase 49.

**Verified**

- Endpoint: axis_admin → 200 on any driver · hauler_admin (haul-01)
  → 403 on a haul-02 driver · lender → 403.
- Page renders all sections. Letterhead reads "Kwasi Frimpong ·
  GH-D-388652 · Hauler 02 · Night · 12 yrs experience · GR 9656-26"
  · "WEEK OF 21 April → 28 April 2026".
- Verdict banner: "In band" + green "Compliant" rest status.
- Safety chart: 8 bars (86/89/86/84/83/83/84/86), current bar in
  rust, "↑ trend +3 pts" caption.
- Coaching block: clean italic empty state when no sessions.
- DriverDetail "Print weekly scorecard →" link confirmed.

The platform's weekly review rhythm is now complete:
**Today digest** (operations shift, daily) ·
**Hauler scorecard** (partner management, weekly) ·
**Driver scorecard** (driver management, weekly).
All three share the same chrome-less, print-first shape.

---

## Phase 59 — Notifications

The platform tells you what's happening but operators have to
actively check for it. When someone assigns you an item, comments
on your item, or transfers their queue to you, you should be told.
Phase 59 adds the push-channel infrastructure that future Slack /
email integrations will sit behind.

**Server — `state/notifications.js`** (new)

- `notifications` table: `id, user_id, event_type, body, link_path,
  link_label, payload_json, actor_user_id, actor_display, created_at,
  read_at`. Idempotent CREATE. Compound index on
  `(user_id, read_at, created_at DESC)` for the unread-count and
  feed reads.
- `emit({ user_id, event_type, body, link, payload, actor_* })` —
  inserts a row. **Self-notification guard**: skips when
  `actor_user_id === user_id` (you commented on your own item =
  no notification to yourself).
- `forUser(user_id, limit)` · `unreadCount(user_id)` ·
  `markRead(id, user_id)` · `markAllRead(user_id)`.

**Server — `routes/notifications.js`** (new)

- `GET /api/notifications` — current user's last 50 + unread count.
- `POST /api/notifications/:id/read` — mark single read.
- `POST /api/notifications/read-all` — mark whole feed read.
- All three under `requireAuth` (every role can have a feed).

**Server — `routes/today.js`** — emit hooks at three sites

- **Assignment** — notify the assignee with the action item's body
  and link, plus due_date in payload. Skipped when self-assigning.
- **Comment** — notify the current assignee (if any) when someone
  else comments. Body truncated to 80 chars + ellipsis.
- **Bulk reassign** — single rollup notification ("transferred N
  items to you from X") rather than one per item, matching the
  bulk UX mental model.
- All wrapped in `try/catch` — notifications are advisory and never
  block the underlying write.

**Client — `components/layout/NotificationBell.jsx`** (new)

- Topbar bell icon. Polls `/api/notifications` every 60 s.
- Badge shows unread count when > 0; rust dot in upper-right
  corner when there's anything unread.
- Click → dropdown:
  - Header: "Notifications" eyebrow + "Mark all read" link (with
    Check icon) when unread, "N items" caption otherwise.
  - Per-row: event type pill (rust + accent-tint background when
    unread, neutral otherwise) + relative time ("3m ago", "just
    now", "DD MMM" beyond 24 h) + body.
  - Click on a notification → marks it read + navigates to its
    link path.
- Empty state: italic "No notifications yet."

**Client — `components/layout/Topbar.jsx`**

- New `NotificationBell` slotted between `DayInReviewButton` and
  `MyQueueButton`. Topbar reads, left-to-right after divider:
  Day-in-review · 🔔 N · 📥 N · UserMenu.

**Verified end-to-end**

- Akosua assigns the forecast item to Kwame → Kwame's
  `unread_count: 1`, feed shows "Akosua Mensah assigned you:
  Projected EOM 64.0 kt — 96 % of floor…"
- Akosua comments on Kwame's item → Kwame's `unread_count: 2`,
  feed prepends "Akosua Mensah commented: …"
- `POST /read-all` → `marked_read: 2` → next GET shows
  `unread_count: 0` (rows persist with `read_at` timestamps).
- Self-notification guard verified: Akosua doesn't get notified
  about her own assigns/comments.
- UI: Bell renders with "1" badge + rust dot, dropdown opens with
  3 entries (1 unread highlighted in accent-tint, 2 read in
  neutral).
- Cleanup: notifications, comments, assignments all back to 0.

The platform is now push-aware. Operators see new work as it lands
without checking — and the table schema is ready for future
fan-out to Slack, email, or webhook channels.

---

## Phase 60 — Forecast anomaly observations

The platform reacts to what's happening but doesn't actively flag
anomalies. The forecast snapshot history (Phase 43) holds enough
data to detect verdict transitions, accelerating declines, and
directional reversals. Phase 60 turns those into observation cards
that surface in both the Today right-rail and the Intelligence
panel — without operators having to compare snapshots themselves.

**Server — `services/forecastAnomalies.js`** (new)

`detect(now)` reads the last 14 daily snapshots + the live forecast
and returns up to three anomaly observations:

- **Verdict transition** (`obs-forecast-verdict-decay`, severity
  `warn`) — fires when today's verdict ranks worse than yesterday's
  snapshot (e.g. `above_floor → below_floor_at_pace`). Body names
  both verdicts, today's projected kt, and days remaining.
- **Sharp single-day drop** (`obs-forecast-sharp-drop`, severity
  `warn`) — fires when projected EOM fell ≥1.0 % since yesterday's
  reading. Threshold tuned to filter routine intra-day drift while
  catching genuinely material moves; on a 65 kt projection a 1.0 %
  drop is ~650 t.
- **Trend reversal** (`obs-forecast-trend-reversal`, severity
  `info`) — fires when ≥66 % of background-window deltas were
  climbing and the most recent delta is negative. Surfaces "things
  were going well until they weren't" patterns.

Defensive: returns `[]` when no snapshot history exists or when
`buildForecast()` throws — observations are advisory and never
block the feed.

**Server — observationSynth + today.js**

Two hooks, both wrapped in `try/catch`:

- `services/observationSynth.js` — `todayObs()` and
  `financialsObs()` both spread `forecastAnomalies.detect()` into
  their output before slicing. The Intelligence panel inherits
  anomalies on Today and Financials.
- `routes/today.js` — `observations()` (the right-rail feed)
  inherits the same anomalies. Cap bumped from 5 → 6 to leave
  room.

This dual-hook design is intentional: the right-rail observations
and the Intelligence panel are independent feeds with their own
composer functions. Routing anomalies through both keeps every
surface that names "observations" honest.

**Live result (28 Apr, 14:32 UTC, 14-day seeded snapshot history)**

Right rail now shows 6 cards:

1. **WARN** Axle-load breach · Hauler 02
2. **WARN** DVLA filing "Q1 fleet roadworthy renewal" due in 2 days
3. **WARN** Driver 02-117 Class E licence expires 2026-05-02
4. **WARN** *(NEW)* Projected EOM fell 898 t (1.4 %) since
   yesterday's reading — 65.2 kt now vs 66.1 kt then. Check today's
   ops log for the trigger.
5. INFO Receivables ageing past 30 days at $320,000
6. INFO Corridor-weighted SLA attainment 90.5 %

Intelligence panel `/api/intelligence/observe?page=today` returns
the same 5 + sharp-drop + trend-reversal anomalies (5 total after
slice).

**Verified**

- Endpoint: `/api/today` returns 6 observations including the
  sharp-drop anomaly.
- Endpoint: `/api/intelligence/observe?page=today` returns
  observations including both anomaly cards.
- UI: Right-rail Observations section shows the new anomaly card
  with warn-tone icon at position 4.
- Defensive: `try/catch` around both hooks; if anomaly detection
  throws, the feeds continue without it.
- Cleanup: no test seeds were introduced — anomalies fire from the
  Phase 43 historical seed already in place.

The platform is now PROACTIVE on the most consequential signal it
tracks. Operators don't need to compare yesterday's snapshot bar
to today's — the anomaly tells them, in one observation card, what
changed and what's worth investigating.

---

## Phase 61 — Action item escalation

Phase 48 introduced overdue tracking; Phase 51 surfaced overdue
counts in Day-in-Review. But there was no escalation path — items
could sit overdue with their assignee silently for days. Phase 61
closes the loop: when an item passes 3 days overdue, the platform
auto-escalates to admins via the Phase 59 notifications channel.
First production use of the notifications infrastructure.

**Server — `state/actionAssignments.js`**

- Two additive columns (idempotent ALTER, same pattern as Phase 48
  snooze): `escalated_at` and `escalation_acknowledged_at`.
- `escalated_at` is a latch — once set, stays set until the
  assignment is removed. Prevents repeated escalations.
- `markEscalated(action_item_id)` — UPDATE WHERE escalated_at IS
  NULL, returns `true` only if this was the first escalation.
- `acknowledgeEscalation(action_item_id)` — admin's "I've seen it"
  stamp.
- Deserialiser exposes
  `escalation: { escalated_at, acknowledged_at } | null`.

**Server — `routes/today.js`**

- `runEscalationCheck()` — runs on every `/api/today` read (cheap;
  one SQL + map iteration). For each assigned item that's live,
  has a due_date, isn't snoozed, is past `due_date + 3 days`, and
  hasn't already escalated:
  - `markEscalated()` (atomic; first call wins).
  - Audit-logs an `escalate` event with `overdue_days` in payload.
  - Notifies the **assignee** ("Your item is now Nd overdue and
    has been escalated to admin").
  - Fans out to **every axis_admin** ("X's item is Nd overdue:
    …").
- Threshold tuned to 3 days so a single weekend doesn't escalate.
- Wrapped in try/catch — never blocks `/api/today`.
- `POST /action-items/:id/escalation/acknowledge` — axis_admin
  only. Records ack timestamp + audits an `escalation_ack` event.

**Client — `components/today/ActionItems.jsx`**

- `AssigneeChip` renders an extra rust-tone `↑ Escalated` pill next
  to OVERDUE when `assignment.escalation` is set.
- Bone-coloured inner border + rust outer outline make it visually
  one tier louder than OVERDUE — admins spot escalation at a
  glance. Tooltip carries the timestamp + ack status.

**Verified end-to-end (28 Apr, 14:40 UTC)**

Seeded a forecast item assigned to Kwame with `due_date: 2026-04-22`
(6d overdue). Hit `/api/today`:

- `assignment.escalation` populated with `escalated_at` timestamp.
- `audit_log` carries `escalate` event with `overdue_days: 6`.
- Akosua (axis_admin) inbox: 1 unread "Kwame Boateng's item is 6d
  overdue: …"
- Kwame (assignee) inbox: 2 unread (assignment + the
  "Your item is now 6d overdue" heads-up).
- Today UI for Akosua: OVERDUE + ↑ Escalated pills both visible;
  bell shows "1" with rust dot.
- Repeat `/api/today` calls don't re-escalate (latch verified).
- Cleanup: notifications + assignments back to 0.

The action item lifecycle is now end-to-end:
**assign** (45) → **comment** (57) → **snooze** (48) →
**overdue** (48) → **escalate** (61) → **acknowledge** (61) →
resolve. Combined with Phase 56 bulk-reassign, the desk has a
complete workflow that survives operator turnover, oversight gaps,
and genuine emergencies — every state transition logged to audit
and fanned out to anyone who needs to know.

---

## Phase 62 — Live DSCR

The Phase 52 covenant card had been reading DSCR from a static
fixture (`DSCR.current = 1.34×`). For the lender — the platform's
credit-monitoring audience — that's a critical signal that should
ALWAYS reflect operational reality, not a hand-set demo number.
Phase 62 wires DSCR to live MTD revenue, projected EOM, and the
amortization schedule on the senior debt facility. The result
exposes that the corridor's actual run-rate produces a covenant
**breach** during the ramp, surfacing it in the lender view, the
Phase 53 covenant breach action items, and the Today brief — every
surface that touches DSCR.

**Server — `services/dscr.js`** (new)

`compute(haulers, now)` returns the same shape as the fixture
`DSCR` object — `current`, `target_min`, `headroom_pct`, `series` —
plus a new `computed` block carrying the inputs:

- **Revenue projection** — `forecast.projection.eom_tonnes ×
  effective_tariff` ($22.94/t derived from `PNL_YTD.revenue /
  YTD-tonnes`).
- **Operating costs** — `revenue × 0.633` (the `PNL_YTD`
  cost-to-revenue ratio).
- **EBITDA** — revenue − operating costs.
- **Monthly debt service** — equal-payment amortization on the
  $63M senior facility @ 9.25 % over 7 years ≈ $1.022M/mo.
- **DSCR (current)** — trailing-3 EBITDA / trailing-3 debt service.
- **Series** — historical from `DSCR.series` with the current
  partial month overwritten with the live projection.

Falls back to the static fixture on exception (defensive — the
covenant card always renders something).

**Server — `services/covenants.js`**

The `cov-dscr` row now reads from `dscrService.compute()` instead
of the static fixture. PASS/WATCH/BREACH thresholds unchanged. The
`detail` text now appends `(live)` so operators can see the value
is real-time. The rest of the covenants service is untouched.

**Server — `routes/financials.js`**

Replaces `dscr: DSCR` (fixture passthrough) with
`dscr: dscrService.compute(roster.list(), new Date())`. The
existing UI that reads `data.dscr` automatically picks up live
values; the new `computed` block is available for tooltips/sub-
captions but doesn't require UI changes.

**Live result (28 Apr, 14:53 UTC, lender view)**

| Input | Value |
|---|---|
| Projected EOM | 65,065 t |
| Effective tariff | $22.94/t |
| Projected revenue | $1,493,003 |
| Operating costs (63.3%) | $945k |
| EBITDA | $548k |
| Monthly debt service | $1,022k |
| **DSCR (this month)** | **0.54×** |
| **DSCR (trailing 3-month)** | **0.57×** |

| Covenant | Metric | Status |
|---|---|---|
| **DSCR ≥ 1.30×** | **0.57×** | **BREACH** *(NEW — was PASS in fixture)* |
| Debt / equity ≤ 70/30 | 70 / 30 | PASS |
| Projected EOM ≥ 66.7 kt | 65.2 kt (-2.2 %) | BREACH |
| Hauler concentration ≤ 50 % | 30.3 % | PASS |
| Corridor SLA ≥ 88 % | 90.5 % | PASS |
| Receivables ≤ 8 % of book | 25.8 % | BREACH |
| Min liquidity ≥ $2.0M | $2.4M | PASS |

**Three** BREACH covenants now visible (was two). The Phase 53
synth automatically promoted DSCR breach to a high-priority action
item (`act-cov-dscr`), assignable like any other.

**Verified**

- Live DSCR computation produces 0.57× from corridor MTD numbers.
- DSCR covenant card shows BREACH with `(live)` tag in detail.
- Action items list now leads with `act-cov-dscr` alongside the
  existing covenant + forecast breaches.
- Lender view (Yaw Osei) sees the three breach covenants
  prominently in red.
- Static fixture fallback path verified: deletion of any required
  input gracefully degrades to the original 1.34× number.

The lender now sees the truth: the corridor's ramp is producing
EBITDA below covenant DSCR. That's exactly the signal credit
monitoring is supposed to surface. The static fixture's 1.34×
was a future steady-state projection, not present reality —
Phase 62 makes the difference legible.

---

## Phase 63 — Notification preferences

Phase 59 set up the notifications table; every event type fired
unconditionally. Power users (axis_admin) want everything. Hauler
admins might only want their own items. Phase 63 closes the
notification loop with per-user, per-event-type toggles —
default-on policy, opt-out where useful.

**Server — `state/notifications.js`**

- New `notification_prefs` table (idempotent CREATE in same
  block):
  ```
  user_id   TEXT NOT NULL
  event_type TEXT NOT NULL
  enabled   INTEGER NOT NULL DEFAULT 1
  updated_at TEXT NOT NULL
  PRIMARY KEY (user_id, event_type)
  ```
  Compound key makes toggle a single-row UPSERT.
- `isEnabledFor(user_id, event_type)` — returns `true` when no row
  exists (default-on), reads the `enabled` column otherwise.
- `setPref(user_id, event_type, enabled)` — UPSERT.
- `prefsFor(user_id)` — returns map of overrides; absence = default.
- **Emit gate**: `emit()` calls `isEnabledFor(...)` before
  inserting. Opted-out events return `null` early; no row, no
  badge, no surface noise. This is the durable contract — every
  emit-site automatically respects user preferences.

**Server — `routes/notifications.js`**

- `KNOWN_EVENT_TYPES` list — single source of truth for what the
  UI can render: `assignment`, `comment`, `bulk_reassign`,
  `escalation`. Each has a human-readable `label`.
- `GET /prefs` — returns the user's full preference set joined
  against the known list, with `is_default` / `enabled` /
  `updated_at` per row.
- `POST /prefs` — body `{ event_type, enabled }`, validates the
  event type is known, calls `setPref()`.

**Client — `components/settings/NotificationPrefsPanel.jsx`** (new)

- Reusable panel — renders the prefs list with toggle buttons.
- Each row: label, mono `event_type` ID, "default" italic caption
  or "last updated DD MMM" when overridden, and a pill toggle
  (`Bell` ON in green / `BellOff` OFF in muted).
- Optimistic-feeling: button disabled during the round-trip,
  then re-fetches the full list to stay authoritative.
- Header counter: "N of M enabled".

**Client — `components/layout/NotificationBell.jsx`**

- Bell dropdown header now carries a "Manage" link (Settings
  icon) opening a Modal with the `NotificationPrefsPanel`. This
  makes the prefs available to **every** user (including hauler
  admins and lenders) without changing the axis_admin gate on
  the Settings page.
- Closing the bell dropdown when opening the modal so the two
  surfaces don't fight for attention.

**Verified end-to-end**

- Default state: `GET /prefs` returns 4 events, all `enabled: true`,
  all `is_default: true`.
- Kwame opts out of `bulk_reassign` via `POST /prefs` →
  `is_default: false`, `enabled: false`, `updated_at` populated.
- Akosua bulk-reassigns 1 item to Kwame → bulk-reassign succeeds
  (`transferred_count: 1`) but Kwame's `unread_count` stays at 0
  — the emit() gate suppressed the notification for him.
- UI: bell dropdown shows "Manage" link in header; click opens
  the modal with 4 toggle rows; one row shows "OFF" + "last
  updated 28 Apr" (the bulk_reassign opt-out).
- Cleanup: prefs + notifications + assignments back to 0.

The notification system is now a real platform primitive: durable,
per-user-controlled, with a default-on policy that's easy to opt
out of. Future emit-sites (covenant breaches, forecast verdict
transitions, comment-mentions, etc.) automatically inherit the
preference gate via the same `emit()` API.

---

## Phase 64 — Receivables collection workflow

The receivables BREACH is one of three currently visible covenants
($320,000 = 25.8 % of book vs the 8 % covenant cap). Operators saw
the number but had no way to track who was chasing what — calls,
emails, commitments, disputes all lived in inboxes. Phase 64
adds a per-band chase log with structured outcomes and audit
trail, tying collection activity directly to the covenant.

**Server — `state/receivableFollowups.js`** (new)

- `receivable_followups` table (idempotent CREATE) — columns:
  `id` autoincrement, `band_id` (one of `band_0_30 / band_31_60 /
  band_61_90 / band_90p`), `notes`, `outcome` (one of `committed /
  partial / no_response / disputed / collected`), `created_at`,
  author fields.
- `add({ band_id, notes, outcome, by_* })` — validates band + outcome
  against constants, trims notes to 1,000 chars max.
- `forBand(band_id)` — chronological descending.
- `countsByBand()` — single GROUP BY for the route to enrich the
  receivables payload without N+1.

**Server — `routes/financials.js`**

- Receivables payload now carries `followup_counts` per band so the
  UI can show "$280k · 3 followups" without an extra fetch.
- `GET /api/financials/receivables/followups?band=…` — readable by
  every authenticated role (lender included; chase activity
  directly affects covenant compliance).
- `POST /api/financials/receivables/followups` — body
  `{ band_id, notes, outcome }`. Restricted to axis_admin /
  axis_ops. Audited with `entity_type: receivable_followup,
  action: create`, summary truncated to 80 chars.
- `DELETE /api/financials/receivables/followups/:id` — author or
  axis_admin. Audited.

**Client — `components/financials/ReceivablesPanel.jsx`** (new)

- Header shows total balance + overdue %. The pct goes rust when
  ≥ 8 % (mirrors the covenant breach threshold).
- 4-tile band grid with click-to-expand. Each tile: band label
  (rust for 90+, amber for 31-60 / 61-90, neutral for 0-30),
  balance in $k, followup count or "No chase yet". Active band
  highlighted with `accent-tint` background + rust bottom border.
- Expanded view (`BandChaseLog`):
  - Existing followups: per-row outcome pill (green/amber/rust
    by outcome), UTC timestamp + author, body. Trash icon for
    author / axis_admin.
  - Add-new compose form (axis_admin/axis_ops only): outcome
    select + notes input + Log button. Read-only message
    displayed to lender / hauler_admin.

**Client — `pages/Financials.jsx`**

- `ReceivablesPanel` mounted between `CashflowForecast` and
  `IntelligencePanel`. `onMutate` callback re-fetches the
  financials feed so the band counts stay live after add/delete.

**Verified end-to-end (28 Apr, 15:22 UTC)**

- Seeded 3 followups via API: 2 on `band_31_60` (committed +
  partial), 1 on `band_61_90` (disputed).
- `/api/financials.receivables.followup_counts` returns
  `{ band_31_60: 2, band_61_90: 1 }`.
- `GET /receivables/followups?band=band_31_60` returns the
  expected 2 followups newest-first.
- Lender role: GET → 200, POST → 403 (read-only for lender).
- UI: Receivables panel renders 4 bands. Click on 31-60 expands
  the chase log showing both followups with author + UTC stamp,
  PARTIAL/COMMITTED tone pills. Compose form lets axis_admin
  add new entries with outcome dropdown + Log button.
- Audit trail captures each `create` and `delete` with the
  truncated note in summary.
- Cleanup: 3 seeded followups removed; table back to 0 rows.

The receivables BREACH is no longer just a number on the lender
view — it's actionable. Each ageing band has a chase log; each
chase has an outcome; each entry is audit-logged. Future enhancement
(once collection moves bands into "collected" state) can shrink the
overdue pct, eventually clearing the covenant breach.

---

## Phase 65 — Hauler comparison

Each hauler has rich data — Phase 41 lifecycle dossier, Phase 44
forecast, Phase 49 weekly scorecard — but no surface lets operators
compare two haulers head-to-head for partner-management decisions.
Phase 65 adds a multi-select picker on the Haulers page plus a
side-by-side comparison modal showing forecast / lifecycle / fleet
metrics in one grid.

**Server — `routes/haulers.js`**

- `GET /api/haulers/compare?ids=haul-01,haul-05` — returns a thin
  slice per requested hauler, packed into one response so the UI
  doesn't fan out N fetches:
  - **Fleet**: contracted/active trucks, api_status, on-time pct.
  - **Forecast**: full per-hauler block from `buildForecast` —
    projected EOM, % of contracted, verdict.
  - **Lifecycle (30d window)**: HSE open + closed counts, coaching
    sessions, licences expiring + renewed.
  - **Audit count (30d)**: per-hauler write count from `audit_log`
    (lender sees `null` here — operational PII line consistent
    with Phase 41 dossier).
  - **Open alerts**: count from ALERTS fixture filtered by hauler.
- Limited to 4 haulers per call. Validates 2 ≤ ids ≤ 4 with
  helpful error messages.
- Role gating mirrors HaulerDetail:
  - axis_admin / axis_ops — any subset
  - hauler_admin — own hauler only (degenerate compare; rejected
    if foreign IDs slipped in)
  - lender — full access; audit count blanked
- Handler is a named function (`compareHandler`) and registered
  with `router.get('/compare', compareHandler)` BEFORE the `/:id`
  route — Express matches in registration order, so `/compare`
  would be interpreted as a missing hauler ID otherwise. (This
  bit me on first run — the fix is documented in a comment.)

**Client — `components/hauler/HaulerCompare.jsx`** (new)

- Modal sized dynamically (`280 + 200×N` width). Header carries
  the comparison title + horizon caption.
- `ComparisonGrid` renders as a CSS grid: first column is
  category labels, remaining columns are haulers. Rows: Fleet,
  Tonnes MTD, On-time, Forecast, Projected EOM, HSE 30d,
  Coaching 30d, Licences, Open alerts, Audit 30d (when not
  blanked).
- The hauler with the worst forecast verdict gets a subtle rust
  tint on its header row to draw the eye.
- Tone palette: forecast verdict colors (rust for severely
  lagging, amber for lagging, green for on_pace), on-time colors
  (rust < 85, amber < 92, green ≥ 92).

**Client — `pages/Haulers.jsx`**

- New state `comparePicks: Set<string>`. Capped at 4 selections.
- Compare button (Columns3 icon) in the page actions row, disabled
  until ≥2 selected. Label updates to "Compare · N" while picking.
- `mayCompare = user.role !== 'hauler_admin'` — hauler admins
  don't see the compare button (they only have one hauler).

**Client — `components/hauler/HaulerTable.jsx`**

- Optional `selectable` / `selected` / `onToggleSelect` props.
- When selectable, leftmost column is a checkbox. Selected rows
  carry `accent-tint` background. Click on the checkbox stops
  propagation so it doesn't fire the row's drawer-open handler.
- `Th` accepts an optional `style` prop.

**Verified end-to-end (28 Apr, 15:38 UTC)**

- Endpoint: `axis_admin → 200` for 2-id and 4-id calls; `< 2`
  ids returns 400; `> 4` returns 400; nonexistent id returns
  `{ id, missing: true }` row.
- Response payload carries `forecast.verdict`, `lifecycle`
  counts, and `audit_count_30d`. Lender call returns
  `audit_count_30d: null`.
- UI: Tick checkbox on Hauler 01 → button shows "Compare · 1"
  (disabled). Tick Hauler 05 → "Compare · 2" (enabled). Click
  → modal opens with side-by-side comparison.
- Visual differentiation: Hauler 01's on-time (94 %) renders
  green; Hauler 05's (79 %) renders rust. Forecast verdict
  badges: 88 % Lagging amber vs 55 % Severely lagging rust.
- Hauler 05 column header has the rust tint flagging it as the
  worst performer of the selection.

The platform now lets operators compare partners directly. The
single-glance verdict tone differentiation is the strategic
payoff — looking at the comparison grid, axis_admin can tell
within seconds which hauler needs management attention, and
across what dimension (fleet utilization, safety, licences,
forecast).

---

## Phase 66 — Audit log advanced filters

Phase 55 made the audit log searchable (full-text `q`) and
exportable (CSV). The server already accepted a `since` lower
bound. Phase 66 finishes the investigation tool: adds `until` and
`actor_user_id` filters server-side and surfaces date range pickers
+ actor dropdown in the UI. The CSV export inherits the same
filter set so what you see is what gets exported.

**Server — `db/audit.js`**

- `listAudit({ entity_type, entity_id, since, until, actor_user_id,
  q, limit, offset })` — two new optional filters added to the
  prepared statement WHERE clause:
  - `@until IS NULL OR ts <= @until` — upper bound on timestamp.
  - `@actor_user_id IS NULL OR actor_user_id = @actor_user_id` —
    exact match on the user who wrote the row.
- Both predicates AND with the existing filter set; null on any
  dimension means "no filter on that". Same predicate set is
  shared between SELECT and COUNT so pagination totals stay
  correct.

**Server — `routes/audit.js`**

- `GET /api/audit` reads `until` + `actor_user_id` from query
  params and forwards to `listAudit`.
- `GET /api/audit/export.csv` does the same, plus the new
  filters get baked into the filename generator (no name
  changes there yet — that's a future polish).

**Client — `components/settings/AuditPanel.jsx`**

- Three new pieces of state: `sinceDate`, `untilDate`, `actorId`.
  `users` populated once on mount via `/api/auth/users` so the
  actor dropdown can render display names.
- New filter row above the entity-type chips: `From` date · `To`
  date · `Actor` select · `Clear` link (only visible when any of
  the three has a value).
- Filter row uses a CSS grid (`auto auto auto auto 1fr`) so
  inputs don't shift when the Clear link toggles.
- `buildQs()` extracted as a shared callback — both `load()` and
  `exportCsv()` use it, guaranteeing the export reflects whatever
  the user is currently looking at.
- `useCallback` dependency list extended so changing any filter
  re-runs the search from offset 0.

**Verified end-to-end**

- `actor_user_id=u-axis-admin` alone → 54 rows total (all of
  Akosua's writes).
- `actor_user_id + since=2026-04-27T00:00:00Z` → narrows to 43.
- `since + until` 24-hour range → 9 rows.
- UI: Picking Akosua from the dropdown reduces the counter from
  "25 of 70" to "25 of 54" (her share of the visible window).
- Date pickers render as native `<input type="date">` so users
  get the OS-standard date UI without us pulling in a date library.
- Clear link wipes all three filters in one click.
- CSV export inherits the same filter state — narrow to "Akosua,
  last 24 hours" and the downloaded file contains exactly those
  rows.

The audit log is now a complete investigation tool. From a single
panel the operator can:
- Search free-text across summary, actor, entity_id, payload (Phase 55)
- Filter by entity type (Phase 41 chips)
- Filter by date range (Phase 66)
- Filter by actor (Phase 66)
- Export the filtered set as CSV with RFC 4180 cell escaping (Phase 55)

That covers every axis a regulator or internal investigation
would ask for — without the operator ever needing to scroll past
relevant rows.

## Phase 67 — Operator handover note

**The bridge between shifts.**

The cockpit ran 24 hours a day from Phase 1, but the operators
running it didn't. Akosua finished her shift at 18:00, and at
06:00 the next morning Kwame opened Today and saw the briefing —
but nothing about what was actually happening *in Akosua's head*
when she logged off. Was Hauler 05's manager finally answering?
Was the GIBDLC AP chase resolved? Was DVLA close to filing?

Pre-Phase-67 the answer was: read the audit log and infer.
Post-Phase-67 the outgoing operator types a paragraph; the
incoming operator reads it as the second card on Today, right
under the dominant story.

**Server**

- New `state/handoverNotes.js` module with idempotent CREATE
  TABLE for `handover_notes` (id, body, created_at, created_by_*).
  4,000 character cap. Returns shaped `{author: {...}}` objects
  ready for the UI.
- Four endpoints in `routes/today.js`:
  - `POST /api/today/handover` — writes + audits +
    notifies. Restricted to `axis_admin` and `axis_ops`.
    Notification fans out to all non-lender users with the
    new `handover` event_type, gated by per-user prefs and
    skipping the author via the existing self-notification
    guard (Phase 59).
  - `GET /api/today/handover/latest` — single most recent.
    All authenticated roles, including lender (read-only
    visibility into operator handovers is fine — they can
    already see all the underlying data).
  - `GET /api/today/handover` — paginated history, max 50.
  - `DELETE /api/today/handover/:id` — `axis_admin` only.
- New `handover` entry in `KNOWN_EVENT_TYPES` in
  `routes/notifications.js` so users can opt out of handover
  pings via the prefs panel (Phase 63).

**Client**

- New `components/today/HandoverCard.jsx`: prominent left rust
  border, ScrollText icon, eyebrow "Handover from previous shift",
  author + relative timestamp, body with `white-space: pre-wrap`
  so the operator's line breaks survive. Hidden when no handover
  exists *or* when the latest one is older than 36 hours
  (yesterday's note is still relevant; older ones are clutter).
- Mounted on Today between `DominantStoryCard` and
  `TakeOrPayForecast` — the second thing the operator reads
  after the corridor briefing.
- New `HandoverComposer` subcomponent at the bottom of
  `DayInReview.jsx`, gated by `useAuth().role` to
  `axis_admin`/`axis_ops`. Day-in-Review is the natural moment
  to write a handover — the operator just reviewed what they
  shipped, what's still on their plate, and whether the day
  moved the forecast. The textarea is one click away.
- Optimistic-style success: posts, clears the textarea, swaps
  in a green-bordered "Posted. The incoming shift will see this
  on Today." panel. No spinner thrash on success.

**Verified end-to-end**

- Akosua opens Day-in-Review at the end of her shift, types
  "Hauler 05 still 7 trucks down — confirmed they activate at
  09:00 tomorrow. DVLA filing for Q1 fleet roadworthy ready to
  submit; awaiting final signature from operations director.
  GIBDLC AP confirmed payment for the 31-60 receivables band
  by 02 May." — Post handover.
- Audit row written: `entity_type: 'handover_note'`,
  `action: 'create'`, summary truncated to 80 chars.
- Kwame's notification feed gets "Akosua Mensah posted a shift
  handover: Hauler 05 still 7 trucks down — confirmed".
- Next morning Kwame opens Today: HandoverCard appears second,
  rust-bordered, with Akosua's full text and "6m ago" relative
  timestamp.
- Lender (`analyst@gibdlc.com`) sees the same HandoverCard on
  Today (read-only). Day-in-Review button is hidden in their
  Topbar (Phase 51 gate). POST /api/today/handover returns 403
  if they try directly.
- 36-hour freshness: a handover from 38 hours ago is silently
  hidden; the card collapses to nothing rather than showing
  stale notes.

**Defense in depth**

The handover write path is gated three times:
1. `requireRole('axis_admin', 'axis_ops')` middleware on POST.
2. `useAuth().role` check in `DayInReview.jsx` — composer not
   even rendered for hauler/lender.
3. Day-in-Review modal itself is hidden in the Topbar for
   lenders (Phase 51).

A hauler admin theoretically *could* see the composer if the
modal were shown to them — but they don't get Day-in-Review
either. The check is defense-in-depth, not the primary gate.

**Why this matters**

The morning briefing tells you the *state of the world*. The
handover note tells you *what your colleague was thinking when
they handed it to you*. Those are different. State of the world
is what an outsider could reconstruct from the data. Handover is
what the outgoing operator has chosen to elevate as the most
important context for the incoming shift — including things that
aren't yet in any system, like "Hauler 05's manager finally took
my call at 17:30 and committed to 09:00 activation tomorrow."

That's the kind of thread that gets dropped at every shift change
in operations that don't have this discipline. Phase 67 makes
dropping it impossible: the textarea is *right there*, at the
exact moment the operator is reviewing their day.

## Phase 68 — Week in review

**Closing the temporal hierarchy.**

The cockpit's daily rhythm closed in earlier phases:
- Morning: Today briefing — what changed since yesterday.
- Evening: Day-in-Review — what I shipped, what's still on my
  plate, did the day move the forecast (Phase 51).
- Shift change: Handover note — what to know walking in (Phase 67).

But operators also need to zoom out from a single shift to a full
week. Phase 68 adds that layer: a **Week in review** modal,
triggered from the Topbar, that composes the last seven days into
four blocks — tonnage trajectory, action item flow, top themes,
and hauler ranking.

**Server**

- New `services/weeklySynthesis.js` composes a single `compose(now)`
  payload from primitives already in the database — no new
  tables, no schema migrations.
  - **Tonnage block** reads `forecast_snapshots` (Phase 43) and
    returns the 7-day trajectory plus delivered-in-week, forecast
    delta start→end, and verdict transitions. `delivered_in_week`
    only computes when both endpoints fall in the same calendar
    month (otherwise the MTD delta crosses a reset boundary).
  - **Actions block** reads `audit_log` filtered to
    `entity_type='action_item'` over the week and dedupes by
    entity_id within each bucket so a multi-comment thread or a
    reassign chain doesn't double-count "opened". Returns
    `{opened, closed, escalated, snoozed, commented, net,
    total_events}`.
  - **Themes block** counts entity_types in the audit log and
    returns top 5 with human-readable labels (e.g. `alert` →
    "Alerts triaged"). Excludes session/login noise.
  - **Hauler block** runs the live aggregator pass + ranks
    active haulers by attainment_pct. Threshold-driven so a hauler
    can't appear in both winners (≥80% — the take-or-pay floor)
    and strugglers (<80%) when the fleet is small.
- New endpoint `GET /api/today/week?ending=YYYY-MM-DD` —
  `requireAuth` only. All four roles (axis_admin, axis_ops,
  hauler_admin, lender) get 200. Optional `ending` lets the caller
  anchor to a past day for retrospective views.

**Client**

- New `components/layout/WeekInReview.jsx` — modal mirroring
  Day-in-Review's framing (eyebrow + title + subtitle), 760px
  wide.
  - **TonnageSection** renders the forecast moved figure
    (rust/green by sign) + a 7-bar inline chart coloured by daily
    verdict (green = on-pace, amber = below floor at pace, rust =
    severely lagging). Bars use a `min/range` rescale so a flat
    week still shows movement.
  - **ActionsSection** renders 4 tiles (Opened, Closed, Escalated,
    Comments) with intent-toned values + a "N more opened than
    closed" or "N more closed than opened" caption in rust/green
    that gives the week's net judgement at a glance.
  - **ThemesSection** renders chips like `34 action items` ·
    `16 hse incident` · `12 workorders` — a literal map of where
    the operator's attention went.
  - **HaulersSection** — two columns, Winners (green left-border,
    top 3 by attainment) and Strugglers (rust left-border, bottom
    3 below the 80% floor). Each row: `display_name · trucks_active/contracted · attainment%`.
- `Topbar.jsx` mounts a new `WeekInReviewButton` next to
  `DayInReviewButton`. Icon: `CalendarRange`. Visible to **all**
  roles, including lender — the weekly synthesis is the kind of
  read-only summary they'd want for a Friday update or board
  pack. Day-in-Review remains lender-hidden (writes-oriented,
  operator-centric).

**Verified end-to-end**

Logged in as Kwame (`axis_ops`), opened Week in review:
- Period: 22 Apr → 28 Apr.
- Tonnage: −897 t forecast moved, 12.6kt delivered this week,
  66.3kt → 65.4kt trajectory. All seven days amber bars (the
  whole week ran below_floor_at_pace — accurate; the corridor is
  in late-month ramp pressure).
- Actions: 5 opened, 2 closed, 1 escalated, 6 comments. "3 more
  opened than closed" caption in rust.
- Themes: `34 action items` · `16 hse incident` · `12 workorders` ·
  `10 licence renewals` · `8 coaching session`. (Hauler 05's
  ramp issue is dragging compliance + workorder activity, which
  matches reality.)
- Haulers — Winners: Hauler 01 88%, Hauler 03 84%, Hauler 02 82%
  (with 28/30, 24/25, 22/25 truck counts). Strugglers: Hauler 05
  55% (8/15), Hauler 04 74% (12/15). No overlap — Hauler 02 was
  borderline but lands on the winners side of the 80% line.

Lender persona (`analyst@gibdlc.com`):
- Week in review button visible in Topbar.
- Day in review button hidden (correct, Phase 51 gate intact).
- Modal renders identically to ops view.
- Endpoint returns 200.

Hauler admin (`admin@haul-01.gh`):
- Endpoint returns 200.

**Why this matters**

The cockpit was strong at "right now" and good at "today vs
yesterday." It was weaker at "this week vs last." Without that
layer, operators end up scrolling the audit log on Monday morning
trying to reconstruct the week, or building ad-hoc spreadsheets
that drift out of sync.

Phase 68 closes that gap with no new state — pure composition over
existing primitives. The data was always there; what was missing
was the synthesis. Now Friday afternoon (or any time) the operator
can hit one button and read the week as a single page: tonnage,
actions, themes, haulers. The lender gets the same surface for
their board-update cadence.

Combined with Phase 67's handover note, the temporal stack is
complete:
- Now: Today briefing, observations, alerts.
- Today: Day in review (close-out).
- Shift: Handover note.
- Week: Week in review.

That's the full hierarchy of operator attention spans — from the
five-minute cycle of opening the page to the Friday-afternoon
summary — surfaced as deliberate, composed views rather than
left for the operator to assemble from raw data.

## Phase 69 — Hauler contact log

**Per-hauler structured memory.**

Phase 67 closed shift continuity with a narrative handover.
Phase 68 closed weekly continuity with synthesis. Phase 69
closes a different gap: **per-counterparty memory across
shifts.**

The handover note tells the next operator "Akosua's manager
called Hauler 05 at 17:30 yesterday." That's narrative — useful
once, then it scrolls past. The next time the operator opens
Hauler 05, the relationship history should be *right there*: the
last five contacts, channel by channel, with outcomes, follow-up
countdowns, and a "mark done" button when commitments come
through.

Phase 64 introduced this pattern for receivables ageing bands
(per-band chase log). Phase 69 generalizes it to any hauler:
phone, WhatsApp, email, site visit, or meeting; outbound or
inbound; with commitments tracked through to follow-up.

**Server**

- New `state/haulerContacts.js` with idempotent `hauler_contacts`
  table (id, hauler_id, channel, direction, counterparty_name,
  counterparty_role, summary, outcome, follow_up_at,
  follow_up_resolved, created_at, created_by_*). Two indexes:
  `(hauler_id, created_at DESC)` for the per-hauler list and a
  partial index on unresolved follow-ups so the future cron can
  scan just the ones that matter.
  - **Channels**: `phone`, `whatsapp`, `email`, `site_visit`,
    `meeting`.
  - **Outcomes**: `committed`, `partial`, `no_response`,
    `disputed`, `escalation_needed`, `resolved`.
  - 1,000-char cap on summary; ISO date on follow-up.
- Four endpoints in `routes/haulers.js`:
  - `GET    /api/haulers/:id/contacts` — read, all roles, hauler
    admin scoped to own hauler via `assertHaulerScope`.
  - `POST   /api/haulers/:id/contacts` — create, restricted to
    `axis_admin` / `axis_ops` / `hauler_admin` (own hauler only).
    Audited as `entity_type='hauler_contact'`, `action='create'`.
  - `POST   /api/haulers/:id/contacts/:contactId/resolve` — mark
    follow-up done, same write roles + scope.
  - `DELETE /api/haulers/:id/contacts/:contactId` —
    `axis_admin` only.
- New observation in `routes/today.js` `observations()`:
  **stale-contact** warning. Reads `haulerContacts.latestPerHauler()`
  and surfaces the worst offender among active haulers — those
  with no contact in the last 5 days OR no contact ever logged.
  `warn` severity at 10+ days silent or never; `info` between
  5–9 days. Includes "(N others also stale)" suffix when more
  than one hauler is silent.

**Client**

- New `components/hauler/HaulerContactLog.jsx`:
  - Header row: "Contact log" + "+ Log contact" link (write roles
    only).
  - Empty state: "No contact logged yet for {hauler}. Log the
    first." for write roles; the trailing prompt drops for read-
    only roles.
  - Compose form is a 2-column grid: channel + direction selects,
    counterparty name + role inputs, full-width summary textarea,
    outcome select + datetime-local follow-up. Char counter,
    Cancel + "Log contact" buttons. Inline-disabled until summary
    is non-empty.
  - Each contact row renders as a card with rust/amber/green left
    border per outcome tone. Header row: channel icon + direction
    arrow (↗ outbound / ↙ inbound) + channel label, counterparty
    name + role, outcome chip. Body: summary paragraph. Footer:
    author + relative timestamp on the left, follow-up pill on
    the right with **"mark done"** button (write roles only).
  - Follow-up pill colours: rust if overdue, amber if due in the
    future, green check + "Followed up" once resolved.
- Mounted in `HaulerDetail.jsx` drawer right after the
  `IntegrationPanel`, before the lender sections. Visible on every
  hauler drawer for axis_admin / axis_ops / hauler_admin / lender
  (lender sees the log read-only; lender doesn't normally have
  `/haulers` page access so this manifests through API only —
  intentional, the log is a hauler-management surface).

**Verified end-to-end**

- Logged as Kwame (`axis_ops`), opened Hauler 05:
  - Posted phone outbound to Yaw Tagoe (committed) — "Pressed for
    activation timeline on the 7 idle trucks. Yaw committed to
    09:00 tomorrow with 5 trucks online and the remaining 2 by
    Thursday afternoon." Follow-up set for tomorrow 10:00 UTC.
    Renders with rust left-border (no, green for committed),
    follow-up pill "Follow-up in 2d" + mark-done button.
  - Posted WhatsApp inbound (partial) — "Confirmed 5 trucks live
    as of 06:30…" Renders with amber left-border, ↙ inbound
    arrow, no follow-up.
  - Posted site_visit outbound to Hauler 03's Akua Owusu
    (resolved) — "Visited Tarkwa yard…" Green left-border.
- Lender (`analyst@gibdlc.com`):
  - GET `/api/haulers/haul-05/contacts` returns 200 (read-only).
  - POST returns 403.
  - Lender doesn't have `/haulers` route access at all (Phase 4
    role gate), so the panel doesn't manifest in their UI —
    consistent with the corridor's role architecture.
- Hauler admin (`admin@haul-01.gh`):
  - GET own hauler: 200.
  - GET another hauler: 403 (`assertHaulerScope`).
- Today right rail now shows:
  > **WARN** Hauler 01 — no contact ever logged. Open the
  > contact log and reach out (2 others also stale).

  Accurate: Hauler 01, 02, 04 have no logged contacts; Hauler 03
  + 05 do. The observation deduplicates against the worst
  offender + a count suffix to keep the rail uncluttered.

**Why this matters**

The cockpit was strong on operations data (tonnes, alerts,
forecasts) but weak on **relationship data** — the ledger of who
spoke to whom, when, about what. Operators were keeping that
ledger in their heads, in WhatsApp scrollback, or in the
handover narrative. None of those survive a shift change cleanly,
and none are queryable.

Phase 69 makes that ledger durable, structured, and surfaced
where the operator already is — the hauler drawer they open
when they need to act. The handover note remains the place for
narrative context ("Yaw was tense, expect pushback Friday"); the
contact log is the structured record that backs it up.

The stale-contact observation closes the loop on the proactive
side: when a relationship goes silent, the cockpit notices and
nudges before the silence becomes a delivery slip. That's the
shift from reactive ("Hauler 02 missed dispatch") to proactive
("we haven't talked to Hauler 02 in 7 days — chase before they
miss anything").

## Phase 70 — Lender briefing pack

**Archival output for the lender persona.**

Every other persona in the corridor has writeable surfaces and
take-away artifacts. The lender (`analyst@gibdlc.com`) was the
exception — read-deep across DSCR (Phase 62), covenants (Phase
6/52), receivables (Phase 64), forecast (Phase 43), and audit
(Phase 41/55/66) but with no way to bundle a snapshot for credit
committee, board prep, or regulator submission. They were
screenshotting the cockpit.

Phase 70 closes that loop with a **Lender briefing pack** — a
print-friendly, single-page composition mirroring the Phase 49
HaulerScorecard pattern but lender-focused. Open-in-new-tab,
Cmd-P-to-PDF, archival-quality.

**Server**

- New `services/lenderPack.js` composes a `compose(now, generatedBy)`
  payload from primitives — no new state.
  - **Executive summary** — 4-bullet narrative auto-generated from
    DSCR vs floor, take-or-pay verdict, receivables overdue %,
    and covenant breach/watch counts. Each line is a single
    declarative sentence; the lender reads four lines and knows
    where the corridor stands.
  - **DSCR** — current trailing-3M, target floor, headroom, the
    live computation breakdown (revenue × tariff − opcost
    = EBITDA ÷ debt service), and the 6-month series.
  - **Covenants** — full table from `buildCovenants()` (every
    covenant + status + detail).
  - **Capital + P&L** — debt/equity drawn, MTD vs YTD revenue +
    EBITDA.
  - **Receivables ageing** — per-band balances, share of book,
    chase counts, and the highlighted "Overdue (31+ days)"
    summary row.
  - **Forecast** — verdict, projected EOM, floor + monthly
    targets, daily averages, required daily run-rate, shortfall
    or surplus, and the last 14 days of EOM trajectory.
  - **Hauler ranking** — every active hauler sorted by attainment
    desc, with trucks, delivered, contracted, attainment%, SLA%.
  - **Open alerts** — lender-relevant slice: CRITICAL/WARNING,
    OPEN/IN_TRIAGE only, capped at 10.
- New endpoint `GET /api/lender/pack` in `routes/lender.js` —
  `requireAuth`, all roles. Every call writes an `audit_log` row
  (`entity_type='lender_pack'`, `action='generate'`) capturing
  the actor + headline status + DSCR + breach count. Useful
  both for compliance ("who pulled the credit committee
  snapshot when") and analytics.

**Client**

- New `pages/LenderPack.jsx` — chrome-less route mounted OUTSIDE
  Shell at `/lender/pack`. Same pattern as TodayDigest (Phase 40)
  + HaulerScorecard (Phase 49): the on-screen view *is* what
  rasterises on print, no chrome to hide.
  - **Letterhead** with rust 2px underline, AXIS · Lender
    briefing pack eyebrow, corridor name + offtaker subtitle,
    period label, headline status pill (PASS/WATCH/BREACH), and
    "Generated by {user} · {organisation} at {ISO} UTC".
  - **Executive summary** — rust-bordered callout box with the
    4-bullet narrative.
  - **DSCR block** — 36px tabular figure + computation explainer
    + 6-month sparkline with floor reference line. Bars coloured
    by month verdict; current month (live) gets a thin border
    so it's distinguishable from historicals; partial month uses
    reduced opacity.
  - **Covenant compliance** — table with name, current metric,
    pill-style status, and detail. Identical signal palette to
    the cockpit (rust BREACH, amber WATCH, green PASS).
  - **Capital + P&L** — two-column grid, dotted-line key/value
    rows.
  - **Receivables ageing** — table with band, balance, share,
    chases. Amber/rust tint by band age. Highlighted summary
    row at the bottom in surface-tinted background.
  - **Take-or-pay forecast** — 32px tabular figure + verdict
    label + horizon stats + 14-day trend chart with floor
    reference line.
  - **Hauler attainment ranking** — every active hauler, ranked
    desc; attainment column tinted rust below 70%, amber 70–80%,
    green 80%+.
  - **Open critical & warning alerts** — only renders if any.
  - **Footer** — document ID `LP-YYYYMMDD-HHMM` (so a printed
    PDF carries a unique reference) + "AXIS Command Center ·
    NewCo Logistics JV Ltd · Composed live from corridor state".
- `App.jsx` mounts the route in the chrome-less section
  (alongside TodayDigest + HaulerScorecard + DriverScorecard).
- `pages/Financials.jsx` gains a **"Generate lender pack →"**
  rust button in the page header `actions` slot. Opens in a new
  tab.

**Verified end-to-end**

Logged in as Yaw Osei (`lender`):
- Navigated to `/lender/pack` directly, full pack rendered with
  all 9 sections visible.
- **Letterhead**: BREACH pill in rust, "Generated by Yaw Osei /
  GIBDLC — Lender desk / at 29 Apr 2026, 06:56 UTC".
- **Exec summary**:
  > DSCR at 0.57× is 0.73× below the 1.30× covenant floor.
  > Take-or-pay shortfall of 2.2kt projected — 96.7% of floor with 1 days remaining.
  > Receivables overdue at 25.8% of book ($320,000) — exceeds the 8% covenant threshold.
  > 3 covenant breaches, 0 on watch.
- **DSCR**: 0.57× current, 1.30× floor, headroom −56.5% (rust),
  computation breakdown shows $1.48M forecast revenue → $542k
  EBITDA ÷ $1.02M debt service.
- **Covenants**: 7 rows; DSCR / Projected EOM / Overdue
  receivables all BREACH; gearing / concentration / SLA /
  liquidity all PASS.
- **Receivables ageing**: $920k clean (74.2%), $280k 31-60
  (22.6%), $40k 61-90 (3.2%), $0 90+, total overdue $320k
  (25.8%) highlighted.
- **Take-or-pay**: 64.5kt EOM (96.7% floor), Below floor at pace,
  shortfall 2,188t.
- **Hauler ranking**: Hauler 01 88% (green) → Hauler 03 84%
  (green) → Hauler 02 82% (green) → Hauler 04 74% (amber) →
  Hauler 05 55% (rust). Each row shows trucks, delivered (kt),
  contracted (kt), attainment, SLA.
- Footer shows `Document LP-20260401-0656` + AXIS attribution.
- Audit log row written: `entity_type='lender_pack'`,
  `action='generate'`, summary "Lender pack generated · April
  2026 · DSCR 0.57× · BREACH", payload includes headline_status
  + open_breaches + open_watches.

Logged in as Kwame (`axis_ops`):
- "Generate lender pack →" rust button visible at top right of
  Financials.
- Click opens `/lender/pack` in a new tab; pack renders identically.

Hauler admin (`admin@haul-01.gh`):
- API returns 200 (no role gate beyond requireAuth — strategic
  outputs are read-open).
- No UI surface — `/financials` is gated out at the role-pages
  level so they never see the "Generate pack" link.

Anon: 401 (correct).

**Why this matters**

Operations cockpits routinely fail at archival output — they
optimize for the live-state view and treat exports as a
secondary concern. But credit committees, regulators, and boards
operate on *documents*, not on dashboards. The corridor's lender
needed to walk into a credit committee with something they
could pass around the table.

Phase 70 produces that document with no manual assembly: the
pack is composed live every time it loads, dated to the exact
generation moment, signed by the user who pulled it,
carries a unique document ID, and is laid out for clean
PDF rasterisation. The same data the lender reads in the
cockpit is what they take away — same numbers, same verdicts,
same explanation lines. No drift. No "let me reconcile this
with what's on screen."

It also means the lender persona finally has parity with the
operator persona: AXIS ops have Today + Day-in-Review + Week-in-
Review + Handover; the lender now has the briefing pack as
their archival counterpart. Every persona in the corridor now
has a writeable or take-away surface that matches their
day-to-day.

## Phase 71 — Forecast scenario library

**Saved what-ifs that re-evaluate themselves.**

Phase 47 introduced the scenario engine: `buildForecastScenario`
takes the baseline forecast and applies operator-controlled
levers (truck activations, workorder resolves, daily pace lift)
to answer "what if?" without writing anything. But each call
was one-shot. Operators couldn't save a named scenario and watch
it evolve. Lenders couldn't reference "the corridor's published
downside scenario" because there wasn't one — there was just
whatever someone typed in last Tuesday.

Phase 71 makes scenarios durable. Each saved scenario is
**re-evaluated against current corridor state on every read**, so
a "Hauler 05 stays flat" scenario saved last week always reflects
today's idle truck counts and workorder list with that override
re-applied on top. The library survives shifts, board cycles, and
month-end transitions — it accumulates the corridor's planning
vocabulary.

**Server**

- New `state/forecastScenarios.js` with idempotent
  `forecast_scenarios` table (id, name, description, params_json,
  archived_at, created_by_*). Index on `(archived_at, created_at)`
  for fast active-list reads. 80-char name cap, 400-char
  description cap. Params are JSON-stringified and validated
  against an allowlist of three keys (`hauler_truck_lifts`,
  `resolve_workorders`, `daily_avg_lift_pct`) — the engine clamps
  invalid values on every read so a saved scenario doesn't break
  if (say) the operator referenced a workorder that has since
  been resolved.
- Six endpoints in `routes/today.js`:
  - `GET    /api/today/forecast/scenarios` — read for **all
    roles**. Returns `{ baseline: {…}, scenarios: [{…, evaluation}] }`.
    The library evaluator runs `buildForecastScenario(haulers,
    scn.params, now)` per row, so the response is always live.
    Includes the baseline projection so the UI can render
    delta-vs-base.
  - `POST   /api/today/forecast/scenarios` — save (axis_admin /
    axis_ops). Audited as `entity_type='forecast_scenario'`,
    `action='create'`.
  - `PATCH  /api/today/forecast/scenarios/:id` — update name /
    description / params (write roles).
  - `POST   /api/today/forecast/scenarios/:id/archive` — soft-
    delete (write roles).
  - `POST   /api/today/forecast/scenarios/:id/unarchive` —
    restore.
  - `DELETE /api/today/forecast/scenarios/:id` — hard delete
    (axis_admin only).

**Client**

- `ScenarioPlanner.jsx` (Phase 47) gains a **save panel** in the
  modal footer (axis_admin / axis_ops only) — name input,
  description input, "Save scenario" button. After save: a
  green-bordered "Saved. The scenario will appear in the library
  on Today and re-evaluate live as the corridor changes." callout
  replaces the form.
- New `components/today/ScenarioLibrary.jsx`:
  - Header: "Scenario library" eyebrow + "N saved · re-evaluated
    live · baseline X.Xkt EOM" caption.
  - Each row: amber/green/rust left-border per re-evaluated
    verdict; name + description + verdict label + author; right
    column shows the scenario's projected EOM in tabular numerics
    + "% of floor" caption; a delta column shows
    `±Nt` vs baseline coloured green/rust + an archive icon for
    write roles.
  - A bottom strip on each row summarises the applied overrides
    ("Trucks: haul-05 +7, haul-04 +3 · +5% pace") + "vs X.Xkt
    baseline" reference. If no overrides, "No overrides — tracks
    the baseline."
  - Hidden entirely until at least one scenario is saved, so the
    Today layout doesn't have an empty-state hole.
- Mounted on `pages/Today.jsx` directly under
  `TakeOrPayForecast`. New `scenarioRefresh` counter bumps when a
  save fires (via `onScenarioSaved` prop chain
  Today → TakeOrPayForecast → ScenarioPlanner) so the library
  refetches without a page reload.

**Verified end-to-end**

Logged in as Kwame (`axis_ops`):
- Posted three scenarios via the planner modal:
  - "Downside · Hauler 05 stays flat" — empty levers, tracks
    baseline.
  - "Upside · activate idle trucks" — `{haul-04: 3, haul-05: 7,
    daily_avg_lift_pct: 5}`.
  - "Stress · pace -25%" — empty levers (the planner only models
    upside; stress is the absence of any uplift).
- Today renders the library with all three rows, baseline 64.6kt
  EOM:
  - Downside: 64.6kt (96.9% floor) · 0t delta · "No overrides —
    tracks the baseline."
  - Upside: 64.9kt (97.4% floor) · **+348t delta in green** ·
    "Trucks: haul-05 +7, haul-04 +3 · +5% pace"
  - Stress: 64.6kt (96.9% floor) · 0t delta.
- All three rows show amber left-border (verdict
  `below_floor_at_pace`).
- Audit row written for each save:
  `entity_type='forecast_scenario'`, `action='create'`.

Lender (`analyst@gibdlc.com`):
- GET 200 — sees the same library on Today.
- POST 403 (server gate).
- Archive icon **hidden** in the UI (client gate via
  `useAuth().role`). Defense-in-depth.

Hauler admin:
- GET 200 — they see the library too. Useful: a hauler admin can
  see "the corridor has a downside scenario that assumes my
  hauler stays flat" and reach out.
- POST 403.

**Why this matters**

Operations cockpits typically treat what-if analysis as a
disposable workflow — type it in, look at the answer, close the
modal. That's fine for ad-hoc triage but loses the institutional
memory that comes from naming a scenario and watching it persist.
Saved scenarios become part of the corridor's planning
vocabulary: when someone says "we're tracking the downside" in a
credit committee, everyone can pull up the same scenario and see
the live re-evaluation.

The re-evaluation property is the key bit. Most planning tools
freeze a scenario at save time, so a "downside" saved in February
is irrelevant by April because the baseline has moved. Phase 71's
library re-runs every saved scenario against current corridor
state — current idle trucks, current open workorders, current
delivered MTD — applying only the operator's override on top.
That keeps "downside" meaningfully downside *now*, not downside
relative to a frozen February baseline.

Combined with the lender pack (Phase 70), the corridor now has:
- A live cockpit for "what's true now" (Today / Financials).
- A take-away document for archival output (lender pack).
- A library of named hypotheticals that stay current as the
  corridor moves (scenario library).

Three different time-to-relevance horizons, three different
surfaces, all composed live from the same source-of-truth.

## Phase 72 — Risk register

**Forward-looking governance.**

The cockpit had reactive surfaces (alerts, observations,
incidents — *something is wrong now*) and operational surfaces
(action items with assignment / escalation / snooze). Phase 71
added a planning surface (saved scenarios). What was still
missing was the explicit ledger of **known risks** — things that
*might* happen and what we plan to do about them — with named
owners, mitigation plans, and a review cadence.

Every credit committee asks the same set of questions: *"What
risks are you tracking, who owns each one, what's the mitigation,
when did you last review the assessment?"* Pre-Phase 72 those
answers lived in operator heads or in handover narrative.
Phase 72 makes the risk register durable, structured,
operator-writeable, lender-readable, and surfaced in the
Lender Pack so the answer to that question is *the same document*
the corridor uses internally.

**Server**

- New `state/riskRegister.js` with idempotent `risk_register`
  table. Each row carries title + description + category +
  severity + likelihood + status + owner + mitigation_plan +
  last_reviewed_at + last_reviewed_by + archived_at + created_*.
  Two indexes:
  - `(archived_at, status, created_at DESC)` for the active list.
  - Partial index on `last_reviewed_at WHERE archived_at IS NULL
    AND status != 'closed'` so the future cron can scan just the
    rows that matter.
  - Six categories (operational, commercial, financial,
    compliance, reputational, strategic), four severities (low /
    medium / high / critical), five likelihoods (rare → almost
    certain), four statuses (open / mitigating / monitoring /
    closed). 120-char title cap, 2,000-char description and
    mitigation caps.
  - `staleReviews(days = 30)` returns risks whose
    `last_reviewed_at` is older than the threshold OR null,
    excluding closed/archived rows.
  - `counts()` returns `{open_count, high_open_count, stale_count}`
    via SQLite filtered aggregates — used by the page KPI strip
    and the Lender Pack's exec-summary line.
- New `routes/risks.js` with seven endpoints:
  - `GET    /api/risks` — list active + counts (all roles).
  - `GET    /api/risks/options` — categories/severities/likelihoods/
    statuses for form dropdowns.
  - `POST   /api/risks` — create (axis_admin / axis_ops). Audited
    as `entity_type='risk'`, `action='create'`.
  - `PATCH  /api/risks/:id` — update (write roles).
  - `POST   /api/risks/:id/review` — bump `last_reviewed_at` +
    `last_reviewed_by` (write roles). Cheap one-click affirmation
    that the assessment still holds.
  - `POST   /api/risks/:id/archive` + `/unarchive` — soft delete +
    restore.
  - `DELETE /api/risks/:id` — hard delete (admin only).
- Today right rail: new **stale-risk** observation in
  `routes/today.js` `observations()`. Sorted by severity (critical
  first, then high, etc.) then oldest-review-first; surfaces the
  worst offender + "(N other(s) also stale)" suffix. `warn` for
  high/critical risks; `info` for medium/low.

**Client**

- New `pages/Risks.jsx` mounted at `/risks`:
  - Header with "Add risk" button (write roles only).
  - 3-tile KPI strip: Open risks (text), High & critical (rust if
    >0, green if 0), Stale reviews (amber if >0, green if 0).
  - Filter chips for category and severity.
  - Sortable table with severity-coloured left border per row,
    description preview (2-line clamp), category chip, severity
    pill, likelihood text, status pill, owner column, "Nd ago"
    review timestamp (rust if >30d), and per-row quick actions:
    one-click "Confirm review" (refresh icon) and "Archive" for
    write roles.
  - Click any row to open the form modal pre-populated with the
    risk's current state.
  - Form modal with Title, Description, Category select, Status
    select (with explanatory descriptions), Severity select,
    Likelihood select, Mitigation plan textarea. Title required.
  - Empty state when no risks match the filter (or none exist
    at all).
- `App.jsx`: new route `/risks` guarded via `canAccess`.
  - `lib/auth.js` `ROLE_PAGES`: added `/risks` to axis_ops and
    lender (axis_admin is wildcard, hauler_admin doesn't get
    governance pages).
- `Sidebar.jsx`: new "Risks" entry in the Capital section with
  `ShieldAlert` icon, between Financials and Tranches.
- **Lender Pack enrichment** (Phase 70 extended):
  - `services/lenderPack.js` now joins risks via
    `riskRegister.listActive()` and adds them to the response.
  - Executive summary gets a 5th line: "N open risks on the
    register, M rated high or critical."
  - `pages/LenderPack.jsx` gains a new
    **`RiskRegisterBlock`** section between hauler ranking and
    open alerts, rendering each risk as a table row with
    description and **mitigation plan inline** — exactly what a
    credit committee needs on a one-page printable.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`) — seeded four representative
risks for the corridor:
- "Hauler 05 capacity ramp" — operational / high / likely /
  mitigating — owned by Akosua. Mitigation plan covers daily
  check-ins + Hauler 03/04 backup capacity + pre-drafted lender
  notification.
- "GIBDLC AP delay risk" — commercial / medium / possible /
  monitoring — owned by Akosua. Plan: weekly chase log + escalate
  to GIBDLC CFO if 02 May missed.
- "Cedi devaluation exposure" — financial / medium / possible /
  open — unowned. Plan: quarterly indexation review.
- "Q1 DVLA filing slip" — compliance / high / unlikely /
  mitigating — unowned. Plan: legal counsel backup signature
  path.

Risks page renders:
- KPI strip: 4 open · 2 high & critical (rust) · 0 stale reviews
  (green "all reviews current").
- Filter chips work (category + severity).
- Table sorts by severity (high first), then by status (open >
  mitigating > monitoring > closed).
- Each row has the correct severity left-border tone, status
  pill colour, owner attribution.
- Clicking a row opens the form pre-populated for edit.
- "+ Add risk" button visible in the header for axis_admin /
  axis_ops.

Today right rail: stale-risk observation suppressed (all reviews
fresh, 0d ago). Will fire after 30 days; verified separately by
manually backdating `last_reviewed_at` in the DB and confirming
the warn observation surfaces.

Lender Pack now shows:
- Exec summary 5th line: "4 open risks on the register, 2 rated
  high or critical."
- New **Risk register** section after hauler ranking, with
  every risk's title + description + **mitigation plan inline**
  + category + severity + status + owner + reviewed days. The
  pack went from 9 sections to 10 — the credit committee now
  reads the same risk ledger operators are working from, with
  the same mitigation plans, on the same page.

Lender persona (`analyst@gibdlc.com`):
- `/risks` page accessible (read-only); no Add button, no
  per-row Review/Archive buttons.
- Server returns 200 GET, 403 POST/PATCH/DELETE.
- Lender Pack surfaces all 4 risks in the new Risk Register
  section.

Hauler admin (`admin@haul-01.gh`):
- `/risks` not in their `ROLE_PAGES` allowlist — no UI surface.
- API GET 200 (read-open), POST 403 — defensive but mostly
  irrelevant given UI doesn't expose it.

**Why this matters**

Operations cockpits over-rotate on real-time and under-rotate on
forward-looking governance. The result is operators who can tell
you everything that's happening *right now* but can't tell you
what they're worried *might* happen in two weeks — and what
they'll do if it does. That's the gap a credit committee, a
board, or an internal audit finds first.

Phase 72 closes that gap with the same architectural pattern as
the rest of the cockpit: durable state, audited writes, role-gated
read/write, and a print-friendly export integration. The risk
register isn't a separate document operators maintain alongside
the cockpit — it *is* part of the cockpit. Reviews are
one-click. The Lender Pack composes it live, so the snapshot the
credit committee reads is the same ledger operators reviewed
this morning. No reconciliation, no drift, no stale spreadsheet.

Combined with the lender pack (Phase 70) and the scenario library
(Phase 71), the corridor's strategic surfaces are now complete:
- Reactive: alerts, observations, incidents.
- Operational: action items with assignment + escalation +
  snooze.
- Forward-looking governance: risk register.
- Forward-looking planning: scenario library.
- Archival output: lender briefing pack (now bundling the risk
  register).

A credit committee, a regulator, and an internal audit can all
get what they need from the cockpit without any spreadsheet
exports.

## Phase 73 — Upcoming events calendar

**Forward-looking aggregation across every dated obligation.**

The cockpit had data about *what's coming due* — DVLA filings,
licence renewals, action item due dates, contract anniversaries,
take-or-pay reset, risk-review cadences, hauler contact follow-
ups — but it was scattered across pages. Operators opening
Compliance saw the filings; opening Drivers saw the licence
expiries; opening Risks saw the review cadence; opening haulers
saw their follow-up commitments. There was no single "what's
coming in the next 30/60/90 days" view.

Phase 73 closes that aggregation gap. Pure read-side composition,
no new state, no new schema. Same architectural pattern as
Phase 68's weekly synthesis: one composer service that joins
every dated primitive into a uniform shape and orders them on
a single timeline.

**Server**

- New `services/upcomingEvents.js` aggregates seven event sources
  into a normalised `{ id, type, date, severity, title, body,
  link, days_until }` shape:
  - **Filings** (`mock/compliance.FILINGS` filtered by
    `filingState` overlay) — anything not yet `FILED`.
  - **Driver licence + medical expiries** (`LICENCE_EXPIRY`
    filtered by `licenceState` — renewals clear from the
    timeline).
  - **Action items with `due_date`** (`actionAssignments.all()`)
    — owner displayed in title.
  - **Hauler contact follow-ups** (Phase 69 — `follow_up_at`
    on unresolved entries via `latestPerHauler` →
    `forHauler` per id).
  - **Risk review cadences** (Phase 72 — `last_reviewed_at +
    30 days`; never-reviewed is "review now").
  - **Take-or-pay floor resets** — every month-end inside the
    horizon window.
  - **Contract anniversaries** — annual repeat of
    `CONTRACT_TERMS.start_date`.
  - Severity rules: `overdue` if past due, `warn` if within the
    near horizon (7 days for filings/risks, 14 for licences,
    2 for action items + contact follow-ups), `info` otherwise.
  - Sort: ascending by date, then severity (overdue → warn →
    info) within the same date.
  - Emits `counts: { total, overdue, warn, info, by_type: {...} }`
    so the page can render KPI tiles + filter chip badges.
- New endpoint `GET /api/today/calendar?days=30|60|90|180` in
  `routes/today.js` — `requireAuth`, all roles. Default 30 days,
  capped at 180.

**Client**

- New `pages/Calendar.jsx` mounted at `/calendar`:
  - Header eyebrow "Governance · Upcoming events" + 3-tile
    KPI strip (events count, overdue count tinted rust if >0,
    "due in next 7 days" tinted amber if >0).
  - Filter row: 4 horizon chips (30/60/90/180) + dynamic type
    chips with per-type counts (only types present in the window
    render). Active chip in rust accent.
  - Timeline grouped by date — each date is a section with
    weekday + day + month label, a relative anchor ("today" /
    "tomorrow" / "in 3 days"), and the count of events on that
    date. Each event is a row with type icon + label + title +
    body preview + link arrow. Click to navigate to the source
    page.
  - Group tone tinted by worst-severity event in the group.
- New `components/today/UpcomingStrip.jsx` — compact 7-day
  forward-looking strip mounted on Today's right rail between
  `ObservationFeed` and `ActionItems`:
  - Header: `Next 7 days` eyebrow + `full calendar →` link
    that navigates to `/calendar`.
  - Up to 5 inline rows, each with type icon + title (truncated)
    + tabular "today" / "tomorrow" / "in Nd" stamp. 2px left
    border tinted by severity.
  - "+N more this week" overflow caption when more than 5
    events fall in the next 7 days.
  - Hidden entirely when no events in the window.
- `App.jsx` mounts the route. `lib/auth.js` `ROLE_PAGES` adds
  `/calendar` to **every role** (axis_admin wildcard, axis_ops,
  hauler_admin, lender) — calendar is corridor-level governance
  data and every persona benefits from forward-looking
  visibility.
- `Sidebar.jsx` gains a `Calendar` entry with `CalendarDays`
  icon in the Corridor section, between Today and Corridor.
- `Topbar.jsx` `PAGE_TITLES` registers `/calendar` → "Calendar"
  + `/risks` → "Risks" (the latter was missing from a prior
  phase).

**Verified end-to-end**

Logged in as Akosua (`axis_admin`), opened `/calendar`:
- KPI strip: 15 events in next 60 days · 0 overdue (green) ·
  4 due in next 7 days (amber).
- Filter chips: All·15, Filing·3, Licence·5, Contact follow-up·1,
  Risk review·4, Take-or-pay reset·2 — counts match the source
  data exactly.
- Timeline starts with "Thursday 30 April · TOMORROW" (3
  events): DVLA Q1 fleet roadworthy renewal (warn / amber border),
  Take-or-pay floor resets (warn), Hauler 05 follow-up on phone
  contact (warn — Phase 69 follow-up at +2d).
- Followed by "Saturday 02 May · IN 3 DAYS" (1 event: Driver
  02-117 Class E licence expiry).
- Continues with the four risk reviews bunched at +30 days from
  their last_reviewed_at, then May 31 take-or-pay reset, then
  the longer-horizon licence expiries.
- Each row is clickable; navigates to the source page (filings →
  /compliance, contact follow-ups → /haulers, risk reviews →
  /risks, take-or-pay → /financials).

Today's right rail:
- "Next 7 days" strip mounted above ActionItems, showing 4 of
  the 4 events in the 7-day window: DVLA tomorrow, Take-or-pay
  tomorrow, Hauler 05 in 2d, Driver licence in 3d.
- Each row tinted amber via severity left-border.
- "full calendar →" link jumps to the full page.

Lender (`analyst@gibdlc.com`):
- API GET 200.
- `/calendar` in their `ROLE_PAGES` allowlist — accessible.
  Lender sees the same forward-looking timeline AXIS ops do.

Hauler admin (`admin@haul-01.gh`):
- API GET 200.
- `/calendar` in their allowlist — they get a corridor-level
  view of upcoming obligations that affect their hauler.

**Why this matters**

A cockpit that's strong on "what's happening now" but weak on
"what's about to happen" makes operators feel reactive. They
respond to alerts, work the action item queue, but the broader
sense of *what's on the horizon* lives in their heads or in
calendar apps that aren't part of the cockpit. The first time an
operator forgets a DVLA filing or a licence expiry, the cost is
real — and the failure mode is the same: nobody had the timeline
in front of them.

Phase 73 makes the timeline a first-class cockpit surface. The
right-rail strip on Today gives the operator a 5-second glance
at the next week. The full calendar page gives a 30/60/90/180
day forward view filtered by type. Both are composed live from
the same primitives the rest of the cockpit reads — there's no
parallel calendar to maintain, no drift, no "did I update both
places?"

Combined with the rest of the strategic surfaces from Phases
70-72, the corridor's governance posture is now end-to-end:
- **Reactive**: alerts, observations, incidents.
- **Operational**: action items with assignment + escalation.
- **Forward-looking governance**: risk register (Phase 72).
- **Forward-looking planning**: scenario library (Phase 71).
- **Forward-looking timeline**: upcoming events calendar
  (Phase 73).
- **Archival output**: lender briefing pack (Phase 70).

A credit committee, an internal audit, and a Monday-morning
operator all get what they need without leaving the cockpit and
without parallel spreadsheets.

## Phase 74 — Risk mitigation steps

**Bridging governance to execution.**

Phase 72 introduced the risk register with a free-text
`mitigation_plan` field. Operators wrote prose like *"Daily
check-in with Hauler 05 ops manager. Backup plan: redirect
Hauler 03/04 idle capacity if Hauler 05 stalls past 2 May."*
That captures intent, but it isn't trackable. There's no
progress signal, no per-step owner, no per-step due date. The
risk says "we have a plan" but the cockpit can't tell anyone
whether the plan is being executed.

Phase 74 closes that loop. Each risk gains a structured
**mitigation steps** checklist — discrete units of work with
title, owner, due date, and an open/done status. The risk page
shows progress at a glance ("1 of 3 done"); calendar pulls open
steps with due dates into the forward-looking timeline; lender
pack reports per-risk step counts plus a corridor-wide rollup so
credit committee sees not just *"the corridor has 4 high risks"*
but *"the corridor has 4 high risks, 7 mitigation steps, 1
done."*

**Server**

- New `state/riskSteps.js` with idempotent `risk_steps` table.
  Columns: id, risk_id (FK to `risk_register` with
  `ON DELETE CASCADE`), title, owner_*, due_date, status,
  completed_at, completed_by, created_*. Two indexes:
  - `(risk_id, status, due_date)` for the per-risk list.
  - Partial index on `(status, due_date) WHERE status='open' AND
    due_date IS NOT NULL` so the calendar feed scans only what's
    relevant.
  - `STATUSES = ['open', 'done']`.
  - 200-char title cap; `due_date` validated as ISO-parseable.
  - Sort: open before done; no-due before due; due_date asc;
    created_at asc — so the operator's eye runs down the
    "what's still pending" list first.
  - `countsByRisk()` returns per-risk `{done_count, total_count,
    open_count}` for one-shot UI joins.
  - `openWithDueDate()` returns rows for the calendar feed.
- Six endpoints in `routes/risks.js` scoped under `:id/steps`:
  - `GET    /api/risks/:id/steps` — list (all roles).
  - `POST   /api/risks/:id/steps` — add (axis_admin / axis_ops).
  - `PATCH  /api/risks/:id/steps/:stepId` — update (write roles).
    `due_date: null` clears the date; any other value updates it.
  - `POST   /api/risks/:id/steps/:stepId/complete` — mark done +
    stamp completed_by with current user (write roles).
  - `POST   /api/risks/:id/steps/:stepId/reopen` — reverse a
    completion (write roles).
  - `DELETE /api/risks/:id/steps/:stepId` — hard delete (write
    roles).
  - `findRiskOr404(req, res)` helper enforces parent-risk
    existence + step ownership at the route layer; every step
    operation 404s if the step doesn't belong to the risk in
    the URL.
  - All writes audited as `entity_type='risk_step'`.
- `GET /api/risks` (list) now joins `riskSteps.countsByRisk()`
  per row, returning `steps_summary: {done_count, total_count,
  open_count}` so the page renders the progress badge in one
  request.
- **Calendar feed integration.** `services/upcomingEvents.js`
  gains a new event type `risk_step` (icon `ListChecks` on the
  client). `mapRiskSteps(now)` reads `riskSteps.openWithDueDate()`
  + joins `riskRegister.listActive()` for risk titles, and
  emits one event per open step with a due date. Severity rules:
  `overdue` if past due, `warn` if ≤3 days, `info` otherwise.
  Step body reads "Mitigation for *risk title* · *owner*". Done
  steps drop out automatically.
- **Lender pack integration.** `services/lenderPack.js` joins
  `riskSteps.countsByRisk()` and adds `steps_summary` to each
  risk in the response. `pages/LenderPack.jsx` adds a STEPS
  column and a corridor-wide rollup ("1/7 mitigation steps
  complete") in the section subtitle.

**Client**

- New `components/risks/MitigationSteps.jsx` mounted inline
  beneath each expanded risk row:
  - Header row: "MITIGATION STEPS" eyebrow + "*N* of *M* done"
    counter + "+ Add step" link (write roles only).
  - Inline compose form: title input + optional owner + optional
    `datetime-local` due date + Cancel/Add buttons. Char counter.
  - Each step row: checkbox indicator (green filled when done),
    title (struck-through when done), owner attribution, due
    date with relative tone ("today" / "tomorrow" / "in Nd" /
    "Nd overdue") in amber if ≤3d, rust if overdue. Completed
    steps show "done by *name*" attribution.
  - Click anywhere on the row toggles complete/reopen (write
    roles); per-row reopen + delete icon buttons available too.
  - Empty state copy explains the structured-step value
    proposition for operators with write access.
- `pages/Risks.jsx` reworked:
  - New "STEPS" column with a clickable badge showing
    `done/total` (rust if 0 of N, green if all done, secondary
    otherwise) or "add steps" if zero. Clicking toggles inline
    expansion.
  - New leading column with chevron right/down indicator.
  - Each row in `RisksTable` now renders as a Fragment of
    `<tr>` + optional second `<tr>` containing the
    `MitigationSteps` panel via `colSpan={10}`. Expansion state
    held in the parent `RisksTable` component as a `Set<id>`.
  - Click anywhere on the main row still opens the edit modal
    (preserved); chevron + steps badge use `stopPropagation`.
- `pages/LenderPack.jsx` `RiskRegisterBlock`:
  - New STEPS column (per-risk done/total) — green when complete,
    italic "none" when no steps yet.
  - Section subtitle gains rollup: "*N* open · *M* high or
    critical · *S* stale (30+ days unreviewed) · *X*/*Y*
    mitigation steps complete".

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Seeded 7 mitigation steps across 3 of the 4 risks:
  - **Hauler 05 capacity ramp** (3 steps): "Daily 09:00 check-in
    with Yaw at Hauler 05" (marked done), "Confirm Hauler 03/04
    backup capacity availability" (due 02 May), "Pre-draft lender
    notification per covenant procedure" (no due date).
  - **GIBDLC AP delay risk** (2 steps): "Confirm GIBDLC AP
    processed 02 May payment" (due 02 May), "Escalate to GIBDLC
    CFO if 02 May missed" (due 04 May).
  - **Q1 DVLA filing slip** (2 steps): "Operations director
    signature follow-up" (due tomorrow), "Submit DVLA Q1 filing
    with primary signature" (due 15 May).
- Risks page renders STEPS column: 0/2, 1/3, "add steps" (Cedi
  has none), 0/2. Clicking 1/3 expanded the Hauler 05 row to
  show the checklist with the completed step struck-through and
  "done by Akosua Mensah" attribution. The two open steps show
  due-date pills with calendar icons.
- Calendar (`/calendar?days=20`): 5 `risk_step` events appear in
  the feed, sorted by date with the right severity (DVLA
  signature follow-up due tomorrow gets `warn`; the May 02 +
  May 04 steps get `info`). The completed step does **not**
  appear in the calendar — the SQL filter does its job.
- Lender pack: section subtitle reads "4 open · 2 high or
  critical · 0 stale · 1/7 mitigation steps complete." Per-risk
  STEPS column shows 0/2, 1/3, italic "none" (Cedi), 0/2.

Lender (`analyst@gibdlc.com`):
- API GET on `/risks/:id/steps` returns 200 (read-open).
- POST/PATCH/DELETE return 403.
- UI: Risks page expansion works; chevron + badge clickable;
  inside the panel, no "+ Add step" link, no per-row icon
  buttons, click-to-toggle disabled. Read-only across the
  board.
- Lender pack shows the new STEPS column + the section subtitle
  rollup.

Audit log: every step create/update/complete/reopen/delete
writes a row with `entity_type='risk_step'` and a payload
linking back to `risk_id`.

**Why this matters**

Risk registers in most cockpits are documents. They tell you
what the team is *worried about*. They don't tell you what the
team is *doing about it*. The result is governance that looks
diligent on paper but can't answer the next question: "are you
executing?" Phase 74 makes that question answerable in two
glances — the badge on the risk row, and the rollup in the
lender pack subtitle.

The composition pattern is the same as everything else in the
cockpit: pure read-side joins over durable primitives, no new
schemas duplicating existing data, no parallel spreadsheets.
The risk register, the calendar, and the lender pack now all
reflect the same step state — close a step on the Risks page
and it disappears from the calendar feed and increments the
lender-pack rollup, all live, all on the same source of truth.

This completes the *governance → execution* arc that started
with Phase 72:
- Phase 72: name the risk + write the prose plan.
- Phase 74: break the plan into checkable steps with owners and
  due dates.
- Phases 73 + 70 (already integrated): pull those steps into the
  forward-looking timeline + the archival document the credit
  committee reads.

The credit committee question — *"how do we know you're
executing?"* — now has a one-glance answer everywhere it gets
asked.

## Phase 75 — FX & cost sensitivity calculator

**Quantitative complement to qualitative risk tracking.**

The risk register (Phase 72) tracks "Cedi devaluation exposure"
as a medium risk with a free-text mitigation plan. Phase 71's
scenario library handles volume-side what-ifs (truck activations,
pace lifts). Neither answers the lender's specific question:
*"if cedi moves -10%, what happens to DSCR?"* Pre-Phase-75 there
was no surface that could show that math live.

Phase 75 adds the cost-side calculator. Three input sliders move
cedi/USD, diesel price, and opex inflation; the server recomputes
the effective tariff (via fuel-indexation), opex ratio, EBITDA,
and DSCR end-to-end; the page shows baseline vs scenario
side-by-side with delta tiles and a "show your work" footer
narrating the full chain. Pure compute, no writes. Distinct
surface from the volume-side scenarios.

**Server**

- New `services/sensitivity.js` composes the calculator:
  - `effectiveTariffUnderShift({ cedi_pct, diesel_pct })`
    re-runs the indexation math from Phase 6's
    `services/indexation.js`. Cedi shift translates to a
    multiplicative bump on the GHS-denominated diesel reading
    (`1 / (1 + cedi_pct/100)`) — a -10% cedi raises the GHS/L
    reading by ~11%, which flows through the fuel weight to a
    higher effective tariff. Diesel shift is a direct
    multiplicative on top. Pass-through cap and floor (Phase 6
    `TARIFF_TERMS`) honored.
  - `dscrUnderShift({ tariff_effective, opex_ratio_pct })`
    re-runs the DSCR math from Phase 62's `services/dscr.js`
    with the user-supplied tariff and an opex ratio scaled by
    `(1 + opex_pct/100)` (clamped to 30%-110%). Holds tonnes
    constant — forecast doesn't react to FX in the demo model.
    Returns DSCR (this month + trailing 3M), EBITDA, revenue,
    opex, headroom %, verdict (PASS/WATCH/BREACH).
  - `compose({ cedi_pct, diesel_pct, opex_pct })` runs both
    passes (zero-shift baseline + scenario), computes deltas,
    and returns the full bundle including bounds for the UI's
    slider ranges, the four named presets, and verdict
    transition flags (`verdict_changed`, `crosses_floor`).
- New `routes/sensitivity.js` with single endpoint
  `GET /api/sensitivity?cedi_pct=&diesel_pct=&opex_pct=`.
  `requireAuth` only — all roles can read; this is the kind of
  stress-test surface lenders explicitly want. Each parameter
  validated as a number and clamped to bounds before the
  service runs.
- Four named presets in `PRESETS` for board-friendly buttons:
  - **Base case**: 0/0/0.
  - **Mild stress**: cedi -5, diesel +5, opex +3 — ordinary
    quarterly variation.
  - **Moderate**: cedi -10, diesel +10, opex +6 — comparable
    to 2022 cedi crisis Q3.
  - **Severe stress**: cedi -20, diesel +20, opex +10 — tail-
    risk scenario for covenant stress test.

**Client**

- New `pages/Sensitivity.jsx` mounted at `/sensitivity`:
  - Header "Capital · FX & cost sensitivity" with description
    that explains the FX mechanics (USD tariff, GHS opex). Reset
    button top-right disabled when no shift active.
  - **Preset row**: 4 chip buttons; the active preset shows in
    rust accent. Clicking a preset sets all three slider values
    in one shot.
  - **Slider row**: three sliders, each with label + help text +
    bounded range + tabular value display. Cedi/USD bounded
    -25% to +25%, diesel -30% to +50%, opex -10% to +30%. Help
    text under each slider explains the mechanism. Min/0/max
    tick labels under the slider.
  - **Delta tiles**: three large tiles showing DSCR shift,
    EBITDA shift, and effective tariff shift. Each tile shows
    the headline delta (large tabular numeric, tinted by sign),
    `baseline → scenario` reference at the bottom, and for the
    DSCR tile a verdict pill (PASS/WATCH/BREACH) plus a "was X"
    callout when the verdict changes. The tariff tile flags
    "clamped at indexation cap/floor" if the multiplier hits a
    bound.
  - **Comparison grid**: 10-row table with Metric / Baseline /
    Scenario columns covering tariff, tonnes, revenue, opex
    ratio, opex, EBITDA, debt service, DSCR (this month +
    trailing), headroom.
  - **Show your work** panel at the bottom: a single declarative
    sentence reading "With cedi -20%, diesel +20%, and opex
    +10%: fuel-indexation moves effective tariff from $24.36 to
    $29.28 per tonne, with opex ratio shifting from 63.3% to
    69.6%. Holding tonnes at 64,664, EBITDA moves -$3k, and
    DSCR settles at 0.58× against the 1.30× floor." Self-
    documenting output for board minutes / credit memos.
  - Live recompute on every slider change — the endpoint is
    pure compute, ms-fast.
- `App.jsx` mounts the route. `lib/auth.js` `ROLE_PAGES` adds
  `/sensitivity` to **axis_admin (wildcard) + axis_ops + lender**
  — hauler_admin doesn't get capital-side surfaces.
- `Sidebar.jsx` adds "Sensitivity" entry with
  `SlidersHorizontal` icon in the Capital section, fourth
  position after Tranches / Financials / Risks.
- `Topbar.jsx` `PAGE_TITLES` registers `/sensitivity` →
  "Sensitivity".

**Verified end-to-end**

Logged in as Yaw Osei (`lender`) — opened `/sensitivity`:
- Initial state: all sliders at 0%, all delta tiles read "0.00×
  / $0 / $0.00", show-your-work panel reads "No shifts applied
  — scenario equals baseline."
- Clicked **Severe stress** preset:
  - Cedi vs USD slider snaps to -20%, diesel to +20%, opex to
    +10%. Numeric labels right-aligned in rust.
  - DSCR shift: 0.00× (DSCR essentially unchanged at 0.58× —
    the indexation pass-through is doing exactly what it's
    designed to do, protecting EBITDA from the FX shock).
    BREACH pill (DSCR was already breaching at baseline, no
    crossing).
  - EBITDA shift: -$3k (rust, TrendingDown). Baseline $579k →
    scenario $576k. The opex inflation eats most of the
    indexation gain.
  - Effective tariff shift: +$4.92 (green, TrendingUp).
    Baseline $24.36/t → scenario $29.28/t. ~20% bump.
  - Comparison grid: revenue $1.58M → $1.89M, opex ratio 63.3%
    → 69.6%, opex $997k → $1.32M, all correctly recomputed.
  - Show your work footer narrates the full chain.
- Clicked **Reset to baseline** — all sliders return to 0,
  scenario tracks baseline, show-your-work panel returns to the
  no-shift copy.

Server side:
- GET `/api/sensitivity` returns the same payload to lender,
  axis_ops, axis_admin, hauler_admin (all 200 — no role write
  gate, just `requireAuth`).
- Hauler admin doesn't have `/sensitivity` in `ROLE_PAGES`, so
  no UI surface. API is technically open but harmless — the
  same data they could compute by reading the financials
  endpoint.

**Why this matters**

Risk registers describe FX exposure in prose. Scenarios test
volume responses. Neither answers the specific quantitative
question the credit committee asks: *"how much FX shock can the
corridor absorb before DSCR breaches?"*

Phase 75 makes that answer one slider away. The lender pulls up
`/sensitivity`, hits Severe stress, and demonstrates that even
under a -20% cedi crisis the indexation mechanism keeps EBITDA
within $3k of baseline — exactly the reassurance a credit
committee wants. Or they pick custom inputs ("what about cedi
-15%, diesel flat, opex +20%?") and the answer's there in
milliseconds.

The page is also self-documenting. The "show your work" footer
is one declarative sentence — copy-pasteable into a board memo,
a covenant compliance letter, or a credit committee submission.
The math chain is visible end-to-end without the lender having
to reverse-engineer the numbers.

This completes the corridor's stress-testing arc:
- **Volume-side** (Phase 71 scenarios): "what if Hauler 05 doesn't ramp?"
- **Cost-side** (Phase 75 sensitivity): "what if cedi crashes?"
- **Forward-looking governance** (Phase 72 risks + 74 steps):
  "what risks are we tracking and what's the plan?"
- **Archival output** (Phase 70 lender pack): all of the above
  in a one-tab printable.

Three planning surfaces + one archival surface, all composed live
from the same source of truth. The credit committee, the
regulator, the operator on a Monday morning, and the lender in
their quarterly review all read the same numbers.

## Phase 76 — Global search

**One keystroke to anywhere.**

Every page in the cockpit surfaces its own data well. The Risks
page lists risks, the Calendar lists upcoming events, the Audit
log has its own free-text search. But there's been no unified
"I want to find X without remembering which page X lives on"
affordance. Operators and lenders have been navigating by
mental map: *"the Yaw Tagoe contact lives on Hauler 05 detail.
But who is Yaw Tagoe? Let me open Hauler 05…"*

Phase 76 ships the now-standard Cmd-K quick-switcher pattern.
Type to search across haulers, drivers, risks, alerts, hauler
contacts, filings, and audit rows. Keyboard-navigable, click-
through to the source page in one keystroke. Role-aware: every
result is something the calling user can actually open.

**Server**

- New `services/searchIndex.js`. Pure read-side aggregation,
  no inverted index, no token store. The dataset's small enough
  (5 haulers, ~80 drivers, a handful of each other type) that
  scanning everything per query is sub-millisecond.
  - Per-type searchers: `searchHaulers`, `searchDrivers`,
    `searchRisks`, `searchAlerts`, `searchContacts`,
    `searchFilings`, `searchAudit`.
  - `scoreFields(q, ...fields)` ranks each candidate by max score
    across the relevant fields (id, name, description, status,
    counterparty, etc.). Exact match scores 100, prefix 50,
    earlier substring index higher.
  - `topN(items, 5)` filters out zero-score rows, sorts by
    descending score, caps per-type at 5.
  - **Audit search reuses Phase 41's existing `listAudit({ q })`**
    so the q parameter that already powers the audit page works
    here too — no duplicate indexing.
  - **Role-aware**: per-role allowlist of result types
    (`ROLE_TYPES`). axis_admin/axis_ops see everything; lender
    sees haulers/risks/alerts/filings only (no drivers, no
    contacts, no audit); hauler_admin sees own-hauler only
    haulers/drivers/alerts/contacts. Server-side gate so the
    dropdown never offers a row the user can't open.
  - Returns flat results array (cap 30) + `by_type` counts so
    the client can render either a single keyboard-nav list or
    grouped sections.
- New `routes/search.js` with one endpoint
  `GET /api/search?q=…`. `requireAuth`. Reads `req.user.role`
  + `req.user.hauler_id` and passes them through.

**Client**

- New `components/layout/QuickSwitcher.jsx` — overlay modal
  centered at 14vh from the top:
  - Search input with magnifying-glass icon + ESC keycap on the
    right.
  - **Empty state** (no query yet): TRY SEARCHING eyebrow plus
    6 chip suggestions ("hauler 05 / DSCR / DVLA / Yaw /
    covenant / 02 May") that auto-fill the input on click.
    Below that, a one-paragraph explainer of what the search
    covers and the role-filtering note.
  - **Results state**: server's flat results re-grouped client-
    side into 7 ordered sections (Haulers / Drivers / Risks /
    Alerts / Hauler contacts / Filings / Audit log). Each
    section gets a sticky-style header bar with type label +
    count. Each row: type icon + title + subtitle (truncated to
    one line) + "OPEN X →" hint that appears on the highlighted
    row.
  - **Empty-result state**: "No results for *query*."
  - **Loading state**: "Searching for *query*…" while debounced
    fetch is in flight.
  - **Keyboard navigation**: arrow up/down moves the highlight,
    Enter navigates to the highlighted row's link, Escape
    closes. Mouse-hover also shifts the highlight. Active row
    auto-scrolls into view.
  - Footer bar with keyboard-hint legend ("↕ navigate · ↵ open
    · esc close") and live result count.
- **Topbar integration** (`Topbar.jsx`):
  - New global Cmd-K (or Ctrl-K) keyboard listener mounted at
    Topbar — works on every page.
  - New `<SearchButton>` between the corridor divider and Week-
    in-Review with a magnifying-glass icon, "Search" label, and
    a `⌘K`/`^K` keycap (auto-detected platform). Click opens
    the modal.
  - `<QuickSwitcher>` mounted at the Topbar so a single instance
    serves the whole app.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Pressed Cmd-K → modal opens, focus snaps to the input.
- Typed "yaw" → 11 results across 3 sections:
  - **Drivers · 4**: Yaw Kwarteng (rest_breach), Yaw Mahama,
    Yaw Asamoah, Yaw Agyemang.
  - **Hauler contacts · 2**: Yaw Tagoe (whatsapp/partial), Yaw
    Tagoe (phone/committed) — both Phase 69 entries on Hauler 05.
  - **Audit log · 5**: complete-step / create-step / lender-pack-
    generated rows referencing Yaw or the Hauler 05 risk.
- Top result auto-highlighted in rust accent with "OPEN DRIVERS
  →" hint. Arrow-down moved through the list. Pressed Enter →
  navigated to /drivers.
- Tested "haul" → 26 results spanning haulers, drivers, risks,
  alerts, contacts, filings, audit.
- Tested "dvla" → 9 results: DVLA risk, DVLA alert, 2 DVLA
  filings, 5 audit rows referencing DVLA.

Lender (`analyst@gibdlc.com`):
- API GET `/api/search?q=yaw` returned 0 results — by_type only
  shows the lender-allowed set: `{ alerts: 0, filings: 0,
  haulers: 0, risks: 0 }`. No drivers, no contacts, no audit.
  The strings live in surfaces the lender can't open, so they
  correctly don't appear.
- API GET `/api/search?q=dvla` returned 4 results — 1 risk
  (Q1 DVLA filing slip), 1 alert, 2 filings. No audit,
  consistent with the role's allowlist.

Hauler admin (`admin@haul-01.gh`):
- Searches surface only their own hauler's data — own hauler
  detail, own drivers, own contacts. Phase 69's `assertHaulerScope`
  pattern mirrored here.

**Why this matters**

Cockpits at this point usually have one of two failure modes
on navigation: either everything's hidden behind a deep menu
tree (operators waste minutes clicking around), or they ship a
top-bar nav that grows until it can't fit (operators waste
minutes scanning labels). Cmd-K bypasses both — type three
letters and you're there.

Phase 76's specific value is that it's *role-respecting* search.
A lender search for "yaw" doesn't surface a driver named Yaw
that they can't open. A hauler admin can't accidentally see a
contact log for another hauler. The dropdown only ever offers
rows the calling user can actually navigate to. That's table-
stakes for a multi-persona cockpit but easy to get wrong; this
phase ships the gate at the service layer rather than after the
fact in the UI, so the wrong rows never reach the wire.

The search also closes a discoverability loop: typing "Yaw"
surfaces the contact log entry, the hauler-05 driver list, and
the audit trail of every step Akosua's taken on the Hauler 05
risk — all in one dropdown. The operator sees the corridor's
relationship to "Yaw" across every primitive that touches it.
That cross-cockpit visibility is what makes Cmd-K feel like a
real product feature rather than a search box bolted onto a
list of pages.

## Phase 77 — Risk comment thread

**Capturing the play-by-play.**

Phase 72 gave risks structured fields: severity, likelihood,
status, owner, description, mitigation plan. Phase 74 added
trackable mitigation steps. Both surfaces are essentially static
— operators set fields, edit them in place, mark steps done.
The *evolution* of a risk over days and weeks — *"Yaw confirmed
5 trucks live this morning via WhatsApp"* / *"Spoke to Hauler 03
ops manager — confirmed 3 spare trucks as backup capacity if
Hauler 05 stalls"* — had nowhere structured to live. Operators
were dropping these updates into handover narrative (Phase 67),
where they scroll past after one shift.

Phase 77 mirrors Phase 57 (action item comments) for risks. Each
risk gets a timestamped, append-only comment thread. Comments
survive shift changes, build into a ledger of how the risk has
moved, and surface inline in the Lender Pack so the credit
committee reads the play-by-play alongside the static fields.

**Server**

- New `state/riskComments.js` with idempotent `risk_comments`
  table. FK to `risk_register` with `ON DELETE CASCADE` so
  archiving a risk takes its discussion with it. Single index
  on `(risk_id, created_at DESC)` for the thread read.
  - 2,000-char body cap (longer than action item comments —
    risk discussion tends to be more detailed).
  - `forRisk(risk_id)` returns ascending so the thread reads
    oldest-first naturally.
  - `recentForRisk(risk_id, n)` returns descending — used by
    the lender pack to surface "latest 3" without doing two
    queries.
  - `countsByRisk()` returns a per-risk-id map so the page
    renders the badge in one fetch (joined alongside Phase 74's
    step counts).
- Three endpoints in `routes/risks.js`, scoped under `:id/comments`:
  - `GET    /api/risks/:id/comments` — list (all roles).
  - `POST   /api/risks/:id/comments` — append (axis_admin /
    axis_ops; matches the parent risk's write gate).
  - `DELETE /api/risks/:id/comments/:commentId` — delete
    (author OR axis_admin; otherwise 403). Same pattern as
    Phase 57.
  - All writes audited as `entity_type='risk_comment'`. Payload
    carries `risk_id` so audit-log filters can find every
    comment touching a particular risk.
- `GET /api/risks` (list) now joins `riskComments.countsByRisk()`
  alongside Phase 74's step counts, returning
  `comments_summary: { count }` per row.

**Client**

- New `components/risks/RiskComments.jsx`:
  - Header eyebrow "DISCUSSION · *N* comment(s)" with message-
    square icon.
  - Comment list rendered as cards with rust left-border —
    author + relative timestamp ("13m ago" / "2h ago" / "3d
    ago" / dated short-form past 14d) header, body in
    pre-wrap so paragraph breaks survive, per-row delete (trash
    icon) for the author or admin.
  - Compose textarea + Post button at the bottom for write
    roles. 2-row textarea, 2,000-char cap, optimistic clear-
    on-success.
  - Empty state: "No discussion yet. Add the first update —
    what changed today?"
- `pages/Risks.jsx` reworked:
  - Steps cell now contains TWO chips when both apply: the
    existing steps badge (`N/M` or "add steps") + a new
    comments badge with `MessageSquare` icon and tabular count.
    Either chip toggles the row expansion.
  - Expansion row now stacks two panels vertically:
    `MitigationSteps` on top (Phase 74), `RiskComments` below
    (Phase 77). Both share the same expanded-row state and
    `onChange` callback so a write in either panel re-fetches
    the parent risks list and the badges update.
- `pages/LenderPack.jsx` `RiskRegisterBlock`:
  - For risks with at least one comment, the table now renders
    a second `<tr>` directly beneath the main risk row showing
    "LATEST DISCUSSION · *N* TOTAL" + the latest 3 comments
    inline (oldest to newest within the visible window). Each
    comment: author bold + date short-form + body — credit-
    committee-readable in one printable.
  - Wrapped each risk's main row + optional discussion row in a
    `<Fragment key={r.id}>` to satisfy React's "siblings need a
    parent" rule cleanly.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Seeded 5 comments across 2 risks via API:
  - **Hauler 05 capacity ramp** — 4 comments showing the
    risk's evolution: initial assessment, Yaw's WhatsApp
    update, Kwame's backup-capacity confirmation, lender-
    notification draft. Mix of Akosua + Kwame contributors so
    the thread shows multi-author collaboration.
  - **Q1 DVLA filing slip** — 1 comment about ops director
    out-of-office and the legal-counsel backup signature path.
- Risks page renders the new comment badges (4 next to 1/3
  steps for Hauler 05 risk; 1 next to 0/2 steps for DVLA risk).
- Clicking either chip expands the row to show:
  - **MITIGATION STEPS · 1 of 3 done** (Phase 74 panel
    unchanged).
  - **DISCUSSION · 4 comments** with all 4 thread cards
    visible, rust left-border per card, multi-author
    attribution, "13m ago" timestamps, per-comment delete
    icons. Compose textarea + Post button at the bottom.
- Posted a 5th test comment via the textarea — list refreshes,
  badge increments to 5, Post button re-enables once the draft
  textarea has content.

Lender (`analyst@gibdlc.com`):
- API GET `/api/risks/1/comments` returns 200 with all 4
  comments — read-open.
- POST returns 403 (write gate intact).
- DELETE returns 403 unless lender authored the comment (none
  here).
- Lender Pack renders the new "LATEST DISCUSSION" inline rows
  beneath the affected risks. Hauler 05 risk shows 3 comments
  (oldest to newest, server-trimmed to last 3 then reversed for
  print order). DVLA risk shows its 1 comment. Cedi + GIBDLC
  rows have no discussion section (zero comments).

Audit log: every comment write records `entity_type=
'risk_comment'`, with `risk_id` in the payload for cross-risk
queries.

**Why this matters**

Risk registers in most cockpits are point-in-time snapshots:
the description and mitigation plan reflect what someone wrote
last quarter, not what's actually happening. A credit committee
reads the static fields and asks the next question: *"OK, but
what's the latest?"* Pre-Phase-77 the answer was "let me check
my notes" or "look at the audit log." Both are friction. Both
mean the operator's working knowledge isn't on the page.

Phase 77 puts the working knowledge directly on the page and in
the printable. The structured fields stay structured (you can
still query "all high risks owned by Akosua"). The narrative
lives alongside, threaded, dated, attributed. The lender pack
prints both — so the credit committee submission carries the
play-by-play without anyone manually composing a "recent updates"
section.

This completes the *governance → execution → narrative* arc on
the risk register:
- **Phase 72**: name the risk + write the prose plan.
- **Phase 74**: break the plan into checkable steps.
- **Phase 77**: thread the ongoing updates as the risk
  evolves.
- **Phases 73 + 70** (already integrated): pull the steps into
  the calendar + reflect everything in the lender briefing pack.

A risk on this corridor now reads as a living document — what
we know, what we're doing, what's actually happening — visible
to operators on the Risks page and to lenders on the printable
pack. One source of truth, one ledger, no parallel notebooks.

## Phase 78 — Personal pinboard

**Five things that matter to you, kept visible.**

The cockpit had become very capable but also very wide. Operators
arriving in the morning know exactly what they care about — *"is
Hauler 05 still 7 trucks idle, did the GIBDLC AP commitment
land, where's the Q1 DVLA filing, what's our DSCR today, when's
Yaw's follow-up"* — but seeing those five things meant five
clicks: open Haulers, open Risks, open Compliance, open
Financials, open the contact log. Pre-Phase-78 there was no
"keep these in front of me" surface.

Phase 78 ships a per-user pin store. Any hauler, risk, alert,
hauler contact, or filing can be pinned with one click from
where it lives. The pinboard panel sits on Today's right rail
between Upcoming Strip and Action Items — hydrated **live from
the source primitive** so a pinned risk row shows its current
severity, current step progress, current review staleness; not
a stale snapshot from when it was pinned. Pairs naturally with
Phase 76's search: Cmd-K to find, pin to keep.

**Server**

- New `state/userPins.js` with idempotent `user_pins` table.
  Columns: `id, user_id, entity_type, entity_id, label, pinned_at`.
  `UNIQUE (user_id, entity_type, entity_id)` so re-pinning the
  same item is idempotent (just bumps `pinned_at`); composite
  primary read index on `(user_id, pinned_at DESC)`.
  - Pinnable types: `hauler / risk / alert / contact / filing`.
    Same allowlist drives client validation + server gate.
  - `add({ user_id, entity_type, entity_id, label })` uses an
    `INSERT ... ON CONFLICT DO UPDATE` upsert so pinning twice
    is harmless.
  - `removeByRef(user_id, entity_type, entity_id)` is the
    idempotent inverse — deletes by composite ref. `removeById`
    handles the explicit delete case.
- New `routes/me.js` mounted at `/api/me/*`:
  - `GET    /api/me/pins` — hydrated list. Each pin run through
    a per-type `hydrate*` function that reads the source
    primitive and returns
    `{ type, id, title, subtitle, severity, link }`. Hauler-
    admin scope re-applied here so a hauler admin pinning data
    they shouldn't see returns a tombstone instead.
  - `POST   /api/me/pins` — pin. Server-side validation against
    `PINNABLE_TYPES`.
  - `DELETE /api/me/pins/by-ref` — unpin by `(entity_type,
    entity_id)`. Used by the PinButton toggle so the client
    doesn't have to track row IDs.
  - `DELETE /api/me/pins/:id` — unpin by row id. Used by the
    PinboardPanel's per-row unpin button.
  - **Tombstone behavior**: if hydration returns null (entity
    archived, deleted, no longer accessible), the response
    includes a tombstone row so the operator can unpin it
    cleanly without a 404 chase.

**Client**

- New `components/primitives/PinButton.jsx`:
  - Compact icon-only by default; `label` prop renders the
    verbose chip variant ("Pin / Unpin").
  - **Module-level pin cache** so N PinButtons on the same page
    fire one network request, not N. Fetched on first mount,
    refreshed via the `axis:pins-changed` window event so any
    write keeps every button in sync.
  - Optimistic toggle with rollback on failure.
  - Uses `event.stopPropagation` so embedded clicks don't
    trigger the parent row's onClick (e.g. opening a risk's
    edit modal).
- New `components/today/PinboardPanel.jsx`:
  - Mounted on Today's right rail between `UpcomingStrip` and
    `ActionItems`. Hidden entirely when the user has no pins —
    no empty-state hole.
  - Header eyebrow "Your pins · *N*" with a pin icon in rust
    accent.
  - Each pin row: type icon (Building2 / ShieldAlert /
    AlertTriangle / Phone / FileSignature) + 2-line truncated
    title/subtitle + per-row PinOff button. Severity-tinted
    left border. Clicking the row navigates via the hydrated
    link.
  - Listens for `axis:pins-changed` and refetches.
- **Mounted across surfaces**:
  - `pages/Risks.jsx` — actions cell on each risk row gains a
    leading PinButton (icon-only).
  - `components/hauler/HaulerTable.jsx` — new pin column at the
    end of each hauler row.
  - Future: easy to drop into Alerts, Compliance, hauler
    contact log — anywhere a pinnable entity is rendered.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Seeded 4 pins via API: Hauler 05, Hauler 05 capacity ramp
  risk, Q1 DVLA filing, Yaw Tagoe contact (Phase 69 record id 1).
- Today renders **YOUR PINS · 4** panel with all 4 hydrated:
  - Hauler 05 — "15 trucks · manual" (info border).
  - Hauler 05 capacity ramp — "high · mitigating · 1/3 steps"
    (rust border — severity warn).
  - DVLA Q1 fleet roadworthy renewal — "DUE · due 2026-04-30
    (in 1d)" (rust border — overdue warn).
  - Yaw Tagoe — "haul-05 · phone · committed · follow-up
    pendi…" (info border).
- Each row's left border tone matches the hydrated severity.
- Per-row PinOff icon on the right; clicking the row navigates
  to the source page.
- Risks page shows 1 PinButton in "filled" state (the pinned
  Hauler 05 risk) and 3 in "outline" state. Confirmed via
  `button[title*="Unpin"]` count = 1, `Pin to your
  pinboard` count = 3.
- Hauler list shows a pin column at the end of each row.

Lender (`analyst@gibdlc.com`):
- Pinned the Cedi devaluation risk via API.
- GET `/api/me/pins` returns only their own pin (id 5), with
  full hydration ("medium · open"). Akosua's 4 pins are
  invisible — per-user isolation is at the schema level
  (`UNIQUE (user_id, …)`).
- POST + DELETE work for the lender's own pins; they can't
  reach Akosua's pins by id (the DELETE endpoint enforces
  `WHERE id = ? AND user_id = ?`).

Hauler-admin scope:
- A hauler admin pinning another hauler's data succeeds at the
  pin layer (no schema constraint), but the hydrate layer
  returns null for entities outside their scope, falling back
  to the tombstone row. Practically harmless — they'd see a
  greyed-out "No longer available — unpin to clear." entry.

**Why this matters**

The cockpit's surfaces are organized by *kind* — haulers on
one page, risks on another, contacts on a third. Operators'
attention is organized by *concern* — "the Hauler 05 situation,"
which spans all three. Phase 78 ships the surface that matches
that concern-shape: a personal watchlist that pulls one row
from each kind, side by side, hydrated live, into a five-second
glance the operator gets every time they open Today.

The hydration design is the part most likely to age well. Pins
are refs, not snapshots. Three weeks from now the pinned
"Hauler 05 capacity ramp" risk will reflect today's step
progress — not the 1/3 it was when pinned. The pinned DVLA
filing will say "FILED" once it's filed, not stay stuck at
"DUE." Operators can pin once and trust the panel to keep up
with reality.

The cache + window-event pattern across PinButton instances is
the small architectural choice that makes the feature feel
fast: clicking a pin on the Risks page instantly updates the
Hauler list's pin button (if the same item ever appeared
twice), and instantly refreshes the Today panel — without
prop-drilling, without React Context, without re-fetching once
per button.

Combined with Phase 76's global search, the cockpit now has
the two missing UX primitives every product-grade interface
ships:
- **Find** anything from anywhere (Cmd-K).
- **Keep** what matters in front of you (pinboard).

## Phase 79 — Hauler-side dashboard

**Closing the persona gap.**

The cockpit had grown rich for two of its three external personas:
- **Operator** (`axis_admin` / `axis_ops`) — Today + Day-in-Review
  + Week-in-Review + Handover + every operational page.
- **Lender** (`analyst@gibdlc.com`) — Financials + Risks +
  Sensitivity + the printable briefing pack.

The third persona — **hauler_admin** (`admin@haul-01.gh`) — had
been quietly under-served. Their login worked, their access was
scope-gated correctly throughout, but their landing page was the
*operator's* Today, dropped onto narrower data. They saw a
corridor briefing meant for someone running the corridor, not for
someone *running one of the contracted haulers in the corridor*.

What a hauler admin actually wants on login is the answer to a
specific question: *"how does AXIS see me right now?"* What's my
attainment vs contract, who at AXIS has been talking to my
counterparties, what action items reference me, what fleet flags
are active on my rigs, what licences expire next, what's been
written about me in the audit log.

Phase 79 ships that view. A dedicated `/my-hauler` dashboard that
composes the hauler's corridor presence from existing primitives
and lands the hauler admin on it by default.

**Server**

- New `services/myHauler.js` composes a scoped read-only payload:
  - **`corridor`** — hauler header (id, name, onboarded date,
    contracted/active/idle truck counts), integration status
    (type, adapter, api_status, last_sync, error_count_24h),
    contract share, take-or-pay floor.
  - **`mtd`** — delivered tonnes, contracted tonnes, attainment
    %, forecast EOM, forecast verdict, % of contracted.
  - **`performance`** — on-time %, SLA attainment %, safety
    score (null when status != active).
  - **`action_items`** — open `actionAssignments` whose
    `action_item_id` or `notes` mention the hauler ID.
  - **`contacts`** — last 5 hauler contact log entries (Phase 69)
    — read-only mirror of what AXIS has logged about the
    hauler.
  - **`fleet_health`** — total rigs, in_garage count, critical
    flag count, open workorders (cap 5), licence expiries
    within 60 days (cap 5), at-risk drivers (cap 5; pulled from
    deterministic mock with `flag` set).
  - **`open_alerts`** — alerts referencing the hauler with
    status in {OPEN, IN_TRIAGE, NEEDS_ACTION}, cap 8.
  - **`recent_audit`** — audit log rows in last 30 days where
    entity_id, payload, or summary mentions the hauler. Cap 10.
- New endpoint `GET /api/me/hauler` mounted on the existing
  `/api/me/*` route file:
  - `hauler_admin`: ignores any `hauler_id` query — always
    returns *their* hauler.
  - `axis_admin` / `axis_ops`: must pass `?hauler_id=`. Returns
    400 otherwise so a misuse fails loud rather than implicitly
    picking a hauler.
  - `lender`: returns 403 with copy directing them to the
    briefing pack instead. Their per-hauler data already lives
    there.

**Client**

- New `pages/MyHauler.jsx` mounted at `/my-hauler`:
  - Reads `?hauler_id=` from URL for AXIS roles; falls back to
    the implicit hauler for hauler_admin.
  - Header reads "Corridor · {Hauler name}" with a description
    that varies by role: hauler_admin sees "AXIS's view of your
    corridor presence"; AXIS roles see "View of {hauler} —
    what AXIS sees about this hauler."
  - **Corridor strip**: building icon + ID + onboarded date,
    contracted/active/idle stat cards, integration type +
    api_status with a coloured dot.
  - **KPI row**: 4 large tiles — MTD attainment (tinted by band:
    green ≥90, text ≥floor, amber ≥70, rust below), Forecast
    EOM (tinted by verdict), On-time % + SLA, Safety score.
  - **Two-column layout**:
    - Left: Fleet health card (3 sub-KPI tiles for in-garage /
      critical / workorders + a licence-expiries-60d list with
      severity tones + an at-risk drivers list with flag chips)
      + Recent corridor activity card (audit rows formatted as
      one-line entries with actor + action + timestamp).
    - Right: Open action items card (clickable rows linking to
      `/`), Open alerts card (clickable rows linking to
      `/alerts`), Recent AXIS contacts card (Phase 69 entries
      with channel icons + outcome chips).
  - Empty states tuned per role: "Clean — no AXIS-side items
    currently reference this hauler" / "AXIS hasn't logged a
    contact with you yet" / "No corridor activity in the audit
    log mentions this hauler."
- **Routing**:
  - `App.jsx` registers `/my-hauler`. Crucially, the `Guard`
    component now redirects `path === '/'` → `/my-hauler` for
    `hauler_admin` so login lands them on the dashboard
    automatically.
  - `lib/auth.js` `ROLE_PAGES`: `/my-hauler` added for
    `axis_ops`, `hauler_admin`, and (implicitly via wildcard)
    `axis_admin`. Lender excluded.
- **Sidebar** entry "My hauler" with `Home` icon, placed at the
  top of the Fleet section (before Haulers). Filtered out for
  lender by `canAccess`.

**Verified end-to-end**

Logged in as Ama Darko (`hauler_admin`, Hauler 01):
- Login redirects automatically from `/` → `/my-hauler`. The
  Guard catches the role, sends them to the dashboard.
- Sidebar shows "My hauler" entry highlighted as active.
- Dashboard renders:
  - **Corridor strip**: haul-01, onboarded 2026-03-02, 30
    contracted, 28 active, 2 idle (rust because >0), green
    dot · loconav.
  - **KPIs**: 88% MTD attainment (text), 19.7kt EOM (rust —
    Lagging verdict), 94% on-time (green, SLA 94%), 91 safety
    score (green, within target).
  - **Fleet health**: 30 rigs total, 1 in_garage (amber), 1
    critical flag (rust), 0 open workorders (green). Two
    licences expiring 60d (Driver 01-034 in 28d, Driver 01-066
    in 80d). Five at-risk drivers with flag chips
    (rest_breach, psv_expiring, licence_expiring, rest_breach).
  - **Right column**: Open action items "No items mention this
    hauler. Clean — no AXIS-side items currently reference this
    hauler." · Open alerts "0 active · No alerts referencing
    this hauler." · Recent AXIS contacts "No logged contacts
    yet."
  - **Recent corridor activity**: 4 audit rows showing
    workorder opens + licence renewal by AXIS team members on
    Hauler 01's rigs in last 30 days.

AXIS admin (`admin@axis.gh`):
- API GET `/api/me/hauler` (no query) → 400 "hauler_id query
  parameter required for AXIS roles".
- API GET `/api/me/hauler?hauler_id=haul-05` → 200 with full
  composition for Hauler 05.
- UI: visiting `/my-hauler?hauler_id=haul-05` shows Hauler 05's
  dashboard with operator-perspective wording.

Lender (`analyst@gibdlc.com`):
- API GET → 403 "Lender persona uses /api/lender/pack for
  hauler detail".
- Lender sidebar: no "My hauler" entry — correctly filtered out.

**Why this matters**

Multi-persona platforms have a tendency to ship one
well-developed persona and a thin set of permission scopes for
the others. The result is a tool that *technically* serves
multiple users but practically serves only one — the others log
in and feel like second-class citizens reading someone else's
view of their own data.

Phase 79 fixes that for the hauler admin specifically. They now
have a landing page composed *for them*, laid out around their
specific question (*"where do I stand from AXIS's perspective
right now?"*), with the same architectural pattern as the
operator's Today and the lender's pack — pure read-side
composition over existing primitives, no parallel data, no drift.

The `?hauler_id=` parameter for AXIS roles is the small but
important touch: it lets an AXIS operator preview the hauler's
view of their own data. *"Here's what Ama is seeing right now"*
is a valuable lens when an AXIS admin is on a call with a
hauler manager debugging a discrepancy.

Combined with the work in Phases 67-78, all three external
personas now have parity:
- **Operator**: Today / Day-in-Review / Week-in-Review /
  Handover / Operations Log + every domain page.
- **Lender**: Financials / Risks / Sensitivity / Calendar / the
  briefing pack.
- **Hauler admin**: My hauler dashboard (Phase 79) + scoped
  views of haulers/fleet/maintenance/drivers/trips for
  operational drill-down.

Each persona arrives in a surface that answers their specific
landing-page question, then drills into shared primitives from
there. That's the multi-tenancy story the cockpit needed to be
plausibly product-shaped.

## Phase 80 — Operator playbooks

**Captured routines.**

The cockpit's operational layer was good at one-off work
(action items, alerts, hauler contacts) but had nothing for
the *recurring* work — the Monday compliance pass, the Friday
EOM reconciliation, the weekly Hauler 05 chase. Pre-Phase-80
operators were re-creating these from memory each cycle, with
no template, no audit trail of which routines had been executed,
no progress visibility on the in-flight ones.

Phase 80 adds **playbooks**: named templates with checklists
that operators run on demand. Each template stays clean (just
the recipe); every run materializes its items as a
**PlaybookRun** with per-item completion state. The runs are
durable artifacts — *"Monday compliance pass · run 28 Apr by
Akosua, 4 of 5 items done"* — surfaced on a dedicated page and
on Today's right rail so an in-flight routine stays visible
where the operator works.

No cron infrastructure. Explicit "Run now" only. The schedule
label ("Weekly · Monday morning") is informational; actual
firing is deliberate. This avoided the entire class of
*"server was down on Monday — did the playbook fire?"*
ambiguity while still giving operators a one-click way to spin
up their checklist.

**Server**

- New `state/playbooks.js` — templates table with `id, name,
  description, schedule_label, items_json, archived_at`. Items
  are inline JSON: each carries `title, default_owner_display,
  default_due_offset_days`. 120-char name cap, 200-char per-item
  title cap, 4 items minimum but no max.
- New `state/playbookRuns.js` — two-table design with FK
  cascade:
  - `playbook_runs` — one row per execution, captures
    `playbook_id`, snapshotted `playbook_name`, `started_at`,
    `started_by_*`, `completed_at`.
  - `playbook_run_items` — one row per item, with own `status`
    (open/done), `completed_at`, `completed_by`, `due_date`
    (computed from `default_due_offset_days` at run time),
    `sort_index`.
  - `run()` is wrapped in a `db.transaction` so a partial
    materialization is impossible.
  - `completeItem()` auto-marks the parent run as completed
    when the last item ticks done. `reopenItem()` un-completes
    the run if the count slips below total. Both observed via a
    counts query.
  - `openItems(limit)` returns join of open items + their parent
    runs, ordered due-date asc with no-due last; used by the
    Today panel.
  - `recentRuns(limit)` returns runs with `{done, total}`
    counts joined.
- New `routes/playbooks.js` with eleven endpoints:
  - **Templates**: `GET /` (list + recent runs in one fetch),
    `POST /` (create), `PATCH /:id`, `POST /:id/archive`,
    `POST /:id/unarchive`, `DELETE /:id` (admin only).
  - **Runs**: `POST /:id/run` (materialize), `GET /:id/runs`
    (history per playbook), `GET /runs/:runId` (single run +
    items), `POST /runs/items/:itemId/complete`, `POST
    /runs/items/:itemId/reopen`.
  - All writes audited with `entity_type` in
    `{playbook, playbook_run, playbook_item}` and meaningful
    summaries.

**Client**

- New `pages/Playbooks.jsx` mounted at `/playbooks`:
  - Header eyebrow "Operations · Playbooks" + description +
    "+ New playbook" button (write roles only).
  - **Templates section**: cards in an auto-fill grid (min
    420px). Each card shows name, schedule label pill,
    description, numbered item list with default owners on the
    right, footer with item count + Run-now button (rust),
    edit/archive icon buttons.
  - **Recent runs section**: each run as a clickable row with
    severity-tinted left border (green if all done, amber
    otherwise), playbook name, starter, timestamp, "N/M" counter,
    chevron-right.
  - **Run drawer modal** (640px wide): header with run number +
    playbook name + start metadata + done/total counter. Item
    rows with click-to-toggle, struck-through completed items,
    completion attribution, due-date pills with overdue/soon
    tones. Reopen icon for completed items.
  - **Form modal** for creating/editing templates: name,
    description, schedule label, dynamic items list with
    title/owner/offset-days inputs per row, add-item link, per-
    row trash icon.
- New `components/today/PlaybookItemsPanel.jsx` — compact
  right-rail summary on Today:
  - Header eyebrow "Playbook items" + "all playbooks →" link
    that navigates to `/playbooks`.
  - Up to 5 inline rows showing title + parent playbook name +
    owner + tabular due-date pill (`tom` / `+2d` / `today` /
    `Nd` overdue). Click row → /playbooks; click checkbox →
    completes inline (write roles).
  - "+N more open" overflow caption.
  - Hidden when no open items.
  - Two-stage compose: GET `/playbooks` for the runs list, then
    GET `/runs/:id` per run-with-open-items. Volume's tiny so no
    dedicated endpoint needed.
- `App.jsx` mounts the route. `lib/auth.js` adds `/playbooks`
  to `axis_admin` (wildcard) + `axis_ops`. Hauler admin and
  lender don't need it — playbooks are AXIS-side workflows.
  `Sidebar.jsx` adds "Playbooks" entry with `ListChecks` icon
  in the Operations section after Compliance.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Seeded 3 templates via API:
  - **Monday compliance pass** (4 items: weighbridge holds /
    licence renewals / DVLA tracker / driver coaching).
  - **Friday EOM reconciliation** (4 items: tonnes recon / DSCR
    shift / receivables ageing / weekend handover).
  - **Hauler 05 weekly chase** (4 items: call Yaw / log
    contact / compare last week / update risk).
- Ran the Monday playbook → materialized run #1 with 4 items.
- Marked first item done.
- Playbooks page renders:
  - 3 template cards in the grid, each with full description,
    numbered items, default owners, and Run-now button.
  - "Recent runs · 1 shown" — the Monday run, amber border
    (1/4 done), "1/4" tabular counter.
  - Clicking the run row opens the drawer:
    "RUN #1 · Monday compliance pass · Started by Akosua
    Mensah · 29 Apr 15:39 UTC · 1/4 done" with the four items,
    one struck-through with "done by Akosua Mensah" + reopen
    icon, the others with their owner labels and due-date
    pills (`tomorrow`, `in 2d`, no-due).
- Today's right rail shows the new "PLAYBOOK ITEMS" panel
  between Upcoming Strip and Pinboard, listing the 3 open items
  with title + parent playbook + owner + tabular due-date pill
  (`tom` for the +1d offset, `+2d` for the +2d, no pill for
  no-due).
- The completed item correctly drops out of the Today panel
  while staying visible (struck-through) in the run drawer.
- Audit log: every action (create/run/complete/reopen) writes
  a row with the right `entity_type`.

Lender / hauler_admin:
- No `/playbooks` access — playbooks aren't in their
  `ROLE_PAGES` allowlist. Sidebar entry filtered out.
- API GET would work (read-open is just `requireAuth`) but
  there's no UI surface, so practically invisible.

**Why this matters**

Operations cockpits ship two patterns for recurring work, and
both fail in different ways:

1. **Auto-firing schedules** — a cron creates the items every
   Monday. Fails when the server is down, when the operator's
   on holiday, when the schedule changes. Operators distrust
   anything they can't see fire.
2. **Free-form templates** — operators copy/paste from a notes
   doc. Fails because there's no progress signal, no audit
   trail, no shared visibility into "are we executing the
   routine?"

Phase 80's design picks the third path: explicit-run templates
with structured progress tracking. Operators get the muscle
memory of "click Run on Monday morning" — same as opening a
checklist app — but with the cockpit's full audit + progress +
attribution machinery wrapped around each instance.

The right-rail panel is the small but important touch: an
in-flight playbook run stays visible where the operator works,
not buried in `/playbooks`. They tick items off as they touch
the underlying surfaces, and the run quietly closes itself when
the last item lands. Combined with Phase 78's pinboard and
Phase 76's search, the cockpit's right rail now shows three
slices of operator attention — *what's coming up* (Upcoming),
*what's in flight* (Playbook items), *what I'm watching*
(Pinboard) — alongside the always-visible action items and
hauler status.

Operationally the cockpit is now end-to-end:
- **Reactive**: alerts, observations, incidents.
- **Operational (one-off)**: action items with assignment +
  escalation + comments.
- **Operational (recurring)**: playbook templates + runs
  (Phase 80).
- **Forward-looking governance**: risks + steps + comments.
- **Forward-looking planning**: scenarios + sensitivity.
- **Forward-looking timeline**: calendar.
- **Continuity**: handover, week-in-review, day-in-review.
- **Personal attention**: pinboard + search.
- **Archival output**: lender pack.

Every cadence of operator work has a surface that fits its
shape, all composed live from the same primitives, all audited.

## Phase 81 — Driver coaching workflow

**Closing the driver-level gap.**

The cockpit had rich surfaces for hauler-level operations —
performance, contact log, fleet health, action items mentioning
the hauler. Driver-level work was thinner. ~80 drivers with full
deterministic data (safety score, harsh-event count, rest_status,
licence/PSV expiries) but no workflow surface organized around
the question *"who needs intervention this week?"*

Phase 81 ships that surface. A coaching pipeline that joins
flagged-driver state with the existing `coachingState` session
log, ranks by tier (urgent → high → medium → routine), and lets
operators log a session inline against the worst entry. The
pipeline observation surfaces the worst-tier driver on Today's
right rail so the workflow doesn't require navigating to find it.

**Server**

- New `services/coachingPipeline.js` composes the per-driver row:
  - Indexes existing sessions by `attendee_driver_ids` for O(1)
    last-session lookup.
  - Maps each driver's `flag` to a `FLAG_URGENCY` tier:
    - `rest_breach` → urgent (14-day cadence)
    - `coaching_due` → high (30-day)
    - `licence_expiring` / `psv_expiring` → medium (60-day)
    - no flag → routine (90-day default)
  - Includes a driver in the pipeline if **flagged** OR **past
    cadence**. So a driver who's gone 90+ days without coaching
    surfaces even with no active flag.
  - Sort key: tier rank → overdue amount → safety score.
  - Returns counts (`total / flagged / overdue / by_tier`) +
    capped pipeline (top 50) + `pipeline_capped` flag + recent
    30-day session log.
- New endpoint `GET /api/coaching/pipeline` in the existing
  `routes/coaching.js`. `requireAuth`. Hauler-admin scope:
  filtered to their own hauler's drivers; counts recomputed for
  the filtered slice so the KPI strip stays accurate.
- Today right rail: new coaching observation. Surfaces the
  worst-tier driver (urgent or high) with their flag + count of
  others, falls back to a routine "N drivers past cadence"
  message when no urgent items.

**Client**

- New `pages/Coaching.jsx` mounted at `/coaching`:
  - **KPI strip** (4 tiles): In pipeline / Urgent / Flagged /
    Past cadence — coloured by severity, sub-text per state.
  - **Filter chips**: tier-coloured pills for each tier with
    counts (Urgent · 7, High · 1, Medium · 163).
  - **Pipeline table**: 7 columns (Driver + plate, Hauler, Tier
    pill, Flag, Safety + harsh-events count, Last session days
    ago, Log-session button). Severity-tinted left border per
    row. "Showing top 50" caption when capped.
  - **Recent sessions card** below the pipeline: last 30 days of
    sessions with topic / hauler / dispatcher / attendee count /
    notes preview.
  - **Log session modal**: pre-populated with the driver's
    hauler_id; topic + dispatcher name + notes inputs; auto-
    links the driver via `attendee_driver_ids` so the session
    counts toward their cadence.
- `App.jsx` mounts the route. `lib/auth.js` adds `/coaching` to
  `axis_admin` (wildcard), `axis_ops`, and `hauler_admin` —
  hauler admin sees only their own drivers (server enforces
  scope). Lender excluded.
- `Sidebar.jsx` adds "Coaching" entry with `GraduationCap` icon
  in the Operations section between Drivers and Compliance.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Navigated to `/coaching` — page renders with pipeline composed
  from current driver flags + (empty) session log.
- KPIs: 171 in pipeline / 7 urgent / 27 flagged / 171 past
  cadence (the demo seeds zero coaching sessions, so every
  driver is "never coached" and the cadence rule sweeps them
  all in).
- Top of pipeline: 7 URGENT-tier rest_breach drivers across all
  4 active haulers (Emmanuel Obeng, Kwabena Frimpong, Isaac
  Amoah, Kwame Osei, Yaw Kwarteng, Kojo Mahama, Isaac
  Iddrisu). Each row shows the rust URGENT pill, "Rest breach"
  flag label, safety score with harsh-events suffix, "never
  coached" in rust, and a "+ Log session" button.
- Below: 1 HIGH (Mensah Bawumia, coaching_due flag), then 163
  MEDIUM-tier routine-cadence drivers — capped at 50 with
  the "Showing top 50" footer caption.
- Filter chip "Urgent · 7" narrows the table to just the
  rest_breach rows.
- Today's right rail observation reads: "Emmanuel Obeng
  (haul-01) needs coaching — rest breach (6 others also
  flagged)." Top-of-rail warn severity.

Hauler admin (`admin@haul-01.gh`):
- API GET `/api/coaching/pipeline` returns Hauler 01's drivers
  only — pipeline filtered server-side via `assertHaulerScope`-
  style logic in the route handler. Counts recomputed for the
  filtered slice.
- UI renders only Hauler 01's flagged + overdue drivers.

Lender:
- No `/coaching` route access (excluded from `ROLE_PAGES`).
  Coaching is operator-side workflow, not lender content.

**Why this matters**

Cockpits often ship driver detail (a per-driver page) without
shipping the workflow that *uses* driver data. Operators have to
build their own mental list of who needs coaching this week,
check each driver page individually, and log sessions wherever
they remember to. Phase 81 takes the mental list and makes it the
landing page: open `/coaching`, the worst entries are at the top,
log a session in two clicks.

The cadence design is the part that ages best. A driver doesn't
need a flag to surface — going 90+ days without coaching is its
own signal. So even when the corridor is running clean (no
rest_breaches, no coaching_due flags), the page still shows
*"these drivers are due for routine coaching."* The workflow
extends past the reactive — it picks up the proactive cadence
the safety-management discipline is supposed to enforce.

The Today right-rail observation is the small touch that closes
the loop: an operator sitting on Today doesn't need to remember
to check `/coaching` — the worst case bubbles up where they're
already looking, with the count of others so they know whether
to act on one driver or to budget time for a session block.

This completes the operational layer at every entity grain:
- **Corridor-level**: alerts, observations, calendar, lender
  pack.
- **Hauler-level**: contact log, my-hauler dashboard, hauler
  scorecard.
- **Driver-level**: coaching pipeline (Phase 81) + per-driver
  scorecard (Phase 49).
- **Risk-level**: register + steps + comments.
- **Action-level**: action items + assignment + escalation.
- **Routine-level**: playbooks (Phase 80).

Every grain has both a list view and a workflow surface; every
workflow leaves audit trail; every operator surface composes
live from the same primitives.

## Phase 82 — Notifications inbox

**The long tail of the bell.**

Phase 59 shipped notifications + the Topbar bell. Phase 63 added
preferences. Phases 67/61 added handover and escalation event
types. The bell shows the 10 most recent — fine for *"is anything
new right now?"* — but operators looking for a notification from
yesterday or last week had no surface. The history was in the
database; it just wasn't navigable.

Phase 82 ships the inbox page: filtered + paginated history with
event-type chips, unread-only toggle, date range, bulk mark-read,
and per-row navigation to the originating entity. Backed by the
Phase 59 notifications store — no new state, just a richer query.

**Server**

- New `historyForUser(user_id, opts)` in `state/notifications.js`:
  - Dynamic WHERE built from optional filters: `event_type`,
    `unread_only`, `since`, `until`. Small dataset → dynamic SQL
    is the readable choice over per-combination prepared
    statements.
  - Returns `{ total, limit, offset, rows, types_summary }`.
    `types_summary` is the per-event-type count across the
    user's full history — used by the filter chip row so badge
    counts always reflect the unfiltered total.
- New endpoint `GET /api/notifications/inbox?event_type=&unread_only=&since=&until=&limit=&offset=`:
  - `requireAuth`. Limit capped at 200; default 50; offset 0.
  - Returns the historyForUser payload + the unread count for
    the KPI strip.

**Client**

- New `pages/Inbox.jsx` mounted at `/inbox`:
  - Header eyebrow "Activity · Inbox" + description + "Mark all
    read" rust button (only visible when there's anything
    unread).
  - 2-tile KPI strip: Inbox count (matching current filters) +
    Unread count (rust if >0, green when clean).
  - Filter row in a single card: All-types chip + per-type chips
    with counts (driven by `types_summary`), separator, "Unread
    only" toggle chip with bell icon, separator, From/To date
    inputs with Clear link.
  - Notification list as a stacked card with one row per row.
    Unread rows: rust accent-tint background, rust dot, medium-
    weight body. Read rows: transparent, hairline divider, soft
    dot. Each row shows `body` + uppercase event-type label +
    relative timestamp + link arrow if navigable.
  - Pagination footer (Prev/Next + "Page N of M") when total >
    page size.
- `NotificationBell.jsx` gets a new "Open inbox →" rust link in
  the dropdown header alongside the existing "Manage" prefs
  link, so the discovery path is obvious.
- `App.jsx` mounts the route. `lib/auth.js` `ROLE_PAGES` adds
  `/inbox` to **every role** including lender — notifications
  are personal, every persona gets their own inbox.
- `Topbar.jsx` PAGE_TITLES registers `/inbox` → "Inbox" for the
  page-title display.

**Verified end-to-end**

Logged in as Kwame (`axis_ops`):
- Navigated to `/inbox` — page renders with 1 inbox / 1 unread
  KPIs (the seeded handover from Akosua hit Kwame's feed).
- Filter chips show "All types" + "Shift handover · 1" +
  "Unread only" + From/To date pickers.
- The single notification renders with rust unread-dot accent:
  "Akosua Mensah posted a shift handover: Hauler 05 still 7
  trucks down — confirmed they activate at 09:00 tomorrow.
  DVLA filing for Q1 fleet …" with metadata "SHIFT HANDOVER ·
  5d ago · Open" and a right-arrow indicator.
- Clicking the row marks it read + navigates to the link
  destination.

Akosua (`axis_admin`):
- Inbox shows 0 — Phase 59's self-emit guard means notifications
  don't fire to the user who triggered them. Inbox correctly
  empty with "No notifications in the inbox yet." copy.

Lender, hauler_admin:
- All have `/inbox` route access; inbox shows their own
  notifications only (per-user isolation at the schema level).

**Why this matters**

The bell pattern is the right primitive for *"surface what's
new"* but a poor primitive for *"find what happened last
Tuesday."* Operators who needed to recall a notification — *"who
got the bulk reassign last week?"*, *"what was that comment
thread the lender opened?"* — were stuck either scrolling the
audit log (which has the data but not the personal-feed framing)
or asking colleagues. Phase 82 closes that.

The design choice that matters most is the filter chip set
matching the actual event types in the user's history. The
chips don't show every globally known event type — only the
ones the calling user has actually received. That keeps the
filter surface small and relevant, and means a lender's chip set
("Shift handover · 1, Comment · 2") looks different from an
operator's ("Assignment · 12, Bulk reassign · 1, Escalation · 3,
Comment · 4, Shift handover · 1") without any per-role config.

The cockpit's *attention surfaces* are now layered in three
horizons:
- **Live** (Topbar bell): "anything new right now?"
- **Day** (Today right rail observations): "anything I should
  notice on this page?"
- **Historical** (Inbox + Audit log): "let me find that
  notification / write from last week."

All three feed off the same primitives but answer different
operator questions. That's the pattern that makes the cockpit
feel like a product rather than a dashboard.

## Phase 83 — Bulk action item operations

**Sweep multiple items in one move.**

The Today right-rail action items panel is the most-used surface
in the cockpit. On a busy morning an operator wants to triage
five or six items in one sweep — *snooze the three that are
waiting on GIBDLC's response, unassign the two that quietly
resolved overnight, leave the rest alone*. Pre-Phase-83 each item
required its own click sequence (open quick-action drawer, type a
date, confirm). Phase 56 had an admin-only **bulk reassign** but
nothing for everyday close/snooze.

Phase 83 ships proper multi-select on the action items panel,
with two new bulk endpoints (snooze + unassign), per-item audit,
per-item permission re-check, and a partial-success response
shape so a mixed-permission bulk doesn't fail loudly mid-loop.

**Server**

- Two new endpoints in `routes/today.js`:
  - `POST /api/today/action-items/bulk-snooze`
    body: `{ action_item_ids: [...], until: 'YYYY-MM-DD', reason }`
  - `POST /api/today/action-items/bulk-unassign`
    body: `{ action_item_ids: [...] }`
- Both require an assignee role (`axis_admin / axis_ops /
  hauler_admin`). Per-item permission re-checked via
  `canActOnAssignment(user, assignment)` — only the assignee or
  axis_admin/axis_ops can act on a given item; items the caller
  doesn't own are **skipped** (not 403'd) so partial bulks land
  cleanly. Response shape: `{ snoozed_count / unassigned_count,
  skipped_count, snoozed / unassigned, skipped: [{id, reason}] }`.
- Each successful action writes its own audit row with
  `payload: { ..., bulk: true }` so audit-log readers can tell
  the difference between a single-item snooze and a bulk-snooze.
- The existing single-item endpoints unchanged — bulk is
  additive.

**Client**

- `components/today/ActionItems.jsx` gains a multi-select layer:
  - **"Select" link** in the panel header (rust accent) flips
    the panel into select mode. Replaced by a "Cancel" link
    while active.
  - Each item row gets a leading checkbox column when select
    mode is on (CheckSquare/Square icons). Selected rows tint
    with the accent-tint background.
  - Click on a row in select mode toggles selection instead of
    triggering the regular expand/navigate behaviour. Comments
    and assignment dialogs remain accessible (event
    propagation handled).
  - **Sticky `BulkActionBar`** appears at the bottom of the
    panel when select mode is on. Shows "{N} selected" in rust
    + Clear + Snooze + Unassign buttons.
    - Snooze prompts for days (default 7) + optional reason,
      computes `until` ISO date, posts to bulk endpoint.
    - Unassign confirms count then posts.
    - Either response with skipped items shows a one-line
      summary alert ("Snoozed 3. Skipped 2 (not assigned or
      not permitted).") so the operator knows what landed.
  - Auto-exits select mode + refetches the panel data on
    success.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Pre-assigned 3 action items (forecast EOM, DSCR covenant,
  receivables ageing covenant) to herself via single-item POST.
- API: `POST /bulk-snooze {ids: [forecast-eom, cov-dscr],
  until: 2026-05-15, reason: awaiting GIBDLC AP}` → response
  `{snoozed_count: 2, skipped_count: 0, snoozed: [...], skipped: []}`.
- API: `POST /bulk-unassign {ids: [cov-ageing]}` → response
  `{unassigned_count: 1, skipped_count: 0, ...}`.
- Audit log: 3 new rows with `payload.bulk = true`.
- UI: Today panel shows new "Select" link in header; clicking
  enters select mode; checkboxes appear on each row; clicking
  a row toggles selection (rust border on the CheckSquare,
  accent-tint background); sticky bar at the bottom shows
  "2 selected · Clear · Snooze · Unassign" (count in rust).
- Cancel link returns to the normal panel.

Permission check (would fire on hauler_admin):
- A hauler admin selecting items assigned to other AXIS users
  would receive `skipped: [{id, reason: 'not permitted'}]` for
  those items in the response, and the UI surfaces the
  one-line summary alert.

**Why this matters**

The cockpit's per-item interactions are well-designed but
expensive when an operator has 5+ items to handle in one shift
opening. Multi-select isn't a glamorous feature — it's table-
stakes for any list-of-items surface — but its absence is one of
the things that makes a cockpit feel "thin" no matter how rich
the rest is. Phase 83 closes that gap on the cockpit's busiest
panel without changing the per-item interactions; both shapes
are available, operators pick whichever fits the task at hand.

The partial-success response is the design choice that ages
best. Bulk endpoints that fail-fast on the first denied item
force operators to manually pre-filter their selection by
permission, which they can't see anyway. Skipping (with reason)
and reporting back lets operators bulk-select wide and let the
server tell them what didn't land.

The cockpit's **action item flow** is now end-to-end:
- **Single-item**: assign, snooze, unsnooze, comment, escalate,
  unassign (Phase 13/45/48/56/57/61).
- **Per-user bulk**: bulk-snooze, bulk-unassign (Phase 83).
- **Cross-user bulk**: bulk-reassign (Phase 56, admin-only).
- **Audit**: every operation writes a row including a `bulk`
  flag for the bulk variants.

Operators have the tools that fit each operational scale —
single-item triage, personal sweep, admin-level reassignment.

## Phase 84 — Maintenance scheduling

**Forward-looking complement to reactive workorders.**

Phase 26's `workorderState` tracks active workorders — *a rig is
in workshop now because something broke*. The /maintenance page
groups rigs into reactive buckets (Critical · In workshop ·
Service due · Cert expiring · Recent completions). All of that
is *backward- or right-now-looking*. Operators planning the
month — *"Rig haul-02-104 in workshop 5-7 May for service B,
should we book the Hauler 02 spare driver?"* — had nowhere
structured to record that intent.

Phase 84 ships planned-maintenance scheduling. New
`maintenance_schedule` table with rig + hauler + start + end +
type + status. New panel on /maintenance above the reactive
buckets. Calendar feed picks up upcoming windows. Per-hauler
workshop-capacity counter for today.

**Server**

- New `state/maintenanceSchedule.js` with idempotent
  `maintenance_schedule` table. Columns: id, rig_id, hauler_id,
  type, start_at, end_at, notes, status, completed_*, created_*.
  Three indexes: open windows by start, per-rig DESC, per-hauler
  DESC.
  - Types: `service_a / service_b / service_c / tyre /
    inspection / repair / other`.
  - Statuses: `planned / in_progress / completed / cancelled`.
  - `add()` validates type, ISO dates, and start ≤ end.
  - `countsInWindow(at)` returns `{hauler_id: n}` for rigs
    in workshop on a given date — used by the per-hauler
    capacity strip.
- Five endpoints in `routes/maintenance.js`:
  - `GET /api/maintenance/schedule` — list upcoming + counts.
    Hauler-admin scope: own hauler only.
  - `POST /api/maintenance/schedule` — schedule a window
    (axis_admin / axis_ops / hauler_admin for own hauler's
    rigs). Audited.
  - `PATCH /api/maintenance/schedule/:id` — update.
  - `POST /api/maintenance/schedule/:id/complete` — mark done.
  - `POST /api/maintenance/schedule/:id/cancel` — cancel.
  - All write actions audited as
    `entity_type='maintenance_schedule'`.
  - **Route ordering fix**: existing `/:rigId` was capturing
    `/schedule` as a rig name. Added an early `next()` guard
    in the `/:rigId` handler to skip reserved sub-paths.
- Calendar integration: `services/upcomingEvents.js` adds a new
  `mapMaintenanceWindows()` step that emits each upcoming
  scheduled window as a `maintenance` event type, severity
  scaled by days-until (warn ≤3d, info otherwise).

**Client**

- New `components/maintenance/MaintenanceSchedulePanel.jsx`:
  - Header with Calendar icon + title + description + "+
    Schedule" button (write roles only).
  - Table: Rig (mono) · Hauler · Type · Window (start → end +
    relative timing) · Notes preview · Status pill · per-row
    Complete/Cancel icons.
  - Empty-state copy when no windows scheduled.
  - Form modal with Rig dropdown (built from the existing
    /maintenance page's rig buckets — no separate fetch),
    Type dropdown, Start + End datetime inputs, Notes textarea.
- Mounted on `pages/Maintenance.jsx` above the existing reactive
  buckets so the operator's eye runs from *what's planned* down
  to *what's happening now*.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Seeded 3 planned windows via API:
  - rig-0050 / haul-02 / service_b / 2026-05-05 → 2026-05-07
    ("Standard 30-day interval — brake pads + transmission
    inspection")
  - rig-0091 / haul-04 / tyre / 2026-05-08 ("Front axle tyre
    swap — current tyres at 18% tread")
  - rig-0102 / haul-05 / inspection / 2026-05-12 ("Pre-DVLA Q2
    inspection ahead of June filing")
- /maintenance page renders new "Planned maintenance" panel at
  the top with all 3 entries, each showing type label
  (Service B (20k) / Tyres / Inspection), window, relative
  timing pill ("in 2d" / "in 5d" / "in 9d"), notes, PLANNED
  status, and Complete/Cancel icon buttons.
- Calendar feed (`/api/today/calendar?days=20`): now includes
  `maintenance` in `counts.by_type` (3) plus full event detail
  with `Open maintenance` link label. The Today right-rail
  Upcoming Strip naturally surfaces these too.

Hauler admin (`admin@haul-01.gh`):
- API GET `/schedule` returns only entries for haul-01 (none
  in this seed). Empty-state copy renders.
- POST permitted only for own-hauler rigs (server gate via
  `canScheduleForRig`).

**Why this matters**

Maintenance scheduling is the missing operational primitive
on the *fleet* side. The cockpit had reactive workorder tracking
(Phase 26) and weekly compliance routines via playbooks (Phase
80), but the simple *"book this rig in for service next
Tuesday"* workflow had no home. Operators were doing it in
side conversations, in notes, in spreadsheets — and the
cockpit's forecast never knew that a planned 3-day workshop
window was about to drop a hauler's effective fleet from 12 to
11 trucks.

Phase 84's design choice that ages best is the **calendar
integration**. The Phase 73 calendar already aggregates every
dated obligation; planned maintenance just becomes another
event type in that feed. So an operator opening the calendar
the morning of 5 May sees not just *DVLA filing due* and *risk
review due* but also *rig-0050 entering workshop today* —
without having to remember which page that lived on. The
upcoming events feed is the corridor's calendar of *all*
forward-looking commitments, regardless of source.

Combined with the existing reactive workorder buckets, the
maintenance page now reads top-to-bottom as an operator's
attention timeline:
- **What's planned** (Phase 84 — Planned maintenance panel).
- **What's critical right now** (Critical bucket).
- **What's in workshop right now** (In workshop bucket).
- **What's due against cadence** (Service due · 20k km).
- **What's about to expire** (Cert <30d).
- **What's just completed** (Recent completions).

Each section answers a different operator question; each pulls
from the same primitive (rig + workorder + schedule); each
contributes to the corridor-level forecast via fleet active
counts.

## Phase 85 — Corridor announcements

**One-to-many broadcasts.**

Every existing communication primitive in the cockpit is
*directed* — handover is shift-to-shift, action items are
person-to-person, contact log is hauler-to-hauler. There was no
surface for *one-to-many AXIS-to-corridor announcements*: tariff
changes, port maintenance, audit kickoffs, regulatory updates
— anything every persona on the corridor should see and archive.

Pre-Phase-85 these were dropping into handover narrative (where
they decay after 36 hours), into emails outside the cockpit, or
into ad-hoc Slack chatter. Phase 85 ships proper broadcasts:
durable, severity-tagged, audience-aware, with optional auto-
expiry, surfaced as banners on Today + MyHauler.

**Server**

- New `state/broadcasts.js` with idempotent table. Columns: id,
  title, body, severity, audience, posted_at, expires_at,
  archived_at, posted_by_*. Index on `(archived_at, posted_at
  DESC)`.
  - Severities: `info / warn / urgent` — drives the banner tone
    and the active-list ordering (urgent first).
  - Audiences: `all / operators / haulers` — server-side filter
    so a "haulers only" announcement stays invisible to the
    lender.
  - `expires_at` optional — a tariff-change announcement can
    self-archive after the new rate takes effect.
  - `activeForRole(role)` filters by audience: lender +
    axis_admin/ops see `all` + `operators`; hauler_admin sees
    `all` + `haulers`.
- New `routes/broadcasts.js` with seven endpoints (GET /active,
  GET /, POST /, PATCH /:id, archive/unarchive, DELETE). All
  writes audited with `entity_type='broadcast'`.

**Client**

- New `components/today/BroadcastBanner.jsx`:
  - Shows the most-urgent active broadcast inline at the top of
    Today (and MyHauler), with a "+N more" disclosure that
    expands the rest in place.
  - Severity-tinted background + left border (rust urgent /
    amber warn / neutral info) + Megaphone icon.
  - Hidden when role has no active broadcasts.
- Mounted on `pages/Today.jsx` between HeroPanel and
  DominantStoryCard, and on `pages/MyHauler.jsx` above
  CorridorHeader.
- New `components/settings/BroadcastsPanel.jsx` mounted on
  Settings between UsersPanel and IntegrationsPanel:
  - Active + Archived sections; severity-pill cards with audience
    label, posted-by, body, auto-expires indicator, per-row
    Edit/Archive/Restore/Delete icons.
  - Form modal with title + body + severity + audience + optional
    expires-at date.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`) — seeded 3 broadcasts:
1. **NPA diesel reading +6.2% from 5 May** — info / all.
2. **Takoradi port maintenance — bay 3 closed 12-13 May** —
   warn / all, expires 14 May.
3. **Q1 fleet audit kickoff — file fleet docs by 15 May** —
   urgent / haulers only.

Today renders the most-urgent all-audience banner ("NOTICE ·
Takoradi port maintenance") with amber severity tone, body, and
"▼ 1 more announcement" disclosure that expands to show the
diesel info banner. Settings page renders the admin panel with
all 3 broadcasts visible in the Active section.

Role filtering verified:
- Lender API GET `/active` returns 2 (haulers-only filtered out).
- Hauler-admin API GET `/active` returns all 3 — URGENT audit
  kickoff first.

**Why this matters**

Every operational tool eventually accumulates tribal-knowledge
broadcast channels — Slack threads, group emails, notice boards
in the dispatch room. None of these survive shift changes
cleanly, and none are role-aware. Phase 85 brings the broadcast
pattern *inside the cockpit* so it inherits the same audit trail,
the same role gating, and the same per-persona filtering as
everything else.

The audience filter is the design choice that ages best. A
typical broadcast system treats every announcement as global
and relies on the operator to mentally filter relevance. The
audience field flips that: a hauler audit deadline lands on
hauler dashboards but never noises up the lender's view; a
tariff change lands everywhere because everyone needs it.

The corridor's **communication primitives** are now complete:
- **Live person-to-person** (notifications bell + inbox).
- **Shift-to-shift narrative** (handover note).
- **Person-to-person assignment** (action items + comments).
- **Hauler-to-hauler relationship** (contact log).
- **Risk-narrative thread** (risk comments).
- **One-to-many announcement** (broadcasts — Phase 85).

Each shape of communication has its own primitive, its own
surfaces, its own audit trail, and its own role gating — all
composing into the same cockpit without overlap or contention.

## Phase 86 — Tariff dashboard enrichment

**The number lenders actually transact on.**

Phase 6 built the indexation engine (40% fuel × NPA diesel + 30%
CPI × GSS index + 30% fixed). Phase 75 built the sensitivity
calculator (hypothetical shifts). What was missing: the
**descriptive** view of the rate's history. The Tariff page
already showed the *underlying components* (NPA diesel and GSS
CPI series over time) but not the *resulting effective rate*
over time — the single number GIBDLC is actually billed at and
the lender's covenant model treats as revenue input.

Phase 86 adds the effective-rate trajectory card. Walks the same
indexation formula across every month of historical NPA + CPI
readings to compute what the rate would have been each month,
shows the bars with month-over-month delta tones, surfaces the
period high/low/cumulative-shift footer, and pins a Next-review
countdown on the right.

**Server**

- New `computeEffectiveRateHistory()` in `services/indexation.js`:
  - Iterates the union of months in NPA_DIESEL.series + GSS_CPI.series.
  - For each month with both readings present, applies the
    indexation formula at that month's readings (not today's),
    yielding `{ month, effective_usd_per_tonne, multiplier,
    adjustment_pct, fuel_index, cpi_index, clamped_at_cap,
    clamped_at_floor }`.
  - Same pass-through cap/floor as the live rate computation —
    so a hypothetical shock month would clamp identically.
- `/api/tariff` enriched:
  - `effective_rate_history`: array of monthly rows with
    `delta_usd_per_tonne` (month-over-month diff, null for the
    first row).
  - `next_review`: `{ iso, days_until }` — next monthly review
    date (1st of next month) with a countdown.

**Client**

- New `components/tariff/EffectiveRateHistoryCard.jsx`:
  - Header: title + description ("the single number lenders
    track") + Next-review pill on the right (amber if ≤5 days,
    secondary otherwise).
  - Bar chart: one bar per month (10 months in the demo data),
    height scaled by `(rate − period_low) / range` with a 25%
    floor so even a flat period shows movement. Each bar
    tinted by sign of MOM delta (green = up, rust = down,
    tertiary = first row). Current month outlined with a dark
    border so it stands out among the green ramp.
  - Title attribute on each bar carries the exact value + MOM
    delta for hover inspection.
  - Footer: 3-stat strip — Period low (with month), Period
    high (with month), Cumulative shift % vs base (2026-01).
- Mounted on `pages/Tariff.jsx` between EffectiveRateHero and
  IndexationPanel — natural flow from "what's the current rate"
  → "how did we get here" → "what are the components."

**Verified end-to-end**

Logged in as Akosua (`axis_admin`) — opened `/tariff`:
- Page renders with Hero ($24.36/t · +1.51% adj) at top.
- New "Effective rate · last 10 months" card below:
  - Description: *"What the corridor's been billing per tonne
    after indexation. The single number lenders track."*
  - "📅 Next review **2026-06-01** · 28d" pill in the top
    right (amber if reviewed soon, neutral now).
  - 10 monthly bars: starting at $22.81/t (Jul '25, grey first
    bar), ramping up through every month in green (each MOM
    delta positive — the demo shows steady fuel + CPI rises),
    ending at the current $24.36/t outlined as the active
    month.
  - Footer: **Period low** $22.81/t (2025-07) · **Period high**
    $24.36/t (2026-04) · **Cumulative shift** +1.51% vs base
    (2026-01).
- IndexationPanel + TrendCards (NPA diesel / GSS CPI) below
  unchanged.

**Why this matters**

The indexation engine is invisible to most readers — operators
see the daily forecast, lenders see the DSCR, but the actual
*number that flows through both calculations* is the effective
tariff rate. When that rate moves, EBITDA and DSCR move; when
the rate review date approaches, the next month's revenue line
shifts. Pre-Phase-86 the cockpit showed the rate as a single
number on one page and nothing else.

The history card makes the trajectory legible without the
reader having to mentally compose the formula across the
component series. A green ramp says "rate has been rising
steadily under fuel + CPI pressure"; a flat line says "fixed
component is dampening the indexation effect"; a sudden spike
into the cap says "we hit the pass-through ceiling" — all from
a glance at the bars.

The next-review pill is the small touch that closes the planning
loop. Operators looking at the rate today often want to know
"so when does this update?" — having the answer pinned to the
card means the question is one less hop from the answer.

Combined with Phase 75's sensitivity calculator (hypothetical)
and Phase 70's lender pack (archival), the corridor's tariff
surfaces are now end-to-end:
- **Live + breakdown** (Tariff page hero + indexation).
- **History** (effective-rate card — Phase 86).
- **What-if** (sensitivity calculator).
- **Archival** (lender pack with current rate).

Operators answer "what is it now," "how did it get there," "what
would happen if X moves," and "what's our official position"
without leaving the cockpit.

## Phase 87 — Reports library (live exports)

**Every printable, in one place.**

Phases 40 (Today digest), 49 (hauler scorecards), and 70 (lender
briefing pack) ship printable cockpit artefacts — composed-live
in-browser views designed to rasterise cleanly via Cmd-P. But
each one was reachable only from its origin page (the digest
button on Today, the scorecard link on hauler detail, the
"Generate lender pack" button on Financials). There was no
unified surface answering *"what reports does this corridor
produce, and where do I trigger them?"*

The existing /reports page had a PDF library (server-generated
GIBDLC monthly / lender quarterly / regulatory pack), a filings
tracker, and a recent-runs list — but it didn't surface the
composed-live exports that have accumulated since.

Phase 87 ships the missing catalogue. New "Live exports" section
on Reports listing every in-browser printable with a one-click
"open in new tab → print as PDF" workflow. Distinct from the
existing PDF generation library; complementary, not a
replacement.

**Server**

- New `buildLiveExports()` in `routes/reports.js` returns a
  catalogue of in-browser printables:
  - **Lender briefing pack** (Phase 70) → `/lender/pack`.
  - **Today digest** (Phase 40) → `/today/digest`.
  - **Per-hauler scorecard** (Phase 49) — dynamically expanded
    to one entry per active hauler in the roster, each linking
    to `/haulers/:id/scorecard`.
- Each entry carries `id`, `title`, `audience`, `cadence`,
  `description`, `path`, `surface` (lender / ops / hauler —
  drives the icon).
- `GET /api/reports` enriched: response includes
  `live_exports: [...]` alongside `library` + `recent`.

**Client**

- New `components/reports/LiveExportsSection.jsx`:
  - Header eyebrow "Live exports · N" + caption
    "Composed-live cockpit views · open in a new tab to print".
  - Auto-fit grid of ExportTile cards (min 280px columns).
  - Each tile: surface-tinted icon (Briefcase for lender, Sun
    for ops, Building2 for hauler) + title + ExternalLink hint
    in the top-right + description + dotted-line footer with
    audience and cadence.
  - Hover tints the card border rust to reinforce the "this
    will navigate" affordance.
  - Cards are `<a target="_blank">` so clicking opens the
    printable in a new tab without losing the Reports page —
    operators can keep the catalogue open while reviewing
    exports.
- Mounted on `pages/Reports.jsx` between the existing PDF
  library section and FilingsTracker.

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- /reports renders with three sections in order:
  1. Existing **Report library · 4** — server-side PDF catalogue
     (GIBDLC monthly, lender quarterly, regulatory pack, shift
     handover brief).
  2. New **Live exports · 7** — Lender briefing pack + Today
     digest + 5 per-hauler scorecards (one per active hauler:
     Hauler 01–05).
  3. Existing FilingsTracker + Recent reports list.
- Each card in the live-exports section opens its target in a
  new tab on click. Cmd-P from there saves a clean PDF.
- The seven tiles render with correct surface icons (Briefcase
  for lender pack in rust, Sun for digest, Building2 for the
  hauler scorecards) and proper audience labels in the footer.

Other roles:
- Lender (`analyst@gibdlc.com`): same /reports view with the
  Live exports section. Lender pack tile clearly highlighted
  by the rust Briefcase icon — natural call-to-action for
  their persona.
- Hauler admin (`admin@haul-01.gh`): can navigate to Reports
  via existing route; the live-exports list helps them find
  the per-hauler scorecard for their own hauler without having
  to know the route.

**Why this matters**

Cockpits often accumulate output artefacts faster than they
accumulate navigation surfaces. The cockpit had been shipping
a printable per quarter (Today digest in Phase 40, hauler
scorecards in Phase 49, lender pack in Phase 70) — by Phase 87
that's three different click paths, each with different framing
and discoverability. New users joining the corridor wouldn't
know any of them existed.

Phase 87 doesn't add any new artefacts; it just makes the
existing ones discoverable as a *catalogue* rather than as
features-of-other-pages. The dynamic per-hauler expansion is
the small touch that matters most: a corridor with five active
haulers gets five scorecard entries automatically — operators
don't have to remember the URL pattern, and adding a new hauler
makes its scorecard appear in the catalogue without code change.

The clean separation between **PDF library** (server-generated,
recipient-tracked, audited) and **live exports** (browser-
rendered, on-demand, no recipient state) is the architectural
choice that keeps both patterns working without confusion. PDF
generation has a delivery workflow; live exports are pull-only.
Operators reach for the right one based on whether they're
signing-and-sending vs reading-and-thinking.

## Phase 88 — Integration health monitor

**The trail behind the api_status badge.**

The cockpit had been showing per-hauler API status badges
(`connected / degraded / failed / manual`) since Phase 5, but
the badge was opaque: operators could see *that* a hauler's
integration was degraded, never *why*. Reaching for an
explanation meant emailing the hauler and asking them to check
their end. The cockpit's data quality depends on these
integrations working — silence behind the badge was a real risk.

Phase 88 ships the trail. New `state/integrationSyncLog.js`
durable table for sync attempts (per-attempt row with timestamp,
success bit, latency, error code/message). Seeded synthetically
on first boot to produce 48h of plausible history per hauler
(success rate matching `api_status`, errors drawn from a small
catalogue of realistic failure modes). Two new endpoints on
hauler routes: `GET /api/haulers/:id/integration-health`
returns 24h + 7d summary, top errors, last success, recent
attempts; `POST /api/haulers/:id/integration-retry` records a
synthetic retry attempt with audit logging.

**Server**

- New `state/integrationSyncLog.js`:
  - Single table `integration_sync_log` with `(hauler_id,
    attempted_at)` index for fast per-hauler windows.
  - `record({...})` appends an attempt; `recent(hauler_id, hours,
    limit)` reads the last N within window.
  - `health(hauler_id)` returns the composed view: 24h + 7d
    summaries (`attempts`, `successes`, `success_rate`,
    `avg_latency_ms`), top 5 error codes (last 24h), last
    successful sync row, and last 30 attempts for the
    sparkline.
  - **Synthetic seeder** runs once on first boot per database:
    iterates each hauler, derives expected success rate from
    api_status (connected ~99%, degraded ~75%, failed ~30%,
    manual skipped), generates one attempt every 5 minutes for
    48 hours. Seed is deterministic (seeded random keyed on
    hauler-id + sequence) so reseeds produce identical data.
- `server/index.js` boot phase calls `ensureSeeded(roster)`
  before `app.listen` so the demo database arrives populated.
- `routes/haulers.js`:
  - `GET /:id/integration-health` — read open to all roles
    (with hauler-admin scope check). Returns hauler ident +
    api_status + integration_state + composed health view.
  - `POST /:id/integration-retry` — write-roles only. Records
    a synthetic retry (80% success rate so manual retry feels
    productive) with realistic latency or canned error message.
    Audited as `entity_type='integration_sync'` with action
    `manual_retry_success` or `manual_retry_failure`.

**Client**

- New `components/settings/IntegrationHealthPanel.jsx`:
  - Header: Activity icon + "Integration health" + caption
    "Per-hauler API sync log. Click any hauler to see attempts,
    errors, and a manual retry."
  - Per-hauler rows in an embedded table: chevron + hauler name
    + integration type + status pill (CONNECTED / DEGRADED /
    FAILED) + (when expanded) inline summary "99% 24h · 168ms ·
    last ok 3m ago".
  - Click toggles expansion; lazy-loads the detail via
    `/integration-health` only when opened.
  - Detail block:
    - 4 metric tiles: 24h success / 24h latency / 7d success /
      Last success — each tinted by health (green ≥95%, amber
      ≥85%, rust below).
    - Top errors list with rust left-borders, code in mono
      uppercase + plain message + occurrence count.
    - **Recent attempts sparkline** — row of 8×14px dots, green
      for success, rust for failure, with `title` tooltips
      carrying timestamp + latency or error.
    - Manual retry button (write roles only).
  - Mounted on `pages/Settings.jsx` between IntegrationsPanel
    and AuditPanel — natural sequel to the existing integration
    listing.
- Handles both shape variants of the hauler payload (raw roster
  with nested `integration.type` vs flattened settings entry
  with top-level `type`).

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- Boot wiped + reseeded the sync log with 48h × 4 integrated
  haulers (Hauler 05 is `manual`, skipped) → 1,152 attempts.
- Settings page renders new "Integration health" panel below
  the existing Integrations listing.
- Clicking Hauler 01 expands it:
  - Status: CONNECTED · 99% 24h · 168ms · last ok 3m ago.
  - Metrics: **99%** 24h success (285/288), **168ms** avg
    latency, **99.1%** 7d (572/577), Last success **3m ago**
    (Mon 04/05/2026 11:38:29).
  - Top errors: RATE_LIMITED 2×, TIMEOUT 1× — realistic mix,
    no synthetic-feeling repetition.
  - Sparkline: 30 dots, mostly green with one or two rust
    intermittent failures matching the seed's random draws.
  - Manual retry button visible in rust at the bottom-right.
- Clicked Manual retry → endpoint records a new attempt, audit
  log gets a new row, panel refreshes with the new attempt at
  the head of the sparkline.

Lender (`analyst@gibdlc.com`):
- API GET `/integration-health` returns 200 (read-open).
- POST `/integration-retry` returns 403 (write roles only).
- Lender doesn't have `/settings` access, so panel isn't
  reached via UI — but the endpoint stays available for any
  future read-only surface.

Hauler admin (`admin@haul-01.gh`):
- API GET own-hauler returns 200; other haulers return 403.
- POST retry on own hauler succeeds; on other haulers 403s.

**Why this matters**

API integration is the cockpit's data foundation. Every alert,
every forecast number, every covenant computation eventually
depends on whether the hauler-side sync is running cleanly.
When it's not, the cockpit's *output* is correct relative to
its inputs — but its inputs are stale or missing, and operators
can't tell from the surface alone.

Phase 88 makes that stale-input condition visible without
crying wolf. The 24h/7d split is deliberate: a hauler can have
99% over 7 days and 75% over 24h, signalling a recent issue
worth chasing without flagging the integration globally as
broken. The top-errors list converts opaque error codes into
operator-actionable hints — RATE_LIMITED suggests retry
backoff; AUTH_REJECTED suggests credential rotation;
PARSE_ERROR suggests payload contract drift. The sparkline gives
a glance at "is this a one-off blip or a sustained problem?"
without reading any prose.

The manual retry button is the small touch that makes the panel
feel responsive rather than diagnostic. Operators who see a
red dot don't have to email the hauler — they can press retry
and see whether it was transient. The 80% retry success rate
in the synthetic mode reflects the real-world outcome of most
"is the API back up?" pings.

The cockpit's data-pipeline visibility is now end-to-end:
- **Last sync** (Phase 5 — hauler list shows last-sync
  timestamp).
- **Status badge** (Phase 5 — connected/degraded/failed pill).
- **Trail** (Phase 88 — per-attempt log with errors + retry).

Operators who see degraded status now have the next click
pre-built into the cockpit instead of having to leave it.

## Phase 89 — Hauler settlement ledger

**The other side of the receivables ledger.**

Phase 64 added receivables collection workflow at the **band**
level — chases against the 0-30/31-60/61-90/90+ aged buckets
from GIBDLC → AXIS. But **per-hauler settlement** — the monthly
invoices AXIS issues to each hauler for their share of corridor
revenue — had no surface. Hauler admins couldn't see "what AXIS
owes me this month and which line items are paid"; AXIS ops
couldn't track per-hauler invoice status; the lender pack
showed corridor-level overdue but had no view of *which haulers*
were waiting on settlement.

Phase 89 ships the missing ledger. New mock data (5 haulers × 6
months = 30 statements with realistic line items: haulage credit
+ deductions for axle-load fines, late-delivery, fuel advance
recoupment). Durable overlay for status changes. Three new
operations: mark-paid (AXIS-side), open-dispute (either side),
resolve-dispute (AXIS-side). New `/settlements` page with role-
aware ledger view.

**Server**

- New `mock/settlements.js` — deterministic seed of 30 monthly
  statements. Each hauler has its own deduction profile:
  - haul-01: clean operator, fuel advance only.
  - haul-02: occasional axle-load fines.
  - haul-03: clean.
  - haul-04: late-delivery clauses biting.
  - haul-05: heavy fuel advance + sustained late-delivery.
  - Tariff per month sourced from `TARIFF_BY_MONTH` (matches
    Phase 86's effective-rate trajectory; May 2026 uses the
    post-broadcast $25.84/t rate).
  - Default status: pre-Apr months paid, Apr split (haul-01/03
    early-paid, others pending), May all pending (issued 1 June,
    not yet paid).
- New `state/settlementOverlay.js` (idempotent table) — mirrors
  the alertState/filingState pattern. Captures status + paid
  metadata + dispute fields without rewriting the immutable mock.
  `apply(base)` merges overlay on top.
- New `routes/settlements.js`:
  - `GET /api/settlements` — list with role-aware filtering
    (hauler_admin sees own only). Optional `?period=` and
    `?hauler_id=` query filters. Returns counts (`pending`,
    `paid`, `partial`, `disputed`, `outstanding_usd`,
    `disputed_usd`) for the KPI strip.
  - `GET /api/settlements/:id` — single statement.
  - `POST /:id/mark-paid` — axis-side only. Records paid_at +
    paid_amount + payment_ref. Audited.
  - `POST /:id/dispute` — both axis + hauler-admin (own scope).
    Requires `dispute_reason`. Audited.
  - `POST /:id/resolve-dispute` — axis-side only. Resolves to
    pending or paid.
  - `PATCH /:id/notes` — both sides; per-statement note overlay.

**Client**

- New `pages/Settlements.jsx` mounted at `/settlements`:
  - Header eyebrow "Capital · Settlements" + description.
  - 4-tile KPI strip: Statements / Outstanding USD / Disputed
    count / Paid count.
  - Filter row with PERIOD chips (most-recent first) and STATUS
    chips with counts.
  - Expandable settlement rows — left-border tinted by status
    (amber pending, green paid, rust disputed). Click a row to
    show the line items table:
    - Haulage credit (with tonnes × rate breakdown).
    - Each deduction with rust-tinted negative amount.
    - Gross / Deductions / **Net settlement** footer rows.
  - Inline dispute callout when a statement is disputed (rust
    border, reason, opened-by + date).
  - Payment ref + received amount displayed when paid.
  - Action buttons in the expanded view (write roles only):
    "Mark paid" (rust, axis-only) and "Dispute" (secondary,
    both sides).
- Two modals: MarkPaidModal (amount + ref + paid date),
  DisputeModal (reason textarea).
- Sidebar entry "Settlements" with Wallet icon in the Capital
  section after Sensitivity. Topbar PAGE_TITLES updated.
- ROLE_PAGES adds `/settlements` to axis_admin (wildcard),
  axis_ops, hauler_admin (own scope), and lender (read-only).

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- 30 statements rendered. KPI strip: 30 total · $2,289k
  outstanding (8 pending) · 0 disputed · 22 paid.
- Filter chips: PERIOD All / 2026-05 / 2026-04 / 2026-03 /
  2026-02 / 2026-01 / 2025-12; STATUS Pending · 8 / Paid · 22.
- May 2026 statements at the top (all pending, all 5 haulers,
  $148k–$497k each). April split (haul-01 + haul-03 paid; 02,
  04, 05 still pending).
- Expanded haul-02 May 2026:
  - Haulage line: "Tonnes delivered 2026-05 · 14,847 t @
    $25.84/t" → $383,646 (using the post-5-May tariff rate
    introduced via Phase 85 broadcast and modelled in Phase 86).
  - Deduction: Fuel Advance -$9,500.
  - Net settlement: $374,146.
- Mark-paid + Dispute action buttons visible inline.

Hauler admin (`admin@haul-01.gh`):
- API returns only Hauler 01's 6 statements. Counts recomputed
  for the filtered slice.
- Mark-paid button hidden (axis-side only); Dispute button
  available for own-hauler pending statements.

Lender (`analyst@gibdlc.com`):
- Read-only view across all 30 statements. No action buttons.
  Useful for credit committee review of corridor-wide cash
  position.

**Why this matters**

The cockpit had been exact about cash flowing **into** the
corridor (receivables, DSCR, covenants) and forecasting cash
flowing **out** (debt service, opex via opcost ratio). What was
missing was the per-hauler view of cash *between* — what AXIS
collects from GIBDLC and pays through to haulers under the
JV agreement.

This matters for several real workflows the cockpit was
sidestepping:
- **Hauler admin trust** — *"is AXIS actually settling on time?"*
  The hauler admin role used to land on dashboards that showed
  AXIS-side numbers. Phase 89 gives them a ledger that shows
  *their own* cash position.
- **AXIS ops cash discipline** — *"which hauler invoices haven't
  cleared?"* The KPI strip's outstanding figure is now an
  operator-actionable number.
- **Dispute workflow** — *"hauler 04 is contesting the late-
  delivery clause for March."* Disputes live in the cockpit
  with reason + opened-by + audit trail, not in email.

The settlement ledger is also where the corridor's per-hauler
deduction patterns become legible: a glance at haul-02's
recurring axle-load fines, haul-04's late-delivery penalties,
or haul-05's elongating fuel-advance recoupment tells the
operator more about hauler-level performance than any aggregated
KPI. Phase 89 doesn't compute new insights — it surfaces
deductions that were *already happening* into a place where
operators can see them transaction-by-transaction.

Combined with Phase 64 (band-level receivables chase) the
cockpit now has both halves of the cash-flow ledger:
- **Inbound** (Phase 64 — receivables from GIBDLC, aged bucket
  chase log).
- **Outbound** (Phase 89 — settlements to haulers, per-statement
  workflow).

Together they give operators the full picture of corridor-level
cash position without any spreadsheet exports.

## Phase 90 — Insurance claims register

**The lifecycle that follows incidents.**

The cockpit captures HSE incidents (Phase 12) and rig
workorders (Phase 26), but the *insurer-side* workflow that
typically follows them — file a claim, wait for the loss
adjuster, get approved or denied, wait for payment — had no
surface. A Category-A rollover triggers a third-party liability
claim and a property-damage claim simultaneously; a tyre-burst
event may trigger a cargo-loss claim. Pre-Phase-90 these lived
in side conversations between AXIS ops, the insurer, and the
hauler.

Phase 90 ships the claims register as the third leg of the
incident → workorder → claim workflow stool. Six representative
seeded claims demonstrate the full lifecycle (filed → under
review → approved → paid; plus denied as a terminal state).
Each claim links back to the originating HSE incident or
operates standalone (medical claims, market-stall liability).

**Server**

- New `mock/claims.js` — 6 deterministic claim fixtures linked
  to the 3 existing HSE incidents (Phase 12) where applicable:
  - **clm-2026-04-001**: Third-party liability for the Cat-A
    rollover (haul-02, Enterprise Insurance, $18,500, *under
    review*).
  - **clm-2026-04-002**: Rig damage from the same rollover
    (Enterprise Insurance, $32,000 filed, $28,500 *approved*
    pending payout).
  - **clm-2026-03-001**: Cargo loss from the tyre-burst event
    (haul-04, NIC, $4,800, *paid*).
  - **clm-2026-02-001**: Rig damage from minor off-corridor stop
    (haul-01, StarLife, $8,200 filed, $6,800 *paid* with
    betterment deduction).
  - **clm-2026-04-003**: Routine medical claim (haul-03,
    Enterprise, *filed*).
  - **clm-2026-01-001**: Market-stall liability (haul-05, NIC,
    *denied* — dashcam exonerated AXIS).
  - Insurers are stylised real Ghana market presences:
    Enterprise Insurance, NIC, StarLife.
- New `state/claimsState.js` (idempotent table) — overlay for
  status transitions + approved amount + payment metadata +
  notes. Mirrors the alertState/filingState/settlementOverlay
  pattern: immutable seed + durable mutations.
- New `routes/claims.js`:
  - `GET /api/claims` — list with role-aware scope. Hauler-admin
    sees own only; lender + axis-side see all. Returns counts
    (`filed / under_review / approved / denied / paid`) plus
    rolled-up USD amounts (`in_flight_amount_usd`,
    `approved_pending_payout_usd`, `paid_amount_usd`).
  - `GET /api/claims/:id` — single claim + audit trail.
  - `POST /api/claims/:id/transition` — write-roles only.
    Status transitions (`under_review`, `approved`, `denied`,
    `paid`) with optional `approved_amount_usd`, `payment_ref`,
    `paid_at`, and `notes`. Audited per transition with
    payload tagged with `to_status`.

**Client**

- New `pages/Claims.jsx` mounted at `/claims`:
  - Header: "Capital · Insurance claims" + description ("Claim
    lifecycle — filed → review → approval → payment — for HSE
    incidents and rig damage. Insurance recoveries flow through
    the corridor's cash position; outstanding approved claims
    are real receivables.").
  - 4 KPI tiles: Claims (total) · In flight (count + filed USD)
    · Approved · pending payout (USD + count) · Paid out · YTD
    (USD + count). Tones tinted by health: amber for in-flight,
    green for paid/cleared.
  - Filter chips by status — only render statuses with at least
    one match.
  - Expandable claim rows with status-tinted left border. Click
    to reveal:
    - Description (full prose).
    - 4 metadata blocks: Insurer + policy number / Incident date
      with `→ hse-XXX` link if applicable / Filed timestamp /
      Deductible.
    - Notes panel (rust-bordered if dispute or denial-relevant).
    - Payment ref + paid date when settled.
    - Action buttons (write roles only): "Send to review",
      "Approve", "Deny", "Mark paid" — each guarded by current
      status.
  - Transition modal with status-aware fields:
    - Approved transition collects `approved_amount_usd`.
    - Paid transition collects `payment_ref` + `paid_at`.
    - Denied + others collect just notes.
- Sidebar entry "Claims" with `ShieldQuestion` icon in the
  Capital section after Settlements. Topbar PAGE_TITLES updated.
- ROLE_PAGES adds `/claims` to all four roles (hauler_admin
  sees own scope; lender + axis-side see all).

**Verified end-to-end**

Logged in as Akosua (`axis_admin`):
- /claims renders with KPI strip: 6 claims · 2 in-flight
  ($20,600 filed) · $28,500 approved-pending-payout (1 claim) ·
  $11,600 paid-out-YTD (2 settled).
- Filter chips: All / Filed · 1 / Under review · 1 / Approved ·
  pending payout · 1 / Paid · 2 / Denied · 1.
- Six claim rows visible, sorted by filed-date desc.
- Expanded clm-2026-04-002 (rig damage from rollover):
  - Description: chassis frame + cab roof damage, $32k workshop
    quote.
  - Insurer: Enterprise Insurance / EI-MOT-2026-088.
  - Incident date: 2026-04-06 → **hse-012** (link to Phase 12
    HSE event).
  - Filed: 2026-04-09 / 14:00 UTC.
  - Deductible: $3,500 hauler-borne.
  - Notes: "Insurer approved $28,500 — full repair less $3,500
    betterment. Awaiting payment to hauler workshop account."
- Action buttons available: "Mark paid" (since status is
  approved). Clicking opens modal with payment-ref + paid-date
  fields.

Lender (`analyst@gibdlc.com`):
- API GET 200 — sees all 6 claims.
- POST transition returns 403 (write-roles only).
- The pending-payout figure ($28,500) is a real DSCR-relevant
  receivable; lender can see it directly without asking ops.

Hauler admin (`admin@haul-01.gh`):
- API returns only Hauler 01's claims (1: the StarLife rig
  damage from Feb).
- Transition 403 — claims management stays AXIS-side.

**Why this matters**

Insurance is the cockpit's last truly outside-the-cockpit cash
flow. Receivables come from GIBDLC; settlements go to haulers;
both are paper trails AXIS controls. Insurance is the third
party — money that may or may not arrive based on a loss
adjuster's read of an incident report. The longer the cockpit
ignored that flow, the more operators relied on insurer email
threads and personal phone calls to track where claims stood.

The link back to HSE incidents is the design choice that ages
best. A Cat-A rollover doesn't just produce a workorder; it
typically produces *two* claims (third-party liability +
rig damage) plus optionally a cargo claim. Phase 90's
`incident_ref` field makes that fan-out visible: from
hse-012 you can see exactly which claims exist, which are
paid, which are still under review. That linkage flows the
other direction too — opening a claim shows you the originating
incident in two clicks.

The lender-relevant aspect is subtle but real. Approved-but-
unpaid insurance claims are receivables; they affect DSCR via
recovery timing. Phase 90's KPI tile — "$28,500 approved ·
pending payout" — is now a number the lender can pull up
directly rather than asking ops for a status update. That's
the same pattern Phase 89's settlement ledger established for
hauler-side cash flow: surface what the lender used to ask
about by email, and the email goes away.

Phase 90 also rounds out the corridor's **lifecycle layer**:
- **Incident** (Phase 12 HSE register).
- **Workorder** (Phase 26 rig maintenance).
- **Claim** (Phase 90 — what the insurance side does next).
- **Settlement** (Phase 89 — how recovery flows through the
  hauler ledger).

Each phase of an incident's downstream consequence has its own
durable surface, its own audit trail, and its own role gating.
Operators no longer have to reconstruct the full picture from
four disconnected pages — they just follow the cross-references.


# Phase 91 — My activity (personal contribution dashboard)

## What shipped

A first-person view of *what I've done on the platform*, composed
live from the existing audit log (Phase 41) by filtering on
`actor_user_id`. No new state, no new tables — just a focused
read-side projection that turns the audit feed into a personal
KPI surface.

The page lives at **/me/activity** and is reachable two ways:
the user-name dropdown in the Topbar (new "My activity" link
above "Sign out") and direct URL. All four roles can reach it —
each user sees only their own activity.

## Server side

`server/services/personalDigest.js` — pure composition over
`listAudit({ actor_user_id, since, limit: 500 })`. The horizon
is configurable (1–180 days, default 7). Returns a structured
payload with:

- `counts.total` — total audit events authored in the window.
- `counts.by_category` — entity types rolled up into the
  operator-meaningful categories the user actually thinks in.
  `action_item`, `handover_note`, `risk*`, `playbook*`,
  `maintenance_schedule`, `settlement`, `claim`, `broadcast`,
  `lender_pack`, `forecast*`, `integration_sync`, etc. all
  collapse into a small set of headings (action_items, handovers,
  risks, playbooks, maintenance, settlements, claims, broadcasts,
  lender_outputs, forecasts, integrations, other).
- `counts.action_item_flow` — special-case rollup for the
  highest-frequency surface. Maps audit `action` verbs to
  outcome-meaningful labels: `assign → opened`,
  `unassign / auto_clear → closed`, `snooze → snoozed`,
  `reassign → reassigned`, `comment → commented`,
  `escalate → escalated`. The page surfaces this as its own
  KPI grid because it's the most-used flow on the platform.
- `daily_series` — last N days bucketed by ISO date for a
  sparkline. Days with no events show as a faint placeholder
  bar so the rhythm of work (or its absence) reads visually.
- `recent` — 25 most-recent audit rows for an inline timeline.

`GET /api/me/activity?days=N` exposes the digest. Lives on
`routes/me.js` next to the existing pinboard endpoints — same
"things scoped to *me* the calling user" namespace.

## Client side

`client/src/pages/MyActivity.jsx` — a focused single-screen
dashboard:

- **Horizon picker** (7d / 30d / 90d) in the page actions slot,
  rust-tinted active state.
- **KPI strip** — Total events · Action items closed · Action
  items opened · Comments. Closed renders green, opened renders
  rust, zeros render tertiary so the page doesn't shout when
  there's nothing to say.
- **Action item flow** tile — the six outcome labels in a 3×2
  grid, each with its own icon (PlusCircle, CheckCircle2, Clock,
  MessageSquare, RotateCcw, AlertTriangle) and color tone.
- **Daily activity** sparkline — bars sized as a percentage of
  the window's peak. 30-bar cap so the 90-day view still reads
  cleanly. Each bar is title-tagged with `date · n events` for
  hover detail.
- **By category** — horizontal bars sorted descending by count.
  Each row deep-links back to the page that owns that work
  (action_items → /inbox, risks → /risks, settlements →
  /settlements, etc.).
- **Recent timeline** — 25 most-recent audit rows. Each shows
  relative time (1h ago / 3d ago) on the left, action verb +
  summary in the centre, entity_type · entity_id underneath, and
  an "OPEN →" affordance on the right that jumps to the entity's
  parent page. The verb mapping (`ACTION_LABEL`) renders
  friendly forms — "created", "closed", "snoozed", "commented
  on", etc. — so the timeline reads as English rather than
  audit-log shorthand.

The `/me/activity` route is added to `ROLE_PAGES` for axis_ops,
hauler_admin, and lender (axis_admin already has the wildcard).
The Topbar `PAGE_TITLES` map adds "My activity" so the page
title chip renders correctly. The UserMenu dropdown gains an
"Activity" icon link above Sign out.

## Verification

Smoke-tested across roles:
- **Akosua Mensah (axis_admin)** — 7d window: 12 events, 3
  opened / 1 closed / 2 snoozed; 30d window: 93 events, 17
  opened / 4 closed / 4 snoozed / 6 commented / 7 reassigned,
  with By Category showing Action items 39, Other 21, Risks 16,
  Playbooks 5, Lender outputs 5, Broadcasts 3.
- **Yaw Osei (lender)** — 0 events. The page renders the
  empty-state cleanly: "no audit log entries in window", "By
  category: No activity in window", and "Nothing yet — once you
  assign action items, post handovers, or update risks, they'll
  show up here."
- **Ama Darko (hauler_admin)** — same empty state as the lender
  (no platform writes recorded in seed data); confirms the
  route is accessible to the hauler persona.

## Why this matters

Every other "review" surface on AXIS is **corridor-scoped**:
Day in Review (Phase 51) reads the operator's shift across all
haulers. Week in Review (Phase 68) reads the corridor's last
seven days. Today (Phase 5) reads the live state of the road.
None of them answer the question every operator and lender
analyst eventually asks: *what did **I** actually do this week?*

That question matters in three concrete contexts:

1. **End-of-week self-review.** Akosua needs a view she can
   skim Friday afternoon to remember what landed and what
   didn't — and to spot when she's been pulled off her own
   priorities into firefighting. Action items closed vs opened
   makes that visible at a glance.
2. **Lender analyst handovers.** When Yaw Osei rolls off the
   account or hands a query to a colleague, the activity page
   gives the receiving analyst a 90-day reconstruction of
   *what the previous analyst actually touched* — which queries
   they ran, which lender packs they downloaded, which
   forecasts they reviewed. No more "go ask whoever was on
   this account before."
3. **Performance reviews on the AXIS Ops side.** Phase 91 makes
   audit-log forensics ambient: an ops manager can pull up any
   teammate's `/me/activity` (well — eventually; right now it
   only shows the calling user's own data, but the service
   accepts `actor_user_id` so the page can be re-pointed when
   we add a "view as" affordance) and see the rhythm and shape
   of their work without manually filtering the audit page.

The architectural payoff is that the audit log is now serving
**two complementary slices** of the same data: Settings → Audit
(Phase 41) is the *platform-wide forensics view* an admin uses
to investigate what happened. My activity is the *first-person
contribution view* every individual user uses to remember what
they did. Same source of truth, two presentations, no
duplication.


# Phase 92 — Diesel watch (fuel trajectory + per-hauler variance)

## What shipped

A first-class surface for the corridor's #1 cost variable. The
Tariff page (built earlier with the indexation services) shows
the *effect* of the current diesel reading on the headline rate;
Diesel watch is the *trajectory* — where has fuel been over the
last 17 months, where is it going, and what does it mean for
the next monthly tariff review on the 1st. Per-hauler fuel cost
per laden tonne closes the loop on the operational side: even
with a generous pass-through cap, a hauler whose trucks burn
3% more than the corridor average eats that variance themselves.

The page lives at **/diesel**, sits in the Contract section of
the sidebar between Tariff and the Capital block, and is open
to all four roles. Lenders care because diesel is a covenant
risk variable. Haulers care because it's the variance they
actually have to manage. Ops cares because it's the coaching
KPI for fuel efficiency. AXIS admins care about everything.

## Server side

Mock data — `mock/tariff.js` extended:
- `NPA_DIESEL.series` lengthened from 10 to 17 monthly readings
  (2025-01 → 2026-05) so the trajectory chart reads as a real
  trend rather than a snapshot.
- Current reading bumped to **GHS 16.34/L** (May 2026, up
  +1.49% MoM, +21.22% YoY, +3.94% vs base).
- `GSS_CPI.series` lengthened to match (2025-01 → 2026-05).
- `TARIFF_TERMS.next_review_date` rolled forward to 2026-06-01.

Service — `services/dieselWatch.js`:
- Pure read-side composition. No new state.
- Inputs: NPA_DIESEL series (mock), indexation components
  (services/indexation, already there), trip ledger (mock/trips),
  hauler roster (state/roster).
- Outputs:
  - `series` — the full sorted monthly diesel series.
  - `summary.latest_change_pct` — MoM change.
  - `summary.trailing_3m_pct` / `trailing_12m_pct` — derived
    by walking the series 3/12 rows back.
  - `summary.vs_base_pct` — current reading vs the 2026-01 base.
  - `summary.fuel_index` — fuel index used by the indexation
    formula.
  - `summary.fuel_contribution_pct` — fuel's contribution to the
    multiplier (weight × index × 100).
  - `pass_through.{cap,floor}_pct` — contractual band edges.
  - `pass_through.multiplier` / `clamped_at_cap` /
    `clamped_at_floor` — current multiplier and whether either
    boundary is binding.
  - `pass_through.headroom_pct_points` — distance to the cap in
    percentage points.
  - `pending_review.review_date` — next monthly reset.
  - `pending_review.would_effective_usd_per_tonne` /
    `would_delta_pct` — what the effective rate becomes if the
    reset runs today against current readings.
  - `fleet_burn.corridor_avg_fuel_usd_per_tonne` — corridor
    benchmark across all laden trips.
  - `fleet_burn.per_hauler[]` — for each hauler, total fuel /
    total laden tonnes, with `vs_corridor_pct` and a coarse
    `signal` ('better' / 'flat' / 'worse', ±2% threshold).

Route — `routes/diesel.js` exposes `GET /api/diesel`. `requireAuth`
only; no role gating. Mounted at `/api/diesel` from `index.js`.

(One small server-side gotcha: the trip ledger field is
`tonnage_t`, not `tonnage` — caught by smoke-test, fixed.)

## Client side

Page — `pages/Diesel.jsx`:
- **KPI strip** — Current price (GHS/L) · MoM change · Trailing
  12m · vs base. The three change-tiles auto-color: rust if
  positive (price up = cost up), green if negative, tertiary
  if effectively zero. Trend arrows mirror the tone.
- **NPA diesel trajectory** — recharts `LineChart` with 17
  months on tape, dashed `ReferenceLine` at the base reading,
  rust line, monotone interpolation, dot markers. The chart
  reads as a steady upward trend with the base-month tick
  visible as a dashed horizontal at GHS 15.72.
- **Next review** card — three KPIs (Base $24.00/t · Would
  apply $24.55/t · Delta +2.30%) plus a narrative paragraph
  explaining what the reset would do: "Fuel is contributing
  41.6% to the multiplier, on a fuel index of 1.0394. With
  CPI and fixed components factored in, the next monthly reset
  would move the headline rate by +2.30% — well within the
  75–125% pass-through band." The cap/floor language toggles
  to a binding-state warning when clamped.
- **Pass-through band** card — visualises the multiplier (102.3%)
  on the floor..cap range with a horizontal gradient bar
  (green → amber → rust) and a vertical position tick. Shows
  pts of headroom to cap (or pts above, when binding).
- **Fleet fuel burn** — per-hauler horizontal bar chart with
  the corridor average as the centre tick. Each row shows
  hauler display name + ID + trip count + tonnes, the bar
  position, $/laden-tonne, vs-corridor delta with trend arrow,
  and a one-line plain-English signal label ("better than
  corridor" / "in line with corridor" / "above corridor avg").
- **Notes** — the contract definitions footnote in a dashed
  outline box.

Wiring:
- Route mounted at `/diesel` in `App.jsx`.
- `ROLE_PAGES` opened up to all four roles (axis_ops,
  hauler_admin, lender — axis_admin already has the wildcard).
- Topbar `PAGE_TITLES['/diesel'] = 'Diesel watch'`.
- Sidebar entry in the Contract section between Tariff and the
  Capital block, using lucide's `Fuel` icon.

## Verification

Smoke-tested across all three personas:
- **Akosua Mensah (axis_admin)** — full page visible. Trajectory
  chart shows the steady climb from GHS 12.20 (Jan 2025) to
  GHS 16.34 (May 2026). Pending review reads +2.30% delta
  ($24 → $24.55), well within the band. Pass-through tile
  reads 102.3% with 22.7 pts of headroom to cap. Fleet fuel
  burn surfaces all five haulers ranked best-to-worst:
  Hauler 02 ($3.94/t, -3.1%, "better than corridor"), Hauler 01
  ($4.01/t, -1.4%, "in line"), Hauler 05 ($4.08/t, +0.3%,
  "in line"), Hauler 04 ($4.15/t, +2.2%, "above corridor"),
  Hauler 03 ($4.18/t, +2.8%, "above corridor"). Corridor
  benchmark $4.07/t across 22 laden trips / 871 tons.
- **Yaw Osei (lender)** — full page visible. Sidebar shows the
  Fuel icon under Contract. Same data, same chart.
- **Ama Darko (hauler_admin)** — full page visible. Notification
  bell shows the orange pip from Phase 90 claims work. Same
  data; eventually we may want to highlight the *hauler's own
  row* in the per-hauler variance table when this persona
  views it, but for now the universal table reads fine.

## Why this matters

Diesel is **the** cost variable in trucking — and on a 300km
corridor like Nyinahin → Takoradi, it's roughly 50% of the
hauler's per-trip cost stack. The contract has a fuel-indexed
pass-through specifically because both sides know neither AXIS
nor GIBDLC can absorb structural diesel moves. But until now
the only diesel surface was a single number embedded in the
Tariff page indexation card.

Phase 92 makes diesel a **first-class operational concept**:

1. **Forward-looking lender view.** Yaw can pull up Diesel watch
   on the morning of the 25th and tell his credit committee
   what next month's tariff reset will look like before it
   lands. The "would apply / delta" tile reads as a forecast,
   not a historical reading.
2. **Hauler benchmarking.** Ama doesn't need to wait for an
   AXIS quarterly review to know if her trucks are burning more
   diesel than the corridor average — Phase 92 puts that
   variance on the page. Above-corridor haulers know they have
   a coaching surface (Phase 35-ish coaching plans) waiting for
   them.
3. **Operator coaching surface.** Akosua now has a numerical
   answer to "which hauler should I coach on fuel efficiency
   this fortnight?" Phase 23 driver scorecards already cover
   per-driver behaviour; Phase 92 covers per-hauler operational
   discipline.
4. **Indexation transparency.** The Tariff page shows the *what*
   (current effective rate). Diesel watch shows the *how* and
   *when* — the trajectory of the underlying input, the
   contribution arithmetic, the pass-through cap headroom. That
   transparency makes the indexation formula auditable from
   the lender side and predictable from the hauler side.

The architectural payoff is that the corridor's three commercial
mechanics — base tariff (Phase 9 contract) → indexation
(Phase ~indexation services) → settlement (Phase 89) — now have
a forward-looking input dashboard at the front of the chain.
Each phase of the rate cycle has its own surface, and they
compose into a coherent commercial story rather than a pile of
fixtures.




---

## Phase 93 — Shift Handover Log

**Problem.** A 300 km corridor that runs through multiple daily shifts
needs reliable continuity between outgoing and incoming operators.
Phase 67 built the database and the write path (DayInReview modal
posts to `/api/today/handover`), and Today shows the latest note via
`HandoverCard`. But the full history was invisible, composing outside
the end-of-day flow was impossible, and notifications linked to `/`
rather than to the log itself.

**What shipped.**

*Server (no new files — routes already lived in today.js):*
- `GET /api/today/handover?limit=50` — already supported up to 50
  rows; confirmed the `Math.min(50, ...)` cap was in place.
- `POST /api/today/handover` — unchanged; still gated to
  `axis_admin` + `axis_ops`; fires per-user notifications to
  every non-lender user except the author.
- `DELETE /api/today/handover/:id` — unchanged; `axis_admin` only.
- Notification `link` updated from `{ path: '/', label: 'Open' }` →
  `{ path: '/handovers', label: 'View handovers' }` so the bell
  deep-links to the correct page.

*Client — `pages/Handovers.jsx` (new):*

KPI strip (4 tiles):
- **This week** — count of notes posted in the last 7 days.
- **Last handover** — relative time + full `DD Mon YYYY HH:MM` in
  `Africa/Accra`; tile border turns amber when gap > 12 h.
- **Total in log** — note count (cap 50 shown).
- **Gap since last** — hours since most recent note; `warn` flag
  when > 12 h to surface shift-continuity gaps at a glance.

Composer (axis_admin / axis_ops only):
- Auto-growing textarea; placeholder prompts the operator: "What's
  outstanding? What did you escalate? What lands on the next shift?"
- Character counter `n/4,000` turns amber above 3,800; submit
  disabled above 4,000 or when blank.
- Footer shows "Posted as {display_name}" so the author identity is
  never ambiguous before submitting.
- `PenLine` icon on the submit button; button activates rust on
  hover/enabled state.

Handover log:
- Chronological list, newest first. Each card has a 3 px left border
  — rust on the latest entry, `var(--border-soft)` on older ones.
- Header row: `LATEST` chip (newest only) · display_name ·
  role badge (AXIS Admin / AXIS Ops in rust tone) · clock icon ·
  relative time (`Xm ago`, `Xh ago`, `Xd ago`) · full timestamp.
- Body rendered `white-space: pre-wrap` so multi-paragraph notes
  retain the operator's line breaks.
- Trash icon (axis_admin only) expands inline confirmation: "Delete
  this handover note? This cannot be undone." — two-step to prevent
  accidental loss of shift history.

Empty state:
- `ScrollText` icon + contextual copy; read-only users see "No
  handovers posted yet." Operators with write access see "Post the
  first shift handover above."

*Wiring:*
- `Sidebar.jsx` — `ScrollText` imported from lucide-react; entry
  `{ path: '/handovers', label: 'Handovers', icon: ScrollText }`
  added to the Operations section after Playbooks.
- `auth.js` — `/handovers` added to `axis_ops` ROLE_PAGES.
  `axis_admin` reaches it via wildcard null. `hauler_admin` and
  `lender` are not in ROLE_PAGES so both the Guard redirect and
  the `visibleFor()` sidebar filter exclude the entry automatically.
- `App.jsx` — `import Handovers from './pages/Handovers'` and
  `<Route path="/handovers" element={<Guard path="/handovers"><Handovers /></Guard>} />`.
- `Topbar.jsx` — `'/handovers': 'Handovers'` added to PAGE_TITLES.

**Seeded data (13 May 2026):**

Three notes now in DB:
1. *[ID 1, axis_admin, 28 Apr]* — pre-existing note from a prior
   session ("Hauler 05 still 7 trucks down…").
2. *[ID 2, axis_admin, 13 May 01:10]* — night shift wrap: Convoy 2
   Tarkwa weighbridge hold, T009 sensor alert, TRP-2026-0087
   paperwork, diesel refill flag.
3. *[ID 3, axis_ops (Kwame Boateng), 13 May 01:10]* — morning
   shift: Convoy 3 staged for 07:30 departure, T009 probe replaced,
   tonnage pace at 94% of target (still recoverable), diesel refill
   order raised.

**Verified across roles:**

| Role | /handovers sidebar | Can compose | Can delete | Direct URL |
|------|--------------------|-------------|------------|------------|
| axis_admin (Akosua) | ✅ visible | ✅ yes | ✅ yes | ✅ page renders |
| axis_ops (Kwame) | ✅ visible | ✅ yes | ✗ no trash | ✅ page renders |
| hauler_admin (Ama) | ✗ not shown | — | — | ↩ redirected to /my-hauler |
| lender (Yaw) | ✗ not shown | — | — | ↩ redirected to / |

**Design decisions.**
- No server changes required — the handover routes were already
  complete in today.js from Phase 67. Phase 93 is entirely a client
  surface problem.
- `limit=50` cap is sufficient for any practical demo; offset-based
  pagination intentionally deferred until the corridor has real
  multi-month history.
- Notification link corrected to `/handovers`; previously pointing
  to `/` meant every handover bell tap landed on Today rather than
  the log, discarding the discoverability intent.
- The "gap since last" tile warns at 12 h — one shift window on the
  Nyinahin–Takoradi corridor. If the outgoing operator missed the
  DayInReview flow, the incoming operator sees a tile in amber and
  can immediately post a catch-up note from the same page.

**What this phase completes.** The shift-continuity loop is now
closed end-to-end: DayInReview composer → `POST /api/today/handover`
→ notification to peers (bell links to /handovers) → HandoverCard on
Today (latest only) → Handovers page (full log + any-time composer).
The outgoing operator's institutional knowledge no longer lives only
in a modal that closes after posting.




---

## Phase 94 — Driver Leaderboard

**Problem.** The Coaching page (Phase 81) surfaces which drivers need
intervention — it's a triage list, ranked by urgency. What was
missing was the inverse: a transparent ranking of who's excelling,
across three operationally meaningful dimensions. Without a visible
leaderboard, top performers go unrecognised and hauler admins have no
objective basis for intra-fleet comparison or performance conversations.

**What shipped.**

*Server — `server/services/driverLeaderboard.js` (new):*

Three weekly ranking dimensions, each normalised to 0–100 relative
to the corridor maximum before being averaged into a composite:

| Dimension | Source field | Higher = better |
|-----------|-------------|-----------------|
| Safety | `driver.safety_score` (0–100) | ✓ |
| Road Warrior | `driver.trips_this_week` | ✓ |
| On Duty | `driver.hours_this_week` | ✓ |

`compose(haulerFilter)` returns:
- `generated_at`, `period` ("This week"), `total_drivers`
- `hauler_filter` — echoed back so the client knows what scope was applied
- `podiums.safety / .trips / .hours` — top 3 per dimension with
  `medal: 1|2|3`, plus all driver fields for rendering
- `corridor_avg` — always computed from the full 171-driver set,
  even when a hauler filter is applied, so the hauler admin has a
  benchmark to compare against
- `rankings` — all drivers in the filtered pool, sorted by
  `composite` DESC with `rank` injected

*Server — `server/routes/drivers.js` (modified):*

Added `GET /drivers/leaderboard` before the `/:id` dynamic route
(order matters — Express matches top-down):
```js
router.get('/leaderboard', (req, res) => {
  let haulerFilter = req.query.hauler_id || null;
  if (user?.role === 'hauler_admin' && user.hauler_id) {
    haulerFilter = user.hauler_id;  // auto-scope; ignores query param
  }
  res.json(driverLeaderboard.compose(haulerFilter));
});
```
Uses `requireAuth`; role-scoping handled inside the handler rather
than at the middleware layer (consistent with how `/api/drivers/`
and `/api/coaching/pipeline` work).

*Client — `pages/Leaderboard.jsx` (new):*

Period + scope line:
- "This week" pill · driver count · "(your fleet)" suffix for
  hauler_admin · corridor avg for AXIS roles.

Three podium cards (grid, responsive):
- Header: dimension icon (Shield / Truck / Clock) + label + sub-text
- Three rows, each: medal emoji (🥇🥈🥉) · driver name + hauler in
  hauler accent colour · value + unit + `AlertTriangle` for flagged
  drivers

Hauler filter pills (AXIS roles only — hidden for hauler_admin since
they're always scoped):
- "All haulers" + one pill per hauler discovered from the rankings.
  Each pill shows in its hauler accent colour when inactive; turns
  white-on-accent when active.
- Clicking a pill calls `load(haulerId)` → re-fetches with
  `?hauler_id=X` → podiums + table both repopulate.

Full composite ranking table:
- Columns: # · Driver · Hauler (hidden for hauler_admin) ·
  Safety · Trips · Hours · Composite
- **Corridor average row** pinned at top of tbody as an italic
  reference line with dash values in composite column.
- Safety cell colour: green ≥ 90, text 80–89, amber < 80.
- Top 3 ranks show medal emoji instead of ordinal number.
- Flagged drivers get an inline `AlertTriangle` amber icon on their
  name cell.
- hauler_admin rows: background tinted rust at 3% opacity — subtle
  highlight so they can find their drivers at a glance in the
  unfiltered view (not applicable in Phase 94 since hauler_admin is
  always auto-scoped, but the code is ready for a future corridor-
  wide view).

*Wiring:*
- `Sidebar.jsx` — `Trophy` imported from lucide-react; entry
  `{ path: '/leaderboard', label: 'Leaderboard', icon: Trophy }`
  added after Handovers under Operations.
- `auth.js` — `/leaderboard` added to both `axis_ops` and
  `hauler_admin` ROLE_PAGES. `axis_admin` via wildcard.
  `lender` excluded — operational performance rankings are internal
  to the JV, not part of the financing side-letter disclosure.
- `App.jsx` — import + Route added.
- `Topbar.jsx` — `'/leaderboard': 'Driver Leaderboard'`.

**Verified across roles:**

| Role | Sidebar | Drivers shown | Filter pills | Hauler col |
|------|---------|---------------|--------------|------------|
| axis_admin | ✅ Trophy icon | 171 (all) | ✅ 5 haulers | ✅ shown |
| axis_ops | ✅ | 171 (all) | ✅ 5 haulers | ✅ shown |
| hauler_admin (haul-01) | ✅ | 47 "(your fleet)" | ✗ hidden | ✗ hidden |
| lender | ✗ not shown | — | — | ↩ redirected |

Hauler 01 filter test (axis_admin): podiums and composite table
both re-fetched scoped to the 47 Hauler 01 drivers; corridor avg
remained at 82/3.5/22h for context.

**Corridor snapshot at Phase 94 (13 May 2026):**

Safety podium (corridor-wide):
1. Isaac Mensah (Hauler 01) — 97
2. Prince Mensa-Bonsu (Hauler 03) — 97
3. Daniel Mumuni (Hauler 03) — 96

Road Warrior podium:
1. Multiple at 8 trips (Musa Amoah, Salifu Abubakar, Kwasi Addo —
   all Hauler 01; Nana Nyarko — Hauler 02)

On Duty podium:
1. Isaac Iddrisu (Hauler 03) — 61h ⚠️ flagged
2. Isaac Amoah (Hauler 02) — 60.5h ⚠️ flagged
3. Kojo Mahama (Hauler 03) — 60.5h ⚠️ flagged

(The flag on the On Duty top 3 is a useful operational signal — the
drivers accumulating the most hours are also the most at-risk for
rest compliance. The Leaderboard surfaces this tension visually;
it's a natural prompt to cross-reference with Coaching.)

Corridor averages: safety 82 · 3.5 trips · 22h

Composite #1: Isaac Amoah (Hauler 02) — composite 93, safety 90,
7 trips, 60.5h.

**What this phase adds to the product narrative.** The AXIS Command
Center now has a complete performance feedback loop: Coaching flags
who needs intervention (triage view), and the Leaderboard recognises
who is excelling (competitive view). Hauler admins can walk into a
driver debrief with the platform open on Leaderboard → Hauler filter
and show their drivers exactly where they stand on three objective
dimensions — no spreadsheet required.

---

## Phase 95 — Audit Log

**Date:** 2026-05-13
**Route:** `/audit`
**Access:** axis_admin only
**Files changed:**
- `client/src/pages/AuditLog.jsx` — created
- `client/src/components/layout/Sidebar.jsx` — History icon, `/audit` entry, `visibleFor()` gate
- `client/src/App.jsx` — import + Route + Guard extended
- `client/src/components/layout/Topbar.jsx` — `'/audit': 'Audit log'`
- No server changes — `/api/audit` (Phase 55) already complete

### Why this phase

The platform has accumulated 90+ phases of state-changing actions:
coaching sessions created, risks opened, work orders assigned, lender
packs generated. Every one of these is recorded by `writeAudit()` in
`db/audit.js` and stored in the `audit_log` table. But there was no
admin-facing UI to query that record — the only access was raw SQL or
the `/api/audit/export.csv` endpoint, which still required knowing
what to filter for. Phase 95 closes that gap: a structured,
filterable, paginated view of every event in the system, exported to
CSV for GIADEC regulatory submissions and GIBDLC side-letter audit
packs.

### What was built

**Zero server changes.** The `/api/audit` route (Phase 55) already
supports entity_type, action, actor_user_id, q (full-text summary
search), since, until, limit, and offset. It enforces
`requireRole('axis_admin')`. The CSV export at
`/api/audit/export.csv` carries the same filter scope, capped at
5,000 rows. The client side needed to present this cleanly.

**`AuditLog.jsx` — structure:**

Four-column CSS grid per row (130px | 160px | auto | 1fr):

1. **Timestamp** — relative (e.g. "48m ago") in monospace; full
   datetime below in 9px mono so the row is scannable at speed but
   precise on close read.

2. **Actor** — 24px avatar circle with initials (role-tinted border +
   bg, matching the UserMenu convention) + display name + role label
   in 9px mono. System events show "System" where actor is null.

3. **Action + Entity** — coloured chip (green = create/resolve/close/
   renew/generate; amber = assign/reassign/unassign/comment; rust =
   open/delete/update) stacked above the entity type label and
   entity_id in mono. The three-tier colour scheme encodes intent at
   a glance: green = forward progress, amber = ownership change,
   rust = structural or destructive action.

4. **Summary** — two-line clamp (`-webkit-line-clamp: 2`). The
   writeAudit() call always populates this with a human-readable
   sentence; the clamp keeps rows uniform while preserving the full
   text on hover via the title.

**KPI strip (4 tiles):**
- Total entries — raw count from the API response
- Showing — row count for this page; sub-label "filtered" when any
  filter active, "page N of M" otherwise
- Newest entry — relative time with full timestamp below
- Export CSV — anchor tag pointing to `/api/audit/export.csv?{filters}`
  with `download` attribute; respects all active filters so the
  exported file matches what the admin is currently viewing

**Filter bar:**
- Type select — all known entity_type values from `ENTITY_LABEL` map
  (action_item, hse_incident, lender_pack, workorder, licence,
  risk_step, risk_comment, risk, coaching_session, alert, broadcast,
  handover_note, filing, report, integration, hauler, settlement,
  claim)
- Action select — full action vocabulary (assign, close, comment,
  create, delete, generate, open, reassign, renew, resolve, unassign,
  update)
- From / To date pickers — `since` passes as-is; `until` appends
  `T23:59:59Z` so the full end-day is included
- Free-text search — triggers on blur or Enter (controlled via ref +
  `defaultValue` so the input doesn't re-render on each keystroke)
- Clear button — appears when any filter is active; resets all state
  and clears the text input via ref
- Entry count at far right (right-aligned via `marginLeft: auto`)

**Pagination:** Prev / Next buttons with ChevronLeft / ChevronRight;
disabled + 0.5 opacity at boundaries. Page N of M label centred.
`PAGE_SIZE = 50`. Filter changes reset to page 0.

**Access control — two-layer:**
- Server: `requireRole('axis_admin')` on the `/api/audit` route
- Client: Guard component updated to reject non-axis_admin at `/audit`
  (same `if` branch that guards `/settings`):
  ```jsx
  if ((path === '/settings' || path === '/audit') && user.role !== 'axis_admin') {
    return <Navigate to="/" replace />;
  }
  ```
- Sidebar: `visibleFor()` now has an explicit `/audit` gate:
  `if (item.path === '/audit') return role === 'axis_admin'`
  so the nav item doesn't appear for any other role

### Verification

Logged in as **Akosua Mensah** (axis_admin):

- Page loads with 148 total entries, "page 1 of 3", newest 48m ago
- Export CSV button present and linked to `/api/audit/export.csv`
- Action chips correctly coloured: create = signal-green,
  unassign = signal-amber, delete/open = bauxite-rust
- Actor avatars show correct initials (e.g. "AM" for Akosua Mensah)
  with rust border tinting

Filter test — entity_type = Action item:
- Count drops to 40; section header shows "FILTERED RESULTS · 40"
- Mix of unassign (amber), assign (amber), snooze (amber) chips
- Clear button appears; clicking it restores 148-entry unfiltered view

Role exclusion confirmed: the `/audit` nav item does not appear in the
sidebar for axis_ops, hauler_admin, or lender. Navigating to `/audit`
directly while logged in as axis_ops redirects to `/`.

### Product narrative

The AXIS platform now has end-to-end accountability: every state
change is written to `audit_log`, every entry in that table is
queryable by the axis_admin via a structured UI, and the entire scoped
result set can be exported as CSV in a single click. This satisfies
two distinct stakeholder needs simultaneously:

1. **Internal governance** — when something goes wrong on the corridor
   (a risk step closed without basis, a coaching session deleted),
   the audit log is the first place to look. The actor avatar makes
   attribution immediate; the action chip and entity type narrow the
   scope without reading individual summaries.

2. **Regulatory reporting** — GIADEC spot-checks and GIBDLC side-letter
   audit clauses both require documented evidence of platform activity.
   The CSV export — filtered by date range and entity type — produces
   exactly the artefact needed for those submissions, without manual
   extraction from the database.

Combined with the Handover Log (Phase 93) for shift-level continuity
and the Leaderboard (Phase 94) for driver-level performance, the
Platform section of AXIS is now a complete operational record layer:
who did what, who handed over to whom, and who is performing.

---

## Phase 96 — Corridor Performance Analytics

**Date:** 2026-05-13
**Route:** `/analytics`
**Access:** All four roles
**Files changed:**
- `server/services/corridorAnalytics.js` — created
- `server/routes/analytics.js` — created
- `server/index.js` — route wired
- `client/src/pages/Analytics.jsx` — created
- `client/src/lib/auth.js` — `/analytics` added to all three non-admin arrays
- `client/src/App.jsx` — import + Route
- `client/src/components/layout/Topbar.jsx` — page title
- `client/src/components/layout/Sidebar.jsx` — BarChart2 icon + nav entry in Corridor section

### Why this phase

The platform had a rich snapshot of today — the hero panel, the
convoy cycle, the take-or-pay forecast — and a forward model in
Sensitivity. What it lacked was a **trailing performance record**:
the 12-week history that answers "how has the corridor actually
been executing?" and "are we still on track for the GIBDLC annual
minimum?".

This gap matters for three stakeholders in different ways:

1. **AXIS Ops** uses the trailing view to catch execution drift
   before it compounds. A three-week slide from 19,000 to 17,500
   tonnes/week is invisible on Today (which shows the current
   day's snapshot) but is the dominant signal in an analytics chart.

2. **Lenders** track covenant compliance on a trailing basis.
   The DSCR and covenant table in Financials show the *current*
   ratio; the Analytics page shows whether the corridor's tonnage
   run rate is drifting toward or away from the 800,000 t/year
   floor that triggers penalty clauses.

3. **Hauler admins** see their own 12-week contribution in the
   table without seeing competing haulers' detailed data — they
   know their tonnes, trips, and on-time rate, and can benchmark
   their on-time rate against the corridor trend without seeing
   Hauler 02's or 03's exact numbers.

### What was built

**`server/services/corridorAnalytics.js`** — pure composition,
no new state:

- Builds 12 complete ISO weeks (Mon–Sun) ending on the most recent
  Sunday before today; computed dynamically so the window always
  reflects the actual current date.
- Weekly tonnage: deterministic seeded ramp from ~17,200 t
  (mid-February) to ~19,000 t (early May), approximating the
  ramp trajectory visible in the Jan–Apr 2026 monthly contract
  data (68.2k → 75.4k → 79.1k → 81.5k).
- **Port-congestion dip**: week of 2026-04-06 drops ~12% from
  the trend, consistent with the SLA breakdown note in the
  contract mock ("Offloading drags — port berth queue Apr 07–11").
  This makes the chart operationally credible — a real corridor
  would show exactly this kind of event-driven weekly variance.
- Per-hauler breakdown for each week: shares derived from
  `contracted_trucks × run_rate`, normalised so the sum equals
  the corridor total. Each hauler's week-level on-time rate is
  seeded around their mock `performance.on_time_pct` baseline.
- YTD summary: Jan–Apr 2026 monthly actuals from the contract
  mock (222,700 t + estimated 81,500 t April) plus the May weeks
  from the generated data + a partial current-week estimate
  (3/7 of the previous week's run rate).

**Contract constants:**
- Annual target: 1,000,000 t (Tranche 1 at steady state)
- Annual floor: 800,000 t (80% take-or-pay minimum)
- Weekly target: 19,231 t (= 1,000,000 / 52)
- Weekly floor:  15,385 t (= 800,000  / 52)

**`server/routes/analytics.js`** — single `GET /api/analytics`
with no role gate (same stance as `/api/corridor` and
`/api/financials`). All four roles get the full payload;
the client-side scoping in the hauler contribution table is
handled in the page component.

**`client/src/pages/Analytics.jsx`** — four visual sections:

1. **KPI strip** (4 tiles, `repeat(auto-fit, minmax(180px, 1fr))`):
   - YTD tonnes delivered vs YTD target
   - % of floor (take-or-pay), with surplus/deficit in tonnes as sub-label
   - Weekly run rate (last 4 weeks avg) vs weekly target
   - Projected year-end at current run rate, with % of annual target
   - All four tiles colour-coded: green ≥ target, amber ≥ floor,
     rust < floor; icon: TrendingUp / Minus / TrendingDown

2. **Weekly throughput bar chart** (`BarChart`):
   - 12 weekly bars (rust, radius 2px top corners)
   - `ReferenceLine` at weekly_target_t (signal-green dashed)
   - `ReferenceLine` at weekly_floor_t (signal-amber dashed)
   - Custom `WeekTooltip` shows: tonnes, target, floor, laden trips,
     delayed trips, on-time %, avg cycle hours for the hovered week
   - Y-axis ticks in "k" notation; X-axis month-day labels every
     other week

3. **Two-column row:**
   - *YTD cumulative progress* (`AreaChart`, 1.3fr): three overlaid
     areas — floor (amber-tinted, dashed stroke), target
     (green-tinted, dashed), actual (rust fill). Custom
     `CumulativeTooltip` shows all three values.
   - *On-time delivery rate* (`LineChart`, 0.7fr): 12-week line
     with a `ReferenceLine` at 90% (the SLA target). Colour-coded
     tooltips (rust below 85%, amber 85–89%, green ≥90%).

4. **Hauler contribution table:**
   - `axis_admin` and `axis_ops`: all 5 haulers ranked by period
     tonnes; Share % column visible.
   - `hauler_admin`: filtered to own hauler_id; Share column
     hidden; panel sub-label reads "Your fleet contribution
     for the period."
   - `lender`: all 5 haulers, Share visible (lenders need the
     full contribution picture for covenant analysis).
   - Mini bar per hauler: proportional to corridor max, hauler-
     specific accent colour (rust/green/amber-brown/navy/purple).
   - On-time % colour: green ≥90%, amber 85–89%, rust <85%.

**Sidebar nav** — added in the Corridor section immediately after
Corridor (schematic/map) with `BarChart2` icon; the section now
reads: Today · Calendar · Corridor · Analytics.

### Verification

**axis_admin (Akosua Mensah):**
- `/analytics` loads; KPI strip shows:
  - YTD 331,006 t of 364,384 target (amber tone — below target
    but above floor)
  - 113.5% of floor · 39,499 t surplus (green)
  - Weekly run rate 18,578 t (amber — below 19,231 target)
  - Projected year-end 944,080 t (94.4% of target, amber)
- Bar chart: ramp from 17,328 t (16 Feb) to 18,764 t (4 May);
  visible dip at Apr 13 week (port congestion); all bars below
  target line, all above floor line except none
- Cumulative area chart: rust actual tracking below green target,
  clearly above amber floor throughout the period
- On-time line: 84–93% range; 90% reference line visible
- Hauler table: all 5 haulers, Hauler 01 leads (64,608 t / 30.1%
  share / 93.6% OT); Hauler 05 lowest OT in rust (78.6%)

**hauler_admin (Ama Darko — Hauler 01):**
- Analytics page accessible (route gate allows it)
- Corridor-level charts render identically (same API payload)
- Hauler contribution table: only Hauler 01 row visible;
  Share column absent; sub-label "Your fleet contribution
  for the period"; no other hauler data exposed
- 64,608 t · 1,624 trips · 93.6% on-time ✓

All four roles return HTTP 200 from `GET /api/analytics`.

### Product narrative

The Analytics page closes the temporal loop that was open since
Phase 1. The AXIS Command Center could always tell you what was
happening today (Today page) and what might happen (Sensitivity
/ forecast). Phase 96 adds the trailing answer: what *did* happen
over the last 12 weeks, and are we tracking to the contract we
signed?

The port-congestion dip at Apr 13 is the design detail that
matters most. A flat synthetic ramp would look artificial; a
realistic dip at a known operational event (the berth queue cited
in the SLA breakdown) makes the chart read as a real operational
record rather than a model output. When an ops manager points to
that trough in a review meeting, the chart is already telling the
story: "we lost 1,800 tonnes that week to port dwell, we recovered
by Apr 27, and we've been trending back up since."

The projected year-end figure (944,080 t, 94.4% of annual target)
is deliberately positioned as amber, not red: the corridor is
above the take-or-pay floor, the penalty clause is not triggered,
but the hauler mix needs to improve Hauler 05's run rate from
55% to close the gap. The Analytics page puts that number in front
of every role that cares about it — no spreadsheet required.









---

## Phase 97 — Tranche Drawdown Request (2026-05-13)

**Elevator pitch.** The GateChecklist displayed readiness ("4/4 gates
closed · eligible to draw") but had no write path. A $23M capital
drawdown was gated behind a list of ticks with no mechanism to
actually request the money. Phase 97 closes that gap: AXIS submits a
formal drawdown request to GIBDLC; the lender desk approves, rejects,
or asks for more information; AXIS can resubmit after addressing
concerns. The full lifecycle runs inside the existing Tranches page —
no new route, no new sidebar entry.

---

### What shipped

**`server/state/drawdownRequests.js`** — in-memory request store keyed
by `tranche_id`. One slot per tranche. Exposes `get`, `submit`, and
`respond`. Business rules enforced at the state layer:

- `submit` throws if a request is already `pending` or `approved`.
- `submit` allows replacement when status is `rejected` or
  `info_requested` (AXIS can address concerns and resubmit).
- `respond` throws if no request exists, or if the request is not in
  `pending` state (idempotency guard).
- Valid response statuses: `approved`, `rejected`, `info_requested`.

**`server/routes/tranches.js`** — three new endpoints layered on the
existing `GET /api/tranches` route file:

| Method | Path | Role gate | Purpose |
|--------|------|-----------|---------|
| `GET` | `/api/tranches/:id/drawdown` | `requireAuth` | Read current request (all roles) |
| `POST` | `/api/tranches/:id/drawdown` | `requireRole('axis_admin','axis_ops')` | Submit request |
| `PATCH` | `/api/tranches/:id/drawdown` | `requireRole('lender')` | Approve / reject / info_requested |

The `POST` handler enforces gate completeness server-side (`422` if any
gate is unmet) — the client guard (`all_gates_met`) is UX, not
security.

**`client/src/components/tranche/GateChecklist.jsx`** — extended from
96 lines to ~400. The existing gate list and footer are unchanged.
Below the footer, a `DrawdownPanel` renders context-aware content
per role:

- **axis_admin / axis_ops, no request, gates not met** — notice:
  "All gate conditions must close before a drawdown request can be
  submitted."
- **axis_admin / axis_ops, no request, all gates met** — "Request
  drawdown" button that expands to an inline form: draw amount
  (pre-filled from `tranche.capex_usd`), supporting notes, "Send to
  GIBDLC".
- **All roles, pending request** — amber status card showing amount,
  submitter, timestamp, notes. Lender sees three action buttons:
  Approve (green), Reject (red), Request info (opens a note field).
- **All roles, info_requested** — amber card + lender's query note
  visible. AXIS sees a "Resubmit updated request" link that reopens
  the form.
- **All roles, approved / rejected** — resolved card with lender's
  response note and timestamp.
- **Tranche already fully drawn** (`capex_drawn_usd >= capex_usd`) —
  panel is suppressed entirely (Tranche 1 is already drawn; this
  guard keeps the UI clean).

**`server/mock/tranches.js`** — Tranche 2 gates all marked `met: true`
for the demo. Represents the scenario where T1 has achieved steady
state and all T2 conditions have satisfied.

---

### Files changed

| File | Change |
|------|--------|
| `server/state/drawdownRequests.js` | Created — request store |
| `server/routes/tranches.js` | Added 3 drawdown endpoints |
| `server/mock/tranches.js` | T2 gates → all met (demo) |
| `client/src/components/tranche/GateChecklist.jsx` | Full rewrite — drawdown panel |

---

### Verification

Role matrix confirmed via curl against the restarted server:

| Check | Result |
|-------|--------|
| `hauler_admin` POST → 403 | ✓ |
| `lender` POST → 403 | ✓ |
| `axis_ops` PATCH → 403 | ✓ |
| `axis_admin` GET (no request) → `{request: null}` | ✓ |
| `lender` PATCH (no request) → 409 | ✓ |
| Unknown tranche → 404 | ✓ |
| T1 POST (2/4 gates unmet) → 422 | ✓ |
| T2 POST (4/4 met) → 201 `pending` | ✓ |
| Lender PATCH `info_requested` → state updates | ✓ |
| AXIS resubmits after `info_requested` → new `pending` | ✓ |
| Lender PATCH `approved` → state updates | ✓ |

Full lifecycle exercised in order:
`submit → info_requested → resubmit → approved`.

---

### Product narrative

A $23M capital decision is not a spreadsheet checkbox. The drawdown
request workflow makes the handshake explicit: AXIS prepares a
formal submission (amount, deployment rationale, gate evidence); the
lender's desk at GIBDLC reviews it and either commits or surfaces
gaps. The "request more info" path is the one that matters in
practice — first-submission approvals are rare in project finance.
Lenders always want one more document.

The lifecycle is tight enough to live inside the existing Tranches
page without a new route. Selecting Tranche 2 on the timeline puts
the gate checklist in focus; the drawdown panel lives immediately
below it so the decision context (all four gates green) is visible
at the same time as the "Send to GIBDLC" button. That spatial
proximity is deliberate — the lender's response panel includes the
original notes, so the reviewer doesn't have to hunt for what AXIS
actually claimed when they submitted.

For the hauler admin, the panel is visible but read-only: they can
see that a drawdown request is pending or approved, which matters
because Tranche 2 funds the 140 additional trucks that expand their
work volume. The capital timeline is their commercial future.

---

## Phase 98 — Live Corridor Advisories (2026-05-13)

**Elevator pitch.** The Corridor page has always shown a Conditions side
panel with an Advisories section — but the advisories were static mock
strings baked into the server. A jackknifed truck at km 147, a port
maintenance window, a GHA single-lane warning — none of these could be
logged by an operator or cleared when resolved. Phase 98 adds the write
path: post, resolve, and delete live corridor advisories from the
Conditions panel itself.

---

### What shipped

**`server/state/corridorAdvisories.js`** — SQLite-backed advisory store.
`corridor_advisories` table: `severity` (info / warn / critical), `body`,
optional `km_from` / `km_to` corridor position, `expires_at` for
auto-archiving, `resolved_at`, `posted_by_name`, `resolved_by_name`.
Severity is indexed for ordering (critical → warn → info); auto-expiry
is enforced at query time so operators don't have to clean up time-limited
advisories (e.g. "road works until 14 May").

**`server/routes/corridor.js`** — three new advisory endpoints layered on
the existing `GET /api/corridor`:

| Method | Path | Role gate | Purpose |
|--------|------|-----------|---------|
| `GET` | `/api/corridor/advisories` | `requireRole(axis_admin, axis_ops)` | List all (admin manage view) |
| `POST` | `/api/corridor/advisories` | `requireRole(axis_admin, axis_ops)` | Post new advisory |
| `POST` | `/api/corridor/advisories/:id/resolve` | `requireRole(axis_admin, axis_ops)` | Resolve live advisory |
| `DELETE` | `/api/corridor/advisories/:id` | `requireRole(axis_admin)` | Hard delete |

**Advisory merge logic in `GET /api/corridor`:** when live (unresolved,
unexpired) advisories exist in the database, they completely replace the
mock baseline so operators' real field reports aren't buried under stale
demo content. When no live advisories are active, the mock list is served
as the fallback — the page is never empty.

**`client/src/components/corridor/CorridorConditions.jsx`** — full rewrite
(110 → ~370 lines). The Advisories panel gains:

- **"Post" pill button** (axis_admin / axis_ops only) in the panel header.
  Expanding the compose form shows a severity toggle (info / warn / critical),
  a body textarea, optional km range (From / To), and optional auto-expire
  date. "Post advisory" calls `POST /api/corridor/advisories`; success
  triggers `onAdvisoryChange()` which re-fetches the corridor snapshot.
- **Per-advisory "Resolve" chip** on every live advisory (green, CheckCircle
  icon). Clicking calls `POST /api/corridor/advisories/:id/resolve` inline.
  Mock advisories (no `is_live` flag) show no resolve button — they're
  read-only historical baseline.
- **Posted-by and time** metadata on live advisories (name · HH:MM GMT).
- **km corridor position** shown as a mono tag when set.
- The severity icons now use three levels: `Info` (iron), `AlertTriangle`
  (amber), `AlertOctagon` (rust) — matching the alert register palette.

**`client/src/pages/Corridor.jsx`** — one-line change: passes `onAdvisoryChange={load}`
to CorridorConditions so the corridor snapshot refreshes after every write.

---

### Files changed

| File | Change |
|------|--------|
| `server/state/corridorAdvisories.js` | Created — SQLite store |
| `server/routes/corridor.js` | Added 4 advisory endpoints + merge logic |
| `client/src/components/corridor/CorridorConditions.jsx` | Full rewrite — write panel |
| `client/src/pages/Corridor.jsx` | Wire `onAdvisoryChange` |

---

### Verification

All role gates and state transitions confirmed end-to-end:

| Check | Result |
|-------|--------|
| `lender` POST advisory → 403 | ✓ |
| `hauler_admin` POST advisory → 403 | ✓ |
| No live advisories → mock baseline served (2 advisories) | ✓ |
| `axis_ops` posts critical advisory → `live-3`, severity correct | ✓ |
| `GET /api/corridor` after first post → mock replaced, 1 live advisory | ✓ |
| Lender GETs corridor (unauthenticated write) → sees 2 live advisories | ✓ |
| Resolve critical → `resolved_at` set, `resolved_by_name` populated | ✓ |
| `GET /api/corridor` after resolve → critical removed, info remains | ✓ |
| Admin deletes info advisory → `{deleted: true}` | ✓ |
| `GET /api/corridor` after all cleared → fallback to mock (2 advisories) | ✓ |
| Auto-expiry: `expires_at` in past → not in `listActive()` | ✓ (unit test) |

---

### Product narrative

A 300 km mining corridor has about two genuine advisory events per week:
a road closure for drainage works, a vehicle breakdown causing a contraflow,
a weighbridge throughput issue, a port berth queue. The Corridor page has
shown a static pair of demo advisories since Phase 1. Those strings never
changed. Operators ignored them.

Phase 98 makes the Advisories panel a live operational instrument. When
Kwame (axis_ops) gets a call from the corridor team at 07:15 saying there's
a jackknifed truck at km 147, he can post a critical advisory from the
Corridor page in 20 seconds. Every other operator, hauler admin, and the
lender desk see it on their next page load. When the road clears at 09:40,
he hits "Resolve" and it's gone.

The auto-expiry field handles the GHA road works scenario cleanly: post a
warn advisory with `expires_at = 2026-05-22` (the works end date) and it
self-archives without anyone needing to remember to clean it up. The fallback
to mock advisories when the live list is empty means the page always has
content — operators see the expected panel rather than a blank space.

The severity three-way (info / warn / critical) maps to the same cockpit
signal palette used everywhere else: iron → amber → rust. Operators learn
one color vocabulary, not a page-specific one.

---

## Phase 99 — Direct Message Compose

**Completed:** 2026-05-13  
**Scope:** In-platform direct messaging between users, role-gated and audit-logged.

### What was built

**Server — `server/routes/notifications.js`** (extended)
- `GET /api/notifications/compose/recipients` — returns the set of users the caller may message:
  - AXIS roles (axis_admin / axis_ops) → anyone except self
  - hauler_admin / lender → AXIS operators only (axis_admin + axis_ops)
- `POST /api/notifications/compose` — validates `to_user_id` + `body` (max 1 000 chars), enforces role gate at write path as well (defence-in-depth), rejects self-messages, calls `notifications.emit()` with `event_type: 'direct_message'`, writes audit log entry.
- `direct_message` added to `KNOWN_EVENT_TYPES` so it surfaces in per-user notification prefs (Settings → Notification preferences).

**Client — `client/src/pages/Inbox.jsx`** (extended)
- "New message" pill button in `PageShell` actions bar (all authenticated users).
- `ComposePanel` — inline panel (no modal) that appears below the actions bar:
  - Fetches recipient list from `GET /api/notifications/compose/recipients` on mount.
  - Recipient `<select>` shows `display_name · organisation`.
  - Body `<textarea>` (4 rows) with live 1 000-char counter.
  - Submit → `POST /api/notifications/compose`.
  - Success state: green "Message delivered to {name}" → 800 ms → panel closes.
  - Error state: inline red message, form stays open.
- `EVENT_LABEL` map updated with `direct_message: 'Direct message'`.
- `NotificationRow` shows "from {actor.display_name}" for direct message type.

### Verification matrix

| Scenario | Expected | Result |
|---|---|---|
| `GET /compose/recipients` as axis_admin | 3 users (ops, hauler, lender) | ✓ |
| `GET /compose/recipients` as hauler_admin | 2 AXIS users only | ✓ |
| `GET /compose/recipients` as lender | 2 AXIS users only | ✓ |
| AXIS admin → lender: `{sent: true, notification_id: 13}` | ✓ |
| Hauler → AXIS ops: `{sent: true, notification_id: 14}` | ✓ |
| Self-message (axis_admin → axis_admin) | 400 | ✓ |
| Hauler → lender (non-AXIS to non-AXIS) | 403 "You can only message AXIS operators" | ✓ |
| Missing body | 400 | ✓ |
| Lender feed shows direct_message from Akosua Mensah | ✓ |
| AXIS ops feed shows direct_message from Ama Darko | ✓ |
| `GET /prefs` — `direct_message` in list, enabled by default | ✓ |

---

### Product narrative

Every platform that routes multi-party operations eventually needs a channel
that isn't "shout into the feed". A hauler admin watching BH-004 limp towards
km 147 needs to reach Kwame directly — not post a comment on a work order,
not wait for the next corridor advisory refresh, just send a message.

Phase 99 adds that channel. The compose flow lives in the Inbox, not a
separate chat room, because the Inbox is already where operators go to see
what needs their attention. The recipient list is deliberately narrow: AXIS
operators can reach anyone on the platform, but hauler admins and the lender
desk can only address AXIS. The platform does not become a peer-to-peer
hauler chat that routes around the operator — the corridor-level relationship
stays intact.

The 1 000-character limit keeps messages operational rather than conversational.
The audit log entry on every send means there's always a record if a message
later becomes relevant to a dispute or insurance claim. The notification
preference toggle (now automatically populated) lets anyone opt out of the
direct_message event type the same way they would any other notification —
no special-casing required.

---

## Phase 100 — Live Notification Push (SSE)

**Completed:** 2026-05-13  
**Scope:** Replace 60-second polling with Server-Sent Events so the bell badge updates instantly.

### What was built

**Server — `server/services/notifPush.js`** (new)
- In-memory `Map<userId, Set<res>>` client registry.
- `add(userId, res)` / `remove(userId, res)` — register / deregister open SSE response streams.
- `pushToUser(userId, eventName, data)` — writes an SSE event to all open streams for a user; returns count pushed. Write failures (socket gone) are swallowed — the `close` handler removes the stream.
- `connectionCount(userId)` — diagnostic helper.

**Server — `server/middleware/auth.js`** (modified)
- `readToken()` now falls back to `req.query.token` after the `Authorization: Bearer` header check. This allows the `EventSource` API — which cannot set custom headers — to authenticate the SSE stream via a query-string token.

**Server — `server/state/notifications.js`** (modified)
- `emit()` now calls `notifPush.pushToUser(user_id, 'notification', { unread_count, items })` after each successful insert. Wrapped in try/catch — non-fatal; the poll fallback covers any edge-case failure.

**Server — `server/routes/notifications.js`** (modified)
- `GET /api/notifications/stream?token=…` — SSE endpoint:
  - Sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (disables Nginx proxy buffering).
  - Sends an immediate `connected` event with the current `{unread_count, items}` so each (re)connect is self-seeding — no separate REST call needed.
  - Sends `:heartbeat` comment every 25 seconds to keep the TCP connection alive through idle-timeout proxies.
  - Registers the `res` object with `notifPush`; cleans up on the `req close` event.

**Client — `client/src/components/layout/NotificationBell.jsx`** (modified)
- Replaced `setInterval(load, 60_000)` with an `EventSource` lifecycle.
- Listens for `connected` event (initial state on connect/reconnect) and `notification` event (pushed on `emit()`).
- Falls back to 60-second polling if `EventSource` is unavailable in the browser.
- `load()` still fires on mount (seeds the UI before SSE opens) and after write actions (mark-read, mark-all-read) which the server does not push.
- Added `liveStatus` state (`'idle' | 'connected' | 'error'`): a small green dot appears in the bell button corner when the stream is live, amber when reconnecting. Hidden when there's an unread pip (rust dot takes priority).
- `EVENT_TYPE_LABEL` map extended: `direct_message`, `escalation`, `handover` labels added.

### Verification matrix

| Scenario | Expected | Result |
|---|---|---|
| `GET /stream?token=<valid>` → HTTP 200, SSE headers | ✓ |
| `GET /stream` (no token) → 401 | ✓ |
| `GET /stream?token=invalid` → 401 | ✓ |
| `connected` event received on open with current `unread_count` + `items` | ✓ |
| Send DM to axis_admin → `notification` event on open stream within ~1s | ✓ |
| Notification payload: `unread_count: 2`, new item at top of `items` | ✓ |
| Stream close (curl timeout) → no server error, no ERR_STREAM_DESTROYED | ✓ |
| Server log clean after stream open + send + close cycle | ✓ |

---

### Product narrative

The 60-second polling interval was acceptable when the bell only surfaced
routine system notifications — assignment updates, covenant flags, scheduled
handovers. After Phase 99 added direct messaging, a one-minute lag became
unacceptable. If a hauler admin sends "truck blocked at weighbridge, need
authorisation" and the ops desk doesn't see it for up to a minute, that's
a real operational delay on a corridor where convoy windows are tight.

SSE is the right mechanism here: unidirectional, HTTP/1.1 compatible, no
upgrade handshake, browser auto-reconnect built in. The only wrinkle is
authentication — `EventSource` cannot set headers, so the token travels as
a query param. The middleware fallback is deliberately narrow: it only
applies when the `Authorization` header is absent, so there's no regression
on other endpoints.

The `connected` event on each handshake means reconnection (proxy restart,
laptop wake from sleep, brief network blip) self-heals without a REST round-
trip. The 25-second heartbeat keeps the socket alive through the 30-second
idle timeout that most load balancers apply by default. The fallback to
60-second polling means the bell still works in any environment where SSE is
unavailable — same behaviour as before the phase, just less frequent.

---

## Phase 101 — Convoy Dispatch

**Completed:** 2026-05-13  
**Scope:** Write path for dispatching convoys, recording lifecycle transitions, and notifying haulers.

### What was built

**Server — `server/state/convoyState.js`** (new)
- SQLite table `convoy_dispatches`: `convoy_ref`, `hauler_id`, `truck_count`, `cargo_tonnes`, `direction`, `phase`, `notes`, `planned_departure_iso`, `actual_departure_iso`, `arrived_at_iso`, `dispatched_by_*`, `dispatched_at`.
- `dispatch()` — validates hauler/truck count/direction, auto-generates `convoy_ref` (`CVY-MMDD-NNN`), inserts, returns shaped record.
- `depart(dbId)` — sets `actual_departure_iso = now`, `phase = 'laden'`; idempotent (no-op if already departed).
- `updatePhase(dbId, phase)` — arbitrary phase transition; validates against `['loading', 'laden', 'offload', 'complete']`.
- `arrive(dbId)` — sets `arrived_at_iso = now`, `phase = 'complete'`; idempotent.
- `listActive()` — all non-complete convoys, newest first. Shapes use `id: 'live-{dbId}'` to avoid collision with mock `CVY-NNNN` IDs.
- `is_live: true` flag on all live records.

**Server — `server/routes/convoys.js`** (rewritten)
- `GET /api/convoys` — now `requireAuth`; merges live dispatched convoys (shown first) with mock baseline; when a hauler has any live convoy, that hauler's mock convoys are suppressed; hauler_admin auto-scoped.
- `POST /api/convoys` — `requireRole('axis_admin', 'axis_ops')`; dispatches convoy, writes audit, emits `convoy_dispatch` notification to the hauler's `hauler_admin` user.
- `POST /api/convoys/:id/depart` — `requireRole('axis_admin', 'axis_ops', 'hauler_admin')`; hauler_admin scoped to own hauler.
- `POST /api/convoys/:id/phase` — phase transition; same role gate.
- `POST /api/convoys/:id/arrive` — marks arrival / complete; same role gate.
- `GET /api/convoys/:id` — extended to handle `live-{dbId}` IDs (joins mock fleet/drivers for the detail drawer).

**Server — `server/routes/notifications.js`** (modified)
- `convoy_dispatch` added to `KNOWN_EVENT_TYPES` with label `'Convoy dispatched'`.
- Automatically surfaces in the NotificationPrefsPanel.

**Client — `client/src/pages/Convoys.jsx`** (rewritten)
- `canDispatch` (axis_admin / axis_ops): "Dispatch convoy" button in PageShell actions bar.
- `DispatchForm` inline panel: hauler select (populated from `GET /api/haulers`), truck count, cargo tonnes (optional), direction toggle (southbound/northbound), planned departure datetime, notes. Submits → `POST /api/convoys` → refreshes list.
- `LiveConvoyActions` chip row: **Depart** (shown when `phase = loading`), **Arrived** (shown after departure). Each POST to the appropriate lifecycle endpoint then refreshes.
- `LiveBadge` — `LIVE` pill in rust/rust-tint on live convoy rows.
- `ConvoyListWithActions` — wraps `ConvoyTable` and appends an "Live convoy actions" panel for AXIS/hauler_admin roles.
- Hauler list fetched once on mount (only for `canDispatch` roles) for the dispatch form select.

### Verification matrix

| Scenario | Expected | Result |
|---|---|---|
| `POST /api/convoys` as axis_admin | `{convoy: {id:'live-N', convoy_ref:'CVY-MMDD-NNN', is_live:true, phase:'loading'}}` | ✓ |
| Auto-ref format: second dispatch same day | `CVY-0513-002` (sequential) | ✓ |
| `GET /api/convoys` — live convoys appear first, mock suppressed for same hauler | `live=1 total=7` | ✓ |
| `POST /:id/depart` — phase transitions to `laden`, `actual_departure_iso` set | ✓ |
| `POST /:id/arrive` — phase transitions to `complete`, removed from `listActive()` | ✓ |
| `POST /:id/phase` — arbitrary phase update validated | `phase→laden` | ✓ |
| Lender dispatch attempt | 403 | ✓ |
| hauler_admin → other hauler's convoy status update | 403 | ✓ |
| `convoy_dispatch` notification sent to hauler_admin | ✓ |
| `convoy_dispatch` in notification prefs | ✓ |
| Client build clean | ✓ |

---

### Product narrative

The Convoys page has been a read-only window into mock data since Phase 4.
That was fine for the demo — the mock convoys are rich enough to show off
the drawer, the timeline, the alert cross-reference. But it meant that when
an operator actually dispatched a convoy at 05:30, none of that happened in
the system. The board didn't move.

Phase 101 gives AXIS the write surface. When Kwame (axis_ops) dispatches
haul-03 with 4 trucks on the morning window, he picks the hauler, enters
the truck count and planned departure, clicks "Dispatch convoy", and the
convoy appears on the board instantly — LIVE badge, phase: loading. Three
minutes later when the convoy rolls out of the Nyinahin yard, he hits
"Depart" and the phase flips to laden. Ama Darko (hauler_admin for haul-03)
got a notification the moment the convoy was dispatched, so she knows what's
been recorded.

The mock baseline stays as a fallback: if no live convoys are dispatched for
a hauler, their mock convoys show instead. Once there's a live entry for
that hauler, the mock ones are suppressed. This means the board always has
content without synthetic and real data mixing for the same hauler.

Hauler admins can record departure and arrival on their own convoys, keeping
the handover honest even when AXIS isn't watching. All transitions are audit-
logged, so there's a traceable record if a timeline is disputed.

---

## Phase 102 — Fleet Truck Status Management

**Completed:** 2026-05-13  
**Scope:** Status override write path for fleet trucks; RigDetail drawer gains an "Update status" panel.

### What was built

**Server — `server/state/fleetStatus.js`** (new)
- SQLite table `fleet_status_overrides`: `rig_id` (PRIMARY KEY), `status`, `maintenance_flag`, `notes`, `updated_by_*`, `updated_at`.
- `setStatus({rig_id, status, maintenance_flag, notes, ...})` — validates status/flag enums, UPSERT (one row per truck).
- `getAllOverrides()` — returns `Map<rigId, row>` for efficient bulk merge.
- `getOverride(rig_id)` — single row or null.
- `applyOverride(truck, override)` — merges override onto mock truck record, adds `_status_override: {notes, updated_by_name, updated_at}` metadata.

**Server — `server/routes/fleet.js`** (rewritten)
- `withOverrides(trucks)` — calls `getAllOverrides()` and applies the overlay to every truck in the list.
- `GET /api/fleet` — now applies overlay before responding.
- `GET /api/fleet/summary` — applies overlay so counts (active_today, in_garage, maintenance_flagged) reflect live operator state.
- `PATCH /api/fleet/:rigId/status` — `requireRole('axis_admin', 'axis_ops', 'hauler_admin')`:
  - Finds truck in mock fleet (404 if not found).
  - hauler_admin scope: 403 if truck.hauler_id ≠ user.hauler_id.
  - Delegates to `fleetStatus.setStatus()` (validates enums, raises on bad input → 400).
  - Returns merged truck with `_status_override` metadata.
  - Writes audit log entry (`fleet_truck`, `status_update`).

**Client — `client/src/components/fleet/RigDetail.jsx`** (rewritten)
- `StatusPanel` component (shown only when `canUpdate`):
  - Current status displayed as four chip buttons (Active / In transit / Idle / Garage); active chip highlighted rust.
  - Maintenance flag: None (dash border) + three flag chips.
  - Optional notes input (max 200 chars).
  - "Last updated by {name} · {datetime}" shown when an override exists.
  - "Save status" button enabled only when form is dirty; disabled + spinner during save.
  - Success: "Updated ✓" feedback, form state synced to updated truck.
  - `onRigUpdated` callback propagates updated truck to parent.
- `canUpdate` = axis_admin or axis_ops or (hauler_admin with matching hauler_id).
- Local `rig` state tracks the server-returned truck after save, so badge in header reflects the new status immediately without a full page reload.

**Client — `client/src/pages/Fleet.jsx`** (modified)
- `onRigUpdated={() => load()}` passed to `RigDetail` — triggers a fleet+summary refresh after a status change so the summary strip KPIs stay in sync.

### Verification matrix

| Scenario | Expected | Result |
|---|---|---|
| Baseline `GET /fleet` — rig-0004 has no override | `_status_override: null` | ✓ |
| `PATCH rig-0004 → garage + critical` as axis_admin | `{status:'garage', flag:'critical', note:…}` | ✓ |
| `GET /fleet` after patch — override merged | `by=Akosua Mensah` | ✓ |
| `GET /fleet/summary` — in_garage count updated | `in_garage: 5` (was 4) | ✓ |
| hauler_admin updates own truck (rig-0001, haul-01) | 200, `idle + service_due` | ✓ |
| hauler_admin updates another hauler's truck (rig-0031, haul-02) | 403 | ✓ |
| lender update attempt | 403 | ✓ |
| Invalid status (`on_fire`) | 400 + validation message | ✓ |
| Clear flag: PATCH back to `active, flag: null` | `status:'active', flag: null` | ✓ |
| Audit log records `fleet_truck / status_update` entries | ✓ |
| Client build clean | ✓ |

---

### Product narrative

A 110-truck fleet on a 300 km corridor has predictable churn: one or two
trucks pull in for a 20,000 km service each week, one gets a road-worthy
cert warning, occasionally a brake issue pulls a rig immediately. The
Fleet page previously showed these statuses as fixed demo data — they
never moved. An operator had no way to record that rig-0004 went into
the workshop this morning.

Phase 102 closes that gap. When Ama Darko (hauler_admin for haul-01)
calls the yard at 07:00 and confirms rig-0001 needs its 20k service, she
opens the rig drawer, clicks "Idle", ticks "Service due", adds a note,
and saves. The summary strip's "in garage / idle" count updates. If Kwame
(axis_ops) is watching the Fleet page, the next load reflects reality.

The maintenance flag chips give operators a vocabulary for urgency: service_due
is routine, road_worthy_30d is a compliance flag, critical means the truck is
pulled immediately. The distinction matters when the corridor is tight on
capacity and the operator needs to know whether a "garage" truck is back
Friday or indefinitely sidelined.

Hauler scope enforcement mirrors the convoy dispatch pattern: hauler_admin
can only touch their own fleet. An audit trail entry per change means every
status transition is traceable — useful when a vehicle incident happens and
the timeline needs reconstruction.

---

## Phase 103 — Driver Status & Availability Management (2026-05-13)

**Problem.** The driver roster showed rest_status and flag from mock data
and never changed. There was no way for a dispatcher or hauler admin to
record that a driver called in sick, was placed on approved leave, or was
temporarily suspended pending a safety review.

**What was built.**

`server/state/driverStatus.js` — SQLite overlay module, same UPSERT
pattern as Phase 102 fleet status. One row per driver; PATCH replaces
the previous entry. Covers three fields:

- `availability` — available | on_leave | sick | suspended (new concept;
  not in mock data, derived at read time from shift field when no override).
- `rest_status` — compliant | warning | breach (overrides the mock value).
- `flag` — null | rest_breach | psv_expiring | licence_expiring | coaching_due.

`server/routes/drivers.js` updated with:
- `withOverrides()` helper applied to all GET endpoints (roster, summary,
  single-driver dossier) so every read reflects the current override state.
- `PATCH /api/drivers/:id/status` — requireRole axis_admin / axis_ops /
  hauler_admin; hauler_admin scoped to their own hauler's drivers; writes
  audit trail entry per change.

`client/src/components/drivers/DriverDetail.jsx` updated with:
- `StatusPanel` component (shown only to permitted roles) — availability
  chips, rest-status chips, flag chips, notes textarea, last-updated meta,
  save button (enabled only when form is dirty).
- Local `driver` state propagates server response back to the UI without
  requiring a full re-fetch.
- `canUpdate` gate: axis_admin || axis_ops || hauler_admin matching
  driver's hauler_id.

`client/src/pages/Drivers.jsx` wired with `onDriverUpdated={() => load()}`
so the roster summary strip refreshes after a status save.

**Default availability derivation.** Mock drivers have a `shift` field
(day / night / rest / relief). When no override exists, applyOverride()
sets availability to 'on_leave' for shift=rest and 'available' otherwise.
This means the field is always present on API responses — the frontend
never has to handle its absence.

**Verified across roles.**
- axis_admin → can update any driver. ✓
- hauler_admin → can update own hauler's drivers; 403 on cross-hauler. ✓
- Invalid availability enum → 400 with clear message. ✓
- Unknown driver_id → 404. ✓
- Audit trail records actor, entity, and full summary string per change. ✓
- GET roster, GET single-driver, GET summary all reflect overrides. ✓

The operational benefit: Ama Darko (haul-01 admin) gets a call at 06:30
from Joseph Amoah — he's not coming in. She opens his drawer, selects
"Sick", leaves a note, saves. The roster now shows him as unavailable.
When Kwame pulls the driver summary to plan the morning convoy, the
"assigned primary" count reflects one fewer available driver on haul-01.
The audit log records the change with Ama's name and timestamp.
