# Wiki Ingest

Process a raw source into the LLM Wiki. Reads the source, identifies relevant knowledge, distributes it across existing wiki pages (and creates new ones if needed), maintains cross-references and source attribution.

## Arguments

The user provides:
- **source** — a file path, URL, or `"paste"` (to read from the user's message) (required)
- **--kb engineering|business** — force knowledge base classification (default: auto-detect from content)
- **--dry-run** — show what would change without writing any files

---

## Step 1: Read the Source

**File path:** Read the file directly. Note the path for attribution.

**URL:** Use Firecrawl to extract clean markdown:
1. Load Firecrawl via ToolSearch: `select:mcp__firecrawl__firecrawl_scrape`
2. Scrape the URL with `firecrawl_scrape`
3. Save extracted content to `/Users/commandergoosey/Projects/Brain Work/raw/projects/axis/clips/manual/YYYY-MM-DD-<slug>.md` with a YAML front matter block:
   ```yaml
   ---
   url: <original URL>
   title: <page title>
   ingested: YYYY-MM-DD
   ---
   ```
4. If Firecrawl is unavailable, fall back to `WebFetch`. Note the fallback in the log entry.

**Paste:** Read the content directly from the user's message. No file is saved to `raw/` — attribute as "pasted text" in source references.

**Error handling:**
- If a URL returns 403/404/timeout: report the failure and stop. Do not guess at content.
- If a file path doesn't exist: report the error and stop.

---

## Step 2: Analyze Content

Extract structured knowledge from the source:
1. **Key facts** — concrete data points, metrics, dates, decisions
2. **Patterns** — architectural approaches, workflows, design patterns
3. **Entities** — products, companies, people, technologies mentioned
4. **Risks/pitfalls** — warnings, failure modes, things to avoid
5. **Open questions** — unresolved items or areas needing follow-up

Classify the content:
- **engineering** — code, architecture, infrastructure, patterns, debugging, testing
- **business** — market data, competitors, clients, pricing, positioning, strategy
- If mixed, note which parts belong where

List which existing wiki pages this information relates to by reading `index.md`.

---

## Step 3: Read Affected Wiki Pages

1. Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`
2. Read each wiki page that the source content relates to
3. For each page, identify:
   - Which section the new information belongs in
   - Whether existing content needs updating or expanding
   - Whether any existing claims are contradicted by the new source

---

## Step 4: Plan Changes

Before writing anything, produce a change plan:

```
### Ingest Plan

**Source:** <title or filename>
**KB:** engineering | business | both
**Classification confidence:** high | medium

**Pages to update:**
- `engineering/architecture.md` — add section on [topic] under [heading]
- `business/competitors.md` — update [competitor] entry with new pricing data

**New pages needed:**
- `business/partnerships.md` — source covers partnership models not in any existing page

**Contradictions detected:**
- `business/positioning.md` line ~42: says "$1,600/mo" but source says "$2,000/mo"

**Cross-references to add:**
- Link from `engineering/data-model.md` to new content in `engineering/architecture.md`
```

If `--dry-run` is set: output the plan and stop here. Do not write any files.

Otherwise, confirm the plan with the user before proceeding. If the source is unambiguous and changes are minor (updating 1-2 pages with additive information, no contradictions), auto-proceed.

---

## Step 5: Update Wiki Pages

For each affected page:

1. **Add new information** in the appropriate section. Keep the page's existing structure and voice.
2. **Add source attribution** inline:
   ```
   (Source: [<title>](<path-or-url>), ingested YYYY-MM-DD)
   ```
3. **Add cross-references** to other wiki pages if the new content creates connections that didn't exist before. Use relative links: `[Architecture](../engineering/architecture.md)`.
4. **Update "Last updated"** date if the page has one.
5. **Flag contradictions** — never silently overwrite. Insert:
   ```
   > **Contradiction**: Existing claim "[old]" vs new source "[new]" — needs resolution
   ```

**Writing discipline:**
- Extract and distribute knowledge. Do NOT dump the entire source into one page.
- Keep each page focused on its stated scope (check the one-liner in `index.md`).
- Prefer bullet points and tables over prose paragraphs.
- Match the existing page's formatting conventions.

---

## Step 6: Create New Pages (if needed)

If the source covers a topic not represented by any existing wiki page:

1. Create the page in the appropriate KB directory (`engineering/` or `business/`)
2. Use this template:
   ```markdown
   # <Page Title>

   <One-paragraph summary of what this page covers.>

   Last updated: YYYY-MM-DD

   ---

   ## <Section 1>
   ...

   ## <Section 2>
   ...

   ## Sources
   - [<title>](<path-or-url>) — ingested YYYY-MM-DD
   ```
3. Add cross-references from related existing pages to the new page
4. Add the new page to `index.md` in the appropriate section

---

## Step 7: Update Index

- If new pages were created: add them to `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md` with a one-line summary
- If an existing page's scope changed significantly: update its one-liner in the index
- Update the `Last updated` date at the top of `index.md`

---

## Step 8: Log

Append an entry to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`:

```
## [YYYY-MM-DD HH:MM PT] ingest | <source-title>
- **Source**: <path or URL>
- **KB**: engineering | business | both
- **Pages updated**: <comma-separated list>
- **Pages created**: <list or "none">
- **Contradictions found**: <count and brief description, or "none">
- **Cross-references added**: <count or "none">
```

---

## Rules

- **Immutable sources** — never modify files in `raw/`, `ai/zv/research/`, or `ai/zv/plans/`. They are read-only inputs.
- **Always attribute** — every piece of ingested information must link back to its source.
- **Flag, don't overwrite** — contradictions are flagged for human resolution, never silently replaced.
- **Distribute, don't dump** — extract knowledge and spread it across relevant pages. No single page should receive the entire source verbatim.
- **Scope discipline** — if a page's one-liner in `index.md` doesn't cover the new topic, the information probably belongs on a different page or a new one.
- **Pacific Time** — use PT for all timestamps in log entries and attribution dates.
- **Confirm before large changes** — if updating 3+ pages or creating new pages, show the plan and wait for user confirmation (unless `--dry-run` already handled it). Minor additive updates to 1-2 pages can auto-proceed.

## Next Step

After ingestion, suggest:
- `/wiki-ingest` again if the user has more sources to process
- Review the updated pages to verify accuracy
