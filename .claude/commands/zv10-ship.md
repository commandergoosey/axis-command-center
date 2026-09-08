# Ship

Automated shipping pipeline. Test, commit, create feature branch, push, and PR to staging.

Run after `/zv09-document`.

**SAFETY — hard rules (violations are session-terminating):**
1. NEVER run `gh pr create` with `--base main`
2. NEVER run `gh pr merge` targeting main
3. NEVER run `git push origin main`
4. If ANY step fails and the "fix" would involve targeting main — STOP and tell the user

**Only stop for:** on `main` (abort), merge conflicts, test failures, review findings needing judgment, contract gate hard blocks.

**Never stop for:** uncommitted changes (include them), commit messages (auto-generate).

## Step 0: Detect Base Branch

The base branch is always `staging`. All interactive work ships to staging first via a feature branch + PR.

## Step 1: Pre-flight

1. `git fetch origin staging --quiet`
2. **Workspace + branch check (worktree-first):**
   - **Absolute rule:** the main VS Code window must stay on `staging`. A PreToolUse hook (`.claude/hooks/guard-branches.py`) blocks `git checkout -b` / `git switch -c` / `git switch <x>` in the main workspace — trying to switch the window will fail the command. All feature work happens in a linked worktree under `.claude/worktrees/`.
   - Detect whether you're already in a linked worktree: `[[ "$(git rev-parse --git-dir)" == "$(git rev-parse --git-common-dir)" ]]`. If the two paths differ, you're already in a worktree — keep using it.
   - **If already in a linked worktree:**
     - If HEAD is a feature branch (not `staging`, not `main`): keep it, proceed.
     - If HEAD is `staging`: create a feature branch inside this worktree via `git checkout -b ship/<issue-id>` (the hook only blocks the main workspace, not linked worktrees).
     - If HEAD is `main`: **STOP** — abort and tell the user.
   - **If in the main workspace (the VS Code window):**
     - Derive the issue ID from commit messages or context (e.g. `ship/42`).
     - Create a worktree in one shot so the main window never moves:
       ```bash
       git worktree add .claude/worktrees/ship-<issue-id> -b ship/<issue-id> staging
       cd .claude/worktrees/ship-<issue-id>
       ```
     - If there are uncommitted changes in the main workspace that need to ship, stash them first (`git stash push -m "ship-<id>-staging"`) BEFORE creating the worktree, then pop the stash inside the worktree (`git stash pop`).
     - All subsequent steps in this skill run from inside the worktree. Every Bash call for the rest of the flow must be prefixed with `cd .claude/worktrees/ship-<issue-id> && …` because Bash sessions don't persist `cd` state between tool calls.
3. `git status` — note uncommitted changes
4. `git log origin/staging..HEAD --oneline` — understand what's shipping

## Step 2: Merge Base

```bash
git fetch origin staging --quiet
git merge origin/staging --no-edit
```

Stop on merge conflicts.

## Step 2.5: Contract Gate

Check the Sprint Contract before shipping. This is a hard gate — do not proceed if required criteria failed.

1. Find the plan file in `ai/zv/plans/` — match by issue number (extract first `#\d+` from `**Issue:**` field, ignore suffixes like "(parent)" or "(continuation)"). If "TBD", "—", "N/A", or empty, skip number matching. If multiple match, use most recent by date. Fall back to most recent plan only if no number match.
2. If the plan has no `## Sprint Contract` section → skip this step entirely (backward compat). If `## Contract Amendments` exists, treat amended criteria as SKIP-AMENDED with rationale.
3. Find the review file and QA report in `ai/zv/reviews/` — match by issue number (same `#\d+` extraction) or by slug derived from the plan filename. If a `## Contract Results` table is missing or malformed in either file, treat that phase's criteria as **untested** (fail-closed).
4. Parse the `## Contract Results` tables from both files. If multiple rows exist for the same tag within a file, the **last row wins**. If multiple artifacts match the same issue, use the most recent by date.
5. Merge results using **ownership rules** (owner phase's verdict wins; latest non-SKIP verdict wins, but SKIP-AMENDED always takes precedence — it represents a user-approved scope reduction that cannot be overridden by an older PASS/FAIL row):
   - **SEC** → Review owns. Exception: if the QA report contains non-SKIP SEC rows (meaning QA re-evaluated after committing code fixes), use QA's SEC verdicts instead (they reflect the post-fix state).
   - **FUNC** → QA owns
   - **UI** → QA owns
   - **REG** → both own (prefer QA since it runs after Review)
   - **PERF** → any phase (warn-only)
6. **If QA was skipped** (no QA report found): FUNC and UI criteria are untested. Apply the missing-criteria rule below.
7. Evaluate:
   - **HARD BLOCK (stop immediately):** Any FUNC, SEC, or REG criterion is FAIL — or any FUNC/SEC criterion was never tested by its owner phase — or any FUNC/SEC criterion is SKIP from its owner phase (the criterion was deferred but not verified; tell the user to re-run the owning phase with the prerequisite available, e.g., dev server for QA).
   - **Soft warn (ship with note):** UI or PERF is FAIL, or UI/PERF/REG is untested or SKIP-by-owner.
   - **Pass:** All criteria resolved PASS, SKIP-by-non-owner, or SKIP-AMENDED (user-approved scope reduction via Contract Amendments).
8. **If hard block:** Print a table of failing/untested criteria with evidence. Do NOT proceed to Step 3. Tell the user which phase needs to re-run (e.g., "SEC-1 FAIL from review — re-run `/zv06-review` after fixing"). If QA was skipped, say: "FUNC criteria untested — run `/zv08-qa` before shipping."
9. **If soft warn:** Note the warnings — include them in the PR body later (Step 7). Proceed.
10. **If pass:** Proceed silently.

## Step 2.75: Migration Verification

If `git diff origin/staging --name-only -- supabase/migrations/` shows migration files in this branch:

1. Verify migrations were already pushed during execute (`/zv05-execute`). If not, run `npx supabase db push` now.
2. **If push fails: STOP.** Do not ship with broken schema.
3. CI will also run `supabase db push` on merge as a safety net.

**Never** output a reminder to push migrations manually. Either push them or fail.

## Step 3: Run Tests

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Stop on failure.

## Step 3.5: Staleness Warning

If the merge in Step 2 was non-trivial (upstream introduced significant changes — not just fast-forward), warn: "Upstream changes merged since QA — contract verdicts may be stale. Consider re-running `/zv08-qa` if upstream touched the same areas." The test suite (Step 3) catches compile-time and test regressions but not semantic conflicts.

## Step 4: Commit

Stage all changes. Split into bisectable commits if the changeset spans multiple logical changes:
- Group by feature/fix/refactor
- Each commit should pass build independently
- Use commit style: `type(scope): description`

Single logical change = one commit is fine.

## Step 5: Push + PR

```bash
git push -u origin HEAD
```

If rejected (remote has new commits), run `git pull origin staging --rebase` and push again.

**Then create a PR targeting staging:**

```bash
gh pr create --base staging
```

- Title: concise, under 70 chars, conventional format
- Body: use the format in Step 7 (Summary + How to Test + Contract Results)

**PRs are required.** The feature branch pattern (Step 1) ensures this always works — you're never PRing staging into itself.

**CRITICAL: NEVER fall back to `--base main`.** If `--base staging` fails, diagnose why — do NOT change the target. Deploying to production happens exclusively via the staging dashboard.

After PR is created, enable auto-merge to staging:

```bash
gh pr merge --auto --squash <PR_NUMBER>
```

## Step 6: Close GitHub Issue

If commits reference a GitHub issue (#XX), strip the pipeline status labels then close it:

```bash
gh issue edit <number> --remove-label "status: in-progress" --remove-label "status: in-review" 2>/dev/null || true
gh issue close <number>
```

`gh` is idempotent when a label exists in the repo but isn't on the issue (exit 0, no error). The `|| true` guard only trips if the labels themselves have been deleted from the repo's label set (rare) — we don't want a missing label definition blocking the close.

This step runs AFTER the PR is created and auto-merge is enabled — never before, since a failed PR creation should not leave a closed-but-unshipped issue.

## Step 7: Output

Print a summary:
- Commit(s) pushed (hash + message)
- GitHub issue(s) closed
- **How to Test** checklist (3-7 user-facing QA steps for the staging dashboard)
- Reminder: "Deploy to production via the staging dashboard when ready"

**How to Test** format:

```markdown
## How to Test
Test these steps on [axis.xyz](https://axis.xyz) before deploying:

- [ ] [Specific user action, e.g. "Open the map page and draw a rectangle"]
- [ ] [Another step, e.g. "Delete the shape and verify the count updates"]
- [ ] [Check the result, e.g. "Open work orders list and verify sorting works"]
```

**Contract Results** (include if Sprint Contract exists):

After the How to Test section, append:

```markdown
## Contract Results
| ID | Category | Verdict | Owner | Notes |
|----|----------|---------|-------|-------|
| FUNC-1 | FUNC | PASS | QA | evidence |
| SEC-1 | SEC | PASS | Review | evidence |
| REG-1 | REG | PASS | QA | evidence |
```

If there are soft warnings (UI/PERF), mark them clearly in the table. This gives the reviewer a single view of what was verified.

**How to Test rules:**
- Each step must be a concrete user action: "Click X", "Open Y page", "Try doing Z"
- NO developer steps (no terminal commands, no "build passes", no code inspection)
- NO generic steps like "verify no errors" — be specific about what to check
- If the change is backend-only, write: "- [ ] No user-facing changes to test"
- These steps will appear as a test checklist on the staging dashboard

## Post-Ship Cleanup

**All interactive `/zv10-ship` runs now execute inside a linked worktree under `.claude/worktrees/ship-<id>/`.** Cleanup removes the worktree — it does NOT switch the main VS Code window (which is already on `staging` and must stay there).

- **Pipeline context** (`ExitWorktree` tool available): call `ExitWorktree` to let the harness handle cleanup.
- **Interactive context** (called from your terminal / a plain `/zv10-ship` invocation): once auto-merge lands on staging, remove the worktree from the main repo — NOT from inside the worktree.

```bash
# Run this from the main workspace (cd to /Users/commandergoosey/Projects/axis or open a
# new terminal tab there — NOT from inside the worktree).
WORKTREE_PATH=.claude/worktrees/ship-<issue-id>
git worktree remove "$WORKTREE_PATH"       # refuses if dirty/unpushed
git branch -D ship/<issue-id>               # local branch cleanup
git fetch origin staging --quiet            # pull in the merged change
```

If `git worktree remove` refuses because of dirty or unpushed state, DO NOT `--force`. Inspect `$WORKTREE_PATH` first — it may hold in-flight user work.

Done.

### Final: Session Debrief

After shipping is complete, run the session debrief to capture this session's knowledge:

1. Scan git log for commits made this session
2. Identify decisions made, patterns discovered, and carry-forward items
3. Append entry to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`
4. Verify wiki pages were updated during Document stage — if not, apply wiki updates as fallback (session-debrief Step 4)
5. Flag unfinished work for the next session

Format the log entry as:
```
## [YYYY-MM-DD HH:MM PT] ship | #<issue-number> <title> | branch: <branch>
- **Scope**: Shipped <brief description>
- **PR**: #<pr-number>
- **Commits**: <count>
- **Decisions**: Key architectural or design decisions made
- **Wiki updates**: Pages updated or "none"
- **Carry-forward**: Follow-up work needed or "none"
```

This step is automatic — no user confirmation needed. It runs silently after the ship confirmation message.
