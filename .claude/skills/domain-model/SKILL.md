---
name: domain-model
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (domain glossary + ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against the project's language and documented decisions. Supersedes /grill-me.
disable-model-invocation: true
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Domain awareness

Before grilling, locate the project's domain documentation. Layout varies — read the project's `CLAUDE.md` first to find:

- The **glossary** path (commonly `wiki/engineering/domain-glossary.md`, `docs/glossary.md`, or a `CONTEXT.md` at the repo root)
- The **ADR directory** (commonly `docs/decisions/`, `docs/adr/`, or `docs/architecture/decisions/`)
- The project's **stack** (the `Stack:` line in `CLAUDE.md` is the canonical contract for framework, DB, and language conventions)

If neither glossary nor ADR directory exists yet, ask the user where they want them before seeding.

Update existing docs inline as terms resolve — don't create parallel files. Match the numbering scheme already in use for ADRs (scan for the highest existing `NNNN-*.md` and increment).

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in the glossary, call it out immediately. "The glossary defines `<Entity>` as X, but you seem to mean Y — which is it?"

Many projects have terminology tensions between UI labels, DB column names, and legacy foreign keys. If the user's plan straddles that boundary, surface it. Check `CLAUDE.md` and the glossary's "Flagged ambiguities" section for known tensions before grilling.

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying `account` — do you mean the `<Organization>` or the `<UserProfile>`? Those are different things in this project."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts. (Example shape: `<Aggregate>` → `<Child>` → `<GrandChild>`; orthogonal overlays modelled as `<CrossCuttingEntity>`.)

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "You just said deletes are soft, but `src/lib/<entity>/delete.ts` hard-deletes — which is right?"

Relevant guardrail docs worth checking: `.claude/rules/*.md` (tactical per-path gotchas), `CLAUDE.md` (critical rules, API auth helpers, mutation routing).

### Update the glossary inline

When a term is resolved, update the glossary right there. Don't batch these up — capture them as they happen. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md). New ADRs land in the project's ADR directory under the next sequential `NNNN-slug.md`.
