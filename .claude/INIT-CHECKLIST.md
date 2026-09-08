# Claude stack scaffolded — review checklist

Cloned from canonical `production` template on 2026-06-14.

- Source: `/Users/commandergoosey/Projects/zv-frontend-skill-pack/claude-stack/claude-stack-templates/production/.claude/`
- Target: `/tmp/scaf.GAHnhs/.claude/`

Substitutions applied:
- `STARTER_PROJECT_NAME` → `axis`
- `STARTER_PROJECT_TITLE` → `AXIS Command Center`
- `STARTER_PRODUCTION_URL` — **not provided**, placeholder left in place

## Author your project's `CLAUDE.md`

The templates assume a four-line `CLAUDE.md` at the repo root summarizing the project. Add (or merge into) `CLAUDE.md`:

```
Project: <one-line description>
Stack: <runtime, framework, host>
Repo: <github org/repo> | Package: <package-manager + lockfile>
Database: <postgres/sqlite/...> | Tracker: <github issues/linear/...>
```

This is the canonical handle the agent uses to orient on first contact. Keep it tight.

## Hooks

- `.claude/hooks/protected-paths-base.json` — universal deny list (`.env*`, `*.key`, `*.pem`, `secrets/`, `.git/`). Do not edit.
- **Optional**: create `.claude/hooks/protected-paths.json` (sibling, project-local) to extend the deny list with project-specific globs and prefixes. The hook auto-merges both files. Same schema:

  ```json
  { "deny_globs": ["seed-*.sql"], "deny_prefixes": ["infra/secrets/"] }
  ```

- `.claude/hooks/branch-policy.json` — branch enforcement config. Review the `deploy_marker`, `block_*`, and `main_workspace_*` keys; they default to sensible values for this flavor.

## Rules

`.claude/rules/` ships with a couple of universal seeds (`post-ship-fetch.md`, `prototypes-authoring.md`). Delete any that don't apply to this project. **Do not pre-populate this directory by copying rules from other projects** — the ETH Zurich Feb 2026 study found cargo-culted rule files cost ~+20% tokens per session with negligible success-rate gain. Rules should grow from real incidents in this codebase.

## Settings

- `.claude/settings.json` — hook wiring. Generally fine as shipped. The permissions allowlist in your global `settings.local.json` covers most needs.
- `.claude/settings.local.json` was **not** copied (gitignored, contains personal allowlists).

## Wiki location

This project's wiki lives at:
```
~/projects/shared-knowledge/wiki/projects/axis/
```
Create this directory if absent.

## Next steps

1. Write `CLAUDE.md` at the repo root using the four-line schema above.
2. Replace any unsubstituted placeholders listed above.
3. Decide whether you need a project-local `protected-paths.json`.
4. Trim `.claude/rules/` to only what applies.
5. Set up `~/projects/shared-knowledge/wiki/projects/<name>/` if absent.
6. `git add .claude/ && git commit -m "chore: scaffold .claude/ from canonical templates"`.
7. Delete this checklist file when done.
