#!/usr/bin/env bash
# SessionStart: ensure new sessions begin on `main`.
# - If already on main: no-op.
# - If on a worktree branch (ship/*, prototype/*, landing/*, etc.): no-op (intentional).
# - If on another branch AND tree is clean: checkout main + pull.
# - If tree is dirty: print a warning, don't touch anything.

set -u

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0

# Skip if not a git repo
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

current=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# Respect worktree/feature branches — those are intentional
case "$current" in
  main) exit 0 ;;
  ship/*|prototype/*|landing/*) exit 0 ;;
esac

# Skip if inside a worktree (not the main checkout)
git_common=$(git rev-parse --git-common-dir 2>/dev/null)
git_dir=$(git rev-parse --git-dir 2>/dev/null)
if [ "$git_common" != "$git_dir" ]; then
  exit 0
fi

# Detached HEAD: overnight.mjs intentionally detaches during runs (#469 prevention).
# If overnight is running, say so — don't ambush the user with a generic warning.
if [ "$current" = "HEAD" ]; then
  overnight_pid=$(pgrep -f "scripts/overnight.mjs" | head -1)
  if [ -n "$overnight_pid" ]; then
    overnight_args=$(ps -o args= -p "$overnight_pid" 2>/dev/null | sed -E 's/.*overnight\.mjs//' | awk '{$1=$1};1')
    echo "ℹ️  HEAD detached at main — overnight pipeline is running (PID $overnight_pid${overnight_args:+, args:$overnight_args})."
    echo "    Intentional (#469 prevention). HEAD will reattach automatically when the pipeline finishes."
    echo "    Safe to work in a worktree. Do not run git commands in this checkout."
    exit 0
  fi
  echo "⚠️  HEAD detached at main but no overnight pipeline is running — likely a crashed run."
  echo "    Reattach with: git checkout main  (use --ignore-other-worktrees if another worktree holds main)"
  exit 0
fi

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "⚠️  On branch '$current' with uncommitted changes. Expected 'main'. Leaving as-is."
  exit 0
fi

if git checkout main >/dev/null 2>&1; then
  git pull --ff-only origin main >/dev/null 2>&1 || true
  echo "ℹ️  Switched from '$current' to 'main' at session start."
fi

exit 0
