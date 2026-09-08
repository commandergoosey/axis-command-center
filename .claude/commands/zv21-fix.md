# Quick Fix

Lightweight fix pipeline for post-ship corrections. Uses a worktree so the main workspace stays untouched.

Use when: a feature already shipped via `/zv10-ship` but you spot small issues (typos, missed edge cases, styling tweaks, lint fixes). Not for new features or large refactors — use the full ZV pipeline for those.

**SAFETY — hard rules:**
1. NEVER commit directly to `staging` or `main`
2. NEVER run `gh pr create` with `--base main`
3. Always use a worktree — never switch branches in the user's workspace

**Never stop for:** commit messages (auto-generate), branch naming (auto-derive).

## Step 0: Parse Arguments

The user provides either:
- A description of what to fix (e.g., `/zv21-fix button color on WO detail page`)
- A GitHub issue number (e.g., `/zv21-fix 142`)
- Both (e.g., `/zv21-fix 142 fix button color`)

Derive a short slug for the branch name (e.g., `fix/142` or `fix/button-color`).

## Step 1: Check for Existing PR

```bash
git fetch origin --quiet

# Check if there's an open PR for this issue targeting staging
gh pr list --base staging --state open --json number,headRefName,title | grep -E "<issue-number|slug>"
```

- **If an open PR exists:** check out its branch into a worktree. The fix gets added as a new commit on that branch — the existing PR updates automatically when pushed.
- **If no open PR:** create a fresh branch from `origin/staging`.

```bash
# Existing PR — use its branch
BRANCH="<existing-head-ref>"
WORKTREE_PATH=".worktrees/fix-<slug>"
git worktree add "$WORKTREE_PATH" "$BRANCH"

# OR new branch
BRANCH="fix/<slug>"
WORKTREE_PATH=".worktrees/fix-<slug>"
git worktree add "$WORKTREE_PATH" -b "$BRANCH" origin/staging
```

All subsequent work happens in the worktree directory. Do NOT modify files in the main workspace.

## Step 2: Make the Fix

1. Read the relevant files in the worktree
2. Make the fix — keep changes minimal and focused
3. Do not refactor surrounding code, add comments, or make unrelated improvements

## Step 3: Validate

Run from the worktree:

```bash
cd "$WORKTREE_PATH"
npm run lint
npm run typecheck
npm run test
```

If any fail, fix and re-run (max 2 attempts). If still failing, abort: remove the worktree and tell the user.

## Step 4: Commit + Push + PR

```bash
cd "$WORKTREE_PATH"
git add <changed-files>
git commit -m "fix(scope): description"
git push -u origin "$BRANCH"
```

- **If reusing an existing PR branch:** push is enough — the PR updates automatically. No need to create a new PR. Add a comment to the existing PR summarizing what was fixed.
- **If new branch:** create a PR:

```bash
gh pr create --base staging --title "fix(scope): description" --body "$(cat <<'EOF'
## Summary
- <1-2 bullet points describing the fix>

## How to Test
- [ ] <concrete user action to verify the fix>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# Auto-merge
gh pr merge --auto --squash <PR_NUMBER>
```

## Step 5: Cleanup

```bash
git worktree remove "$WORKTREE_PATH"
git branch -D "$BRANCH" 2>/dev/null || true
git pull --rebase origin staging
```

## Step 6: Output

Print:
- PR URL
- What was fixed (1-2 lines)
- How to verify on staging

Done.
