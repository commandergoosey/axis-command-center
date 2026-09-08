# Rules

Path-scoped guardrails. Claude Code activates a rule file when a tool call touches a path matched by a glob declared inside the rule's frontmatter. Rules are advisory context, not enforcement — see the caveat below.

## Conventions

- **Naming**: kebab-case, `.md`. The filename is the slug (e.g. `post-ship-fetch.md`).
- **Triggering**: each rule declares a glob (or list of globs). When a matching path appears in a tool call, the rule's body is injected into context.
- **Scope**: tactical, per-path gotchas. If the rule is project-wide and unconditional, it belongs in `CLAUDE.md`, not here.

## Don't pre-populate

The ETH Zurich Feb 2026 study on Claude Code rule files found that templated, cargo-culted rule directories cost roughly **+20% tokens per session with negligible success-rate gain**. Rules are most effective when they encode lessons learned from real incidents in your codebase.

**Grow this directory from work, not from templates.** When a bug or footgun bites you twice in the same area of the code, write the rule. Until then, leave the directory thin.

## Universal seeds shipped with this template

Two rules ship by default. Both are project-agnostic. Delete either if it doesn't apply.

- **`post-ship-fetch.md`** — runs `git fetch origin <integration-branch>` after every merge so the next branch cut starts from fresh code. Universal — applies to both single-branch and staging-as-integration-branch models.
- **`prototypes-authoring.md`** — conventions for authoring throwaway UI variants behind a prototype registry. **Delete this if your project has no prototype registry** (no `usePrototype` hook, no `src/lib/prototypes.ts`). It's meaningless without that runtime infrastructure.

## Caveat: rules don't fire in subagents

Path-scoped rules currently do not activate inside subagent (Task tool) invocations — see [anthropics/claude-code#32906](https://github.com/anthropics/claude-code/issues/32906). For hard enforcement (must-not-violate invariants, security gates), use hooks in `.claude/hooks/` instead. Rules are best for "remind me when I'm editing this area" guidance, not safety-critical checks.
