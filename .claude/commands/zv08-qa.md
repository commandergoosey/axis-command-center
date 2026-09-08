# QA Testing

Test the application like a real user after implementation. Find bugs, optionally fix them.

Run after `/zv06-review` (and `/zv07-codex` if launched), before `/zv09-document`.

## Parameters

| Parameter | Default | Override |
|-----------|---------|---------|
| Target URL | `http://localhost:3000` | Any URL |
| Mode | Report + Fix | `--report-only` (never fixes) |
| Tier | Standard | `--quick` (critical+high), `--exhaustive` (+cosmetic) |
| Scope | Diff-aware | "Focus on the proposal workspace" |

## Step 0: Setup

1. Verify dev server: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
2. Require clean working tree (commit or stash first)
3. Detect base branch, map changed files to affected pages

## Step 1: Systematic Testing

For each page in scope, run:
- [ ] Page loads without errors
- [ ] Interactive elements work (buttons, links, dropdowns)
- [ ] Forms submit with valid data
- [ ] Forms show errors with invalid data
- [ ] Empty states render correctly
- [ ] Loading states appear and resolve
- [ ] Modals open, close, submit
- [ ] Data persists after refresh
- [ ] Dark mode renders correctly

## Step 2: Issue Classification

| Severity | Description | Example |
|----------|-------------|---------|
| **Critical** | Data loss, crash, security | Form silently drops data |
| **High** | Feature broken | Button does nothing |
| **Medium** | Degraded experience | Layout breaks at width |
| **Low** | Cosmetic | Inconsistent spacing |

## Step 3: Fix Loop (skip if `--report-only`)

For each bug at or above tier threshold:
1. **Diagnose** — read source, understand root cause
2. **Fix** — minimal code change
3. **Commit** — `fix(qa): ISSUE-NNN description`
4. **Verify** — confirm fix, no regressions

**Self-regulation:**
- Each fix: +2% risk. Multi-file: +5%. Shared util: +8%. Re-fix: +15%.
- **Stop at 20% cumulative risk.** Hard cap: 30 fixes.

## Step 3b: Sprint Contract Verification

After systematic testing, evaluate the Sprint Contract from the plan file:

1. Find the plan in `ai/zv/plans/` — match by issue number (extract first `#\d+` from `**Issue:**` field, ignore suffixes). If "TBD", "—", "N/A", or empty, skip number matching. If multiple match, use most recent by date. Fall back to most recent plan only if no number match.
2. Parse the `## Sprint Contract` section. Also check for `## Contract Amendments` — any amended criteria are SKIP-AMENDED with the amendment's rationale.
3. Test each non-amended criterion:
   - **FUNC** criteria: Verify each functional behavior through the running app or test output. Verdict: PASS or FAIL with reproduction steps.
   - **REG** criteria: Confirm existing features still work. Verdict: PASS or FAIL.
   - **UI** criteria: Verify visual requirements if applicable. Verdict: PASS or FAIL.
   - **SEC** and **PERF** criteria: Mark as **SKIP** (already evaluated in review phase) unless a runtime check is feasible.
4. Any FAIL on FUNC or REG is a bug — enter the fix loop (Step 3) for it.
5. **After all QA fixes are complete**, re-run Step 3b contract verification once more (full pass over all criteria) to confirm no regressions. Update the `## Contract Results` table with final verdicts.
6. **If QA committed any code fixes** (Step 3 or Step 3b fix loop): re-evaluate the review's SEC and REG contract criteria against the post-fix code. Update the QA report's contract results table with fresh SEC/REG verdicts (overriding SKIP with PASS/FAIL). This prevents the ship gate from consuming stale review verdicts after QA changes code.

## Step 3c: Browser Testing via Playwright MCP

For issues that touch UI (any `.tsx` file in the diff), run browser-based verification using the Playwright MCP server (`mcp__playwright__*` tools). No CLI shell-out — drive the browser directly via MCP tool calls.

1. **Verify dev server is running** at the expected URL (usually `http://localhost:3000`). If not, start it or skip to fallback.
2. **Open the page under test** with `mcp__playwright__browser_navigate`. Use `mcp__playwright__browser_snapshot` to get the accessibility tree (no screenshots needed for most checks — saves tokens).
3. **For each FUNC and UI criterion** in the Sprint Contract:
   - Drive the interaction via `browser_click`, `browser_type`, `browser_select_option`, etc.
   - Verify state via `browser_snapshot` (read accessibility tree) or `browser_take_screenshot` (only for visual-only criteria).
   - For timing-sensitive criteria (e.g., "updates within 500ms"), wrap the action + verify in `browser_evaluate` with `performance.now()` deltas.
   - For assertion primitives, opt into `--caps=testing` (run `claude mcp edit playwright` and add `--caps=testing` to args) which exposes `browser_verify_value`, `browser_generate_locator`, and friends.
4. Record results (PASS/FAIL per criterion) in the contract results table. Cite the specific tool call and observed value in the FAIL reason.
5. Close the browser context with `mcp__playwright__browser_close` when done — clean lifecycle, no orphan procs.

**Fallback:** If the dev server isn't running, the Playwright MCP server isn't connected, or `browser_navigate` fails, skip browser testing and continue with code-only QA. Browser QA is additive — lint/typecheck/test still run regardless.

**Contract impact of code-only QA:** If runtime verification was not possible (no dev server, no browser), mark FUNC and UI criteria that require visual/interactive verification as **SKIP** (not PASS). FUNC criteria that can be fully verified via automated test output (e.g., pure backend logic) may still be PASS. This ensures the ship gate correctly identifies untested functional and visual criteria.

## Step 3d: Journal Write (failures only)

If QA found Critical or High bugs that required rework (Step 3 fix loop), append a dated entry to `.overnight/journals/{id}.md` (create file/dir if needed). Use strict 5-line format:

```
## YYYY-MM-DD — QA
- Outcome: N critical, N high fixed
- Approach: what was tested and how
- Dead ends: root cause of failures (or "none")
- Next time: what to watch for (or "n/a")
```

Skip if QA passed clean. Do not alter entries written by other tools.

## Step 4: Verify Build

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

All 4 checks are required (not just build+lint) because QA code fixes may break types or tests.

## Step 5: Report

Save to `ai/zv/reviews/YYYY-MM-DD-qa-<slug>.md`. Derive the slug from the plan filename's slug. Output template MUST include `**Issue:**` field for artifact matching. If re-running on the same day, overwrite the existing artifact.

```markdown
# QA Report: [Feature]
**Date:** YYYY-MM-DD
**Issue:** #42 (or N/A)
**Tier:** Standard
**Pages tested:** N

## Health Score
| Category | Score |
|----------|-------|
| Functionality | X/10 |
| Data Integrity | X/10 |
| UI/Layout | X/10 |
| Error Handling | X/10 |

## Issues Found: N
- Critical: N (fixed: N)
- High: N (fixed: N)
- Medium: N (fixed: N)
- Low: N (deferred: N)

## Fixes Applied
- `fix(qa): ISSUE-001` — description

## Contract Results
| ID | Category | Criterion | Verdict | Notes |
|----|----------|-----------|---------|-------|
| FUNC-1 | FUNC | ... | PASS/FAIL | evidence |
| UI-1 | UI | ... | PASS/FAIL | evidence |
| REG-1 | REG | ... | PASS/FAIL | evidence |
| SEC-1 | SEC | ... | SKIP | reviewed in /zv06 |

## Browser Testing
- expect run: YES/NO/SKIPPED
- Results: [summary or "N/A — no .tsx changes"]

## Ship Readiness
READY / NOT READY
```

If no Sprint Contract exists in the plan, note "No Sprint Contract found — skipping contract verification" and proceed with standard QA.
