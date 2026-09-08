# Execute Plan

Now implement precisely as planned, in full.

## Before Starting

**Journal check:** If `.overnight/journals/{issue-number}.md` exists (GitHub issue number, e.g. `42.md`), read it. If content exceeds 3000 characters, only use the last 3000 characters. This contains notes from previous attempts — dead ends to avoid. Keep it in mind throughout execution.

Use the `gh` CLI to mark the issue as in-progress:
```bash
gh issue edit <number> --add-label "status: in-progress"
```

## Implementation Requirements

- Write elegant, minimal, modular code.
- Adhere strictly to existing code patterns, conventions, and best practices.
- Include thorough, clear comments/documentation within the code.

## Commit Cadence

Commit after each major task marked with "← commit point" in the plan. Don't save all commits for the end. Use the project's commit style: `type(scope): description`.

## Mid-Execution Changes

If the plan needs to change during execution:
1. **Pause** implementation
2. **Update** the plan document with the deviation and rationale
3. **Note** the change clearly (strikethrough old, add new)
4. **Never modify the `## Sprint Contract` section** — it is the grading rubric. If a criterion becomes invalid due to plan changes, add a `## Contract Amendments` section using this format:
   ```
   - [TAG-N] SUPERSEDED: reason
   ```
   **Approval rules:** UI and PERF criteria can be unilaterally amended. FUNC, SEC, and REG amendments require user confirmation via AskUserQuestion before the amendment takes effect (these are hard-gate criteria — silent removal defeats the contract).
   Review, QA, and Ship will treat amended criteria as SKIP-AMENDED with the amendment's rationale.
5. **Continue** implementation

## Progress Tracking

As you implement each step:
- Update the plan markdown with checkbox status and overall progress percentage
- Mark completed tasks with `[x]`

## Verify Loop

After implementation is complete, run the **external verify loop**. These checks are non-negotiable — do not skip them or consider execution complete until they all pass.

### Checks (run in this order)
1. `npm run lint` (timeout: 60s)
2. `npm run typecheck` (timeout: 60s)
3. `npm run test` (timeout: 120s)
4. `npm run build` (timeout: 120s)

### Loop rules
- **Max 2 fix iterations.** If any check fails, fix ONLY the failing issues — do not re-implement from scratch. Then re-run ALL four checks.
- After fixing, commit the fixes: `fix(scope): address verify failures`
- If all checks pass → report results and move on.
- If checks still fail after 2 fix iterations → **stop**. Report exactly what's still failing and let the user decide how to proceed. Do not proceed to review with broken checks.

### Escape hatch
If the plan explicitly notes that certain checks are expected to break (e.g., schema change without migration), note which checks were skipped and why. Still run the remaining checks.

### Also run
- Any manual verification steps listed in the plan
- Report all results clearly (pass/fail per check, iteration count)

## Migration Push

After the verify loop passes, check if any `.sql` files were added or modified in `supabase/migrations/` (check `git diff origin/staging --name-only -- supabase/migrations/`):

1. Run `npx supabase db push` to apply migrations to the staging Supabase instance
2. **If push fails: STOP.** Do not continue with broken schema. Report the error.
3. If push succeeds, log: "Migrations pushed to staging DB."

If no migration files changed, skip silently. **Never** output a reminder to push migrations manually.

## Simplify Pass

After the verify loop passes (and migrations are pushed), run `/simplify` to clean up the full diff before review. This is automatic — do not skip it.

1. Invoke the `simplify` skill (via the Skill tool) on the changed code
2. If simplify makes changes:
   - Re-run the verify loop (single pass — if it fails, stop and report)
   - Commit: `refactor(scope): simplify post-execute cleanup`
3. If simplify finds nothing to change, move on

Skip only if the verify loop failed and execution stopped (no point simplifying broken code).

## After Execution

**Journal write:** Append a dated entry to `.overnight/journals/{id}.md` (create file/dir if needed). Strict format — no more than 5 lines:

```
## YYYY-MM-DD — Execute
- Outcome: succeeded | partial | failed
- Approach: one-line summary of what was implemented
- Dead ends: what failed or was abandoned and why (or "none")
- Next time: what to do differently (or "n/a")
```

No stack traces, no code blocks, no verbose explanations. Do not alter entries written by other tools. If abandoning an approach mid-execution, write the journal entry before stopping.

**Do NOT close the GitHub issue.** Execution is not the end of the workflow — review (`/zv06-review`) and QA (`/zv08-qa`) steps must happen first. Leave the issue with the `status: in-progress` label and wait for the user to drive the next step.
