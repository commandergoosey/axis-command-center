# Exploration Stage

Your task is NOT to implement this yet, but to fully understand and prepare.

## Wiki Context Load

Before exploring the codebase, load relevant prior knowledge:

1. Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`
2. Based on the issue description and affected area, identify 2-3 relevant wiki pages (max 3):
   - Bug in auth/hydration → `troubleshooting.md` + `architecture.md`
   - Schema change → `data-model.md` + `architecture.md`
   - UI component work → `architecture.md` (state management section)
   - Map/rendering → `architecture.md` (dual renderers) + `troubleshooting.md`
   - Business context needed → relevant business page
3. Read those pages. Note any relevant prior issues, dead ends, or architectural constraints
4. Keep wiki context in mind throughout exploration — avoid repeating documented mistakes

This step is silent — no output to the user. Just load context before diving in.

## Your Responsibilities

Use the **Explore subagent** (Agent tool with `subagent_type: "Explore"` and thoroughness "very thorough") to research the codebase. Launch multiple Explore agents in parallel for independent questions (e.g., one for affected files, one for dependencies, one for similar patterns). This keeps exploration output out of the main context window.

- Determine exactly how this feature integrates, including dependencies, structure, edge cases (within reason), and constraints.
- Clearly identify anything unclear or ambiguous in the user's description or the current implementation.
- List clearly all questions or ambiguities you need clarified.

**Do NOT implement anything.** Just explore, ask questions, and build understanding. We will go back and forth until you have no further questions. Do NOT assume any requirements or scope beyond explicitly described details.

## Prior Art & Research

After understanding the codebase, **search the web** for how similar features have been built elsewhere. This step is especially valuable for UI/UX features, common patterns, and well-solved problems.

- **Similar products** — Find established tools that solve the same problem (e.g. Canva, Figma, Notion for a builder; Stripe for payments). Note specific UX patterns worth borrowing.
- **Open source implementations** — Search GitHub for repos that implement similar features. Link to specific files/approaches worth studying.
- **Libraries** — Identify packages that could accelerate implementation (e.g. react-dnd, interact.js, Konva). Note tradeoffs vs building from scratch.
- **UI/UX patterns** — Reference design patterns from established products. What do users expect?

Keep this pragmatic — focus on things that would actually change our approach or save time. Skip if the task is purely internal/unique to our codebase (e.g. a bug fix with no external parallels).

## Issue Context

If working from a triaged issue, reference the GitHub issue number (e.g. #42) throughout your exploration.

## Structured Output

After exploration is complete and all questions are resolved, save a structured exploration document to `ai/zv/explorations/YYYY-MM-DD-<short-slug>.md`. Use today's date and a kebab-case slug.

Include these sections:

```markdown
# Exploration: [Feature/Bug Name]
**Issue:** #42 (if applicable)
**Date:** YYYY-MM-DD

## Summary
1-2 sentence description of what we're building/fixing.

## Affected Files
| File | Role |
|------|------|
| `path/to/file.ts` | Brief description of what this file does in context |

## Dependencies
- **Upstream:** What feeds into this (APIs, data sources, user input)
- **Downstream:** What this affects (UI, other modules, exports)

## Edge Cases
- Edge case 1: description
- Edge case 2: description

## Prior Art
- **[Product/Repo Name]** — what we can learn from it, link
- **[Library Name]** — what it does, tradeoff vs DIY

## Risks
- Risk 1: what could go wrong and potential mitigation
- Risk 2: what could go wrong and potential mitigation

## Open Questions
- [RESOLVED] Question 1 — Answer
- [RESOLVED] Question 2 — Answer

## Decisions Made
- Decision 1: [choice] — [rationale]
- Decision 2: [choice] — [rationale]
```

## Wiki Enrichment

After saving the exploration document, assess whether your findings enrich existing wiki pages:

**Update if you discovered:**
- How a subsystem actually works (vs. how it's documented) → `architecture.md`
- A debugging insight or gotcha → `troubleshooting.md`
- Schema relationships not in the data model → `data-model.md`
- A term or concept that's ambiguous → `domain-glossary.md`

**Don't update for:**
- Issue-specific analysis (that stays in the exploration doc)
- Speculative findings ("I think X might cause Y")
- Anything already covered in the wiki

If updating, modify max 3 wiki pages. Add attribution: `(discovered: YYYY-MM-DD, explore: #XX)`. Update the page's "Last updated" date.

Please confirm you understand, and the user will describe the problem/feature.
