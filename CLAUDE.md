Project: AXIS Command Center — multi-hauler corridor aggregator for the Nyinahin–Takoradi bauxite haulage corridor (NewCo Logistics JV, trading as AXIS). Audience: DFIs, GIBDLC, lenders, regulators.
Stack: React 18 + Vite (client/) + Node/Express (server/). SQLite. No TypeScript.
Repo: commandergoosey/axis-command-center | Package: npm (scripts live in client/ and server/)
Database: sqlite (no migration tool wired) | Tracker: github issues
External wiki: /Users/commandergoosey/Projects/Brain Work | Session log: /Users/commandergoosey/Projects/Brain Work/JOURNAL.md

## Design system — HARD-LOCKED (honor exactly; source: `Bauxite Project/DESIGN_SYSTEM.md`)
Palette: Bauxite Rust `#A23E23` / Charcoal `#1F1F1F` / Bone `#F5F1EC`. Type: Inter + JetBrains Mono only. 8pt spacing, 4px radius. Banned words include "solutions", "best-in-class", "leverage" (verb), "unlock" (metaphor), "excited". Register = port-authority notice, NOT marketing/logistics-tech. AI component = "AXIS Intelligence" (Charcoal + Bauxite Rust accent, no gradient, no vendor tagline). Every entity carries `hauler_id`; views roll up by hauler.

## Verify loop (no root scripts — run per package)
- Client: `cd client && npm run lint && npm run test && npm run build`
- Server: `cd server && npm test`  (the 1261-test suite — in-memory SQLite)
- The default ZV verify loop assumes root-level scripts — use the per-package commands above instead.

## Branch model (production flavor)
`main` is protected by `.claude/hooks/guard-branches.py` (no direct commits/pushes to `main` from the main workspace). Pipeline uses worktree `ship/<issue>` branches + PR. To relax: edit `.claude/hooks/branch-policy.json`.

## Orientation
Living build log: `PHASES.md` (7800+ lines). Business-plan source of truth: `Bauxite Project/NewCo_Logistics_Business_Plan_v2 (AXIS).docx`. Deeper running knowledge: `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`.
