# Update Documentation

You are updating documentation after code changes. This runs on the feature branch before Ship.

Run after `/zv08-qa`, before `/zv10-ship`.

## 1. Identify Changes
- Check git diff or recent commits for modified files
- Identify which features/modules were changed
- Note any new files, deleted files, or renamed files

## 2. Verify Current Implementation
**CRITICAL**: DO NOT trust existing documentation. Read the actual code.

For each changed file:
- Read the current implementation
- Understand actual behavior (not documented behavior)
- Note any discrepancies with existing docs

## 3. Update Relevant Documentation

- **CHANGELOG.md**: Add entry under "Unreleased" section
  - Use categories: Added, Changed, Fixed, Security, Removed
  - Be concise, user-facing language

## 4. Update CLAUDE.md / Rules
If architecture decisions changed during this work:
- Update `CLAUDE.md` with new conventions, commands, or gotchas
- Update relevant `.claude/rules/` files if domain-specific rules changed
- Update auto-memory (`~/.claude/projects/*/memory/MEMORY.md`) if significant patterns were discovered

## 4.5. Update Wiki Pages

Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md` and identify wiki pages affected by this work.

For each changed area, check if wiki pages need updating:

| Change Type | Wiki Page |
|---|---|
| Architecture decision or new pattern | `engineering/architecture.md` |
| Schema/migration changes | `engineering/data-model.md` |
| New debugging insight or resolved gotcha | `engineering/troubleshooting.md` |
| Test strategy changes | `engineering/testing-strategy.md` |
| Deployment process changes | `engineering/deployment.md` |
| Prototype added/changed | `engineering/prototypes.md` |
| New term or naming convention | `engineering/domain-glossary.md` |

When updating:
- Read the actual code (Step 2 already did this) — don't rely on wiki's existing description
- Add/update the relevant section with current behavior
- Add attribution: `(updated: YYYY-MM-DD, #XX)`
- Update "Last updated" date
- Add cross-references if new connections exist

**Don't update for:**
- Trivial changes that don't alter documented behavior
- Bug fixes that don't change the mental model
- Changes already captured in CLAUDE.md gotchas (Step 4)

Max 3 wiki pages per session. If more need updating, note them in carry-forward.

## 5. Journal Cleanup

If the issue shipped successfully, check `.overnight/journals/{id}.md` (lowercase issue ID). If it exists and contains only a header plus a single success entry, delete it — it has no dead-end value. Otherwise, append a final entry:

```
## YYYY-MM-DD — Shipped
- Outcome: shipped
- Lessons: one-line summary of anything worth remembering (or "n/a")
```

## 6. Save Change Log
Save a local record to `ai/zv/changelogs/YYYY-MM-DD-<short-slug>.md` (create directories if needed). Include what changed, which files were touched, and why.

## 7. Commit

Stage and commit doc changes locally. Do NOT push — Ship handles that.

```bash
git add -A
git commit -m "docs: update documentation for <issue-id>"
```

## 8. Documentation Style Rules

- **Concise** — Sacrifice grammar for brevity
- **Practical** — Examples over theory
- **Accurate** — Code verified, not assumed
- **Current** — Matches actual implementation

- No enterprise fluff
- No outdated information
- No assumptions without verification

## 9. Ask if Uncertain
If you're unsure about intent behind a change or user-facing impact, **ask the user** — don't guess.
