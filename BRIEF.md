# AXIS Command Center — Product Brief

Version 0.2 · April 2026 · Pre-build working brief

This document defines the AXIS Command Center product: what it is, what it is not, how it differs from FF Control Center, and how it will be built. It is the single source of truth before any code is written. It resolves to the AXIS design system (`../Bauxite Project/DESIGN_SYSTEM.md`) and the NewCo business plan (`../Bauxite Project/NewCo_Logistics_Business_Plan_v2 (AXIS).docx`).

---

## 1. Product positioning

AXIS Command Center is the operational and commercial control layer for the Nyinahin–Takoradi bauxite haulage corridor. It aggregates live data from 4–6 onboarded haulage companies — each contributing a slice of the ~550-truck fleet requirement at 5 Mtpa — and presents one coherent corridor view to AXIS management, GIBDLC, and lenders.

**One-line positioning (matches AXIS brand):**
> The corridor control layer between Ghana's bauxite and the global market.

**Naming (follows AXIS brand architecture):**
- Product surface: **AXIS Control** (the sub-product name per the design system's naming architecture — "AXIS + capability")
- Internal codename: `command-center`
- UI chrome: wordmark lockup top-left, no secondary product name shouted in the chrome

**What it is:**
- A corridor operator's command layer — dispatch discipline, payload compliance, SLA attainment, lender reporting.
- A multi-hauler aggregation platform — each hauler plugs in via API (their own FMS or Loconav account), AXIS normalises into one schema.
- A GIBDLC-facing reporting surface — tonnage vs contracted, service levels, take-or-pay reconciliation.
- A DFI/lender-facing reporting surface — DSCR, covenant compliance, tranche ramp status.

**What it is not:**
- Not a live tracking map that duplicates what each hauler's FMS already shows (Loconav et al. do that — we link out).
- Not a generalist fleet management SaaS. It runs one commodity on one corridor.
- Not a consumer product. Audience is AXIS ops, GIBDLC, DFIs, regulators. No marketing chrome.
- Not a startup-register UI. The design system reads as infrastructure (Fluor, Bechtel, Trafigura), not logistics tech.

---

## 2. Two deployment modes

The user is considering two paths for the AXIS venture itself. The product must support both.

### Mode A — Hauler-only
AXIS operates its own trucks (Tranche 1 = 110 trucks). The Command Center is AXIS's internal fleet intelligence layer. Single hauler, single tenant. Identical to FF Control Center's shape, rebranded to AXIS.

### Mode B — Command Center-as-solution (primary)
AXIS operates its own trucks **and** is the corridor aggregator for 4–6 onboarded haulage companies contributing additional capacity. Each hauler retains ownership of its fleet and may retain its own FMS; AXIS integrates via API (Loconav API keys requested from each hauler, or hauler-specific FMS adapters). AXIS presents to GIBDLC as one operator; internally, the Command Center attributes every trip, tonne, and SLA breach to the contributing hauler.

**Build target: Mode B.** Mode A is the degenerate single-tenant case and falls out naturally.

---

## 3. Differences from FF Control Center

Reuse wherever the concept transfers. Replace where AXIS's positioning demands.

| Concern | FF Control Center | AXIS Command Center |
|---|---|---|
| Tenant model | Single account (GMEA Group, 32504) | Multi-hauler aggregation; each hauler is a first-class entity |
| Brand | Recursive / Neue Haas / Onest; warm white + amber/teal/violet | Inter / JetBrains Mono only; Bone + Charcoal + Bauxite Rust (8pt, 4px radius) |
| Voice | Analyst briefing, approachable | Port authority notice — specific, understated, no "solutions" / "best-in-class" (per design system §2) |
| Assets | Vehicles, generators, tanks (three types) | Tractor-trailer rigs only (40T payload, 6-axle). Generators/tanks are non-goals. |
| Geography | General Ghana fleet, multiple cities | One corridor: Nyinahin → Takoradi (300 km, N6/N8 via Kumasi) |
| Commodity | Mixed (fuel, passengers, freight) | Bauxite only |
| Counterparty | Internal (GMEA) | GIBDLC (contract), with GIADEC oversight |
| AI component | "Fleet AI" chatbot feel, gradient avatar | "AXIS Intelligence" briefing feed. Chat is secondary. Restrained chrome. No gradient avatars. |
| Maps | Loconav live map integration | Corridor schematic (one line from Nyinahin to Takoradi with waypoints) — not live positions. Link to each hauler's FMS for live. |
| Alerts | General fleet alert types | Corridor-specific: axle-load breach, convoy delay, payload variance, weighbridge hold, mine/port queue overflow, SLA breach vs GIBDLC |
| Financials | Operating costs (GHC) | Tariff revenue (USD $0.08/t·km), take-or-pay reconciliation, DSCR, tranche CAPEX, indexation calc |

---

## 4. Information architecture

Nav order reflects AXIS priorities: corridor first, then counterparty, then commercial.

```
CORRIDOR
  /                     Today              Corridor briefing — today's state across all haulers
  /corridor             Corridor view      Schematic map, convoy timeline, weighbridge status

OPERATIONS
  /convoys              Convoys            Active convoys, cycle times, on-time %
  /trips                Trips              Trip analytics — costs, delay patterns (by hauler)
  /drivers              Drivers            Performance scoring across all haulers, coaching flags
  /compliance           Compliance         Axle load, GHA/DVLA, HSE events

FLEET
  /haulers              Haulers            Onboarded haulage companies, API health, fleet contribution
  /fleet                Fleet              Aggregated truck roster across all haulers
  /maintenance          Maintenance        Service intervals, tyre programme, workshop dispatch

CONTRACT
  /contract             GIBDLC contract    Tonnage vs contracted, take-or-pay, SLA attainment
  /tariff               Tariff             Base rate, indexation components, fuel pass-through

CAPITAL
  /tranches             Tranches           Deployment ramp (1→5 Mtpa), CAPEX committed, fleet added
  /financials           Financials         DSCR, lender covenants, P&L snapshot, receivables

PLATFORM
  /alerts               Alerts             Prioritised action items
  /reports              Reports            Monthly GIBDLC pack, lender pack, regulatory filings
  /settings             Settings           Users, API credentials, roles
```

Sidebar width matches design system (8pt system). Section dividers are 1px Ash, not tinted.

---

## 5. Core new concept — Hauler aggregation

This is the structural addition that does not exist in FF Control Center.

### 5.1 Hauler model

```
Hauler
  id                    haul-01
  display_name          "Hauler 01"                   # anonymous in v1
  onboarded_date        2026-05-14
  fleet_contribution    {contracted_trucks: 40, active_trucks: 37}
  api_integration       {type: "loconav" | "custom" | "manual"}
  api_status            {connected: true, last_sync: ISO8601, error_count_24h: 0}
  contract_share        {tonnage_pct: 0.22, revenue_pct: 0.22}
  performance           {sla_attainment: 0.94, on_time_pct: 0.91, safety_score: 88}
```

Haulers are anonymised in v1 (`Hauler 01` through `Hauler 05`). Legal names and trading brands are added in a later phase once real onboarding begins. This keeps mock data neutral and avoids implying relationships that do not yet exist.

### 5.2 Integration types

| Type | Mechanism | Notes |
|---|---|---|
| Loconav | Hauler shares API token (read-only) on their Loconav account | AXIS server proxies with per-hauler token; reuses the existing Loconav bridge |
| Custom FMS | Hauler-specific adapter (Geotab, Samsara, Cartrack, Teltonika self-host) | Implement on demand; each adapter normalises into the AXIS schema |
| Manual | Weighbridge tickets + daily CSV upload | Degraded mode for haulers without telematics; flagged in UI |

### 5.3 Normalised schema (internal)

Every hauler's data is mapped to:
```
Vehicle: {id, hauler_id, plate, make, model, axle_config, empty_weight_t, ...}
Trip:    {id, hauler_id, vehicle_id, driver_id, cycle: [load, depart, waypoints, arrive, offload], tonnage_t, fuel_l, cost_usd, status, ...}
Driver:  {id, hauler_id, name, licence_expiry, scores: {...}}
Alert:   {id, hauler_id, type, severity, asset_ref, ...}
```

Every record carries `hauler_id`. The Command Center filters, groups, and attributes by hauler. GIBDLC-facing reports roll up; internal views drill down.

### 5.4 Onboarding flow

1. Admin creates hauler record (legal name, contracted trucks, integration type)
2. AXIS sends onboarding email with API credential request template
3. Hauler provides read-only API token (Loconav) or agrees on adapter spec
4. Sync test → fleet discovery → attribution to hauler
5. Status: `PENDING` → `SYNCING` → `ACTIVE`

---

## 6. Reuse from FF Control Center

### Keep (rebrand only)
- React 18 + Vite client scaffold; Node + Express server; mock-mode pattern
- App shell: fixed sidebar + topbar + content column
- KPI strip, insight cards, pill filters, status badges — pattern carries, tokens rebrand
- Recharts, D3, Three.js components — retain where they serve an AXIS concept
- AI pattern: proactive observations + interactive input (rename to **AXIS Intelligence**, restrained chrome, no gradient avatar, no "Powered by Claude" subtitle in footer — the AXIS voice doesn't announce its vendors)
- Alerts architecture (Needs Action / Monitoring / Resolved) — the priorities map cleanly
- Mock-first, live-second server pattern; LOCONAV_API_TOKEN gates demo banner
- Reports architecture and generate drawer

### Replace
- All fonts → Inter + JetBrains Mono (design system §5)
- All colours → Bone / Charcoal / Bauxite Rust (design system §4); amber/teal/violet stripes removed
- All radii → 4px default, 8px card, 12px modal (design system §6)
- Iconography → Lucide only, 1.5px stroke, Charcoal or inherited colour
- All "Fleet" copy → "Corridor" / "Fleet" (plural is fine — it's a fleet-of-fleets)
- Driver scoring and harsh-event model stays; ownership attribution per hauler is new

### Delete outright
- Generators module and hardware-upgrade notice
- Fuel storage tanks module
- FuelTankArray 3D scene — irrelevant here (we don't manage fuel storage for counterparties)
- Geofences as a user-facing page (geofence compliance rolls up into Compliance)
- FleetAI gradient branding — replace with AXIS Intelligence (Charcoal + Bauxite Rust accent only)

### Rebuild with a new shape
- Overview → **Today** (corridor briefing, GIBDLC-facing numbers, AXIS Intelligence feed)
- Live map → **Corridor view** (schematic, not tracking — weighbridges, rest stops, Nyinahin/Kumasi/Takoradi markers)
- Vehicles page → **Fleet** (aggregated, grouped by hauler, filterable)
- Drivers → retained, scored per hauler, coaching flag triggers escalation to hauler admin

---

## 7. Key screens — first pass

### 7.1 Today (`/`)

Top strip (Charcoal hero panel on Bone, per design system cover-page register):
- Date (long form, 14 January 2026)
- "AXIS Corridor · Nyinahin–Takoradi · 300 km"
- Three hero numbers (tabular lining figures):
  - Tonnes delivered MTD (vs contracted monthly)
  - Active trucks today (sum across haulers)
  - SLA attainment (%)

Dominant story card (the one thing worth knowing this morning):
- Example: "Friday loading at Nyinahin is running 90 minutes behind schedule. Three haulers affected. 12 trips at risk of missing Takoradi cut-off."

Supporting row (two cards):
- **Convoy cycle** — 7-day cycle-time trend, laden vs empty split
- **Hauler contribution** — bar chart, tonnes delivered by hauler this week

Brief strip (four small KPI cards):
- Take-or-pay cushion (tonnes above/below 80% floor)
- Axle-load breaches (last 7 days)
- Unresolved alerts (critical)
- Receivables ageing (USD, >30 days)

AXIS Intelligence input: bottom of left column, Charcoal chrome, no gradient.

Right column (340px):
- Today's observations (3–5 insight cards)
- Action items (5 max)
- Hauler status (each of 4–6 haulers with API health dot)

### 7.2 Corridor view (`/corridor`)

Two toggleable modes (pill switch top-right, default **Schematic**):

**Schematic** (default — truer to AXIS's institutional register):
- Horizontal corridor line: Nyinahin · Kumasi · Takoradi
- Markers: depots, weighbridges (3–4), agreed rest stops (every 100 km)
- Overlay: number of trucks laden/empty at each segment (aggregated via last reported position)

**Map** (geographic Ghana view):
- Mapbox base in a muted monochrome style (Bone land, Ash water, 1px Iron roads — no satellite imagery)
- Corridor line rendered as a 2px Bauxite Rust polyline
- Same markers and overlay as Schematic
- Explicitly not a live-tracking map — aggregated segment counts only; live positions stay in each hauler's FMS

Shared side panel (both modes): current corridor conditions (GHA advisories, weighbridge status, road works, active convoys en route).

### 7.3 Haulers (`/haulers`)

Table (not cards — infrastructure register):
- Legal name · Trucks contracted · Trucks active · API status · On-time % · Safety score · Contract share · Last sync
- Row click → hauler detail (fleet list, trip history, SLA breakdown, API credentials panel)

### 7.4 Contract (`/contract`)

GIBDLC contract dashboard:
- Month-to-date tonnage vs 80% floor (take-or-pay line)
- Cumulative tonnage vs annual contracted
- SLA attainment (on-time loading, offloading, cycle completion)
- Tariff indexation tracker:
  - Base: $24/tonne
  - Fuel component (40% of tariff) current adjustment vs NPA diesel price
  - CPI component (30%) current adjustment vs GSS CPI
  - Fixed component (30%) locked
- Payment security status (SBLC expiry, receivables balance)

### 7.5 Tranches (`/tranches`)

Visual timeline (stacked lockup with tranches 1→4):
- Per tranche: target Mtpa, trucks, CAPEX committed, status (PENDING / ACTIVE / RAMP / STEADY), trigger gate (met / pending)
- Debt and equity drawn (cumulative)
- Decision gate checklist per tranche (e.g. Tranche 2: "Validate 1 Mtpa run-rate · DSCR ≥ 1.3× · HSE record clean")

### 7.6 Financials (`/financials`)

Lender-facing (single screen, print-friendly):
- DSCR current and trend
- P&L snapshot for current month and YTD
- Covenant compliance table
- Receivables ageing
- Cashflow forecast (next 90 days)

### 7.7 Compliance (`/compliance`)

- Axle-load weighbridge events (fleet-wide)
- Overload incidents per hauler (with forced off-load time cost)
- HSE events (per MTK — million tonne-km)
- Driver licence / medical expiry pipeline (next 90 days)
- DVLA / GHA / Minerals Commission filing status

---

## 8. Voice and chrome rules (from the design system)

These govern every string in the UI. Non-negotiable.

- Numbers carry units. `GHS 16.10`, `$24`, `40 tonnes`, `300 km`, `28.4%`. Never `24 dollars` or `28 per cent`.
- Dates long form: `14 January 2026`. Never `1/14/26`.
- No banned terms: *solutions, innovative, cutting-edge, best-in-class, world-class, journey (metaphor), leverage (verb), unlock (metaphor), synergy, ecosystem, stakeholder (unless literal), excited, delighted, empower, revolutionise*.
- Operational copy in the terse register: `Corridor closed 14:00–17:00 Tuesday. Trips resume Wednesday 05:00.` Not: `We wanted to let you know that the corridor will be closed…`.
- Fleet AI → **AXIS Intelligence**. Chrome is Charcoal with Bauxite Rust accent at 7–9% area. No gradient avatar. No "Powered by Claude" inline.
- Empty states: one line, factual. "No convoy is active." Not: "Looks like nothing's happening here — try dispatching a convoy!"

---

## 9. Tech stack

Same as FF Control Center unless noted.

| Layer | Choice |
|---|---|
| Client | React 18 + Vite, React Router v6 |
| Styling | CSS custom properties resolved to AXIS tokens (Inter + JetBrains Mono; Bone/Charcoal/Bauxite Rust; 8pt spacing; 4/8/12 radius); Tailwind utilities sparingly, never for colours |
| Charts | Recharts (primary), D3 where Recharts can't |
| 3D | Three.js only if a screen demands it — no gratuitous 3D. Likely removed entirely v1. |
| Server | Node.js + Express, port 3001 |
| Data layer | Per-hauler adapters behind a normalisation layer; all endpoints return normalised AXIS schema |
| AI | Anthropic SDK, model `claude-opus-4-7` for Intelligence summaries, `claude-sonnet-4-6` for chat (cheaper, faster) |
| Cache | node-cache with per-hauler keys |
| Auth | Placeholder in v1 (AXIS staff only); role model designed for later (AXIS admin / AXIS ops / Hauler admin read-only / Lender read-only) |

---

## 10. Folder layout

```
Bauxite Haulage/
├── BRIEF.md              (this file)
├── DESIGN_TOKENS.md      (derived from DESIGN_SYSTEM.md — just the CSS tokens)
├── PHASE_*.md            (one per build phase, same pattern as FF)
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Today.jsx
│   │   │   ├── Corridor.jsx
│   │   │   ├── Convoys.jsx
│   │   │   ├── Trips.jsx
│   │   │   ├── Drivers.jsx
│   │   │   ├── Compliance.jsx
│   │   │   ├── Haulers.jsx
│   │   │   ├── Fleet.jsx
│   │   │   ├── Maintenance.jsx
│   │   │   ├── Contract.jsx
│   │   │   ├── Tariff.jsx
│   │   │   ├── Tranches.jsx
│   │   │   ├── Financials.jsx
│   │   │   ├── Alerts.jsx
│   │   │   ├── Reports.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   │   ├── layout/   (Sidebar, Topbar, PageShell)
│   │   │   ├── kpi/      (KPIStrip, KPICard)
│   │   │   ├── corridor/ (CorridorSchematic, WeighbridgeStatus)
│   │   │   ├── hauler/   (HaulerTable, HaulerCard, ApiHealthDot)
│   │   │   ├── contract/ (TakeOrPayGauge, IndexationPanel, SLAMeter)
│   │   │   ├── tranche/  (TrancheTimeline, GateChecklist)
│   │   │   ├── intel/    (IntelligenceFeed, IntelligenceInput)
│   │   │   └── primitives/ (Pill, StatusBadge, InsightCard, Button, Dropdown)
│   │   ├── data/         (mock-mode fixtures per hauler)
│   │   ├── lib/          (formatters, currency, tabular-num helpers)
│   │   └── styles/
│   │       └── tokens.css  (AXIS design tokens as CSS custom properties)
│   └── public/           (AXIS logos: mark, horizontal, stacked — from design system §3)
└── server/
    ├── index.js
    ├── routes/
    │   ├── snapshot.js
    │   ├── haulers.js
    │   ├── convoys.js
    │   ├── trips.js
    │   ├── compliance.js
    │   ├── contract.js
    │   ├── tranches.js
    │   └── intelligence.js
    ├── adapters/
    │   ├── loconav.js    (reuse FF's, parameterised per hauler)
    │   ├── manual.js
    │   └── registry.js
    ├── services/
    │   ├── normaliser.js (hauler-native → AXIS schema)
    │   ├── aggregator.js (roll-up across haulers)
    │   └── indexation.js (tariff calc against NPA + GSS CPI)
    └── mock/             (per-hauler mock data)
```

---

## 11. Build phases

Phase gates are hard — each ends in a working, demonstrable state.

**Phase 1 — Shell and tokens.** App shell, sidebar, topbar, routing. AXIS design tokens applied. Logo lockup. Empty pages with titles. Demo banner. Mock snapshot endpoint returning stub data.

**Phase 2 — Hauler model.** Hauler schema, `/haulers` page, onboarding flow (admin-only), mock mode with 5 sample haulers contributing mock fleet/trips. API health dots wired to mock status.

**Phase 3 — Today page.** Corridor briefing layout. KPI hero strip. Dominant story card. Supporting row. Brief strip. Intelligence input (stub only — calls mock, returns fixed copy).

**Phase 4 — Corridor + Convoys + Trips.** Corridor schematic. Convoy cycle view. Trip analytics with hauler attribution. Cost-per-route. Delay heatmap.

**Phase 5 — Contract + Tariff + Tranches.** GIBDLC dashboard. Take-or-pay gauge. Indexation panel (base + fuel + CPI + fixed). Tranche timeline.

**Phase 6 — Financials + Compliance + Alerts.** DSCR and covenant view. Axle-load compliance. Alert triage (Needs Action / Monitoring / Resolved).

**Phase 7 — AXIS Intelligence (live).** Proactive observations via Anthropic SDK. Interactive mode. Page-specific suggestion chips. Caching.

**Phase 8 — Reports.** Monthly GIBDLC pack (PDF export). Lender pack. Regulatory filings tracker.

**Phase 9 — Live adapters.** Real Loconav integration with per-hauler tokens. One custom adapter (TBD). Manual CSV upload flow.

**Phase 10 — Auth and multi-role.** Login. Role split (AXIS admin / AXIS ops / Hauler admin / Lender).

---

## 12. Decisions locked (v0.2)

Resolved from the v0.1 open-questions set. These are fixed until explicitly revisited.

1. **Hauler identity in v1** — anonymised. `Hauler 01`…`Hauler 05`. Legal names added only when real onboarding begins.
2. **Corridor view** — both modes, user-toggleable (see §7.2). Schematic default; Map available via a pill switch.
3. **AXIS Intelligence tone** — confirmed. Reference observation shape:
   > "The Nyinahin weighbridge held 4 Hauler 02 trucks over the 40-tonne limit between 07:00 and 09:00. Forced off-load delayed the Takoradi cut-off by 42 minutes. Recommend coaching the Hauler 02 dispatcher on pre-departure verification."
   Specific, terse, named entities, named costs, one action. No hedging language, no banned terms.
4. **Financial model source** — mirror business-plan tables (Tables 3, 8, 9, 10). Every financial figure in the UI carries a `MODELLED` micro-tag next to the value. V1 is not a live FP&A tool; it reflects the plan.
5. **Auth in v1** — single shared login. Full role model (AXIS admin / AXIS ops / Hauler admin / Lender) arrives in Phase 10.
6. **Branding** — Recursive is dropped. Display numerals use Inter Black (900) at the design-system's `display` and `h1` scales with tabular lining figures. Flatter, more institutional — correct for AXIS.

---

## 13. Success criteria for v1 (Phases 1–6, demonstrable)

- Corridor briefing loads on `/` with 5 mock haulers contributing to one aggregated view.
- Tonnes-delivered-MTD vs 80% take-or-pay floor is visible on the Today page and the Contract page, computing consistently.
- Any metric on any page can be filtered by hauler, and attribution is correct down to the trip level.
- Every piece of copy passes the banned-terms check and the number-unit check.
- The UI is visually indistinguishable from a lender memo at arm's length — Charcoal type on Bone, 60/30/10 colour ratio held, Bauxite Rust at 7–9%.
- Works offline (mock mode) without any API token set. Demo banner visible.

---

*End of brief. Version 0.1. Next edit should accompany a PHASE_1.md once direction is confirmed.*
