# Code Review (Fix-First)

Comprehensive code review with auto-fix for mechanical issues. Be thorough but concise.

## Cold-Seed Discipline (#733)

When you launch a reviewer subagent (Agent tool, `subagent_type: "general-purpose"`) from inside a parent pipeline, pass the diff cold. Do NOT include:

- The implementation plan (`ai/zv/plans/*`)
- Exploration notes (`ai/zv/explorations/*`)
- "Here's what I was trying to do" / "context" / "author notes" framing
- The `.context-bundle.md` or any handoff summary from earlier stages
- Phase-by-phase progress reports

The reviewer's prompt should contain only: the diff (or explicit `git diff <base>...HEAD` instruction), the review instruction ("review this diff for bugs, regressions, and convention violations"), and the Sprint Contract criteria if artifact shape requires verdicts. If the reviewer needs clarification, it can ask — don't pre-empt with framing. Author-context contamination is the failure mode this step exists to avoid (see PR #730, three real bugs missed because the reviewer was seeded with the author's mental model).

When you run `/zv06-review` directly in the main context (not as a subagent), the `git diff` below is still the source of truth; ignore any plan or exploration doc you happen to have open — form your own assessment from the diff.

## Step 0: Get the Diff + Launch Codex

**Before anything else**, check the diff size and whether Codex already ran this slice.

**Skip Codex if ANY of these is true:**
1. The invocation includes the literal token `--skip-codex` anywhere in the prompt.
2. A prior commit on this branch has a **subject** signalling a Codex fix (covers both `fix(codex):` and `fix(slice-N): address Codex review findings` patterns — pipeline-heavy uses the latter, standalone /zv06-review Step 6 uses the former):
   ```bash
   BASE=origin/staging
   git rev-parse --verify "$BASE" >/dev/null 2>&1 || BASE=origin/main
   git log "$BASE"..HEAD --format='%s' 2>/dev/null | LC_ALL=C grep -iE '^(fix|refactor)\([^)]*codex[^)]*\):|^(fix|refactor)\(.*(address .*codex|codex .*review|codex .*findings)'
   ```
   Any match → skip. The regex matches only two narrow subject patterns: (a) scope contains `codex` (e.g. `fix(codex):`), or (b) description phrases a Codex review outcome (e.g. `address Codex review findings`, `per codex review`). Subject-only + narrow-phrase matching avoids false skips on either (i) feature commits that mention "codex" in their body as context, or (ii) infra commits like `fix(scripts): configurable codex phase timeouts` where "codex" appears loosely in the description (axis#740).
3. `ai/zv/reviews/.codex-done.marker` exists at the repo root (written by `/zv07-codex` Step 4 on success).

If skipping for reason #2 or #3, log it in the review output ("Codex skip: prior codex-fix commit <hash> already addressed findings") and proceed with just the self-review below. Do NOT launch `/zv07-codex`. This short-circuit prevents the known second-invocation hang (see `~/.claude/projects/-Users-commandergoosey-Projects-axis/memory/feedback_codex_rescue_hangs.md`) where pipeline retries re-trigger Codex and the second app-server turn stalls indefinitely.

**Otherwise**, check the diff size. If **50+ lines changed or 3+ files touched**, launch `/zv07-codex` as a background Agent (`run_in_background: true`). It runs independently on the same diff while you do the self-review below. For smaller diffs, skip Codex (user can still run `/zv07-codex` manually).

Get the diff (same ref as `/zv07-codex` — both must use `origin/staging`):

```bash
git fetch origin staging --quiet
git diff origin/staging --stat
git diff origin/staging
```

If no diff, stop: "Nothing to review."

## Check For

### Pass 1 — CRITICAL
**SQL & Data Safety** — String interpolation in SQL, check-then-set without atomic WHERE, N+1 queries in loops
**Race Conditions** — Read-check-write without uniqueness, XSS via dangerouslySetInnerHTML
**LLM Trust Boundary** — Gemini/Claude output written to DB without validation, AI content rendered as HTML unsanitized
**Enum Completeness** — New enum/status/type: trace through every consumer, check switch/if chains for fall-through

### Pass 2 — INFORMATIONAL
**TypeScript** — No `any` types, proper interfaces, no @ts-ignore
**Error Handling** — Try-catch for async, helpful messages
**React/Hooks** — Effects have cleanup, dependencies complete, no infinite loops
**Performance** — No unnecessary re-renders, expensive calcs memoized
**Production Readiness** — No console.log, no TODOs, no hardcoded secrets
**Architecture** — Follows existing patterns, code in correct directory
**View/Frontend** — Hardcoded colors (`npm run lint:colors`), missing states, missing aria-labels

## Fix-First Heuristic

Classify each finding:

**AUTO-FIX** (apply without asking):
- Dead code / unused variables
- N+1 queries
- Stale comments contradicting code
- Magic numbers → named constants
- Missing LLM output validation
- Inline styles → CSS variables
- console.log statements

**ASK** (needs human judgment):
- Security (auth, XSS, injection)
- Race conditions
- Design decisions
- Large fixes (>20 lines)
- Enum completeness
- Removing functionality
- Anything changing user-visible behavior

Apply auto-fixes, then batch ASK items:
```
Auto-fixed N issues. M need your input:

1. [CRITICAL] file:line — Problem
   Fix: Suggested fix
   → A) Fix  B) Skip

RECOMMENDATION: [reasoning]
```

## Functional Verification

Run before writing the review:
- `npm run build` — note result
- `npm run lint` — note result
- Suggest relevant calibration scripts if applicable

## Update GitHub Status

After the review is written, update the issue to "in-progress" via GitHub CLI:
```bash
gh issue edit <number> --add-label "status: in-review"
```

## Output

Save to `ai/zv/reviews/YYYY-MM-DD-<short-slug>.md`. Derive the slug from the plan filename's slug. Output template MUST include `**Issue:**` field for artifact matching. If re-running on the same day, overwrite the existing artifact.

```markdown
# Code Review: [Feature/Fix Name]
**Date:** YYYY-MM-DD
**Issue:** #42 (or N/A)

## Build & Lint Results
- Build: PASS/FAIL
- Lint: PASS/FAIL

## Auto-Fixed
- [file:line] Problem → fix applied

## Looks Good
- [Item 1]

## Issues Found
- **[Severity]** `file:line` — [Issue description]
  - Fix: [Suggested fix]
  - Disposition: FIXED / SKIPPED / USER-DECIDED

## Summary
- Files reviewed: X
- Auto-fixed: X
- Critical issues: X
- Warnings: X
```

## Step 5: Sprint Contract Evaluation

After the review passes, evaluate the Sprint Contract from the plan file:

1. Find the plan in `ai/zv/plans/` — match by issue number (extract first `#\d+` from `**Issue:**` field, ignore suffixes). If "TBD", "—", "N/A", or empty, skip number matching. If multiple match, use most recent by date. Fall back to most recent plan only if no number match.
2. Parse the `## Sprint Contract` section. Also check for `## Contract Amendments` — any amended criteria are SKIP-AMENDED with the amendment's rationale.
3. Evaluate each non-amended criterion against the diff:
   - **SEC** criteria: Check the diff for violations (injection, auth bypass, data leaks, etc.). Verdict: PASS or FAIL with evidence.
   - **REG** criteria: Check that existing behavior is preserved — no removed tests, no changed interfaces, no broken imports. Verdict: PASS or FAIL with evidence.
   - **FUNC** and **UI** criteria: Mark as **SKIP** — these require runtime verification in QA.
   - **PERF** criteria: PASS if the diff doesn't introduce obvious regressions (e.g., N+1 queries, missing memoization). Otherwise FAIL.
4. If any SEC or REG criterion is FAIL, escalate to the ASK list (do not auto-fix).

Add this section to the review output file:

```markdown
## Contract Results
| ID | Category | Criterion | Verdict | Notes |
|----|----------|-----------|---------|-------|
| FUNC-1 | FUNC | ... | SKIP | QA phase |
| SEC-1 | SEC | ... | PASS/FAIL | evidence |
| REG-1 | REG | ... | PASS/FAIL | evidence |
```

If no Sprint Contract exists in the plan, note "No Sprint Contract found — skipping contract evaluation" and proceed normally.

## Step 6: Merge Codex Findings

If Codex was skipped in Step 0 (already-ran short-circuit or `--skip-codex`), skip this entire step. The existing `## Codex Review` section in the prior review artifact (if any) remains authoritative — do NOT overwrite or re-query.

If Codex was launched in Step 0, wait for it to finish. Then:

1. Dismiss any Codex findings that overlap with auto-fixes already applied
2. Write a `## Codex Review` section to the review file from the Codex findings
3. Commit Codex fixes separately: `fix(codex): address codex findings (#42)`
4. **Re-evaluate SEC and REG contract criteria** against the post-fix code. Update the `## Contract Results` table in the review file with fresh verdicts. This prevents the ship gate from consuming stale results.
5. Batch all remaining ASK items from **both** reviews and present to user together

If Codex was not launched (small diff), skip this step.

## Severity Levels
- **CRITICAL** — Security, data loss, crashes
- **HIGH** — Bugs, performance issues, bad UX
- **MEDIUM** — Code quality, maintainability
- **LOW** — Style, minor improvements
