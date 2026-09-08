#!/usr/bin/env python3
"""Guard against pushes/PRs that violate the project's branch policy.

PreToolUse hook — reads JSON from stdin, outputs deny JSON to block.

Branch policy is read from `$CLAUDE_PROJECT_DIR/.claude/hooks/branch-policy.json`.
Schema fields:

  integration_branch                       — name of the branch PRs target
  block_push_targets                       — branch names that may not be pushed to directly
  block_pr_base_targets                    — branch names that may not be PR --base
  deploy_marker                            — a string in the command that bypasses guards (or null)
  require_pr_on_first_push                 — bool: force `gh pr create` paired with `git push -u`
  block_main_workspace_branch_creation     — bool: require worktrees for new feature branches
  main_workspace_allowed_branches          — branch names exempt from the worktree requirement
  main_workspace_allowed_prefixes          — branch prefixes (e.g. "prototype/") exempt
  block_commit_on_branches                 — branches you can't `git commit` on directly

Missing/malformed config → permissive (fail open). Behavior also fails open
on any internal exception so a hook bug never blocks legitimate work.

Test API: evaluate(cmd, policy, project_dir, is_main_workspace_override,
is_project_repo_override) is exposed for unit tests.
"""

import json
import os
import re
import shlex
import subprocess
import sys


def load_policy(hooks_dir):
    path = os.path.join(hooks_dir, "branch-policy.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _is_project_repo(cwd, project_dir):
    if not project_dir:
        return True
    try:
        common_dir = subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=cwd, stderr=subprocess.DEVNULL, timeout=5,
        ).decode().strip()
        base = cwd or os.getcwd()
        if not os.path.isabs(common_dir):
            common_dir = os.path.join(base, common_dir)
        repo_root = os.path.realpath(os.path.dirname(common_dir))
        return repo_root == os.path.realpath(project_dir)
    except Exception:
        return False


def _is_main_workspace(cwd):
    try:
        git_dir = subprocess.check_output(
            ["git", "rev-parse", "--git-dir"],
            cwd=cwd, stderr=subprocess.DEVNULL, timeout=5,
        ).decode().strip()
        common_dir = subprocess.check_output(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=cwd, stderr=subprocess.DEVNULL, timeout=5,
        ).decode().strip()
        base = cwd or os.getcwd()
        if not os.path.isabs(git_dir):
            git_dir = os.path.join(base, git_dir)
        if not os.path.isabs(common_dir):
            common_dir = os.path.join(base, common_dir)
        return os.path.realpath(git_dir) == os.path.realpath(common_dir)
    except Exception:
        return False


def strip_noise(cmd):
    cleaned = re.sub(
        r"<<-?\s*['\"]?(\w+)['\"]?.*?^\s*\1\s*$",
        "",
        cmd,
        flags=re.DOTALL | re.MULTILINE,
    )
    cleaned = re.sub(r"'[^']*'", "''", cleaned)
    prev = None
    while prev != cleaned:
        prev = cleaned
        cleaned = re.sub(r'"(?:\\.|[^"\\])*"', '""', cleaned)
    return cleaned


def _cd_prefix_cwd(cmd):
    m = re.match(r"cd\s+(\S+)\s*&&", cmd)
    if m:
        return m.group(1).strip('"').strip("'")
    return None


def _git_c_prefix_cwd(cmd):
    m = re.search(r"\bgit\s+-C\s+([^\s;&]+)", cmd)
    if m:
        return m.group(1).strip('"').strip("'")
    return None


def _command_cwd(cmd):
    return _git_c_prefix_cwd(cmd) or _cd_prefix_cwd(cmd)


def _shell_tokens(segment):
    try:
        return shlex.split(segment)
    except ValueError:
        return segment.split()


def _git_push_tokens(clean):
    pattern = re.compile(r"\bgit(?:\s+-C\s+\S+)*\s+push\b(?P<args>[^;&\n]*)")
    for match in pattern.finditer(clean):
        yield _shell_tokens(match.group("args"))


def _push_sets_upstream(clean):
    return any(
        token in ("-u", "--set-upstream")
        for tokens in _git_push_tokens(clean)
        for token in tokens
    )


def _ref_targets_branch(ref, branch):
    if not ref or ref.startswith("-"):
        return False
    destination = ref.lstrip("+")
    if ":" in destination:
        destination = destination.split(":", 1)[1]
    return destination in {
        branch,
        f"origin/{branch}",
        f"refs/heads/{branch}",
    }


def _push_targets_branch(clean, branch):
    return any(
        _ref_targets_branch(token, branch)
        for tokens in _git_push_tokens(clean)
        for token in tokens
    )


def _gh_pr_create_tokens(clean):
    pattern = re.compile(
        r"\bgh(?:\s+(?:-R|--repo)\s+\S+)*\s+pr\s+create\b(?P<args>[^;&\n]*)"
    )
    for match in pattern.finditer(clean):
        yield _shell_tokens(match.group("args"))


def _pr_base_targets_any(clean, branches):
    if not branches:
        return False
    branch_set = set(branches)
    for tokens in _gh_pr_create_tokens(clean):
        for index, token in enumerate(tokens):
            base = None
            if token == "--base" and index + 1 < len(tokens):
                base = tokens[index + 1]
            elif token.startswith("--base="):
                base = token.split("=", 1)[1]
            elif token == "-B" and index + 1 < len(tokens):
                base = tokens[index + 1]
            if base in branch_set:
                return True
    return False


def _branch_in_allowlist(branch, allowed_branches, allowed_prefixes):
    bare = re.sub(r"^(origin/|refs/heads/)", "", branch)
    if bare in allowed_branches:
        return True
    for prefix in allowed_prefixes:
        if bare.startswith(prefix):
            return True
    return False


def evaluate(cmd, policy, project_dir=None,
             is_main_workspace_override=None,
             is_project_repo_override=None):
    """Return deny reason string, or None.

    `policy`: dict matching the schema in this file's docstring. None or
    falsy → no enforcement.
    `project_dir`: absolute path to the project root (typically
    $CLAUDE_PROJECT_DIR). Used to scope guards to this project's repo so
    sibling repos targeting their own conventions aren't blocked.
    """
    if not policy:
        return None

    deploy_marker = policy.get("deploy_marker")
    if deploy_marker and deploy_marker in cmd:
        return None

    clean = strip_noise(cmd)

    if is_project_repo_override is not None:
        in_project = is_project_repo_override
    else:
        in_project = _is_project_repo(_command_cwd(cmd), project_dir)
    if not in_project:
        return None

    integration_branch = policy.get("integration_branch", "main")

    # Block direct pushes to listed branches. Integration branch gets a
    # specific message because the rule there is "open a PR" rather than
    # "use the upstream promotion path".
    for branch in policy.get("block_push_targets", []):
        if _push_targets_branch(clean, branch):
            if branch == integration_branch:
                return (
                    f"BLOCKED: Never push directly to {integration_branch}. "
                    "Create a feature branch and open a PR instead."
                )
            return (
                f"BLOCKED: Pushing to '{branch}' is not allowed. "
                f"All work targets {integration_branch} via feature branch PRs."
            )

    if _pr_base_targets_any(clean, policy.get("block_pr_base_targets", [])):
        return (
            f"BLOCKED: PRs must target {integration_branch}. "
            f"Use --base {integration_branch}."
        )

    if policy.get("require_pr_on_first_push", True) and _push_sets_upstream(clean):
        if not re.search(r"gh\s+pr\s+create\b", clean):
            return (
                "BLOCKED: First-time branch pushes must open a PR in the "
                "same command. Use: "
                f"git push -u origin <branch> && "
                f"gh pr create --base {integration_branch} --title '...' --body '...'"
            )

    if policy.get("block_main_workspace_branch_creation", True):
        target = None
        git_prefix = r"git(?:\s+-C\s+\S+)*"
        m = re.search(rf"{git_prefix}\s+checkout\s+-[bB]\s+([^\s;&]+)", clean)
        if m:
            target = m.group(1)
        else:
            m = re.search(rf"{git_prefix}\s+switch\s+-[cC]\s+([^\s;&]+)", clean)
            if m:
                target = m.group(1)
            else:
                m = re.search(rf"{git_prefix}\s+switch\s+(?!-)([^\s;&]+)", clean)
                if m:
                    target = m.group(1)
        if target:
            allowed_branches = policy.get("main_workspace_allowed_branches", [])
            allowed_prefixes = policy.get("main_workspace_allowed_prefixes", [])
            if not _branch_in_allowlist(target, allowed_branches, allowed_prefixes):
                if is_main_workspace_override is not None:
                    in_main = is_main_workspace_override
                else:
                    in_main = _is_main_workspace(_command_cwd(clean))
                if in_main:
                    return (
                        "BLOCKED: Don't create/switch branches in the main workspace. "
                        f"Create a worktree: "
                        f"git worktree add .claude/worktrees/<name> -b {target} origin/{integration_branch}"
                    )

    block_commit = policy.get("block_commit_on_branches", [])
    if block_commit and re.search(r"git\s+commit\b", clean):
        try:
            cwd = _command_cwd(clean)
            branch = subprocess.check_output(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                cwd=cwd, stderr=subprocess.DEVNULL, timeout=5,
            ).decode().strip()
            if branch in block_commit:
                return (
                    f"BLOCKED: Cannot commit directly on '{branch}'. "
                    "Create a feature branch first: git checkout -b ship/<name>. "
                    f"Then commit, push, and open a PR to {integration_branch}."
                )
        except Exception:
            pass

    return None


def main():
    try:
        data = json.load(sys.stdin)
        cmd = data.get("tool_input", {}).get("command", "")
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        hooks_dir = os.path.join(project_dir, ".claude", "hooks")
        policy = load_policy(hooks_dir)
        deny = evaluate(cmd, policy, project_dir=project_dir)
        if deny:
            json.dump(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "deny",
                        "permissionDecisionReason": deny,
                    }
                },
                sys.stdout,
            )
    except Exception:
        pass


if __name__ == "__main__":
    main()
