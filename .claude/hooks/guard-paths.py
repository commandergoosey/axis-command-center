#!/usr/bin/env python3
"""Guard against path-scope mistakes on Edit/Write/MultiEdit.

Two checks run on every tool-use:

1. Worktree scope (always-on): when the session is inside a `.claude/worktrees/<name>`
   directory, block absolute paths that point at the MAIN workspace instead of the
   active worktree. The Edit tool doesn't honor Bash CWD — it resolves absolute
   paths literally, so edits silently land in the wrong tree.

2. Protected paths (always-on): block edits to paths matching the merged deny list
   from `protected-paths-base.json` (universal: secrets, .env*, .git/, *.key, *.pem)
   plus optional project-local `protected-paths.json`. Universal protections are
   security-critical and never opt-out.
"""

import fnmatch
import json
import os
import re
import sys


def check_worktree_scope(file_path: str):
    if not file_path or not os.path.isabs(file_path):
        return None

    pwd = os.environ.get("PWD") or os.getcwd()
    m = re.match(r"^(.+?)/\.claude/worktrees/([^/]+)(?:/|$)", pwd)
    if not m:
        return None

    project_root = m.group(1)
    worktree_root = f"{project_root}/.claude/worktrees/{m.group(2)}"

    if file_path == worktree_root or file_path.startswith(worktree_root + "/"):
        return None

    if not file_path.startswith(project_root + "/"):
        return None

    rel_inside_worktree = file_path[len(project_root) + 1:]
    return (
        f"BLOCKED: '{file_path}' targets the MAIN workspace while this session is in "
        f"worktree '{worktree_root}'. Edit ignores Bash CWD — absolute paths leak. "
        f"Use a relative path (e.g. '{rel_inside_worktree}') or the worktree-absolute "
        f"path ('{worktree_root}/{rel_inside_worktree}')."
    )


def load_deny_lists(hooks_dir: str):
    """Merge base + optional project-local protections. Missing project-local is fine."""
    deny_globs, deny_prefixes = [], []
    for name in ("protected-paths-base.json", "protected-paths.json"):
        path = os.path.join(hooks_dir, name)
        if not os.path.exists(path):
            continue
        try:
            with open(path) as f:
                cfg = json.load(f)
            deny_globs.extend(cfg.get("deny_globs", []))
            deny_prefixes.extend(cfg.get("deny_prefixes", []))
        except (OSError, json.JSONDecodeError):
            continue
    return deny_globs, deny_prefixes


def check_protected_paths(file_path: str, project_dir: str, deny_globs, deny_prefixes):
    if file_path.startswith(project_dir):
        rel = file_path[len(project_dir):].lstrip("/")
    else:
        rel = file_path

    basename = os.path.basename(rel)

    for glob in deny_globs:
        if fnmatch.fnmatchcase(basename, glob) or fnmatch.fnmatchcase(rel, glob):
            return f"BLOCKED: '{rel}' matches protected pattern '{glob}'. See .claude/hooks/protected-paths-base.json."

    for prefix in deny_prefixes:
        if rel.startswith(prefix) or rel == prefix.rstrip("/"):
            return f"BLOCKED: '{rel}' is under protected prefix '{prefix}'. See .claude/hooks/protected-paths-base.json."

    return None


def evaluate(file_path: str, project_dir: str, hooks_dir: str = None):
    """Return deny reason string, or None. Exposed for tests."""
    deny = check_worktree_scope(file_path)
    if deny:
        return deny

    if hooks_dir is None:
        hooks_dir = os.path.join(project_dir, ".claude", "hooks")
    deny_globs, deny_prefixes = load_deny_lists(hooks_dir)
    return check_protected_paths(file_path, project_dir, deny_globs, deny_prefixes)


def _emit_deny(reason: str):
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )


def main():
    try:
        data = json.load(sys.stdin)
        tool_input = data.get("tool_input", {})
        file_path = tool_input.get("file_path", "")
        if not file_path:
            return

        project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        if not project_dir.endswith("/"):
            project_dir += "/"

        hooks_dir = os.path.join(project_dir, ".claude", "hooks")
        deny = evaluate(file_path, project_dir, hooks_dir)
        if deny:
            _emit_deny(deny)
    except Exception:
        pass


if __name__ == "__main__":
    main()
