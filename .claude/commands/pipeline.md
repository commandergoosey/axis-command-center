# Interactive Pipeline

End-to-end issue pipeline in a single session. Explore → Plan → CEO/Eng Review → Execute → Code Review + Codex → QA → Document → Ship.

**Terminology:** Pipeline steps are called "stages" (Stage 1, Stage 2…). Implementation plans have "phases" (Phase 1, Phase 2…). Never mix the two.

**Arguments:**
- GitHub issue number (e.g., `#42`). If not provided, ask.
- `--gate` — opt-in flag that **always** pauses at Stage 6 (plan approval) and Stage 8 (ASK findings), regardless of review outcomes. Without this flag, the pipeline uses adaptive gating: it only pauses when there's a genuine question to resolve (see decision logic at each stage). Error/exception paths always pause regardless of this flag.

**Principle:** Auto-proceed through stages unless a decision point requires user input. Minimize interruptions — batch questions, don't ask if the answer is obvious.

**Branch model:** This is the single-branch flavor. PRs target `main` directly — there is no staging integration branch and no separate promote step. The merge to `main` IS the deploy.

---

## Stage 1: Setup

1. Look up the issue via `gh issue view <number>` (get title, description, labels)
2. Enter an isolated worktree for this pipeline:
   - Call `EnterWorktree` with `name: "ship-<issue>"`. The tool creates the worktree based on `origin/main`, which is the correct base for this flavor.
   - After entering, rename the branch to match the ship convention and hard-reset onto `origin/main` to ensure a clean base:
     ```bash
     git fetch origin main
     git branch -m worktree-ship-<issue> ship/<issue>
     git reset --hard origin/main
     git branch --unset-upstream 2>/dev/null || true
     ```
   - Verify the base is correct — `git diff origin/main --stat` should be empty.
   - Then run the rest of setup:
     ```bash
     MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
     npm ci --loglevel=error 2>/dev/null || { echo "ERROR: npm ci failed"; exit 1; }
     cp "$MAIN/.env.local" .env.local 2>/dev/null || true
     ln -s "$MAIN/.overnight" .overnight 2>/dev/null || true
     mkdir -p supabase 2>/dev/null
     ln -s "$MAIN/supabase/.temp" supabase/.temp 2>/dev/null || true
     ```
   - **Preflight verify** (fail-fast before spending time on Explore/Plan):
     ```bash
     npm run typecheck && npm run lint && npm run test
     ```
     If any fail: stop and report — base branch is broken, fix before running pipeline.
3. Print a one-line summary: `Pipeline: #XX — "<title>"`
4. **Journal check:** If `.overnight/journals/{id}.md` exists (GitHub issue number, e.g. `42.md`), read it. If content exceeds 3000 characters, only use the last 3000 characters. This contains notes from previous pipeline or overnight attempts — dead ends to avoid. Keep it in mind throughout all stages.

## Stage 2: Explore

Run the exploration from `/zv03-explore`:
- `/zv03-explore` includes Wiki Context Load — it reads 2-3 relevant wiki pages before exploring (troubleshooting, architecture, data-model based on issue area). No additional action needed.
- Launch parallel Explore subagents (Agent tool, `subagent_type: "Explore"`, thoroughness "very thorough") to research affected files, dependencies, and similar patterns
- Build a clear picture of what needs to change
- Save exploration to `ai/zv/explorations/YYYY-MM-DD-<slug>.md`
- `/zv03-explore` includes Wiki Enrichment — it updates relevant wiki pages with codebase findings after saving the exploration doc.

**Decision point — only if ambiguous:**
If there are genuine ambiguities or multiple valid approaches, use AskUserQuestion to present them. If the issue is clear-cut, skip straight to Stage 3.

## Stage 3: Scope Gate + Research

Decide internally: does this need web research?

- **Skip** if purely internal (bug fix, refactor, config change, well-understood pattern)
- **Research** if it involves unfamiliar APIs, libraries, security patterns, or UX decisions worth validating

If research is needed, use Perplexity MCP tools or web search. Summarize findings in 3-5 bullets. Do not pause for user input.

## Stage 4: Plan

Create a detailed implementation plan per `/zv04-plan`:
- Minimum set of changes to resolve the issue
- Include commit points and verification steps
- Save to `ai/zv/plans/YYYY-MM-DD-<slug>.md`

## Stage 5: CEO Review

Before running the review, snapshot the plan: `cp "{plan_path}" "{plan_path}.pre-ceo.bak"`

Challenge the plan from first principles per `/gs01-ceo-review` (HOLD SCOPE mode):
- **Premise challenge:** Is this the right problem? What happens if we do nothing?
- **Existing code leverage:** What already partially solves this? Are we rebuilding?
- **Dream state mapping:** Does this move toward or away from the 12-month ideal?
- Review architecture, error/rescue map, security, data flow, performance

Output a GO/NO-GO with any scope adjustments. If NO-GO, revise the plan (Stage 4) incorporating feedback, re-snapshot the revised plan, then re-run CEO Review. If the CEO review revised the plan, re-read and re-count phases — the task list may have changed.

## Stage 6: Eng Review

Before running the review, snapshot the plan: `cp "{plan_path}" "{plan_path}.pre-eng.bak"`

Validate buildability per `/gs02-eng-review`:
- What existing code already partially solves each sub-problem?
- What is the minimum set of changes? Complexity smell: 8+ files or 2+ new abstractions.
- Architecture, code quality, test coverage, performance review
- If the plan needs changes, produce a REVISED plan

Use the revised plan (if any) for execution. If the eng review revised the plan, re-read and re-count phases — the task list may have changed.

**Decision point (adaptive):**

Output a **Plan Summary** — a short developer-to-leader briefing. Format:

```
### Plan Summary: #42 — "<title>"

**What:** 1-2 sentence plain-English description of the change (what the user will see/experience differently)
**Why:** The problem or opportunity driving this (1 sentence)
**How:** Numbered list of phases with 1-line descriptions (e.g., "Phase 1: Add audit log tab to Team page by porting AdminLogViewer")
**Touches:** Key files/areas affected (not exhaustive — just enough to orient)
**Risk:** One line — what could go wrong, or "Low — mechanical changes only"
```

Determine whether to pause:
- **Pause if `--gate` flag is set** (always pause, regardless of review outcomes).
- **Pause if reviews surfaced issues:** CEO review returned NO-GO, Eng review returned NEEDS_REVISION, or the plan was revised with non-trivial changes (new/removed phases, changed scope, altered contract criteria).
- **Auto-proceed otherwise:** Both reviews passed (GO + BUILDABLE), plan unchanged or only cosmetically revised (wording, ordering, no scope change). Print "Reviews clean — auto-proceeding to execution." and continue.

When pausing, ask via AskUserQuestion:

```
question: "Plan ready for #42 (CEO + Eng reviewed). Summary above. How should we proceed?"
options:
  - "Execute as-is (Recommended)" — Plan looks good, proceed to implementation
  - "Revise scope" — I want to adjust something before execution
  - "Abort" — Cancel this pipeline
```

If "Revise scope": ask what to change, update the plan, and re-present. If "Abort": stop.

## Stage 7: Execute

Implement the plan per `/zv05-execute`:
- If this is the first phase: mark the GitHub issue as in-progress via label (`gh issue edit <number> --add-label "status: in-progress"`)
- Write code, commit at each major task
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` after implementation
- Fix any failures YOUR changes introduced
- After the verify loop passes, run `/simplify` on the full diff against main (`git diff origin/main --name-only`). If simplify makes changes, re-run the verify loop (single pass — if it fails, stop and report). Commit simplify changes separately: `refactor(scope): simplify post-execute cleanup`.

Do not pause unless you hit a blocking ambiguity that genuinely can't be resolved from the plan.

## Stage 7.5: Migration Push

If any `.sql` files were added or modified in `supabase/migrations/` during execution (check `git diff origin/main --name-only -- supabase/migrations/`):

1. Run `npx supabase db push` to apply migrations to the project's Supabase instance
2. **If push fails: STOP the pipeline.** Do not continue with broken schema. Report the error.
3. If push succeeds, log: "Migrations pushed."

If no migration files changed, skip silently.

**Never** output a reminder to push migrations manually. Either push them or fail.

**Single-branch caveat:** In this flavor, the merge to `main` IS the production deploy. Migration push happens before merge — schema goes live as soon as the PR lands. If your project requires a separate migration approval gate, switch to the staging flavor.

## Stage 8: Code Review (Claude + Codex)

Launch `/zv06-review` only (Agent tool, `subagent_type: "general-purpose"`). It auto-launches `/zv07-codex` internally when the diff is 50+ lines or 3+ files **OR** when any changed path is infra-shaped — i.e. matches `scripts/`, `.github/workflows/`, `supabase/migrations/**.{mjs,ts,js,sh}` (migration tooling, not routine .sql DDL), `scripts/launchagents/`, any `*.plist`, `.claude/hooks/`, or `.claude/rules/` (#734). Small infra diffs have outsized blast radius, so size-gating them lets systemic bugs through. Do NOT separately launch `/zv07-codex` — that causes double Codex runs and file write races. Incident escape hatch: set `CODEX_INFRA_GATE=0` to bypass the infra-shape promotion (size gate still applies).

**Seed the reviewer cold (#733).** The Agent prompt MUST contain only the review instruction plus a pointer to run `git diff origin/main`. Do NOT paste the plan, exploration notes, CEO/Eng review summaries, "here's what we did", or any other author framing into the reviewer's prompt. Author-context contamination is what caused PR #730's three missed bugs (data-shape mismatch, halt-state leak past `break`, `process.exit(2)` bypassing a top-level `.finally()` HEAD-reattach hook). Let the reviewer re-derive intent from the code; if it needs clarification, it will ask.

The review step handles:
- Pass 1 (critical: SQL safety, race conditions, security, enum completeness)
- Pass 2 (informational: types, error handling, React patterns, performance)
- Codex launch + merge (if applicable)
- Sprint Contract evaluation (SEC/REG grading). Valid contract verdicts: PASS, FAIL, SKIP, SKIP-AMENDED. Only FAIL or MISSING (untested) are blocking.
- Save review to `ai/zv/reviews/YYYY-MM-DD-<slug>.md`

**If Codex CLI is unavailable or errors:** Surface to user: "Codex CLI unavailable — fix setup or explicitly skip?" Note decision and proceed accordingly.

When complete, auto-fix mechanical issues, commit fixes. After applying any code fixes (auto-fix, Codex fixes, or ASK-level fixes), re-evaluate SEC and REG contract criteria against the post-fix code and update the contract results table with fresh verdicts.

**ASK-level findings (adaptive gating):**
- **Pause if `--gate` flag is set** (always pause).
- **Pause if any ASK item is ambiguous:** items with competing trade-offs, security implications, no clear single-best recommendation, or items where the reviewer explicitly flagged uncertainty.
- **Auto-proceed otherwise:** all ASK items have clear recommendations with no ambiguity. Apply recommended fixes, dismiss items marked as dismissible. Print "ASK items clear — auto-accepting N recommendations." and continue. Also auto-proceed if ASK list is empty.

When pausing, batch ASK-level findings and present to user for decisions.

**Clean-tree gate:** Before proceeding to QA, verify `git status --porcelain` is clean. If dirty, commit remaining changes.

## Stage 9: QA

Automated QA per `/zv08-qa`:
- Map changed files to affected pages
- Test systematically: page loads, interactions, forms, empty states, data persistence
- Write the QA report artifact to `ai/zv/reviews/YYYY-MM-DD-qa-<slug>.md`. This artifact is required by the Ship contract gate.
- Classify bugs by severity, fix Critical and High automatically
- Stop at 20% cumulative risk

**If dev server is not running:** Skip browser testing, but still run lint/typecheck/test/build. Mark FUNC/UI criteria requiring visual/interactive verification as SKIP, but FUNC criteria provable via automated test output may still be PASS. Start the dev server if possible before proceeding.

## Stage 10: Document

Per `/zv09-document`:
- Update any affected documentation (CLAUDE.md gotchas, inline comments if behavior changed)
- `/zv09-document` includes Wiki Page Updates (Step 4.5) — it updates relevant engineering wiki pages based on the changes. No additional action needed.
- Save changelog to `ai/zv/changelogs/YYYY-MM-DD-<slug>.md`
- Commit doc changes locally (do NOT push — Ship handles that)

## Stage 11: Ship

Generate 3-7 user-facing test steps based on the final diff for the PR body. These are concrete user actions ("Open the map page and draw a rectangle"), NOT developer commands.

Ship per `/zv10-ship`:
1. Merge latest main: `git fetch origin main && git merge origin/main --no-edit`
2. Run full test suite: lint, typecheck, test, build
3. Contract gating: merge review + QA artifact results per `/zv10-ship` Step 2.5. Any FAIL or MISSING verdict is a hard block — do NOT ship. Do NOT offer "proceed anyway." Valid verdicts: PASS, FAIL, SKIP, SKIP-AMENDED.
4. Push with the **explicit branch name**, not `HEAD`: `git push -u origin ship/<issue>`. The branch-guard hook (`.claude/hooks/guard-branches.py`) rejects `git push -u origin HEAD` because it treats the literal string `HEAD` as unsafe — always use the resolved branch name.
5. Create PR via `gh pr create --base main` with the test checklist in `## How to Test` and review/QA summary in the PR body. PRs are required — never push directly to `main`. The feature branch created in Stage 1 ensures this always works.
6. Enable auto-merge: `gh pr merge --auto --squash <PR_NUMBER>`
7. Strip pipeline status labels then close the GitHub issue:
   ```bash
   gh issue edit <number> --remove-label "status: in-progress" --remove-label "status: in-review" 2>/dev/null || true
   gh issue close <number>
   ```
   `gh` is idempotent when a label exists in the repo but isn't on the issue. The `|| true` only trips if the labels have been deleted from the repo's label set entirely (rare).
8. Call `ExitWorktree` to clean up
9. Pull merged changes into main workspace. **Guard the stash pop** — only pop if *this run* actually pushed something. A blind `git stash pop` will silently apply a stale stash left over from a previous session and cause a phantom merge conflict (observed 2026-04-08, pipeline-mini #267):
   ```bash
   MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
   cd "$MAIN"
   STASH_BEFORE=$(git stash list | wc -l | tr -d ' ')
   git stash push -m "pipeline-wip-$$" 2>/dev/null || true
   STASH_AFTER=$(git stash list | wc -l | tr -d ' ')
   git pull --rebase origin main
   # Only pop if our push actually created a new stash entry on top
   if [ "$STASH_AFTER" -gt "$STASH_BEFORE" ]; then
     git stash pop
   fi
   ```

Print the PR URL. Pipeline complete.

---

## Rules

- **Context efficiency:** Use subagents for exploration (Stage 2) to keep the main context clean. Do stages 7-9 in the main context since they share file state.
- **Error recovery:** If a stage fails (e.g., tests don't pass), fix and retry once. If still failing, pause and ask the user.
- **Scope discipline:** Only implement what the issue describes. If you notice adjacent issues, note them but do NOT act on them.
- **Adaptive gating (default):** The pipeline only pauses at Stage 6 and Stage 8 when there's a genuine question to resolve (review issues, ambiguous ASK items). Clean reviews and clear recommendations auto-proceed. With `--gate`, both stages always pause. Error/exception paths always pause. Everything else auto-proceeds — QA flows into Document flows into Ship. The contract gate in Ship is automatic (hard-blocks on FUNC/SEC/REG failures, no user prompt needed).
- **CI fix routing:** If code changes after PR creation (CI fix): mechanical fixes (lint, type fix) → update PR body via `gh pr edit` and proceed. Non-trivial fixes (behavior or security changes) → re-run `/zv06-review` or `/zv08-qa` as appropriate, then update PR body.
- **Journal discipline:** Journal entries persist at `.overnight/journals/{id}.md` across sessions and tools. Keep each pipeline entry to the 5-line format — no stack traces, no code blocks, no verbose explanations. Do not alter entries written by overnight automation. If abandoning an approach mid-stage, write the journal entry before pausing for user input.
- **Worktree isolation:** Each pipeline runs in its own git worktree. This enables parallel `/pipeline` tabs without branch collisions. The main VS Code workspace stays on `main` undisturbed. Do NOT `git checkout` in the main workspace.

---

## Final: Session Debrief

After the pipeline completes (all stages done, PR shipped), run `/session-debrief` automatically:

1. Scan `git log origin/main..HEAD` (or the merged PR commits) for commits made during this pipeline run
2. Identify decisions made, patterns discovered, and carry-forward items
3. Append entry to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`
4. Verify wiki pages were updated during Document stage — if not, apply wiki updates as fallback (session-debrief Step 4)

Log entry format:
```
## [YYYY-MM-DD HH:MM PT] pipeline | #<issue> <title> | branch: <branch>
- **Scope**: Pipeline completed — <brief description>
- **Phases**: <count> phases executed
- **Commits**: <count>
- **Decisions**: Key decisions made during execution
- **Wiki updates**: Pages updated or "none"
- **Carry-forward**: Follow-up work or "none"
```

This step is automatic — no user confirmation needed.
