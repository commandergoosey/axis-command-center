# Glossary Format

**Locate the existing glossary first.** Read `CLAUDE.md` for its path (commonly `wiki/engineering/domain-glossary.md`, `docs/glossary.md`, or a `CONTEXT.md` at the repo root). Update it inline as terms resolve. Do not create a parallel file.

This format applies whether you're reading, updating, or (for a greenfield section) seeding the glossary.

## Structure

```md
# <Project> Domain Glossary

{One or two sentence description of what this glossary covers.}

## Language

**<Entity>**:
A one-sentence definition of what this entity IS in the domain.
_Avoid_: <legacy alias>, <fuzzy alias>

**<Aggregate>**:
A one-sentence definition. State the lifecycle if relevant (e.g. draft → active → archived).
_Avoid_: <fuzzy alias>

**<ChildEntity>**:
A one-sentence definition stated in terms of its parent aggregate.
_Avoid_: <legacy alias>

## Relationships

- An **<Aggregate>** owns one or more **<ChildEntity>**
- A **<ChildEntity>** has one or more **<LeafEntity>**
- A **<CrossCuttingEntity>** spans multiple **<Aggregate>**

## Example dialogue

> **Dev:** "When all `<LeafEntity>` rows are marked done, does the **<ChildEntity>** auto-close?"
> **Domain expert:** "No — it stays open until a human signs off. The leaf count is a progress indicator, not a completion gate."

## Flagged ambiguities

- "<legacy alias>" is still used in the UI and legacy DB foreign keys (e.g. `<entity>_table`) but the canonical term is **<Entity>**. Both appear — resolved: **<Entity>** is the name going forward; the legacy column is a rename-debt artefact.
```

> **Concrete shape (illustrative only — replace with your project's actual entities):** an e-commerce app might use `Order` → `LineItem` → `Product`, with `Customer` as the owning aggregate. Use whatever your project calls them; the placeholders above are just slots.

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to your project's domain.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Industry-specific terms, the entity hierarchy, and role/permission names qualify. Generic React / Supabase / TypeScript vocabulary does not.
- **Group terms under subheadings** when natural clusters emerge (e.g. "Entities", "Spatial", "Roles & Auth"). If the glossary is still small, a flat list is fine.
- **Write an example dialogue.** A conversation that demonstrates how the terms interact naturally and clarifies boundaries between related concepts.

## Single vs multi-context

Most projects are single-context. Do **not** create a `CONTEXT-MAP.md` unless the project has genuinely separate bounded contexts (multiple services, different teams, distinct ubiquitous languages). Do **not** split the glossary by feature area. If the glossary grows large, use subheadings inside the single file.
