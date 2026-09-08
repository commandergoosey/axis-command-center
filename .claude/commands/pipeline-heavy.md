---
description: "Context-aware phase orchestrator. Data flows through filesystem, not context. Primary: CLI chaining (claude -p) gives each phase a fresh context window with zero parent accumulation. Fallback: subagent with file handoffs. Use for 4+ phase plans or known-heavy execution."
---

# Pipeline Heavy — Context-Aware Phase Orchestrator

End-to-end issue pipeline with filesystem-first orchestration. Same 11 stages as `/pipeline`, but heavy work runs as isolated CLI processes via `claude -p` — each gets a mathematically fresh context window with zero parent accumulation. The orchestrator never reads source code; it plans, delegates, and validates.

**Arguments:**
- GitHub issue number (e.g., `42`). If not provided, ask.
- `--gate` — always pause at Stage 6 (plan approval) and Stage 8 (ASK findings). Without this flag, adaptive gating auto-proceeds when reviews are clean. Error/exception paths always pause regardless.

**When to use:** 4+ phase plans, large features, known-heavy execution. For 1-3 phases, use `/pipeline`.

---

## Architecture

**Core principle:** Move data through the filesystem, not through the context window.

### Execution Tiers

1. **CLI Chaining** (`claude -p`): Each stage/phase runs as a separate OS process. Fresh context per invocation (~173K usable after system overhead). Zero parent context growth. **Primary mode.**
2. **Subagent File Handoff**: Falls back to Agent tool if CLI unavailable (auth error, CLI not found). Subagent reads prompt from a file path; returns only the structured `*_RESULT:` block. Full results on disk.
3. **Document & Clear**: Escape hatch if orchestrator context gets heavy despite tiers 1-2.

### Orchestrator Constraints

1. **Never read source code or diffs.** May read: GitHub issue metadata, state files, plan files, journal files, phase output summaries, truncated gate output (`tail -20`).
2. **Never pass file contents in prompts.** Give file paths. Let the execution read them in its own context.
3. **Relay pattern.** Executions cannot use AskUserQuestion. They return `blockers: [...]`. The orchestrator surfaces these.
4. **State file updated after EVERY execution.** Phases, gates, fixes, reviews — all persist immediately.
5. **Single-writer for state file.** Only the orchestrator writes state. Never two concurrent writers.

---

## Terminology

- **Stage** — Pipeline step (1-11): Setup → Explore → Scope → Plan → CEO → Eng → Execute → Review → QA → Document → Ship.
- **Phase** — Implementation step from the plan. Each "Step N ← commit point" = one phase.
- **Execution** — Running a prompt via CLI (Mode A) or Agent tool (Mode B). Returns terse status; full output on disk.
- **Orchestrator** — You (main conversation). Plans, delegates, validates. Never touches source code.
- **`current_stage` semantic:** Always set **on entry** (before execution begins), never after completion. This means `current_stage == N` indicates "Stage N is in progress or was the last stage entered." A stage is complete when `current_stage` has advanced to `N+1`.

---

## Phase Execution Protocol

All heavy work uses this reusable protocol. Stages 5-11 reference it by label.

### Step 1: Write the prompt file

Write the complete prompt to `{PHASE_DIR}/{label}-prompt.md` using the Write tool. Every prompt follows this template:

```
You are executing {description} for issue {issue_id}: "{title}".

Read CLAUDE.md before starting.

## Task
{specific instructions for this stage/phase}

## Input Files (read these — do NOT echo contents in your response)
- {path}: {what it contains}

## Output
Write complete results to: {output_path}
{commit/artifact instructions}

## Rules
- Do NOT use AskUserQuestion. Do NOT spawn sub-subagents (exception: Stage 8 review — /zv06-review may auto-launch /zv07-codex internally).
- If you hit a blocker, STOP and include it in your result block.
- Commit your work before returning (if code was changed).

## Return
End your final message with ONLY this block:
{STAGE_RESULT_NAME}:
- status: PASS|FAIL
- output: {output_path}
- files_changed: [list]
- commit_hash: {hash or none}
- blockers: []
```

Each stage defines its own result block name (e.g., `CEO_REVIEW_RESULT`, `PHASE_RESULT`, `REVIEW_RESULT`). The parser searches for `*_RESULT:` suffix to locate the block, then parses the YAML-subset body. **Stage schemas extend the generic template** — every `*_RESULT` block inherits `status`, `commit_hash`, `files_changed`, and `blockers` from the template. Stage-specific fields are additions. If a stage schema omits a relay field like `blockers`, it is still present (default `[]`).

**Critical:** Never embed file contents in the prompt. Pass paths only. Exception: Stage 7b embeds a brief plan-phase reference (step number and title) — not raw source code.

### Step 2: Execute — Mode A (CLI Chaining)

Run via Bash tool with `timeout: 600000`:

```bash
PROMPT_PATH="{path from step 1}"
PHASE_OUT=$(mktemp)
PHASE_ERR=$(mktemp)
CRASH_DIR="{PHASE_DIR}"
LABEL="{label}"
TAIL_LINES="{30 for phases/gates, 80 for review/qa/ship}"

cat "$PROMPT_PATH" | claude -p \
  --output-format text \
  --permission-mode bypassPermissions \
  --no-session-persistence \
  ${DOCS_ROOT:+--add-dir "$DOCS_ROOT"} \
  > "$PHASE_OUT" 2> "$PHASE_ERR"
CLI_EXIT=$?

if [ "$CLI_EXIT" -ne 0 ]; then
  # Preserve diagnostic data before cleanup
  cp "$PHASE_OUT" "$CRASH_DIR/${LABEL}-crash-stdout.log" 2>/dev/null
  cp "$PHASE_ERR" "$CRASH_DIR/${LABEL}-crash-stderr.log" 2>/dev/null
  echo "CLI_FAILED|exit=$CLI_EXIT"
  tail -5 "$PHASE_ERR"
  echo "---STDOUT_TAIL---"
  tail -"$TAIL_LINES" "$PHASE_OUT"
else
  # Preserve full stdout for result block recovery if tail is insufficient
  cp "$PHASE_OUT" "$CRASH_DIR/${LABEL}-stdout.log" 2>/dev/null
  echo "CLI_OK"
  tail -"$TAIL_LINES" "$PHASE_OUT"
fi
rm -f "$PHASE_OUT" "$PHASE_ERR"
```

The orchestrator sees `CLI_OK` + last N lines (the structured result block), or `CLI_FAILED` + stderr tail + stdout tail. Full stdout is always preserved at `{PHASE_DIR}/{label}-stdout.log` (success) or `{PHASE_DIR}/{label}-crash-stdout.log` (failure). **If result block parsing fails from the tail output**, re-read from the preserved stdout log: `{PHASE_DIR}/{label}-stdout.log` on success, or `{PHASE_DIR}/{label}-crash-stdout.log` on failure. On success, only stderr temp files are cleaned up.

**Tail line count (`TAIL_LINES`):** Set `TAIL_LINES=30` for phase executions, gate-fix, and document (simple result blocks). Set `TAIL_LINES=80` for review, QA, ship, and review-fix (result blocks contain nested arrays like `ask_items`, `contract_results`, `bugs_found`).

**Parse result:** Extract the `*_RESULT:` block from the tail output (search for a line matching `^\w+_RESULT:$`). Parse the body as YAML-subset: `- key: value` for scalars, `- key: [...]` for inline arrays, and indented nested structures for objects/arrays like `ask_items`, `contract_results`, `bugs_found`. **Parse on failure too** — a non-zero exit code does not mean no work was done. If the result block is present in the stdout tail, extract it (the phase may have committed code but failed on verify). Use `commit_hash` to distinguish "work committed, verify failed" from "total failure."

**Validate parsed fields:** `status` must be `PASS` or `FAIL` (else treat as FAIL). `commit_hash` must match `/^[0-9a-f]{7,40}$/` or be `none` (else null + warning). `contract_results` verdict values must be one of `PASS|FAIL|SKIP|SKIP-AMENDED` (else FAIL per fail-closed rule). Log warnings for unexpected values but don't halt.

**Partial commit detection (on failure only):** After CLI failure, check for partial commits:
```bash
LAST_KNOWN_HASH="{commit_hash from prior phase or branch base}"
CURRENT_HEAD=$(git rev-parse HEAD)
LAST_KNOWN_FULL=$(git rev-parse "$LAST_KNOWN_HASH" 2>/dev/null || echo "$LAST_KNOWN_HASH")
if [ "$CURRENT_HEAD" != "$LAST_KNOWN_FULL" ]; then
  echo "PARTIAL_COMMITS_DETECTED|prior=$LAST_KNOWN_HASH|head=$(git rev-parse --short HEAD)"
  git log --oneline "$LAST_KNOWN_HASH"..HEAD
fi
```
If partial commits exist: record in state (`"partial_commits": [...]`). On retry, prepend to the phase prompt: "WARNING: A prior attempt partially committed work. Run `git log --oneline {hash}..HEAD` before starting. Build on existing commits — do not re-implement already-committed changes."

**If CLI fails** AND no result block was parsed: log the error, switch `execution_mode` to `"subagent"` in state file, fall back to Mode B for this and all subsequent executions. If a result block WAS parsed (partial success), do NOT switch modes — proceed with the parsed result.

### Step 3: Execute — Mode B (Subagent Fallback)

If Mode A is unavailable:

```
Agent(
  description: "{short description}",
  prompt: "Read the prompt file at {PROMPT_PATH} and execute ALL instructions within it.
Write your complete output to the output path specified in the prompt file.
Return ONLY the structured result block from the end of the prompt — nothing else.
Read CLAUDE.md before starting.
IMPORTANT: Do NOT use AskUserQuestion — if you hit a blocker, include it in the result block's blockers field.
Do NOT spawn sub-subagents via the Agent tool (exception: Stage 8 review — /zv06-review may auto-launch /zv07-codex internally).",
  subagent_type: "general-purpose"
)
```

The subagent reads the prompt file in its own context. The orchestrator passes only a short pointer (~80 tokens). No `isolation: "worktree"` — the pipeline is already in a worktree.

**Validate return.** If the subagent returns > 500 tokens, log warning ("verbose return — extracting status"), extract only the `*_RESULT:` block. Apply the same field validation as Mode A (status, commit_hash, contract_results).

### Step 4: Record result

1. Parse the `*_RESULT:` block. Missing fields → null (log warning, continue). **Exception:** `contract_results` is fail-closed — missing/null/unparseable = FAIL — but only for executions whose result schema includes it (review, QA, ship). Stages without `contract_results` in their schema (CEO review, Eng review, phases, gate-fix, document) skip this check.
2. **Validate fields** per Step 2 rules: `status` must be `PASS`/`FAIL`, `commit_hash` must match hex pattern or `none`, `contract_results` verdicts must be `PASS|FAIL|SKIP|SKIP-AMENDED`. Replace invalid values with safe defaults (FAIL for status/contracts, null for commit_hash).
3. Update state file with result (status, files_changed, commit_hash, output path, partial_commits if any, etc.). **If `stage_results` contains a prior failed entry for this stage**, replace it with the new result (prevents stale failures from retriggering on future resumes).
4. Merge `files_changed` into `cumulative_files` (deduplicate).
5. Append to `{PHASE_DIR}/pipeline-log.md`:
   ```
   | {HH:MM} | {stage/phase} | {PASS/FAIL} | {N files} | {commit_hash} |
   ```

### Mode Detection (runs once in Stage 1)

```bash
CLI_TEST=$(echo "Reply: OK" | claude -p \
  --output-format text \
  --no-session-persistence \
  --max-budget-usd 0.20 2>&1)
if echo "$CLI_TEST" | grep -q "OK"; then
  echo "CLI_AVAILABLE"
else
  echo "CLI_UNAVAILABLE"
fi
```

Store `execution_mode: "cli"|"cli-bare"|"subagent"` in state file.

### Optional: `--bare` optimization

If `ANTHROPIC_API_KEY` is set, phases can use `--bare` to eliminate ~27K tokens of MCP schema overhead per phase:

```bash
cat "$PROMPT_PATH" | claude -p \
  --bare \
  --add-dir . \
  ${DOCS_ROOT:+--add-dir "$DOCS_ROOT"} \
  --output-format text \
  --permission-mode bypassPermissions \
  --no-session-persistence
```

Without `--bare`, each phase loads ~114 tools (~27K tokens) from MCP servers, leaving ~173K usable. With `--bare`, overhead drops to ~0 with full 200K usable. Detect at mode test time: check `[ -n "$ANTHROPIC_API_KEY" ]`.

**Why `--add-dir "$DOCS_ROOT"`:** `claude -p` subprocesses only have write access to directories explicitly passed via `--add-dir` (plus CWD). Without this flag the Document stage's delegate can't update external-wiki pages and falls back to the orchestrator writing them, which defeats context isolation. Broad scope (all stages get docs-root access) lets Stage 2 Explore enrichment and Stage 10 Document both write doc/wiki pages directly. When `DOCS_ROOT` is empty (project docs root not resolvable), the `--add-dir` flag is omitted — Document stage falls back to the worktree-local docs dir (CWD) if one exists. `DOCS_ROOT` is resolved during Stage 1 Project Detection (see below): prefer in-tree `docs/` under `$MAIN`, else the external-wiki path from `CLAUDE.md`'s `External wiki:` line.

**Bare-mode scope:** `cli-bare` is only used for **Stage 7 phase executions** and gate-fix prompts. Stages 5, 6, 8, 9, 10, and 11 always use standard `cli` mode even when `cli-bare` is available — they invoke slash commands (`/zv06-review`, `/zv08-qa`, `/zv09-document`, `/zv10-ship`, `/simplify`) and MCP tools that require the full tool environment. The `execution_mode` state field records the best available mode; individual stages select `cli` or `cli-bare` based on this scope rule.

---

## Quality Gate Protocol

Run in the orchestrator's shell between phases, not inside executions.

```bash
GATE_OUT=$(mktemp)

npm run typecheck > "$GATE_OUT" 2>&1; TC=$?
TC_TAIL=$(tail -20 "$GATE_OUT")

npm run lint > "$GATE_OUT" 2>&1; LINT=$?
LINT_TAIL=$(tail -20 "$GATE_OUT")

npm run test > "$GATE_OUT" 2>&1; TEST=$?
TEST_TAIL=$(tail -20 "$GATE_OUT")

rm -f "$GATE_OUT"
```

Read exit codes and tails. If any non-zero: execute a fix prompt via Phase Execution Protocol (label: `gate-fix-{N}`). Include the error tails in the fix prompt. Then re-run ALL gates. If still failing after one fix: halt, ask user.

**Build** (`npm run build`) is deferred to the last phase's internal verify loop for speed. This is an intentional tradeoff — build is slow (~60s) and running it between every phase would double gate time. A build-breaking change in an early phase will be caught when the last phase runs the full verify loop. If this is unacceptable for a particular plan, add `npm run build` to the gate protocol for that run.

---

## Stage 1: Setup

1. Look up the issue via `gh issue view <number>` (title, description, labels).

2. **Project Detection** — resolve the five per-project helpers used throughout the pipeline. Run in the main workspace:
   ```bash
   MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
   cd "$MAIN"

   # BASE_BRANCH: origin/HEAD → origin/staging → origin/main → origin/master → main
   BASE_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
   if [ -z "$BASE_BRANCH" ]; then
     for candidate in staging main master; do
       if git rev-parse --verify "origin/$candidate" >/dev/null 2>&1; then
         BASE_BRANCH="$candidate"; break
       fi
     done
   fi
   BASE_BRANCH="${BASE_BRANCH:-main}"

   # DOCS_ROOT: prefer in-tree docs/, else `External wiki:` path from CLAUDE.md.
   # Contract: CLAUDE.md may contain a line like `**External wiki:** ... ` ~/projects/<name>-knowledge/wiki/` ...`
   DOCS_ROOT=""
   if [ -d "$MAIN/docs" ]; then
     DOCS_ROOT="$MAIN/docs"
   else
     EXT=$(grep -E '^\*\*External wiki:\*\*' "$MAIN/CLAUDE.md" 2>/dev/null | head -1 | sed -E 's|.*`([^`]+)`.*|\1|' | sed "s|^~|$HOME|")
     if [ -n "$EXT" ] && [ -d "$EXT" ]; then
       DOCS_ROOT="$EXT"
     fi
   fi

   # LOG_PATH: prefer in-tree docs/log.md, else $DOCS_ROOT/log.md, else unset (skip log writes)
   LOG_PATH=""
   if [ -f "$MAIN/docs/log.md" ]; then
     LOG_PATH="$MAIN/docs/log.md"
   elif [ -n "$DOCS_ROOT" ] && [ -f "$DOCS_ROOT/log.md" ]; then
     LOG_PATH="$DOCS_ROOT/log.md"
   fi

   # MIGRATION_STYLE: supabase | sqlite-version | prisma | drizzle | alembic | none
   if [ -d "$MAIN/supabase/migrations" ]; then
     MIGRATION_STYLE=supabase
   elif [ -f "$MAIN/src/lib/db/schema.ts" ] && grep -q 'SCHEMA_VERSION' "$MAIN/src/lib/db/schema.ts" 2>/dev/null; then
     MIGRATION_STYLE=sqlite-version
   elif [ -f "$MAIN/prisma/schema.prisma" ]; then
     MIGRATION_STYLE=prisma
   elif [ -d "$MAIN/drizzle" ] || grep -q '"drizzle-kit"' "$MAIN/package.json" 2>/dev/null; then
     MIGRATION_STYLE=drizzle
   elif [ -f "$MAIN/alembic.ini" ] || [ -d "$MAIN/alembic" ]; then
     MIGRATION_STYLE=alembic
   else
     MIGRATION_STYLE=none
   fi

   # JOURNAL_ROOT: .overnight/journals/ if the directory exists, else "none"
   JOURNAL_ROOT="none"
   if [ -d "$MAIN/.overnight/journals" ]; then
     JOURNAL_ROOT="$MAIN/.overnight/journals"
   fi

   echo "DETECTED | base=$BASE_BRANCH | docs=${DOCS_ROOT:-<none>} | log=${LOG_PATH:-<none>} | migration=$MIGRATION_STYLE | journal=$JOURNAL_ROOT"
   ```
   These values flow into the state file (step 5) and are referenced throughout the pipeline. They are **resolved once at Stage 1** — downstream stages read them from state, never re-detect.

3. Enter an isolated worktree:
   - Call `EnterWorktree` with `name: "ship-<issue-number>"`. **The tool creates the worktree based on `origin/main`, not on HEAD of the current branch** — this is a harness quirk. The next step corrects it.
   - After entering, rename the branch to match the ship convention and hard-reset onto `origin/$BASE_BRANCH`:
     ```bash
     git fetch origin "$BASE_BRANCH"
     git branch -m worktree-ship-<issue-number> ship/<issue-number>
     git reset --hard "origin/$BASE_BRANCH"
     git branch --unset-upstream 2>/dev/null || true
     ```
   - Verify the base is correct — `git diff "origin/$BASE_BRANCH" --stat` should be empty.
   - Then run the rest of setup:
     ```bash
     MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
     npm ci --loglevel=error 2>/dev/null || { echo "ERROR: npm ci failed"; exit 1; }
     cp "$MAIN/.env.local" .env.local 2>/dev/null || true
     if [ "$JOURNAL_ROOT" != "none" ]; then
       ln -s "$MAIN/.overnight" .overnight 2>/dev/null || true
     fi
     if [ -d "$MAIN/supabase/.temp" ]; then
       mkdir -p supabase 2>/dev/null
       ln -s "$MAIN/supabase/.temp" supabase/.temp 2>/dev/null || true
     fi
     ```
   - **Preflight verify:** `npm run typecheck && npm run lint && npm run test`. If any fail: stop (base branch broken). (Adjust verify commands for the project's toolchain — `cargo check && cargo test`, `go vet && go test`, `pytest`, etc.)

4. **Initialize pipeline state** (in main workspace — survives ExitWorktree):
   ```bash
   MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
   STATE_DIR="$MAIN/ai/zv/pipeline-state"
   mkdir -p "$STATE_DIR"
   PHASE_DIR="$STATE_DIR/{issue-id}"
   mkdir -p "$PHASE_DIR"
   STATE_FILE="$STATE_DIR/{issue-id}.json"
   ```
   If STATE_FILE exists: ask via AskUserQuestion:
   - "Resume previous run?" — apply State Recovery Protocol (step 7 determines exact resume point, including re-running any failed stage/phase)
   - "Fresh start?" — Before cleanup, refresh remote ref and check for unpushed commits: `git fetch origin "$BASE_BRANCH" && git log "origin/$BASE_BRANCH..ship/{issue-id}" --oneline 2>/dev/null`. If unpushed commits exist, warn user and list them. Only proceed after explicit confirmation. Then rename existing state file to `{issue-id}-{old-run-id}.bak.json` and rename `{PHASE_DIR}` to `{PHASE_DIR}-{old-run-id}.bak` (prevents stale prompts, outputs, and logs from being consumed by the new run). Clean stale worktree (`git worktree remove <old-path> --force`; if fails, stop). After removal: `git branch -D ship/{issue-id} 2>/dev/null || true`. Create new state file and fresh `{PHASE_DIR}`.

5. **Detect execution mode:**
   ```bash
   CLI_TEST=$(echo "Reply: OK" | claude -p --output-format text --no-session-persistence --max-budget-usd 0.20 2>&1)
   if echo "$CLI_TEST" | grep -q "OK"; then
     EXEC_MODE="cli"
     # Verify bare mode if API key available
     if [ -n "$ANTHROPIC_API_KEY" ]; then
       BARE_TEST=$(echo "Reply: OK" | claude -p --bare --add-dir . --output-format text --no-session-persistence --max-budget-usd 0.20 2>&1)
       if echo "$BARE_TEST" | grep -q "OK"; then EXEC_MODE="cli-bare"; fi
     fi
   else
     EXEC_MODE="subagent"
   fi
   ```

6. Write initial state (include the Project Detection values from step 2 so downstream stages read them from state, not re-detect):
   ```json
   {
     "issue_number": "42",
     "issue_title": "...",
     "run_id": "ISO-timestamp",
     "gate_mode": false,
     "execution_mode": "cli|cli-bare|subagent",
     "branch": "ship/42",
     "worktree_path": "/path/to/worktree",
     "main_workspace": "/path/to/main",
     "phase_dir": "/path/to/pipeline-state/{issue-id}",
     "base_branch": "main",
     "docs_root": "/path/to/docs or wiki or null",
     "log_path": "/path/to/log.md or null",
     "migration_style": "supabase|sqlite-version|prisma|drizzle|alembic|none",
     "journal_root": "/path/to/.overnight/journals or \"none\"",
     "current_stage": 1,
     "last_completed_phase": 0,
     "session_start_phase": null,
     "phases_total": 0,
     "phase_mapping": [],
     "phase_results": [],
     "cumulative_files": [],
     "stage_results": [],
     "decisions": [],
     "plan_path": null,
     "review_path": null,
     "qa_report_path": null,
     "contract_results": null,
     "qa_summary": null,
     "pr_url": null,
     "pr_number": null,
     "stash_hash": null
   }
   ```
7. Print: `Pipeline Heavy: #42 — "{title}" [mode: {cli|cli-bare|subagent}, base: {base_branch}, migration: {migration_style}]`
8. **Journal check:** Only if `$JOURNAL_ROOT != "none"`: if `$JOURNAL_ROOT/{issue_number}.md` exists (e.g. `.overnight/journals/42.md`), read last 3000 chars. Keep in mind throughout. Projects without `.overnight/journals/` skip this silently — no fallback is needed.

## Stage 2: Explore

**Docs pre-load:** Before launching Explore subagents, if `$DOCS_ROOT` is set, check for an index page (`$DOCS_ROOT/index.md`, `$DOCS_ROOT/README.md`, or list top-level `.md` files) and identify 2-3 relevant doc/wiki pages based on the issue description. Read those pages. If `$DOCS_ROOT` is empty (no in-tree `docs/` and no `External wiki:` line in CLAUDE.md), skip this step. Pass a condensed summary (max 500 words) of relevant doc context as a `## Prior Knowledge` section in the explore subagent prompts. This keeps doc reads in the orchestrator (which may read metadata) rather than each subagent reading independently.

Launch parallel Explore subagents directly (`subagent_type: "Explore"`, thoroughness "very thorough") — NOT via Phase Execution Protocol. Explore subagents are lightweight and purpose-built.

Update state: `current_stage: 2` (set on entry, before launching Explore subagents).

Synthesize findings into `ai/zv/explorations/YYYY-MM-DD-<slug>.md`. The orchestrator may read exploration summaries (metadata, not source code).

**Docs enrichment:** After saving the exploration doc, assess whether any codebase-structural findings should update durable docs in `$DOCS_ROOT` (common names: `architecture.md`, `troubleshooting.md`, `data-model.md`, `db-schema.md`, or the project's own `CLAUDE.md` Gotchas section). If yes, update max 3 pages with `(discovered: YYYY-MM-DD, explore: #XX)` attribution. The orchestrator may write docs — they are project metadata, not source code. Skip if `$DOCS_ROOT` is empty.

**Decision point — only if ambiguous:** AskUserQuestion if genuinely ambiguous. Otherwise proceed.

## Stage 3: Scope Gate + Research

Update state: `current_stage: 3` (set on entry).

Same as `/pipeline`: skip if purely internal, research if unfamiliar APIs/libraries/patterns. Summarize in 3-5 bullets. No delegation needed.

## Stage 4: Plan

Update state: `current_stage: 4` (set on entry).

**Wiki context load:** Before writing the plan, read 1-2 relevant wiki pages (per `/zv04-plan` Wiki Context Load — data-model, architecture, or troubleshooting based on the issue area). The orchestrator may read wiki pages — they are metadata, not source code.

Create plan per `/zv04-plan`. Save to `ai/zv/plans/YYYY-MM-DD-<slug>.md`.

**Persist plan_path** in state file. All downstream stages reference it.

**Phase mapping:** Count phases — match `- [ ] **Step N:` / `- [x] **Step N:` items. Handle edge cases: plans may reuse step numbers across sections — assign sequential phase IDs regardless. Store the **original plan step label** (`plan_step_label`) alongside the sequential phase ID so executors can target the correct step in the plan file. Assign file paths:
```json
{
  "phases_total": 4,
  "phase_mapping": [
    {"phase": 1, "plan_step_label": "Step 1", "plan_step_title": "Create schema migration", "status": "pending", "prompt": "{PHASE_DIR}/phase-1-prompt.md", "output": "{PHASE_DIR}/phase-1-output.md"},
    {"phase": 2, "plan_step_label": "Step 2", "plan_step_title": "Add API endpoints", "status": "pending", "prompt": "{PHASE_DIR}/phase-2-prompt.md", "output": "{PHASE_DIR}/phase-2-output.md"}
  ]
}
```

**Initialize pipeline log** — write header to `{PHASE_DIR}/pipeline-log.md`:
```markdown
# Pipeline Log: {issue_id} — {title}
| Time | Stage/Phase | Status | Files | Commit | Notes |
|------|-------------|--------|-------|--------|-------|
```

## Stage 5: CEO Review

Update state: `current_stage: 5` (set on entry, before execution).

**Execute via Phase Execution Protocol.** Label: `ceo-review`.

Before launching: `cp "{plan_path}" "{plan_path}.pre-ceo.bak"`

Prompt task section:
```
Run /gs01-ceo-review in HOLD SCOPE mode for issue {issue_id}.

## Task
Review the plan. Challenge from first principles:
- Premise challenge, existing code leverage, dream state mapping
- Architecture, error/rescue map, security, data flow, performance
Skip Mode Selection — use posture C (HOLD SCOPE).
Diff against the project's base branch: use `git diff "origin/$BASE_BRANCH" --stat`.
Auto-resolve all review sections — do not use AskUserQuestion.
If revisions needed, write revised plan back to {plan_path}.

## Input Files
- Plan: {plan_path}

## Output
Write review notes to: {PHASE_DIR}/ceo-review.md

CEO_REVIEW_RESULT:
- status: PASS|FAIL
- verdict: GO/NO-GO
- plan_revised: true/false
- commit_hash: {hash or none}
- blocking_issues: [list if NO-GO]
- deferred_notes: [non-blocking observations]
```

If NO-GO: surface blocking issues to user, revise plan, re-run CEO review.
If plan revised: re-count phases, update `phase_mapping` in state file.

## Stage 6: Eng Review

Update state: `current_stage: 6` (set on entry, before execution).

**Execute via Phase Execution Protocol.** Label: `eng-review`.

Before launching: `cp "{plan_path}" "{plan_path}.pre-eng.bak"`

Prompt task section:
```
Run /gs02-eng-review for issue {issue_id}.

## Task
Validate buildability:
- What existing code partially solves each sub-problem?
- Minimum set of changes? Complexity smell: 8+ files or 2+ new abstractions.
- Architecture, code quality, test coverage, performance review
Ignore project-specific references that don't match this repo.
Auto-resolve all review checkpoints — do not use AskUserQuestion.
If revisions needed, write revised plan back to {plan_path}.

## Input Files
- Plan: {plan_path}

## Output
Write review notes to: {PHASE_DIR}/eng-review.md

ENG_REVIEW_RESULT:
- status: PASS|FAIL
- verdict: BUILDABLE/NEEDS_REVISION
- plan_revised: true/false
- commit_hash: {hash or none}
- revision_summary: [if revised]
```

If plan revised: re-count phases, update `phase_mapping`.

**Plan Summary and adaptive gating:**

Output a Plan Summary:
```
### Plan Summary: #42 — "{title}"
**What:** 1-2 sentence description
**Why:** Problem or opportunity (1 sentence)
**How:** Numbered phases with 1-line descriptions
**Touches:** Key files/areas
**Risk:** One line
```

Determine pause:
- **Pause if** `--gate` OR CEO returned NO-GO OR Eng returned NEEDS_REVISION OR plan revised non-trivially.
- **Auto-proceed otherwise.** Log `decisions: [{stage: 6, auto: true, reason: "reviews clean"}]`.

When pausing:
```
question: "Plan ready for #42 (CEO + Eng reviewed). Summary above."
options:
  - "Execute as-is (Recommended)"
  - "Revise scope"
  - "Abort"
```

---

## Stage 7: Execute — Phase Loop

Each plan phase runs as an isolated execution. Zero context sharing between phases — all inter-phase data flows through files.

**On first entry:** Update state `current_stage: 7`. Set `session_start_phase` to first pending phase number if null. Update GitHub issue label to "status: in-progress" via `gh issue edit` (orchestrator does this directly).

**Field semantics:** `last_completed_phase` = the phase number most recently completed or skipped. Starts at 0 (no phases done). After phase N finishes or is skipped, set to N. `session_start_phase` = the phase number of the first phase that will execute in this session.

For each phase in `phase_mapping` (skip if `status: "done"`):

### 7a. Escape hatch (check BEFORE spawning)

If `session_start_phase` is null, set it to the current phase number. Then check:

If `phases_total > 7` AND `(last_completed_phase - session_start_phase) >= 3` AND `(phases_total - last_completed_phase) > 1`:

Output continuation prompt and STOP:
```
⚠️ CONTEXT IS GETTING HEAVY — I recommend clearing and continuing in a fresh session.

Paste this into your next Claude Code session:
---
Continue executing pipeline-heavy for {issue_id}.

cd {worktree_path}
# Check for dirty state: git status

State file: {state_file_path}
Branch: ship/{issue_id}
Completed phases: {list with 1-line summaries}
Key decisions: {any deviations}
Next up: Phase {N}
Remaining: {list}
Plan file: {plan_path}
---
```

Do NOT continue. Wait for user.

### 7b. Build and execute phase

**Write prompt** to `{PHASE_DIR}/phase-{N}-prompt.md`:

```
You are executing Phase {N} of {total} for issue {issue_id}: "{title}".

Read CLAUDE.md before starting.

## Your Phase
Read {plan_path} and execute ONLY {plan_step_label}: "{plan_step_title}". Do not execute other steps.
Update the checkbox for {plan_step_label} to [x] when done.
(Phase {N} of {total} — the plan step label above is the authoritative reference for which step to execute.)

## Input Files
- Full plan: {plan_path}
- Prior phase output: {PHASE_DIR}/phase-{N-1}-output.md (read if exists)
- Journal dead-ends: {journal_path} (read if exists)

## Output
Write a brief summary of what you did to: {PHASE_DIR}/phase-{N}-output.md
Commit with message: "pipeline: phase {N} — {phase title}"

## Rules
- If FIRST phase: the orchestrator has already updated GitHub issue label to "status: in-progress" — no action needed.
- If LAST phase: run full verify loop — `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` (adjust for the project's toolchain — `cargo`, `go`, `pytest`, etc.). Fix failures (max 2 iterations). Then run `/simplify` on full diff vs the project's base branch (`git diff "origin/$BASE_BRANCH" --name-only`). If simplify makes changes, re-run verify (single pass). Commit simplify separately: `refactor(scope): simplify post-execute cleanup`.
- Mid-execution change protocol: cosmetic → proceed and note. Contract amendments → STOP, return blocker: [{type: "contract_amendment", criterion: "...", proposed_change: "...", rationale: "..."}].

PHASE_RESULT:
- status: PASS|FAIL
- output: {PHASE_DIR}/phase-{N}-output.md
- files_changed: [list]
- commit_hash: {hash}
- plan_amendments: []
- blockers: []
```

**Execute via Phase Execution Protocol.** Record result with `status: "pending_gate"`. If a `pending_gate` entry already exists for this phase (retry), replace it — don't duplicate.

### 7c. Handle blockers

If `blockers` non-empty:
- **Contract amendment:** Surface to user via AskUserQuestion. If approved, update plan file. Re-spawn this phase from 7b (it hasn't finished).
- **Other blockers:** Surface to user. Skip → mark `status: "done"` with `"skipped": true`, set `last_completed_phase` to this phase number. Re-work → re-spawn from 7b. If partial work was committed (`files_changed` non-empty or `commit_hash` present), still run 7d — committed code must pass gate. Only skip 7d if no code produced.
- **No blockers:** proceed to 7d.

### 7d. Quality gate (skip for last phase — it runs full verify internally)

Run Quality Gate Protocol (typecheck + lint + test). If fails: execute fix via Phase Execution Protocol (label: `gate-fix-{N}`, include error tails). Re-run ALL gates. If still failing: halt, ask user.

After gate passes: mark `status: "done"`, set `last_completed_phase` to this phase number. Update state.

### Loop continues until all phases are done.

### Migration Push (after all phases complete)

Branch on `$MIGRATION_STYLE` (resolved in Stage 1). Each branch has a different detection path + push command. **Never** output a reminder to push migrations manually — either push automatically or skip silently.

- **`supabase`** — check `git diff "origin/$BASE_BRANCH" --name-only -- supabase/migrations/`. If `.sql` files changed, run `npx supabase db push`. On failure: STOP, do not continue to review with broken schema.
- **`sqlite-version`** — check `git diff "origin/$BASE_BRANCH" --name-only -- src/lib/db/schema.ts`. If the schema file changed, verify `SCHEMA_VERSION` was bumped and a `migrateVN...` helper was added (project-specific convention; the migration runs automatically on next DB open). Exercise it by running the test suite — `npm test`. If the tests exercise the migration and pass, the push is implicit.
- **`prisma`** — check `git diff "origin/$BASE_BRANCH" --name-only -- prisma/migrations/ prisma/schema.prisma`. If changed, run `npx prisma migrate deploy` (production-safe non-interactive form; do NOT use `migrate dev` in pipeline). On failure: STOP.
- **`drizzle`** — check `git diff "origin/$BASE_BRANCH" --name-only -- drizzle/`. If changed, run `npx drizzle-kit migrate` (or the project's configured migration script — `npm run db:migrate` is a common alias; inspect `package.json` first). On failure: STOP.
- **`alembic`** — check `git diff "origin/$BASE_BRANCH" --name-only -- alembic/versions/`. If changed, run `alembic upgrade head`. On failure: STOP.
- **`none`** — skip silently.

On success (any branch), log to pipeline-log: `| {HH:MM} | migration-push | PASS | N migrations | — |`.

---

## Stage 8: Code Review

Update state: `current_stage: 8` (set on entry, before execution).

**Execute via Phase Execution Protocol.** Label: `review`.

**Seed the reviewer cold (#733).** Do NOT pass `{plan_path}` as an Input File — author-context contamination is what caused PR #730's three missed bugs. The reviewer must re-derive intent from the diff. The Sprint Contract criteria required for the `## Contract Results` table should be passed as criteria to evaluate, not as author framing.

Prompt task section:
```
Run /zv06-review for issue {issue_id}.
Let /zv06-review handle Codex launch internally (it auto-launches /zv07-codex for diffs >=50 lines or 3+ files, OR when any changed path is infra-shaped — `scripts/`, `.github/workflows/`, `supabase/migrations/**.{mjs,ts,js,sh}`, `scripts/launchagents/`, any `*.plist`, `.claude/hooks/`, `.claude/rules/` per #734; bypass with CODEX_INFRA_GATE=0 for incident response).
Do NOT spawn sub-subagents beyond what /zv06-review does internally.
Do NOT update GitHub issue status (skip /zv06-review's "In Review" step) — the orchestrator handles that after ship.
Do NOT read the plan, exploration notes, or .context-bundle.md. Re-derive intent from `git diff "origin/$BASE_BRANCH"`. The only plan content you may read is the `## Sprint Contract` section (acceptance criteria) — treat it as a spec to grade against, not as author framing.

## Task
Run full review including Codex (if threshold met). Produce:
1. Review artifact at ai/zv/reviews/YYYY-MM-DD-<slug>.md
2. Contract Results table (FUNC/SEC/REG grading)
3. SEC/REG evaluation
4. Codex findings merged (if launched)
5. ASK-level findings batched
Auto-fix mechanical issues and commit.

## Output
Write review to: ai/zv/reviews/YYYY-MM-DD-<slug>.md

REVIEW_RESULT:
- status: PASS|FAIL
- review_path: {path}
- ask_items: [{finding, severity, recommendation}]
- contract_results: {per-criterion verdicts — PASS, FAIL, SKIP, SKIP-AMENDED}
- diff_stats: {lines_changed, files_touched}
- fixes_committed: true/false
- commit_hash: {hash or none}
- files_changed: [list]
- blockers: []
```

**After review execution:**

1. Persist `review_path` and `contract_results` in state. Merge `files_changed` into `cumulative_files`.

2. **Codex handled by review internally.** `/zv06-review` auto-launches `/zv07-codex` for large diffs (50+ lines or 3+ files) OR any infra-shaped diff (`scripts/`, `.github/workflows/`, `supabase/migrations/**.{mjs,ts,js,sh}`, `scripts/launchagents/`, any `*.plist`, `.claude/hooks/`, `.claude/rules/` per #734 — `CODEX_INFRA_GATE=0` bypasses for incident response), merges findings, re-evaluates SEC/REG, and batches ASK items — all within the single review execution. Do NOT launch Codex separately (causes double runs and file write races per `/pipeline.md`).
   **If Codex CLI unavailable during review:** The review execution will surface a blocker. Relay to user: "Codex CLI unavailable — fix setup or skip?" Note decision in state.

   **Codex stall fallback (auto-degrade):** If the Stage 8 Bash invocation hits its 10-min `timeout: 600000` without producing a `REVIEW_RESULT:` block in the tail, assume Codex hung (recurring failure mode — see `feedback_codex_rescue_hangs.md`). The orchestrator must:
   1. Kill orphaned Codex processes: `pkill -f codex-companion; pkill -f 'codex exec'` (ignore exit codes).
   2. Log the stall in state: `decisions: [{stage: 8, codex: "stalled_killed", timestamp: ...}]`.
   3. Re-run Stage 8 via Phase Execution Protocol with a modified prompt: prepend "Skip Codex launch — run /zv06-review with `--skip-codex` or manually perform Pass 1 + Pass 2 review without invoking /zv07-codex. Write the review artifact with a CODEX: SKIPPED (stalled) note in the findings section." Do not re-attempt Codex on the retry.
   4. If the retry also fails, halt and ask the user rather than looping.

   Do not wait for a human to notice the stall — the 10-min timeout is the signal.

3. **ASK items gating (adaptive):** Batch ASK items from the review output (includes any Codex findings).
   - **Pause if** `--gate` OR any ASK item is ambiguous (competing trade-offs, security implications, no clear recommendation).
   - **Auto-proceed otherwise.** Apply recommended fixes, dismiss dismissibles. Log decision.
   If code fixes needed: execute fix via Phase Execution Protocol (label: `review-fix`). Then execute contract re-check (label: `contract-recheck`) for SEC/REG only. Update review artifact and state.

4. **Clean-tree gate:** Verify `git status --porcelain` is clean. If dirty, execute commit fix.

---

## Stage 9: QA

Update state: `current_stage: 9` (set on entry, before execution).

**Execute via Phase Execution Protocol.** Label: `qa`.

Prompt task section:
```
Run /zv08-qa for issue {issue_id}.

## Input Files
- Plan (Sprint Contract criteria): {plan_path}
- Files changed: {cumulative_files list}
- Review artifact: {review_path}

## Task
1. Verify all Sprint Contract criteria (FUNC, REG, UI)
2. Browser testing if dev server available (skip if not — mark visual FUNC/UI as SKIP)
3. Re-check SEC/REG after any fixes
4. Journal entry for Critical/High bugs
5. Classify bugs, fix Critical and High automatically
6. Stop at 20% cumulative risk
7. Write QA report to ai/zv/reviews/YYYY-MM-DD-qa-<slug>.md

QA_RESULT:
- status: PASS|FAIL
- qa_report_path: {path}
- bugs_found: [{description, severity, fixed}]
- contract_results: {per-criterion verdicts}
- commit_hash: {hash or none}
- files_changed: [list]
- commit_hashes: [list]
- journal_written: true/false
```

After: persist `qa_report_path`, `contract_results` (supersede review's), `qa_summary`. Merge `files_changed` into `cumulative_files`.

---

## Stage 10: Document

**On entry:** Update state `current_stage: 10`.

**Execute via Phase Execution Protocol.** Label: `document`.

Prompt task section:
```
Run /zv09-document for issue {issue_id}.

## Input Files
- Files changed: {cumulative_files}
- Review artifact: {review_path}

## Task
You are in the worktree on the feature branch. Ship has not run yet.
1. Update documentation (CLAUDE.md gotchas, inline comments if behavior changed)
2. Save changelog to ai/zv/changelogs/YYYY-MM-DD-<slug>.md
3. Commit doc changes locally (do NOT push — Ship handles that)

DOCUMENT_RESULT:
- status: PASS|FAIL
- changelog_path: {path}
- claude_md_updated: true/false
- doc_committed: true/false
- commit_hash: {hash or none}
- blockers: []
```

**After execution:**
1. If `blockers` non-empty: surface to user, get decisions, re-execute.
2. Update state: `current_stage: 11`.

---

## Stage 11: Ship

Ship is split into two parts: the execution handles pre-CI work (merge, test, push, PR), the orchestrator handles CI watch and retry (unbounded by execution timeout).

**On entry:** Update state `current_stage: 11`.

**Resume logic:** If resuming and `current_stage == 11` with `pr_url` already set in state, skip 11a entirely — jump to 11b CI watch using the stored `pr_number`. Check PR status first: if already `MERGED`, skip to 11c.

### 11a. Pre-CI execution

**Execute via Phase Execution Protocol.** Label: `ship`.

Prompt task section:
```
Run /zv10-ship for issue {issue_id} — pre-CI steps only.

## Input Files
- Plan: {plan_path}
- Review artifact: {review_path}
- QA report: {qa_report_path}
- Contract results from prior stages: {latest from state}

Branch: ship/{issue_id}

## Task
1. Merge latest base branch: `git fetch origin "$BASE_BRANCH" && git merge "origin/$BASE_BRANCH" --no-edit`
2. Full test suite: lint, typecheck, test, build
3. Contract gate: merge review + QA results per /zv10-ship Step 2.5. FAIL/MISSING = hard block.
4. Generate 3-7 user-facing test steps from the diff
5. Push: git push -u origin ship/{issue_id}  # NEVER use HEAD — branch-guard hook rejects the literal string
6. PR: `gh pr create --base "$BASE_BRANCH"` (use the resolved base — never hardcode)
7. Auto-merge: gh pr merge --auto --squash <PR_NUMBER>
8. If merge in step 1 was non-trivial, set staleness_warning: true in your result
STOP HERE — do NOT watch CI. The orchestrator handles CI watch.
Do NOT update GitHub issue status — the orchestrator handles that after merge.

SHIP_RESULT:
- status: PASS|FAIL
- pr_url: {url}
- pr_number: {number}
- commit_hash: {hash or none}
- contract_gate: passed|blocked
- staleness_warning: true/false
- blockers: [{description}]
```

**After pre-CI execution:**

**Persist PR metadata immediately:** Write `pr_url` and `pr_number` from the result block to the state file before any other processing. This ensures CI watch can resume after a crash.

If `contract_gate` is `blocked` → hard block. Explain which FUNC/SEC/REG failed. Do NOT offer "proceed anyway."
If `staleness_warning` is `true` → warn user: "Staging merge introduced changes — QA verdicts may be stale."
If `blockers` non-empty (merge conflict, test failure, etc.) → surface to user, get resolution.

### 11b. CI watch (orchestrator — no timeout pressure)

The orchestrator watches CI directly — no delegation, no 10-minute timeout.

```bash
gh pr checks {pr_number} --watch
```

If CI fails:
1. Read failure: `gh pr checks {pr_number}` (capture output, `tail -20`).
2. Classify: mechanical (lint, type error, test flake) vs. non-trivial (behavior, security).
3. **Mechanical:** Execute fix via Phase Execution Protocol (label: `ci-fix-{attempt}`), push, re-watch. Max 2 attempts.
4. **Non-trivial:** Execute fix via Phase Execution Protocol (label: `ci-fix-{attempt}`) that includes review re-run. Push, re-watch. Max 1 attempt, then ask user.

After CI passes, confirm merge:
```bash
MERGE_STATE=$(gh pr view {pr_number} --json state -q '.state')
```

If not `MERGED` → ask user. If `MERGED` → proceed.

### 11c. Post-merge

1. **Strip pipeline status labels then close the GitHub issue** — orchestrator does this directly:
   ```bash
   gh issue edit <number> --remove-label "status: in-progress" --remove-label "status: in-review" 2>/dev/null || true
   gh issue close <number>
   ```
   `gh` is idempotent when a label exists in the repo but isn't on the issue. The `|| true` only trips if the labels have been deleted from the repo's label set entirely (rare). If `gh issue close` fails, warn user to close manually.
2. Print the PR URL.
3. Exit worktree: `ExitWorktree`.
4. Archive state file: rename to `{issue-id}-{run-id}.done.json`.
5. Pull merged changes into main workspace staging. **Guard the stash pop** — only pop if *this run* actually pushed something. A blind `git stash pop` will silently apply a stale stash left over from a previous session and cause a phantom merge conflict (observed 2026-04-08, pipeline-mini #267):
   ```bash
   MAIN=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
   cd "$MAIN"
   STASH_BEFORE=$(git stash list | wc -l | tr -d ' ')
   git stash push -m "pipeline-wip-$$" 2>/dev/null || true
   STASH_AFTER=$(git stash list | wc -l | tr -d ' ')
   git pull --rebase origin "$BASE_BRANCH"
   # Only pop if our push actually created a new stash entry on top
   if [ "$STASH_AFTER" -gt "$STASH_BEFORE" ]; then
     git stash pop
   fi
   ```
6. Pipeline complete.

---

## State Recovery Protocol

If this pipeline is being **resumed** (user pasted a continuation prompt):

1. Read state file from `{main_workspace}/ai/zv/pipeline-state/{issue-id}.json`.
2. **Post-Ship special case:** If `current_stage >= 11` AND worktree gone (`! test -d {worktree_path}`): `cd` to main workspace, skip steps 3-5. Check dirty state in main workspace. If dirty: stash, ask user restore/discard. Then `git pull origin "$BASE_BRANCH"` (reading `base_branch` from state file).
3. `cd` to worktree path. Do NOT call EnterWorktree (worktree exists).
4. Verify worktree exists: `test -d {worktree_path}`. If not: ask user.
5. Check dirty state:
   ```bash
   git status --porcelain
   ```
   If dirty: `git stash --include-untracked`. Log stash hash. If stash fails: stop.
   Ask: "Restore stashed changes? / Discard stash and continue clean"
   If restore: `git stash pop`. If conflicts: stop.
   After resolution: verify `node_modules` and `.env.local` exist. If missing, re-run Stage 1 setup commands. Re-run preflight verify.
6. **Re-detect execution mode** (CLI availability may have changed between sessions).
7. **Determine resume point.** Since `current_stage` is always set on entry (not after completion), `current_stage == N` means "Stage N was entered but may not have completed." Check `stage_results` for any entry with `"status": "failed"` at `current_stage`. If found, re-run that stage. If no failed entry exists at `current_stage`, the stage either completed successfully (and the orchestrator crashed before advancing `current_stage`) or never started executing — re-run it. A stage is definitively complete only if `current_stage` has advanced past it (i.e., `current_stage > N`). For Stage 7, also check `phase_results` for the failed phase — resume from that phase. For Stage 11, check `pr_url` in state to determine sub-step resume point (PR creation happens in Stage 11 Ship, not Stage 10 Document). Set `session_start_phase` to first phase number that will execute this session.

### Crash Recovery

If an execution fails or times out:
1. **Check for partial commits** (all stages that commit — Stages 7, 8, 9, 10, 11): Compare `git rev-parse HEAD` (full hash) against the last known `commit_hash` from state (prior phase, prior stage, or branch base — also resolved via `git rev-parse`). If HEAD advanced, record partial commit hashes in state and include in journal entry. For Stage 11, also check if a PR was created: `gh pr list --head ship/{issue_id} --json number,url --jq '.[0]'`. **If a PR is found, persist `pr_url` and `pr_number` into state immediately** — this enables the Stage 11 resume logic to skip pre-CI and jump directly to CI watch.
2. Write a 5-line crash entry: if `$JOURNAL_ROOT != "none"`, append to `$JOURNAL_ROOT/{id}.md`; else if `$LOG_PATH` is set, append to that log; else skip the persistent entry and keep the record only in the state file. Include partial commit hashes if detected.
3. Update state file with failure:
   - **Stages 2-6:** Record `{"stage": N, "status": "failed", "error": "..."}` in `stage_results`. Resume re-runs the stage. **Stages 5-6:** Restore plan from snapshot (`{plan_path}.pre-{ceo|eng}.bak`) if execution could have modified the plan.
   - **Stage 7:** Leave `last_completed_phase` unchanged. Add failure to `phase_results`: `{"phase": N, "status": "failed", "error": "...", "partial_commits": [...]}`. On resume, the retry phase prompt will include a warning about existing partial commits (see Step 2 partial commit detection).
   - **Stages 8-11:** Record in `stage_results`.
3. Output continuation prompt:
   ```
   Pipeline-heavy crashed during Stage {N}{", Phase " + M if Stage 7}.

   Paste this into your next session:
   ---
   Resume pipeline-heavy for {issue_id}.

   cd {worktree_path if exists, else main_workspace}
   State file: {state_file_path}
   Last completed: {last successful stage/phase}
   Failed at: Stage {N}{", Phase " + M if applicable} — {error summary}
   ---
   ```
4. Do NOT continue. Wait for user.

---

## Rules

- **Filesystem-first.** All execution outputs go to disk. Orchestrator reads: state files, plan files, journals, phase output summaries, gate output (`tail -20`). Never source code.
- **Terse returns.** CLI: parse last N lines (30 for phases, 80 for review/QA/ship — see `TAIL_LINES`). Subagent: return only the `*_RESULT:` block. Full results live on disk.
- **No compaction reliance.** Pipeline stays within context by design. Document & Clear is the escape hatch, not the normal path.
- **No parallel execution.** Each phase runs sequentially. Exception: Stage 2 Explore subagents (lightweight, purpose-built).
- **No sub-subagents.** Strictly orchestrator → execution. Fixes, re-checks are separate orchestrator-initiated executions. Exception: `/zv06-review` internally launches `/zv07-codex` as a background subagent — this is the designed integration path and is allowed.
- **Gate temp files use `mktemp`.** Parallel pipelines won't clobber each other.
- **CLI auth fallback.** If `claude -p` fails auth mid-pipeline, switch to subagent mode and update state. Don't halt.
- **Fail-closed contracts.** Missing `contract_results` = FAIL. Ship blocks without explicit non-FAIL verdicts.
- **Scope discipline.** Only implement what the issue describes. Adjacent issues → note, don't act.
- **Adaptive gating.** Stages 6 and 8 auto-proceed if clean. `--gate` forces pause. Errors always pause.
- **Journal discipline.** 5-line format. Don't alter overnight entries. Write before pausing.
- **Worktree isolation.** Each pipeline in its own worktree. Main workspace undisturbed.
- **CI fix routing.** Mechanical fixes → update PR, proceed. Non-trivial fixes → re-run review or QA.
- **Bash timeout.** Use `timeout: 600000` (10 min) for all CLI execution Bash calls.
- **GitHub updates from orchestrator.** The orchestrator handles GitHub CLI calls directly (issue status updates, etc.). Don't rely on phases to update GitHub issues — they may run in `--bare` mode without gh CLI access.

---

## Final: Session Debrief

After the pipeline completes (all stages done, PR shipped), run `/session-debrief` automatically:

1. Scan `git log` for commits made during this pipeline run (use state file's `commit_hash` history or `"origin/$BASE_BRANCH..HEAD"`)
2. Identify decisions made, patterns discovered, and carry-forward items
3. Append entry to `$LOG_PATH` (resolved in Stage 1: prefer in-tree `docs/log.md`, else `$DOCS_ROOT/log.md`). If `$LOG_PATH` is empty (project has neither), skip the log append — the state file + commit history already carry the record.
4. Verify docs were updated during Document stage — if not, apply doc updates as fallback (session-debrief Step 4)

Log entry format:
```
## [YYYY-MM-DD HH:MM PT] pipeline-heavy | #<issue> <title> | branch: <branch>
- **Scope**: Pipeline completed — <brief description>
- **Phases**: <count> phases executed
- **Commits**: <count>
- **Decisions**: Key decisions made during execution
- **Docs updates**: Pages updated or "none"
- **Carry-forward**: Follow-up work or "none"
```

This step is automatic — no user confirmation needed.
