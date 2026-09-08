# Session Debrief

> Run at the end of every working session to capture knowledge before it's lost.
> Appends to the wiki log, updates wiki pages, and flags carry-forward items.

## Why This Exists

Knowledge trapped in chat history is knowledge lost. This skill extracts decisions, patterns, and discoveries at the moment they're freshest — before the session ends and context evaporates into the 885MB JSONL graveyard.

## Arguments

- No required arguments — introspects the current session
- `--quick` — log entry only, skip wiki page updates (for short sessions)

---

## Step 1: Gather Session Context

Run these in parallel:
1. `git log --oneline --since="8 hours ago"` — commits made this session
2. `git diff --stat HEAD~5..HEAD` — files changed (adjust range to match commits)
3. `git branch --show-current` — current branch
4. Read the wiki log tail: `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md` (last 5 entries for context)

## Step 2: Identify Session Knowledge

Review the conversation history and git changes to identify:

### Decisions Made
- Architectural choices ("we chose X over Y because...")
- Trade-offs accepted ("we deferred X to keep scope small")
- Issues closed or deprioritized and why

### Patterns Discovered
- New debugging techniques that worked
- Code patterns that should be reused
- Anti-patterns encountered

### Bugs Found
- New issues discovered during work
- Workarounds applied (temporary vs permanent)

### Carry-Forward Items
**Critical** — these prevent dropped work between sessions:
- Unfinished tasks or phases
- Uncommitted changes or unstaged work
- Things that need follow-up in the next session
- Issues that were identified but not filed

## Step 3: Append to log.md

Append an entry to `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md`:

```markdown
## [YYYY-MM-DD HH:MM PT] <brief-description> | branch: <branch-name>
- **Scope**: 1-2 sentence summary of what the session accomplished
- **Issue(s)**: #XX, #YY (GitHub issues worked on)
- **Commits**: <count> commits, key ones: <hash> <message>
- **Decisions**: Key decisions with rationale
- **Discoveries**: Patterns, bugs, or insights found
- **Wiki updates**: Pages updated this session (or "none")
- **Carry-forward**: Unfinished work, follow-up needed
- **Hotspots**: Files touched >3 times this session
```

Use Pacific Time. Convert any UTC timestamps.

## Step 3.5: Append Structured Episodic Entry

Alongside the narrative log entry, append one JSON line to the structured episodic memory. This is the queryable index that feeds future recurrence detection, failure flagging, and salience retrieval. Schema + field definitions live in `~/.claude/projects/-Users-commandergoosey-Projects-axis/memory/episodic.schema.md` — read it if any field is unclear.

**Also write when `--quick`.** The JSONL line is cheap and the structured trace shouldn't have gaps.

Construct the entry from the same session context you gathered in Steps 1-2, then write it via a Python heredoc (Python handles JSON escaping so you don't hand-craft quoting):

```bash
python3 - <<'PY'
import json
from pathlib import Path

entry = {
    "timestamp": "2026-04-15T13:07:00-07:00",   # ISO8601 with PT offset
    "date": "2026-04-15",                        # PT calendar date
    "session_desc": "<mirrors log.md header, ≤120 chars>",
    "skill": "<primary /skill or workflow, e.g. 'pipeline-heavy'>",
    "skills_used": ["<all /skill invocations this session>"],
    "issue_ids": [552],                          # [] if none
    "branch": "<branch name or null>",
    "result": "shipped",                         # shipped | partial | abandoned | blocked | research
    "commits": 0,
    "files_changed": 0,
    "loc_delta": 0,                              # signed net; 0 if research-only
    "pain_score": 5,                             # 1-10; see schema doc for conventions
    "importance": 6,                             # 1-10; see schema doc for conventions
    "tags": ["<short kebab-case aggregation keys>"],
    "reflection": "<1-2 sentence takeaway in plain English — the actual learning>",
    "carry_forward": False,
    "wiki_pages_touched": [],                    # relative paths under wiki/
    "log_entry_anchor": "<YYYY-MM-DD HH:MM PT>",  # matches the log.md header
}

path = Path("/Users/commandergoosey/.claude/projects/-Users-commandergoosey-Projects-axis/memory/episodic.jsonl")
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("a") as f:
    f.write(json.dumps(entry) + "\n")
PY
```

**Rules:**
- Match `timestamp`, `date`, `session_desc`, `log_entry_anchor`, and `branch` exactly to the narrative entry you just wrote to `log.md`.
- `pain_score`/`importance` — be honest, not performative. A quiet mechanical fix is `pain_score: 2`. A rate-limit-stalled rabbit hole is `pain_score: 9`.
- `reflection` is the single most valuable field — one sharp sentence that a future recurrence-scanner could cluster on. Not a restatement of `session_desc`.
- Append-only. Never rewrite existing lines.

## Step 4: Verify Wiki Coverage (skip if `--quick`)

Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`.

Check whether `/zv09-document` already updated the relevant wiki pages during this session (look at git log for wiki file changes in `/Users/commandergoosey/Projects/Brain Work/projects/axis/`). If wiki pages were already updated, skip to Step 5.

If wiki pages were NOT updated (e.g., this session didn't run `/zv09-document`, or it was a quick fix without the full pipeline), apply wiki updates as a fallback:

| Knowledge Type | Likely Wiki Page |
|---|---|
| Architecture decision | `engineering/architecture.md` |
| New debugging insight | `engineering/troubleshooting.md` |
| Test strategy change | `engineering/testing-strategy.md` |
| Deployment procedure change | `engineering/deployment.md` |
| Schema/migration change | `engineering/data-model.md` |
| Prototype added/changed | `engineering/prototypes.md` |
| Client feedback | `business/client-insights.md` |
| Competitor intel | `business/competitors.md` |
| Market insight | `business/market-map.md` |
| Pricing/positioning change | `business/positioning.md` |

When updating (fallback mode):
- Add new information in the appropriate section
- Note the source: `(discovered: YYYY-MM-DD, session: <brief-description>)`
- Update cross-references if new connections were found
- Update the page's "Last updated" date

If session knowledge doesn't fit any existing page, propose a new page and add it to `index.md`.

## Step 5: Suggest Memory Entries

Check if any session-learned patterns should become memory files (feedback, user preferences, workflow patterns). These are things that:
- Would change how Claude should behave in future sessions
- Are preferences or corrections the user expressed
- Cannot be derived from reading the code

If found, propose the memory entry but let the user confirm before writing.

## Step 6: Report

Output a brief summary:
```
Session Debrief Complete
- Log entry appended to wiki/log.md
- Episodic entry: result=<enum>, pain=<N>, importance=<N>, tags=[...]
- Wiki pages updated: [list or "none"]
- Carry-forward items: [count]
- Memory suggestions: [count or "none"]
```

Echoing pain/importance/tags in the report lets the user push back on a misread before the line is baked into the corpus.

If there are carry-forward items, output a copy-paste block for the next session:
```
Continue from previous session:
- Branch: <branch>
- Last commit: <hash> <message>
- Carry-forward: <items>
- Plan file: <path if exists>
```

## When to Run

- **Always** at the end of a working session (before closing Claude Code)
- **After shipping** — `/zv10-ship` should trigger this automatically
- **After overnight runs** — to capture what the pipeline did
- After any session longer than 30 minutes

## Rules

- Never skip the log entry — even for trivial sessions, the log tracks activity
- Always use Pacific Time
- Don't create wiki pages for ephemeral information (temporary debugging state, one-off commands)
- Don't duplicate information already in git commit messages — reference the commit instead
- Keep log entries concise — detail goes in wiki pages, not the log
