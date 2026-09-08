#!/usr/bin/env python3
"""Tests for guard-branches.py evaluate() against both flavor policies.

Run: python3 test_guard_branches.py
Exits 0 on pass, 1 on any failure. No pytest dependency.
"""

import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_module():
    from importlib.machinery import SourceFileLoader
    loader = SourceFileLoader("guard_branches", os.path.join(HERE, "guard-branches.py"))
    spec = importlib.util.spec_from_loader("guard_branches", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def _load_policy(name):
    return json.load(open(os.path.join(HERE, name)))


STAGING = {
    "integration_branch": "staging",
    "block_push_targets": ["main", "master", "staging"],
    "block_pr_base_targets": ["main", "master"],
    "deploy_marker": "# myproj-deploy",
    "require_pr_on_first_push": True,
    "block_main_workspace_branch_creation": True,
    "main_workspace_allowed_branches": ["staging", "main", "master"],
    "main_workspace_allowed_prefixes": ["prototype/", "landing/"],
    "block_commit_on_branches": ["staging", "main", "master"],
}

MAIN = {
    "integration_branch": "main",
    "block_push_targets": ["main", "master"],
    "block_pr_base_targets": [],
    "deploy_marker": None,
    "require_pr_on_first_push": True,
    "block_main_workspace_branch_creation": True,
    "main_workspace_allowed_branches": ["main", "master"],
    "main_workspace_allowed_prefixes": ["prototype/", "landing/"],
    "block_commit_on_branches": ["main"],
}


CASES = [
    # (label, cmd, policy, expect_block, kwargs)
    ("staging: block direct push to main",
     "git push origin main", STAGING, True, {"is_project_repo_override": True}),
    ("staging: block direct push to staging",
     "git push origin staging", STAGING, True, {"is_project_repo_override": True}),
    ("staging: block PR --base main",
     "gh pr create --base main --title x --body y", STAGING, True, {"is_project_repo_override": True}),
    ("staging: allow PR --base staging with -u push",
     "git push -u origin ship/x && gh pr create --base staging --title x --body y", STAGING, False, {"is_project_repo_override": True}),
    ("staging: -u push without gh pr create",
     "git push -u origin ship/x", STAGING, True, {"is_project_repo_override": True}),
    ("staging: deploy marker bypasses",
     "git push origin main # myproj-deploy", STAGING, False, {"is_project_repo_override": True}),
    ("staging: out of project — no enforcement",
     "git push origin main", STAGING, False, {"is_project_repo_override": False}),
    ("staging: block branch creation in main workspace",
     "git checkout -b ship/x", STAGING, True, {"is_project_repo_override": True, "is_main_workspace_override": True}),
    ("staging: allow branch creation in worktree",
     "git checkout -b ship/x", STAGING, False, {"is_project_repo_override": True, "is_main_workspace_override": False}),
    ("staging: allow prototype/ in main workspace",
     "git checkout -b prototype/x", STAGING, False, {"is_project_repo_override": True, "is_main_workspace_override": True}),
    ("staging: feature/staging-fix in src ref doesn't false-trip",
     "git push origin feature/staging-fix:feature/staging-fix", STAGING, False, {"is_project_repo_override": True, "is_main_workspace_override": False}),
    ("staging: literal main inside quotes doesn't false-trip",
     "echo 'this rule says git push origin main is bad'", STAGING, False, {"is_project_repo_override": True}),

    ("main: block direct push to main",
     "git push origin main", MAIN, True, {"is_project_repo_override": True}),
    ("main: PR --base main is allowed",
     "git push -u origin ship/x && gh pr create --base main --title x --body y", MAIN, False, {"is_project_repo_override": True}),
    ("main: -u push without gh pr create blocked",
     "git push -u origin ship/x", MAIN, True, {"is_project_repo_override": True}),
    ("main: no deploy marker means no bypass",
     "git push origin main # anything-deploy", MAIN, True, {"is_project_repo_override": True}),
    ("main: block branch creation in main workspace",
     "git checkout -b ship/x", MAIN, True, {"is_project_repo_override": True, "is_main_workspace_override": True}),
    ("main: allow main checkout in main workspace (recovery)",
     "git checkout -b main", MAIN, False, {"is_project_repo_override": True, "is_main_workspace_override": True}),
    ("main: out of project — no enforcement",
     "git push origin main", MAIN, False, {"is_project_repo_override": False}),

    ("no policy → no enforcement",
     "git push origin main", None, False, {"is_project_repo_override": True}),
    ("empty policy → no enforcement",
     "git push origin main", {}, False, {"is_project_repo_override": True}),
]


def main():
    mod = _load_module()
    fails = []
    for label, cmd, policy, expect_block, kwargs in CASES:
        deny = mod.evaluate(cmd, policy, project_dir="/tmp/_unused", **kwargs)
        actual_block = deny is not None
        if actual_block != expect_block:
            fails.append((label, cmd, expect_block, deny))

    # Validate the on-disk policies match expected schema
    on_disk_staging = _load_policy("branch-policy.json")
    assert isinstance(on_disk_staging, dict), "branch-policy.json should parse as object"
    for key in ("integration_branch", "block_push_targets", "block_pr_base_targets"):
        assert key in on_disk_staging, f"branch-policy.json missing '{key}'"

    if fails:
        print(f"FAIL ({len(fails)}/{len(CASES)}):")
        for label, cmd, expect, deny in fails:
            print(f"  - {label}")
            print(f"    cmd:    {cmd}")
            print(f"    expect: {'BLOCK' if expect else 'ALLOW'}")
            print(f"    got:    {deny if deny else 'ALLOW'}")
        sys.exit(1)

    print(f"PASS ({len(CASES)}/{len(CASES)})")


if __name__ == "__main__":
    main()
