# Triage — Pick Next Task

Read GitHub Issues, assess current state, and recommend the next task to work on.

## Your Task

### 1. Determine Current Project & Query Issues
Determine the current project from the repo's `CLAUDE.md` title (e.g., "AXIS Command Center"). Use the `gh` CLI to fetch all open issues. **Only show issues belonging to this project** — exclude issues labeled with other `project:` labels (e.g., if working in AXIS Command Center, exclude `project: CPRE` issues; if working in CPRE, only show `project: CPRE` issues). Also exclude issues labeled `codex-overnight`. Issues with no `project:` label belong to the repo's primary project (from CLAUDE.md title).

Sort results by labels yourself: `P1-urgent`, `P2-high`, `P3-normal`, `P4-low`.

### 2. Detect ZV Workflow Step per Issue
For each issue, determine the **last completed ZV step** by checking for artifacts. Check in reverse order (highest step first) and stop at the first match:

| Step | Label | Detection |
|------|-------|-----------|
| 7 | Document | GitHub label = `status: done` |
| 6 | Review | File referencing issue in `ai/zv/reviews/` |
| 5 | Execute | GitHub label = `status: in-progress`, OR plan file has checked `[x]` items |
| 4 | Plan | File referencing issue in `ai/zv/plans/` |
| 3.5 | Research | File referencing issue in `ai/zv/research/` |
| 3 | Explore | File referencing issue in `ai/zv/explorations/` |
| 2 | *(empty)* | Issue exists in GitHub (no artifacts found) |

To detect artifacts: grep `ai/zv/` subdirectories for the issue number (e.g., `42`). Artifacts reference issues via `**Issue:** #42` in their frontmatter.

### 3. Display Issues
Show a **single table** for the current project only (no grouping by project — other projects are already excluded). Sort by priority (highest first).

Use this exact table format:

```
## AXIS Command Center
| Issue | Title                                                             | Pri | Step          |
|-------|-------------------------------------------------------------------|-----|---------------|
| #42   | Epic: User Onboarding Flow (Sign-up to First Action)              | ▲   | 5 Execute     |
```

Column rules:
- **Issue**: 6 chars
- **Title**: 65 chars (pad shorter titles with trailing spaces to maintain width)
- **Pri**: symbol only — `▲▲` Urgent, `▲` High, `—` Medium, `▽` Low, ` ` None
- **Step**: ZV step — format as `N Label` (e.g., `3 Explore`, `4 Plan`, `5 Execute`, `6 Review`). Leave **blank** for step 2 (issue created, no artifacts yet)

Only show issues assigned to the current project. Omit issues with no project or from other projects — they're out of scope for this triage.

Omit GitHub onboarding issues (like "Get familiar with GitHub", "Set up your teams", etc.) — just note they exist.

### 4. Check Current Context
- Show current git branch + any uncommitted changes (`git status --short`)
- Check `ai/zv/plans/` for any in-progress plans (files with unchecked tasks)
- Note if there's work already in progress that should be finished first

### 5. Recommend Next Task
Based on:
- Highest priority, unblocked issue
- Whether anything is already in progress (finish that first)
- Current branch context

Provide a clear recommendation:
> **Recommendation:** Pick up `#XX: [Title]` — [brief rationale]

### 6. Ask User to Confirm
Ask the user to confirm or pick a different issue. Once confirmed, suggest:
> Ready to explore? Run `/zv03-explore` and describe the task.
