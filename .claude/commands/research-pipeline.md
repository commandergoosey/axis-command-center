# Research Pipeline — Discover, Extract, Synthesize

Automated multi-step research pipeline that chains Perplexity (discovery) -> Firecrawl (page extraction) -> Claude (synthesis) into a single workflow.

## Arguments

The user provides:
- **topic** — what to research (required)
- **--issue #N** — optional GitHub issue to reference
- **--deep** — use `perplexity_research` instead of `perplexity_ask` for the discovery phase (expensive, use sparingly)
- **--urls URL1 URL2 ...** — skip discovery, go straight to extraction on these URLs
- **--questions "Q1" "Q2" ...** — pre-defined research questions (skip question generation)
- `--wiki` — after saving research output, auto-ingest into the wiki (updates relevant wiki pages with findings)
- `--wiki-kb engineering|business` — which wiki KB to target (default: auto-detect from topic)

---

## Phase 1: Frame the Research

1. Parse the topic and any flags from the user's input
2. If `--questions` provided, use those. Otherwise, generate 3-6 specific research questions based on the topic. Examples:
   - "What libraries exist for X? Tradeoffs?"
   - "How do competitors handle this?"
   - "What are common pitfalls?"
   - "What's the current best practice for X?"
3. Present questions to the user for confirmation before proceeding. If the topic is clear-cut and unambiguous, auto-proceed.

---

## Phase 2: Discovery (Perplexity)

Use Perplexity MCP tools to answer each research question and discover key sources.

**Tool selection:**
- **Default:** `perplexity_ask` — fast, cheap, sufficient for 90% of questions
- **URLs/facts:** `perplexity_search` — when you need specific URLs, repos, or recent news
- **Deep mode (`--deep` flag only):** `perplexity_research` — expensive, 30s+ per call, rate-limited. Never run in parallel. Only use when explicitly requested.

**Execution:**
- Run `perplexity_ask` / `perplexity_search` queries **in parallel** when they are independent
- Never run `perplexity_research` in parallel (rate limits)
- For each question, collect:
  - Key findings (2-4 sentences)
  - Source URLs worth extracting (max 3-5 per question)
  - Confidence level (high/medium/low)

**Cost logging (#343):** After every Perplexity MCP call, if the response exposes a `usage` field, record the spend in the shared log so all three channels (`intel-scrape`, `/zv03.5-research`, `/research-pipeline`) roll up in one place. Run via Bash:

```bash
node /Users/commandergoosey/Projects/axis/scripts/perplexity-log-spend.mjs \
  --source research-pipeline \
  --model <model> \
  --usage '<usage-json>' \
  [--topic <short-label>]
```

- `<model>` = `sonar`, `sonar-pro`, `sonar-reasoning`, `sonar-reasoning-pro`, or `sonar-deep-research`
- `<usage-json>` = pass the MCP response's `usage` object through verbatim
- CLI prints the dollar cost to stdout and appends one line to `.overnight/perplexity-cost.jsonl`

If the MCP response does not expose `usage`, skip the logging step and note it in the Credits Used section of the research doc.

**Output:** A discovery summary with a ranked list of URLs worth deep-extracting.

---

## Phase 3: Extraction (Firecrawl)

Extract full page content from the most valuable URLs identified in discovery.

**URL selection criteria (max 8 URLs total):**
- Documentation pages with implementation details
- Blog posts with benchmarks, comparisons, or case studies
- GitHub READMEs with setup instructions or API details
- Skip: landing pages, pricing pages, generic marketing content, paywalled articles

**Tool usage:**
- Use `firecrawl_scrape` for individual pages (1 credit each)
- Use `firecrawl_search` if you need to find specific content within a domain
- Do NOT use `firecrawl_crawl` (expensive, multi-page) unless the user explicitly requests it

**Execution:**
- Load Firecrawl tools via ToolSearch first: `select:mcp__firecrawl__firecrawl_scrape`
- Scrape URLs in parallel (up to 5 concurrent)
- For each page, extract:
  - Title and main content (Firecrawl returns clean Markdown)
  - Key data points relevant to the research questions
  - Code examples, configuration snippets, or architecture patterns

**Error handling:**
- If a URL returns 403/404/timeout: log it and skip. Do not retry.
- If Firecrawl rate-limits: wait, then retry once. If still failing, note the URL as "extraction failed" and continue.
- If Firecrawl MCP is not connected: fall back to `WebFetch` for the URLs instead. Note the fallback in the output.

---

## Phase 4: Synthesis (Claude)

Combine Perplexity findings + Firecrawl extracted content into a structured research document.

**For each research question, produce:**
- **Answer** — synthesized from all sources (2-4 sentences, grounded in extracted content)
- **Sources** — links to the most useful references with why they're useful
- **Key excerpts** — relevant quotes or data from extracted pages (if they add value beyond the summary)
- **Relevance** — High / Medium / Low to the original topic

**Then produce recommendations:**
- **Libraries/tools to consider** — with pros/cons
- **Patterns to adopt** — specific approaches worth following
- **Pitfalls to avoid** — things others got wrong
- **Open questions** — anything needing human judgment

---

## Phase 5: Save Output

Save the research document to `ai/zv/research/YYYY-MM-DD-<slug>.md` using this structure:

```markdown
# Research: [Topic Name]
**Issue:** #N (if applicable)
**Date:** YYYY-MM-DD
**Pipeline:** discovery (Perplexity) → extraction (Firecrawl) → synthesis (Claude)

## Research Questions
1. Question 1
2. Question 2
3. ...

## Findings

### Q1: [Question]
**Answer:** Summary of findings.
**Sources:**
- [Source name](url) — why it's useful
- [Source name](url) — why it's useful
**Key Excerpt:** (if applicable)
> Relevant quote from extracted page
**Relevance:** High / Medium / Low

### Q2: [Question]
...

## Extracted Pages
| # | URL | Credits | Status | Key Value |
|---|-----|---------|--------|-----------|
| 1 | url | 1 | OK/Failed | What we learned |
| 2 | url | 1 | OK/Failed | What we learned |

## Recommendations

### Libraries/Tools
| Name | Purpose | Pros | Cons | Verdict |
|------|---------|------|------|---------|
| `name` | What it does | Strengths | Weaknesses | Use / Skip / Maybe |

### Patterns to Adopt
- Pattern 1: description and rationale
- Pattern 2: description and rationale

### Pitfalls to Avoid
- Pitfall 1: what went wrong for others
- Pitfall 2: what went wrong for others

## Open Questions
- Question needing human judgment

## Summary
2-3 sentence synthesis of the most important takeaways.

## Credits Used
- Perplexity: N queries (ask: X, search: Y, research: Z)
- Firecrawl: N pages scraped (N credits)
```

---

## Phase 6: Wiki Ingest (if --wiki)

If `--wiki` flag is passed, integrate research findings into the LLM Wiki:

1. Read the saved research document
2. Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md` to identify relevant wiki pages
3. Read affected wiki pages
4. For each finding with High or Medium relevance:
   - Update the relevant wiki page with the new information
   - Add source attribution: `(Source: [Research: Topic](path-to-research-doc), YYYY-MM-DD)`
   - Note any contradictions with existing wiki content
5. If findings don't fit existing pages, create a new wiki page and add to index.md
6. Append to wiki log.md:
   ```
   ## [YYYY-MM-DD HH:MM PT] ingest | Research: <topic>
   - **Source**: <research-doc-path>
   - **KB**: engineering | business
   - **Pages updated**: <list>
   - **Pages created**: <list or "none">
   ```

This phase runs automatically when `--wiki` is passed. No additional user confirmation needed — the research output is the source of truth.

---

## Rules

- **Budget awareness:** Track and report credit usage. Firecrawl free tier has 500 lifetime credits — don't waste them on low-value pages.
- **Parallel execution:** Run independent Perplexity queries in parallel. Run independent Firecrawl scrapes in parallel. Never run `perplexity_research` in parallel.
- **No implementation:** This is a research skill. Do NOT write code, create files (other than the research doc), or modify the codebase.
- **Fallback chain:** If Firecrawl is unavailable, use `WebFetch`. If Perplexity is unavailable, use `brave_web_search` + `WebFetch`.
- **Scope discipline:** Stay focused on the research questions. Don't go down rabbit holes or explore tangential topics unless the user asks.

## Next Step

After research is complete, suggest the user run `/zv04-plan` to create an implementation plan incorporating the findings. If `--wiki` was not used, suggest `/wiki-ingest --source <path>` to integrate findings into the wiki.
