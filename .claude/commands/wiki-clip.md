# Wiki Clip

> Scrape a URL and save to raw/clips/ for later wiki ingestion. Optionally auto-ingest.

## Arguments

- First arg: URL to scrape (required)
- `--ingest` — auto-run /wiki-ingest after saving (combines clip + ingest in one step)
- `--kb engineering|business` — passed to /wiki-ingest if --ingest is used
- `--title "Custom Title"` — override auto-detected title

---

## Step 1: Check for Duplicates

Before scraping, check `/Users/commandergoosey/Projects/Brain Work/raw/projects/axis/clips/manual/` for existing files that match the URL:
1. Grep all `.md` files in `raw/clips/manual/` for the URL in frontmatter (`source:` field)
2. If a match is found: warn the user, show the existing file path and clip date, and ask whether to re-clip
3. If the user declines: stop

> **Note on layout:** `raw/clips/manual/` is for everything the user asks Claude to clip or ingest. `raw/clips/auto/` is reserved for the autonomous `scripts/intel-scrape.mjs` pipeline. Never write to `auto/` from this skill.

---

## Step 2: Scrape the URL

Tool priority:

1. **Firecrawl** (preferred — clean markdown, metadata extraction)
   - Load via ToolSearch: `select:mcp__firecrawl__firecrawl_scrape`
   - Scrape the URL with `firecrawl_scrape`
   - Note: 1 credit per scrape. Track usage and warn if approaching 500 lifetime free credits.

2. **Fallback: WebFetch** — if Firecrawl is unavailable or returns an error
   - Load via ToolSearch: `select:WebFetch`

3. **Fallback: Chrome MCP** — for JS-heavy SPAs where WebFetch returns empty/minimal content
   - Load via ToolSearch: `select:mcp__claude-in-chrome__get_page_text`
   - Use `get_page_text` to extract rendered page content

**Error handling:**
- If the page is paywalled or returns empty content: tell the user and suggest alternatives (paste the text manually, use Chrome MCP to read if already logged in)
- If the URL returns 403/404/timeout: report the failure and stop

---

## Step 3: Save to raw/clips/manual/

Save as: `/Users/commandergoosey/Projects/Brain Work/raw/projects/axis/clips/manual/YYYY-MM-DD-<slug>.md`

**Slug rules:** lowercase, hyphens only, max 50 chars, derived from the page title (or `--title` override). Strip special characters. Trim trailing hyphens.

**File format:**

```markdown
---
title: "<page title or --title override>"
source: "<original URL>"
clipped: YYYY-MM-DD
tool: firecrawl | webfetch | chrome-mcp
---

<extracted markdown content>
```

---

## Step 4: Confirm Save

Output:

```
Clipped: <title>
Saved to: raw/clips/manual/YYYY-MM-DD-<slug>.md
Size: <word count> words

Run `/wiki-ingest --source <path>` to process into wiki.
```

---

## Step 5: Auto-Ingest (if --ingest)

If `--ingest` flag is passed, immediately invoke the `/wiki-ingest` skill on the saved file:
- Pass `--source <saved file path>`
- Pass `--kb <value>` if the user provided `--kb`
- Let wiki-ingest handle analysis, page updates, index, and logging

---

## Step 6: Log

Append to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`:

```
## [YYYY-MM-DD HH:MM PT] clip | "<title>"
- **Source**: <URL>
- **Saved**: raw/clips/manual/<filename>
- **Tool**: firecrawl | webfetch | chrome-mcp
- **Auto-ingested**: yes (-> pages: X, Y) | no
```

---

## Rules

- **Immutable sources** — never modify existing files in `raw/`. Each clip is a point-in-time snapshot.
- **One URL per clip** — don't batch multiple URLs in a single invocation.
- **Pacific Time** — use PT for all timestamps in filenames, log entries, and frontmatter.
- **Warn on paywalls** — if content is empty or suspiciously short (< 50 words of body content), flag it rather than saving junk.
- **Credit awareness** — Firecrawl has 500 lifetime free credits. Note usage when scraping. If the user is doing bulk clipping, suggest batching with `/wiki-ingest` afterward rather than `--ingest` on each call.
