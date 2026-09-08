# Codex Review

Adversarial second opinion on the branch diff using OpenAI Codex CLI.

**Auto-launched** by `/zv06-review` for diffs ≥50 lines or 3+ files. Can also be run standalone.

## Purpose

Claude reviewed its own code in `/zv06-review`. Codex reviews it independently — different model, different blind spots. This catches issues that self-review misses.

## Step 0: Already-ran short-circuit

Before doing any work, check whether Codex already ran successfully on this slice. If so, skip — the known second-invocation hang (see `~/.claude/projects/-Users-commandergoosey-Projects-axis/memory/feedback_codex_rescue_hangs.md`) makes a redundant re-run the single most common 50+-minute stall in pipeline-heavy.

```bash
BASE=origin/staging
git rev-parse --verify "$BASE" >/dev/null 2>&1 || BASE=origin/main
if git log "$BASE"..HEAD --format='%s' 2>/dev/null | LC_ALL=C grep -iqE '^(fix|refactor)\([^)]*codex[^)]*\):|^(fix|refactor)\(.*(address .*codex|codex .*review|codex .*findings)'; then
  echo "CODEX_ALREADY_RAN"
elif [ -f ai/zv/reviews/.codex-done.marker ]; then
  echo "CODEX_ALREADY_RAN"
else
  echo "CODEX_NOT_RUN_YET"
fi
```

Matches branch-local commit **subjects** signalling a prior Codex fix via two narrow alternatives:
1. Scope contains `codex`: `fix(codex): ...`, `refactor(codex-fix): ...`
2. Description phrases a Codex review outcome: `fix(slice-N): address Codex review findings`, `refactor(slice-2): tighten handlers per codex review`, etc.

This avoids the axis#740 false-positive where a feature commit merely mentioned "codex" in its body, AND the axis#740 Codex-consult-caught false-positive where a subject like `fix(scripts): configurable codex phase timeouts` would previously have short-circuited despite being ordinary infra work. `LC_ALL=C` pins grep to ASCII case-folding.

If `CODEX_ALREADY_RAN`: stop immediately. Return a structured no-op:
```
CODEX_RESULT: SKIPPED (prior fix(codex): commit or marker present — avoids second-invocation hang)
```

Do NOT invoke the codex binary or the `/codex review` skill. The caller (`/zv06-review` Step 0) should also be short-circuiting; this is belt-and-suspenders.

## Step 1: Get the Diff

## Step 2: Run Codex Review

Use the `/codex review` skill to run Codex against the current diff.

Codex reviews for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Edge cases and error handling gaps
- Architectural concerns

## Step 3: Triage Findings

Classify each Codex finding:

**AUTO-FIX** (apply without asking):
- Genuine bugs with clear fixes
- Security issues with obvious remediation
- Performance improvements that don't change behavior

**ASK** (needs user judgment):
- Findings that conflict with `/zv06-review` decisions
- Suggestions that would change user-visible behavior
- Architectural changes beyond the current scope

**DISMISS** (false positives):
- Findings already addressed in `/zv06-review`
- Style opinions that conflict with project conventions
- Suggestions that would increase complexity without clear benefit

## Step 4: Return Findings

**Do NOT commit or write to the review file.** When launched as a background agent by `/zv06-review`, Codex is a read-only reviewer. `/zv06-review` Step 6 handles all commits and file writes.

**Write a success marker.** After Codex completes successfully (findings returned, no timeout/auth/error abort), touch `ai/zv/reviews/.codex-done.marker` at the repo root. This prevents a subsequent `/zv06-review` retry in the same slice from re-invoking Codex and hitting the known second-invocation hang. The `fix(codex):` commit (written later by `/zv06-review` Step 6) is the durable version of this signal; the marker bridges the gap for runs where no fixes were applied.

```bash
mkdir -p ai/zv/reviews
date +"codex-ok %Y-%m-%dT%H:%M:%S" > ai/zv/reviews/.codex-done.marker
```

Add `ai/zv/reviews/.codex-done.marker` to `.gitignore` if not already present — the marker is local state, not a commit artifact.

Return a structured list of findings to the caller. Each finding includes:
- **Severity:** CRITICAL / HIGH / MEDIUM / LOW
- **Location:** file:line
- **Description:** what's wrong
- **Suggested fix:** how to fix it
- **Classification:** AUTO-FIX, ASK, or DISMISS (with reasoning)

This command is always read-only. Whether launched by `/zv06-review` or run standalone, it returns findings — never commits or writes to files. `/zv06-review` Step 6 (or the user manually) decides what to apply.

## If Codex CLI Is Unavailable

This step is **required**. If Codex CLI is not installed or errors:
1. Note the blocker
2. Ask user to fix Codex CLI setup
3. Do not skip to `/zv08-qa`
