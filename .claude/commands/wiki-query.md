# Wiki Query

> Search the wiki, answer questions, and file valuable answers back into the knowledge base.

## Arguments
- First arg: the question (required)
- `--file-back` — save the answer as a new wiki page or update to existing page
- `--kb engineering|business|all` (default: all)
- `--output <path>` — save answer to a specific file (e.g., for reports or presentations)

## Steps

### Step 1: Parse the Question
Understand what's being asked:
- Is it factual? ("What tables store work orders?") → direct lookup
- Is it analytical? ("How does our auth model compare to best practices?") → synthesis needed
- Is it comparative? ("What differentiates us from Cartegraph?") → multiple pages needed
- Is it a "how-to"? ("How do I add a new prototype?") → procedural answer

### Step 2: Search the Wiki
1. Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md` to identify relevant pages from summaries
2. Read the identified pages (typically 2-5 pages)
3. If the question touches engineering AND business, read from both KBs
4. If the wiki doesn't have enough information, note the gap

The AXIS Command Center project wiki lives at `/Users/commandergoosey/Projects/Brain Work/projects/axis/` with:
- `index.md` — master catalog with one-line summaries
- `log.md` — append-only session log
- `engineering/` — architecture.md, domain-glossary.md, data-model.md, troubleshooting.md, prototypes.md, testing-strategy.md, deployment.md
- `business/` — competitors.md, positioning.md, client-insights.md, market-map.md

### Step 3: Synthesize Answer
Produce a structured answer:
- Lead with the direct answer (1-3 sentences)
- Support with details from wiki pages
- Cite sources: `(See: [Page Name](path))` for each claim
- If information is incomplete, state what's known and what's missing
- If the wiki has contradictions relevant to the question, surface them

### Step 4: Assess File-Back Value
After answering, evaluate whether this answer should be filed back:

**File back if:**
- The answer synthesizes information from 3+ wiki pages (new cross-cutting insight)
- The answer fills a gap not covered by any existing page
- The question is likely to be asked again
- The analysis has lasting value (comparisons, decision frameworks, how-to guides)

**Don't file back if:**
- The answer is a simple fact lookup
- The information is already well-covered in a single wiki page
- The answer is ephemeral (about current debugging, temporary state)

### Step 5: File Back (if --file-back or if auto-assessment says yes)
Two modes:

**Update existing page**: If the answer enriches an existing wiki page:
- Add a new section or expand an existing one
- Note the source: `(Generated from wiki query, YYYY-MM-DD)`
- Update cross-references

**Create new page**: If the answer covers a new topic:
- Write to `/Users/commandergoosey/Projects/Brain Work/projects/axis/<kb>/<slug>.md`
- Add to `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`
- Add cross-references from related pages

Always ask the user to confirm before filing back (unless --file-back was explicit).

### Step 6: Log
Append to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`:
```
## [YYYY-MM-DD HH:MM PT] query | "<question summary>"
- **Pages consulted**: <list>
- **Filed back**: yes (-> <page>) | no
- **Gaps found**: <description or "none">
```

## Output Formats

Default: markdown answer in the conversation.

With `--output <path>`: Write the answer to a file. Useful for:
- Generating reports for stakeholders
- Creating comparison documents
- Building presentation content

## Tips for Good Queries
- Specific beats broad: "How does RLS work on work orders?" > "How does security work?"
- Comparative queries produce the richest answers: "How does our deployment differ from typical Next.js apps?"
- "What don't we know about X?" surfaces coverage gaps

## Rules
- Always cite which wiki pages the answer draws from
- Never hallucinate — if the wiki doesn't cover something, say so
- Surface contradictions rather than picking a side
- Use Pacific Time for all timestamps
- Keep filed-back content concise — the wiki should stay scannable
