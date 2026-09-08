# Wiki Lint

> Periodic health-check for the LLM Wiki. Finds stale content, contradictions, orphans, coverage gaps, and hotspot patterns. Fixes what's safe, reports the rest. Run weekly or after major changes.

## Arguments
- `--fix` — auto-fix safe issues (orphaned index entries, stale dates, broken links)
- `--kb engineering|business|all` (default: all)
- `--deep` — also check business pages against live web data via Perplexity

## Step 1: Structural Audit (parallel reads)

Read in parallel:
- `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`
- All AXIS Command Center wiki pages (`/Users/commandergoosey/Projects/Brain Work/projects/axis/engineering/*.md` and `/Users/commandergoosey/Projects/Brain Work/projects/axis/business/*.md`)
- `/Users/commandergoosey/Projects/Brain Work/JOURNAL.md` (last 20 entries)

Check:
- [ ] Every wiki page is listed in `index.md`
- [ ] Every `index.md` entry points to a file that exists
- [ ] Index one-line summaries accurately reflect page content
- [ ] All pages have "Last updated" dates
- [ ] No wiki pages are empty or stub-only

## Step 2: Cross-Reference Audit

For each wiki page:
- Check all internal links (`[text](other-page.md)`) resolve to existing pages
- Check for mentions of concepts that have their own page but aren't linked
- Check for orphan pages (exist but no other page links to them)

## Step 3: Freshness Audit

For engineering pages:
- Verify referenced file paths still exist (use Glob)
- Verify referenced function/hook names still exist (use Grep)
- Compare "Last updated" date against recent git changes to related files
- Flag pages where related code changed significantly since last update

For business pages:
- Flag entries older than 30 days for refresh
- If `--deep`: use Perplexity to check if competitor info is outdated (funding rounds, acquisitions, new features). Max 3 concurrent Perplexity calls.

## Step 4: Contradiction Detection

Cross-check between:
- Wiki pages vs `CLAUDE.md` (wiki should be consistent with project rules)
- Wiki pages vs memory files (wiki should supersede `project_*` and `reference_*` memories)
- Wiki pages vs each other (e.g., `architecture.md` vs `data-model.md`)
- Flag any contradictions with specific quotes from both sides

## Step 5: Coverage Gap Analysis

Check for:
- Concepts mentioned in CLAUDE.md gotchas but not in any wiki page
- Subsystems with `.claude/rules/` files but no wiki coverage
- Recent git activity in areas with thin wiki coverage (`git log --since="2 weeks ago" --stat`)
- Recurring carry-forward items in `log.md` (same item appears 3+ times = dropped work)

## Step 6: Hotspot Detection

Parse `log.md` for patterns:
- Files mentioned as hotspots across multiple sessions
- Carry-forward items that keep reappearing
- Areas where troubleshooting entries keep growing (recurring problems)

## Step 7: Report

Output a health report:

```
# Wiki Health Report — YYYY-MM-DD (Pacific Time)

## Status: Healthy / Needs Attention / Stale

### Structural Issues
- [list or "none"]

### Broken Links
- [list or "none"]

### Stale Pages (code changed since last wiki update)
| Page | Last Updated | Related Code Changes |
|------|-------------|---------------------|
| ... | ... | ... |

### Contradictions
- [list with quotes from both sides]

### Coverage Gaps
- [list of undocumented areas]

### Recurring Carry-Forwards (potential dropped work)
- [list from log.md analysis]

### Hotspot Patterns
- [list of recurring problem areas]

## Recommended Actions
1. [prioritized list of fixes]
```

If `--fix` is passed, auto-fix:
- Add missing pages to `index.md`
- Remove index entries for deleted pages
- Update "Last updated" dates on pages that were modified
- Fix broken internal links where the target page can be inferred

## Integration with /refresh-claude-md

When invoked from `/refresh-claude-md` (as its Step 5), skip the report format and return findings as a bulleted list that `/refresh-claude-md` can incorporate.

## Rules
- Never delete wiki pages during lint — only flag them
- Never modify page content beyond metadata (dates, links) — flag content issues for manual review
- Use Pacific Time for all dates
- Keep the report concise — detail goes in suggested fixes, not diagnostics
