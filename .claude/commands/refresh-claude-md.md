# Claude Memory Refresh
> Periodic maintenance. Run `/refresh-claude-md` to audit CLAUDE.md, `.claude/rules/`, and auto-memory files. Keeps context lean so every session starts clean.

## Goal
Optimize the three layers of Claude's project memory:
1. **`CLAUDE.md`** (<80 lines) — commands, critical rules, gotchas
2. **`.claude/rules/*.md`** — path-scoped subsystem deep dives, loaded on demand
3. **Auto-memory** (`~/.claude/projects/<project>/memory/`) — learned patterns, persists across sessions (first 200 lines of `MEMORY.md` load every session)

Principle: no redundancy across layers. Each fact lives in exactly one place.

## Step 0: Research Best Practices

Before auditing, check if our setup still aligns with current best practices:
- Use Perplexity (`perplexity_research`) to search for current Claude Code CLAUDE.md, rules, and memory best practices
- Focus on: loading behavior changes, new features, community patterns, anti-patterns
- Compare findings against our current setup — flag any gaps or outdated patterns
- Only make changes backed by concrete evidence, not speculative improvements

## Step 1: Read All Memory Layers (parallel)

Read these files in parallel:
- `CLAUDE.md`
- `~/.claude/CLAUDE.md` (global)
- `.claude/rules/*.md`
- `~/.claude/rules/*.md` (global rules)
- `~/.claude/projects/<project>/memory/MEMORY.md`
- `~/.claude/projects/<project>/memory/*.md` (topic files)
- `package.json` scripts section (source of truth for commands)

## Step 2: Review Project State

- `git log --oneline -20` — recent activity
- Scan top-level dirs and key subdirectories
- Identify new subsystems, major refactors, or deleted features since last refresh

## Step 3: Audit & Rewrite

### Layer 1: Root CLAUDE.md
For each line ask: *"Would removing this cause Claude to make mistakes?"* If not, cut it.

**Must include:**
- 1-line project description + tech stack (non-obvious choices only)
- **All** runnable scripts/commands (the #1 thing Claude can't guess)
- Architecture decisions that deviate from defaults
- Gotchas, env deps, path quirks
- Commit style (if convention exists)

**Must NOT include:**
- Directory trees, file lists (Claude has Glob/Grep)
- Code conventions (Claude reads existing code)
- Subsystem architecture (goes in `.claude/rules/`)
- Learned patterns (goes in auto-memory)

### Layer 2: Rules Files (`.claude/rules/`)
- Create/update rules for subsystems with >3 non-obvious behaviors
- Delete rules for subsystems that no longer exist
- Verify all referenced file paths still exist (use Glob)
- Keep each file focused, 20-30 lines

**`paths:` frontmatter audit:**
- Every rules file MUST have YAML `paths:` frontmatter unless it genuinely applies to every session
- Rules that only matter for specific file types must be scoped (e.g., design guardrails → `*.tsx`, migrations → `*.sql`)
- Unscoped rules waste tokens on irrelevant sessions
- Only leave a rule unscoped if it defines behavior/workflow that shapes every interaction (e.g., CTO workflow, execution defaults)

- No overlap with CLAUDE.md or auto-memory

### Layer 3: Auto-Memory

**Orphaned file detection:**
- List all `memory/*.md` files (excluding MEMORY.md)
- Cross-reference against links in MEMORY.md
- Any file not linked in MEMORY.md is orphaned — either index it or delete it

**Audit MEMORY.md:**
- Remove entries that duplicate CLAUDE.md or rules files (those already load eagerly)
- Remove stale entries (features deleted, patterns changed)
- Remove entries Claude can infer from reading code (implementation details belong in code, not memory)
- Keep: workflow preferences, non-obvious learned patterns, project-specific quirks, business context
- Keep it under 50 lines — every line costs context in every session

**Audit topic files (`memory/*.md`):**
- These load on demand (not every session) — can be longer
- Remove stale content, consolidate small files
- Delete empty or single-line files (not worth the overhead)
- For memories that state facts about code (file paths, function names, flags): verify they still exist before keeping

### Redundancy Matrix
Check for facts that appear in multiple places:

| Fact | Should live in |
|------|---------------|
| Commands/scripts | CLAUDE.md only |
| Critical rules (singleton, no console.log) | CLAUDE.md only |
| Subsystem architecture | `.claude/rules/` only |
| Gotchas about specific subsystems | `.claude/rules/` only |
| Project-wide gotchas | CLAUDE.md only |
| Learned patterns from past sessions | Auto-memory only |
| Workflow preferences | Auto-memory only |
| Business/pricing/client context | Auto-memory only |
| The *why* behind a CLAUDE.md rule | Auto-memory (keeps CLAUDE.md lean) |

If a fact appears in 2+ places, keep it in the highest-priority layer and delete from others.

### Checklist Before Writing
- [ ] Every package.json script is in CLAUDE.md Commands section
- [ ] No directory trees or file lists in CLAUDE.md
- [ ] No code conventions Claude can infer
- [ ] Rules files have `paths:` frontmatter (unless genuinely global)
- [ ] Rules files reference valid file paths
- [ ] Root CLAUDE.md is under 80 lines
- [ ] MEMORY.md is under 50 lines (concise = less context burn)
- [ ] No orphaned memory files (every .md indexed or deleted)
- [ ] No fact duplicated across layers
- [ ] No stale entries in any layer

## Step 4: Verify & Commit

1. `wc -l CLAUDE.md .claude/rules/*.md` — verify line counts
2. `wc -l` on memory files — verify MEMORY.md is lean
3. List orphaned files one more time to confirm none remain
4. Commit CLAUDE.md and rules changes: `docs: refresh CLAUDE.md and rules files`
5. (Auto-memory changes don't need a commit — they're outside the repo)

## When to Run This
- After completing a major feature
- After deleting or archiving a subsystem
- Monthly as general hygiene
- When context feels bloated or Claude is repeating known info
- When CLAUDE.md exceeds 80 lines or MEMORY.md exceeds 50 lines
