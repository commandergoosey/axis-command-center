# Mini Pipeline

Lightweight 5-stage issue pipeline for small mechanical fixes (<50 LOC, 1-3 files). Auto-promotes to the full `/pipeline` if the diff exceeds ~5 files or ~150 LOC mid-execute.

For anything with security, architecture, or multi-file refactor implications, use `/pipeline` directly. The mini pipeline is a true subset — no parallel design, no divergent terminology.

**Terminology:** Pipeline steps are "stages". Implementation plans have "phases". Never mix the two.

**Arguments:**
- GitHub issue number (e.g., `#42`). If not provided, ask.

**When to use this vs `/pipeline`:**
- Use `/pipeline-mini` for: typo fixes, one-line bug fixes, small config tweaks, single-helper additions, well-scoped mechanical follow-ups.
- Use `/pipeline` for: new features, multi-file refactors, anything touching auth/security/migrations, anything needing architecture or UX review.
- If unsure → use `/pipeline`. Mini is the exception, not the default.

**Branch model:** This is the single-branch flavor. PRs target `main` directly — there is no staging integration branch. The merge to `main` IS the deploy.

**Principle:** Skip ceremony where it's not load-bearing, but never skip Document or Ship. The failure mode that motivated this command (#234) was the Document + ship-close tail getting dropped — mini guarantees both run.

---

## Stage 1: Setup

1. Look up the issue via `gh issue view <number>` (get title, description, labels).
2. **Scope assertion:** confirm the issue looks mini. If the description suggests 5+ files, multi-step refactor, migrations, auth changes, or architecture work, **stop and recommend `/pipeline` instead**. Print: `This looks larger than mini scope — recommend running /pipeline <number>.` and exit.
3. Enter an isolated worktree for this pipeline:
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
   - **Preflight verify** (fail-fast before spending time on Execute):
     ```bash
     npm run typecheck && npm run lint && npm run test
     ```
     If any fail: stop and report — base branch is broken, fix before running pipeline-mini.
4. Mark the issue in-progress: `gh issue edit <number> --add-label "status: in-progress"`.
5. Print a one-line summary: `Pipeline-mini: #XX — "<title>"`.
6. **Journal check:** If `.overnight/journals/<number>.md` exists, read it (last 3000 chars if larger). Contains notes from previous attempts — dead ends to avoid.

## Stage 2: Execute

1. Read the affected files (inferred from the issue description). Do not explore beyond what the fix touches — scope discipline is the whole point of mini.
2. Make the targeted fix. Do not scope-creep into adjacent cleanup.
3. Run the verify loop:
   ```bash
   npm run lint && npm run typecheck && npm run test
   ```
   Fix failures your changes introduced. Max 2 retry attempts — on the third failure, stop and report.
4. **Scope gate — auto-promotion check** (after verify passes):
   ```bash
   CHANGED_FILES=$(git diff origin/main --name-only | wc -l | tr -d ' ')
   CHANGED_LOC=$(git diff origin/main --shortstat | grep -oE '[0-9]+ (insertion|deletion)' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
   ```
   If `CHANGED_FILES > 5` **OR** `CHANGED_LOC > 150`:
   - Print: `⚠️ Diff exceeds mini threshold (N files, M LOC) — auto-promoting to full pipeline. Injecting Code Review and QA stages.`
   - Set `PROMOTED=1` (mental flag) and continue to **Stage 2.5** and **Stage 2.6** before Stage 3.
   - Otherwise skip Stages 2.5 and 2.6.
5. Commit: `fix(<scope>): <summary> (#<issue>)`. Use a conventional commit type that matches the change (`fix`, `chore`, `docs`, etc.).

## Stage 2.5: Code Review (auto-promoted only)

**Skip unless Stage 2 triggered auto-promotion.**

Launch `/zv06-review` via the Agent tool (`subagent_type: "general-purpose"`). It auto-launches `/zv07-codex` internally when the diff is 50+ lines or 3+ files **OR** when any changed path is infra-shaped — i.e. matches `scripts/`, `.github/workflows/`, `supabase/migrations/**.{mjs,ts,js,sh}` (migration tooling, not routine .sql DDL), `scripts/launchagents/`, any `*.plist`, `.claude/hooks/`, or `.claude/rules/` (#734). Small infra diffs have outsized blast radius, so size-gating them lets systemic bugs through. Do NOT separately launch `/zv07-codex` — that causes double Codex runs and file write races. Incident escape hatch: set `CODEX_INFRA_GATE=0` to bypass the infra-shape promotion (size gate still applies).

**Seed the reviewer cold (#733).** The Agent prompt MUST contain only the review instruction plus a pointer to run `git diff origin/main`. Do NOT paste the issue body, fix summary, or any "here's what I did" framing into the reviewer's prompt. Author-context contamination is what caused PR #730's three missed bugs. Let the reviewer re-derive intent from the code.

The review step handles:
- Pass 1 (critical: SQL safety, race conditions, security, enum completeness)
- Pass 2 (informational: types, error handling, React patterns, performance)
- Codex launch + merge (if applicable)
- Sprint Contract evaluation (SEC/REG grading). Valid verdicts: PASS, FAIL, SKIP, SKIP-AMENDED. Only FAIL or MISSING is blocking.
- Saves review to `ai/zv/reviews/YYYY-MM-DD-<slug>.md`

After applying any code fixes (auto-fix, Codex, ASK-level), re-evaluate SEC and REG criteria against the post-fix code and update the contract results table.

**ASK-level findings:** auto-apply clear recommendations, batch ambiguous items and pause to ask the user.

**Clean-tree gate:** before Stage 2.6, verify `git status --porcelain` is clean. If dirty, commit remaining changes.

## Stage 2.6: QA (auto-promoted only)

**Skip unless Stage 2 triggered auto-promotion.**

Run automated QA per `/zv08-qa`:
- Map changed files to affected pages
- Test systematically: page loads, interactions, forms, empty states, data persistence
- Write the QA artifact to `ai/zv/reviews/YYYY-MM-DD-qa-<slug>.md` (required by the Ship contract gate)
- Classify bugs by severity, fix Critical and High automatically
- Stop at 20% cumulative risk

**If dev server is not running:** skip browser testing but still run lint/typecheck/test/build. Mark FUNC/UI criteria requiring visual verification as SKIP.

## Stage 3: Migration Push

If any `.sql` files were added or modified in `supabase/migrations/` during execution (`git diff origin/main --name-only -- supabase/migrations/`):

1. Run `npx supabase db push` to apply migrations to the project's Supabase instance.
2. **If push fails: STOP the pipeline.** Do not continue with broken schema. Report the error.
3. If push succeeds, log: `Migrations pushed.`

If no migration files changed, skip silently. **Never** output a reminder to push migrations manually — either push them or fail.

**Single-branch caveat:** In this flavor, the merge to `main` IS the production deploy. Migration push happens before merge — schema goes live as soon as the PR lands. If your project requires a separate migration approval gate, switch to the staging flavor.

## Stage 4: Document

Per `/zv09-document`:
- Update affected documentation (CLAUDE.md gotchas, inline comments if behavior changed).
- `/zv09-document` includes Wiki Page Updates (Step 4.5) — it updates relevant engineering wiki pages based on the changes.
- Save changelog to `ai/zv/changelogs/YYYY-MM-DD-<slug>.md`.
- Commit doc changes locally (do NOT push — Ship handles that).

This stage runs unconditionally. It is the primary reason `/pipeline-mini` exists instead of letting small fixes run ad-hoc.

## Stage 5: Ship

Generate 3-5 user-facing test steps based on the diff for the PR body. These are concrete user actions, NOT developer commands.

Ship per `/zv10-ship`:
1. Merge latest main: `git fetch origin main && git merge origin/main --no-edit`
2. Run full test suite: `npm run lint && npm run typecheck && npm run test && npm run build`
3. **Contract gating (auto-promoted runs only):** merge review + QA artifact results per `/zv10-ship` Step 2.5. Any FAIL or MISSING verdict on FUNC/SEC/REG is a hard block — do NOT ship. Mini-only runs skip this gate (no review/QA artifacts to check).
4. Push with the **explicit branch name**, not `HEAD`: `git push -u origin ship/<issue>`. The branch-guard hook (`.claude/hooks/guard-branches.py`) rejects `git push -u origin HEAD` because it treats the literal string `HEAD` as unsafe — always use the resolved branch name.
5. Create PR via `gh pr create --base main` with the test checklist in `## How to Test`. PRs are required — never push directly to `main`.
6. Enable auto-merge: `gh pr merge --auto --squash <PR_NUMBER>`
7. Strip pipeline status labels then close the GitHub issue:
   ```bash
   gh issue edit <number> --remove-label "status: in-progress" --remove-label "status: in-review" 2>/dev/null || true
   gh issue close <number>
   ```
8. Call `ExitWorktree` to clean up.
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

Print the PR URL. Pipeline-mini complete.

---

## Rules

- **No scope creep.** Only implement what the issue describes. Adjacent issues: note them, do NOT act.
- **Auto-promotion is irreversible.** Once Stage 2 triggers promotion, Review + QA run. Do not retry to stay mini.
- **Document and Ship always run.** These are the stages skipped in manual fixes and the whole reason this command exists. Never shortcut them.
- **Error recovery:** if a stage fails, fix and retry once. Still failing → pause and ask the user.
- **Worktree isolation:** mini still uses a dedicated worktree. Do NOT `git checkout` in the main workspace.
- **Scope discipline:** if in doubt about whether this is mini, run `/pipeline` instead. The full pipeline is always safe; mini is the optimization.

---

## Final: Session Debrief

After the pipeline completes (Ship done, PR merged or auto-merge enabled), run `/session-debrief` automatically:

1. Scan `git log origin/main..HEAD` for commits made during this pipeline-mini run.
2. Identify decisions made, patterns discovered, carry-forward items.
3. Append entry to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`.
4. Verify wiki pages were updated during Document — if not, apply wiki updates as fallback.

Log entry format:
```
## [YYYY-MM-DD HH:MM PT] pipeline-mini | #<issue> <title> | branch: <branch>
- **Scope**: Pipeline-mini completed — <brief description>
- **Promoted**: Yes/No (threshold trigger if yes)
- **Commits**: <count>
- **Decisions**: Key decisions made during execution
- **Wiki updates**: Pages updated or "none"
- **Carry-forward**: Follow-up work or "none"
```

This step is automatic — no user confirmation needed.
