# Prototype Authoring Rules

This rule covers **authoring** (how to structure a new prototype so it's cheap to prune later).
For the **runtime model** (registry, `usePrototype` hook, dev-tools popover, staging gating), see `prototypes-sidebar.md`.

## Scope → pattern decision tree

Pick the lightest pattern that matches the scope of what actually differs between variants. Wrong pattern = expensive prune later.

| Variant differs in… | Pattern | Author time (3 variants) | Prune time (per loser) |
|---|---|---|---|
| Pure styling (color, spacing, typography) | Tailwind utility swap, optionally [CVA](https://cva.style/) | 1–3 min | 1–2 min |
| Component structure (logic, subcomponent arrangement) | File-per-variant + tiny dispatcher (`ProfilePage.variant-A.tsx`, `ProfilePage.variant-B.tsx`) | 5–7 min | 1–2 min (`rm` the file) |
| Page layout / data-fetch / metadata | Route-level split under `src/app/` (e.g. `src/app/landing-v7/` vs `src/app/landing-v8/`) | 15–20 min | 2–5 min (`rm -rf` the dir) |
| **Anti-pattern** | Inline ternaries deep inside a component with `usePrototype()` sprinkled at call sites | 2–3 min | 5–10 min (grep archaeology) |

If you find yourself writing `variant === 'a' ? <X/> : <Y/>` more than twice in one file, stop and lift to a file-per-variant dispatcher.

## Registry hygiene

- **Variant IDs are lowercase single letters**: `a`, `b`, `c`. No encoded drift (`a6`, `d4`, `v2-final` are banned — they're a sign someone iterated without pruning).
- **Registry entry and first call site ship in the same commit.** Never one without the other. A registry entry with no call sites is dead weight; a `usePrototype()` call with no registry entry returns `defaultVariant = ''` silently and is a footgun.
- The registry (`src/lib/prototypes.ts`) metadata ships in production bundles by design (needed for default resolution). Runtime UI is gated via `isStagingHost()`. Do not try to tree-shake it away — that path was rejected in #297.

## When you finish a prune

1. Use `/prototype-prune <id> <keep-variant>` — the skill rewrites call sites, simplifies constant expressions, deletes the registry entry, and drops orphaned variant files.
2. After the PR merges, check `~/.claude/projects/-Users-commandergoosey-Projects-axis/memory/MEMORY.md` for stale references to the removed prototype id and update or remove them.
3. Do not retroactively migrate existing prototypes to a different pattern. The registry's remaining entries are already in the right pattern for their scope.

## Out of scope

- Runtime fields on registry entries (`createdAt`, `scope`, `expiresAt`) — deferred.
- Custom ESLint rules enforcing this convention — intentional; this doc is the enforcement surface.
- `src/components/dev-tools/DevToolsRoot.tsx` — runtime model, do not edit here.
