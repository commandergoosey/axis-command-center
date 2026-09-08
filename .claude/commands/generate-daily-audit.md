# Generate Daily Code Audit Prompt

You are creating a tailored daily code audit prompt for a project. The output should be a complete, self-contained Markdown file saved to `ai/prompts/audit-daily.md` that can be run headlessly via `claude -p`.

## Step 1: Gather project context

Read `CLAUDE.md` (or `README.md` if no CLAUDE.md exists). Identify:

- **Project name** and one-line description
- **Tech stack**: framework, language, database, ORM/raw SQL, APIs, styling approach
- **Key directories**: where source code, API routes, components, and scripts live
- **Conventions**: API response patterns, state management, import rules, file naming
- **Database approach**: ORM vs raw SQL, migration strategy, connection handling
- **Auth/security model**: how auth works, where secrets live, API key handling
- **Existing tooling**: linters, type checker, test commands, CI checks
- **Known quirks/gotchas**: anything that looks like a bug but isn't (from CLAUDE.md)

## Step 2: Identify audit categories

Based on the tech stack, build a prioritized list of audit categories. Always include these core categories, but tailor the specifics to the project:

1. **Security** — adapt to the stack:
   - Raw SQL → SQL injection checks (parameterized queries)
   - ORM (Prisma/Drizzle) → check for `.raw()` calls, mass assignment
   - React → XSS via `dangerouslySetInnerHTML`, unescaped user input
   - API routes → auth checks, CORS, rate limiting, input validation
   - File handling → path traversal, upload validation
   - Secrets → API keys in client bundles, hardcoded credentials, `.env` exposure

2. **Error handling** — adapt to the stack:
   - API calls without try-catch or retry logic
   - External service calls (AI APIs, payment, email) without timeout/cleanup
   - Swallowed errors that hide root cause
   - Fail-open logic (errors that silently succeed)
   - Resource cleanup on failure (DB connections, file handles, browser instances)

3. **Data integrity** — adapt to the stack:
   - Null/undefined guards on query results
   - Race conditions in concurrent operations
   - Transaction usage for atomic operations
   - Input validation at system boundaries

4. **API & convention compliance** — project-specific:
   - Whatever response pattern the project uses
   - Import rules (client/server split, barrel exports)
   - Naming conventions

5. **TypeScript** (if applicable):
   - `any` types, missing return types, unsafe assertions

6. **Performance**:
   - React: missing memoization, unnecessary re-renders
   - DB: unbounded queries, N+1 patterns, missing indexes
   - Resources: unclosed connections/handles in error paths

7. **Accessibility**:
   - Missing ARIA labels, alt text, keyboard navigation, color-only indicators

8. **Dead code**:
   - Unused imports, unreachable branches, commented-out blocks

9. **Dependency hygiene**:
   - `npm audit` / CVEs, unused deps

Add or remove categories based on what the project actually uses. For example:
- Project uses Stripe → add "Payment security" category
- Project uses file uploads → add "Upload validation" category
- Project has WebSocket/SSE → add "Streaming correctness" category
- Project uses AI APIs → add "AI API reliability" category

## Step 3: Generate the audit prompt

Create `ai/prompts/audit-daily.md` following this structure:

```markdown
# /audit-daily — {ProjectName} Code Audit

> **Run:** `claude -p "$(cat ai/prompts/audit-daily.md)" --allowedTools Edit,Write,Bash,Read,Glob,Grep --max-budget-usd 5`
>
> **Frequency:** Daily (overnight cron or manual)
> **Duration:** ~3-5 min
> **Scope:** Code quality, security, error handling — no browser needed

---

You are auditing the {ProjectName} codebase. Read `CLAUDE.md` first, then read `ai/prompts/daily-audit-skip.md` for known false positives — do NOT re-report any listed items.

## Mode selection

**Quick mode** (default): Audit files changed since last audit commit.
**Full mode** (weekly): Scan all source files.

[Include git diff commands tailored to project directory structure]

---

Fix up to 10 issues total, prioritized by the categories below.

## Step 0: Automated checks

[Include project-specific automated checks: npm audit, linter, type checker, etc.]

## Audit categories (in priority order)

[Numbered list of categories with project-specific details]

## Regression check

Read `ai/prompts/daily-audit-log.md`. For the last 3 audit entries, spot-check that those fixes are still in place.

## Rules

[Project-specific rules derived from CLAUDE.md conventions]
- Do NOT refactor working code for style preferences
- Do NOT add comments/docstrings to unchanged code
- Keep each fix minimal
- Do NOT ask for confirmation. Fix findings with confidence >= 0.7 autonomously.

## Output format

[Findings table with File:Line, Category, Severity, Finding, Confidence]

## Example findings (for calibration)

[3 realistic examples based on the project's actual patterns and likely issues]

## Process

1. Run automated checks
2. Scan files (quick or full mode)
3. Regression check
4. Present findings table
5. Fix all findings with confidence >= 0.7
6. Verify (typecheck, lint)
7. Commit + push
8. Log to `ai/prompts/daily-audit-log.md`
```

## Step 4: Create supporting files

Also create these if they don't exist:
- `ai/prompts/daily-audit-skip.md` — empty skip list with header
- `ai/prompts/daily-audit-log.md` — empty log with table header

## Step 5: Verify

Read back the generated prompt and confirm:
- All categories reference actual project patterns (not generic boilerplate)
- Example findings use real file paths from the project
- Automated check commands actually work in the project
- Git commands target the correct source directories
- Rules align with CLAUDE.md conventions
