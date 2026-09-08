# Research Pipeline Deep — Codebase-Grounded Architecture Research

Heavy version of `/research-pipeline` for the user's **most challenging architectural problems**: stack decisions, concurrency models, security rewrites, data model overhauls, vendor lock-in calls — anything where being wrong costs months.

**The defining feature:** before any external research happens, **subagents deeply explore the codebase** to ground the questions in reality. Generic research → generic answers. Research anchored to *what we have, what we've tried, what we ruled out, what constraints are real* → load-bearing recommendations.

The pipeline:

```
Phase 0  Cost preview & confirmation
Phase 1  Frame the problem (1-2 sentences, what decision is being made)
Phase 2  CODEBASE DEEP DIVE (parallel subagents) ←── the differentiator
         ├─ Current state: what exists, file:line evidence
         ├─ History: what's been tried, what was reverted, why
         ├─ Constraints: stack, infra, team size, budget, deadlines
         └─ Optional: /codex-diagnose if there's a specific failure to root-cause
Phase 3  Generate research questions anchored to Phase 2 findings
Phase 4  Deep Perplexity research (sequential, perplexity_research)
Phase 5  Firecrawl targeted extraction
Phase 6  Synthesis: codebase context + research → verdict + phased plan + UX copy
Phase 7  Save research doc + wiki ingest (default ON)
Phase 8  Suggest next step (/zv04-plan or /codex-argue for irreversible decisions)
```

Use `/research-pipeline` (regular) for "what libraries exist for X" / "what's the current best practice." Use this when the answer will lock in months of engineering.

---

## Arguments

- **topic** — what to research (required; if missing, infer from recent conversation and confirm)
- **--issue #N** — GitHub issue to anchor (recommended — gives the codebase agents a focal point)
- **--questions "Q1" "Q2" ...** — pre-defined research questions (skip Phase 3 framing, but still run Phase 2 codebase dive)
- **--skip-codebase** — skip Phase 2 (use only when researching a *brand new* capability with no existing code surface, e.g., evaluating a 3rd-party SDK before any integration). Default: run Phase 2.
- **--urls URL1 URL2 ...** — pre-selected extraction targets (still runs discovery for the rest)
- **--no-wiki** — opt out of wiki ingest (default is to ingest)
- **--wiki-kb engineering|business** — which wiki KB to target (default: auto-detect)

---

## Phase 0: Cost preview

Before any tool calls, show the user:

> **Deep research budget preview:**
> - Phase 2 (codebase): 2-4 parallel subagents (~free, ~2-3 min)
> - Phase 4 (Perplexity): {N} deep queries (sequential, ~30-60s each, ~$0.50-1.00 each)
> - Phase 5 (Firecrawl): up to 6 extractions (~free)
> - **Total: ~${N×0.75} and ~{N×45s + 4min} runtime**
>
> Proceed? Refine the topic? Pre-supply questions to skip Phase 3?

Auto-proceed without confirmation if the user explicitly invoked deep mode and the topic is unambiguous.

---

## Phase 1: Frame the problem

One paragraph: **what decision is being made, what success looks like, what's at stake if we get it wrong.** No questions yet — that's Phase 3, after we know the codebase reality.

Example:
> "Decide on the concurrency control architecture for shape/activity edits. Success = no silent lost updates when 2-10 users edit simultaneously. Cost of being wrong = corrupted customer data, churn at the first multi-user customer, possible months-long rewrite if we pick wrong abstraction."

Get user thumbs-up on the framing in one line, then proceed. Don't ask further questions yet.

---

## Phase 2: Codebase Deep Dive ← THE DIFFERENTIATOR

Spawn subagents **in parallel** (single message, multiple Agent tool calls). Each agent has a focused brief, returns a tight written report, NEVER writes code.

### Standard agent set (always run)

**Agent A — Current state**
- Subagent: `Explore` (very thorough)
- Brief: "Find the current implementation of {topic area} in this codebase. Cite file:line for every claim. What does the data flow look like end-to-end? What invariants does the existing code rely on? What does the schema look like? What hooks/utilities exist that any new architecture would have to integrate with? Report under 400 words."

**Agent B — History & prior attempts**
- Subagent: `Explore` (medium)
- Brief: "Search git log, closed GitHub issues, comments, and the wiki for any prior attempts, deleted code, reverted commits, design docs, or discussion related to {topic area}. What's been tried? What was rejected and why? What's the conventional wisdom in this codebase that any new design has to either honor or explicitly override? Cite sources. Report under 300 words."

**Agent C — Constraints & integration surface**
- Subagent: `Explore` (medium)
- Brief: "Identify the real constraints any solution must respect: stack (frameworks, DB, infra), existing patterns (mutation hooks, auth model, routing), CLAUDE.md rules, wiki rules, deployment model, team size, budget for new infra. List them as constraints, not just descriptions. Report under 250 words."

### Optional agents (spawn when relevant)

**Agent D — Bug root-cause** (if there's a specific failure mode driving this research)
- Skill: `codex-diagnose` (uses Codex tokens, not Claude tokens)
- Brief: "Diagnose root cause of {specific bug or failure mode}. Read-only, no fixes."

**Agent E — Adjacent system audit** (if the decision affects auth, security, or data integrity)
- Subagent: `Explore` (very thorough)
- Brief: "Audit {adjacent system, e.g., RLS policies, mutation surface} for related issues that would compound if we get {topic} wrong."

### Synthesize Phase 2 into a "Codebase Context" brief

After all agents return, write a 200-400 word **Codebase Context** section that you'll use in Phase 3 question generation AND in Phase 6 synthesis. Save it to the research doc later. Format:

```markdown
## Codebase Context (Phase 2 findings)

### Current state
- [Bullet with file:line evidence]
- [...]

### What's been tried
- [Bullet with commit/issue reference]
- [...]

### Hard constraints
- [Stack/infra constraint]
- [Convention from CLAUDE.md or wiki]
- [...]

### Open questions for research
- [Specific gap that codebase exploration couldn't answer — these become Phase 3 question seeds]
```

This grounded context is what makes the deep research actually useful.

---

## Phase 3: Generate research questions (anchored)

Now — and only now — generate **5-7 research questions**. Each question must reference the Codebase Context. Generic questions are forbidden in this skill.

❌ Bad (generic): "Compare CRDTs vs OCC for collaborative editors."
✅ Good (anchored): "Given we already have a Supabase + Postgres stack with `useEntityMutations` / `useFooMutations` mutation routing and a drawer-scoped `useAutoSaveGroup` debounce coordinator, compare CRDTs vs OCC specifically for our 2-10 concurrent-user polygon editor. Which integrates cleanly with our auto-save group, and which would force us to rewrite the mutation layer?"

Question types that consistently matter for hard architectural problems:

1. **Decision framework anchored to our stack**: Compare {N} approaches, scoped to {our actual constraints}.
2. **Production case studies**: How do {3-5 named systems with similar shape} handle this? Architecture, transport, postmortems.
3. **Stack-specific deep dive**: What does {our specific stack: e.g., Supabase Realtime, Next.js App Router} support in 2025? Limits, gotchas, when teams outgrow it.
4. **Library/tool comparison**: Compare {libraries} for {our specific use case + data shape}, integration cost on top of our existing {hook/abstraction}.
5. **Migration path from where we actually are**: Realistic stage-by-stage progression from {our current state per Phase 2} to {robust ideal}. Commitment points. Anti-patterns.
6. **(If user-facing)** How do production teams communicate {failure mode} to end users when it surfaces in UI?
7. **(If security/data integrity)** Threat model. What goes wrong if we get this wrong + how to detect it.

Show the questions to the user for confirmation. **Each question header should reference what Phase 2 surfaced** so the user can verify the grounding is correct. If the user pushes back on framing ("we're not actually constrained on X"), revise before Phase 4.

---

## Phase 4: Discovery (Perplexity Deep Research)

**Default tool:** `mcp__perplexity__perplexity_research` with `reasoning_effort: "high"` and `strip_thinking: true`.

**Execution:**
- **Sequential only** — never parallelize `perplexity_research`.
- Pass a **strong system prompt** that includes a condensed version of the Codebase Context so the answers stay anchored:
  > *"You are researching {X} for a {stack description}. Current state: {2-3 sentence summary from Phase 2}. Hard constraints: {list from Phase 2}. Goal: pick the most robust architecture given these constraints. Cite sources with URLs. Be specific about tradeoffs, not generic. Avoid vendor marketing. If a recommendation depends on something we don't have, say so."*
- After each query, mark the corresponding TaskCreate task complete and move to the next.
- Capture each response's persisted-output file path (responses are 40-60KB each).

**TaskCreate the question list at the start of Phase 4** — 5-7 sequential queries take ~5-10 min. The user benefits from per-question progress visibility.

**Cost logging:** After every Perplexity call, if `usage` is exposed:
```bash
node /Users/commandergoosey/Projects/axis/scripts/perplexity-log-spend.mjs \
  --source research-pipeline-deep \
  --model sonar-deep-research \
  --usage '<usage-json>' \
  --topic <short-label>
```
If `usage` not exposed by the MCP wrapper (common), note it in Credits Used.

**Fallback chain:** If `perplexity_research` is unavailable, use `perplexity_reason` (still good for analysis) before degrading to `perplexity_ask`.

---

## Phase 5: Targeted Extraction (Firecrawl)

Same as `/research-pipeline`, with sharper selection because Phase 4's deep responses already cite + summarize most sources:

- **Max 4-6 URLs.** Only extract pages where the full text adds material the synthesis missed.
- Prioritize: canonical engineering blog posts (Figma multiplayer, Linear sync, Stripe idempotency), official docs for the specific config we'll copy, GitHub READMEs for libraries we're seriously evaluating.
- Skip: landing pages, generic "what is X" articles, anything Phase 4 already quoted in full.
- Run in parallel (Firecrawl scales fine here). Load tools via `ToolSearch` first.

---

## Phase 6: Synthesis (Verdict-Driven, Codebase-Grounded)

Unlike regular research-pipeline, deep mode **must produce a verdict** that explicitly bridges Codebase Context + research findings.

Required sections:

### Findings (per question)
- **Answer** grounded in extracted content
- **Sources** with one-line "why useful"
- **Key excerpts** (verbatim quotes when load-bearing)
- **Relevance to OUR stack** — say explicitly how Phase 2 findings affect this answer

### The verdict
One paragraph: **what to do**, framed as architecture choice + phased rollout, with specific reference to existing files/hooks/migrations from Phase 2.

### Phased plan
| Phase | What | Effort | Reversibility | When | Files affected (from Phase 2) |
|---|---|---|---|---|---|

### What we explicitly are NOT building
| Approach | Why we skip it | What in Phase 2 makes this clear |
|---|---|---|

### Architectural rules to preserve optionality
Decisions to make **now** that keep doors open. Numbered. Each rule cites either Phase 2 evidence or Phase 4 source.

### Pitfalls / anti-patterns
What goes wrong if we deviate. Anchored to our codebase where applicable.

### User-facing communication (if decision affects UI)
- Toast/error copy — literal words to show
- Onboarding/empty-state hints
- Edge case copy (delete-vs-edit races, network-vs-conflict, coalesced rapid events)
- What to AVOID telling users (jargon, scary words)

### Open questions
Things the research couldn't resolve — flagged for human judgment, not silently dropped.

---

## Phase 7: Save & Ingest

### Save research doc
`ai/zv/research/YYYY-MM-DD-<slug>.md` (or project equivalent — auto-detect from CWD; if none, ask).

The doc must include the **Codebase Context** section verbatim near the top — this is what makes the doc re-readable later when memory of the original conversation is gone.

### Wiki ingest (default ON, unless `--no-wiki`)

For architecture decisions, **prefer a dedicated new wiki page** over scattering findings:

1. Read wiki index
2. Decide: dedicated new page (architecture decisions) vs. updates to existing page (incremental research)
3. Cross-link from the broadest existing page (e.g., `architecture.md`) to any new page with a 1-2 sentence summary
4. Update wiki index with the new entry + refresh the "last updated" line
5. Append to wiki `log.md`:
   ```
   ## [YYYY-MM-DD PT] research-pipeline-deep | <topic> | --wiki
   - **Source**: <research-doc-path>
   - **KB**: engineering | business
   - **Pages updated**: <list>
   - **Pages created**: <list>
   - **Verdict**: <one-line>
   ```

The wiki page (when newly created) should mirror the research doc's structure but cut to a tighter reference: current state, target architecture (named pattern), phased rollout, what we explicitly skip, user-facing copy, references. Future-you reading this in 3 months should not need to re-read the full research doc.

---

## Phase 8: Suggest next step

Based on the verdict's stakes:

- **Default**: `/zv04-plan` against the issue — turn verdict + phased plan into an executable implementation plan.
- **If the decision is irreversible** (CRDT adoption, vendor lock-in, schema rewrite): also suggest `/codex-argue` on the verdict for an adversarial second opinion **before** committing to `/zv04-plan`. Give them this exact wording so they understand the choice:
  > "This is high-stakes and hard to reverse. Recommend `/codex-argue` on the verdict before planning — it'll surface objections you and I both missed."
- **If the decision affects security or data integrity**: suggest `/codex-argue` regardless.

Don't suggest both routinely — `/zv04-plan` is the default; `/codex-argue` is for stakes that warrant the extra cycle.

---

## Rules

- **Phase 2 is non-negotiable** unless `--skip-codebase` is explicit. Skipping it produces generic research, which is what `/research-pipeline` is for.
- **Sequential Perplexity, parallel subagents + parallel Firecrawl.** Never invert.
- **Verdict, not menu.** The user is asking because they have to decide. Give a recommendation. They can override.
- **Cite primary sources.** If Perplexity references Figma's blog, extract the blog and quote it directly.
- **No implementation.** This skill produces a research doc + wiki pages, not code. Suggest `/zv04-plan` next.
- **TaskCreate the question list at Phase 4.** 5-7 sequential queries over ~10 min — visible progress matters.
- **Stay anchored.** If a sixth tangential question emerges mid-research, log it in Open Questions and move on.
- **If Phase 2 reveals the problem is already solved**, stop. Tell the user, save the codebase findings, skip the research. Don't burn $5 confirming what you found in the codebase.

---

## When to use this vs. regular `/research-pipeline`

| Use deep | Use regular |
|---|---|
| Concurrency model selection for our app | "What libraries exist for X?" |
| Stack/database swap evaluation | "What's the current best practice?" |
| Security architecture rewrite | Quick competitor scan |
| CRDT vs OCC vs locks for our editor | "Has anyone solved Z before?" |
| Auth/authz model design for our schema | Comparing 2-3 specific tools |
| Multi-tenant rearchitecture | Single-question lookup |
| "Most robust solution" framing | "Good enough" framing |
| Decision will lock in months of work | Decision can be re-made cheaply |

If unsure, regular is safer — re-run with `-deep` if the answer is too shallow.
