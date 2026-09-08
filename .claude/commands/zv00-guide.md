# ZV Workflow — Complete Guide

Present this guide to the user. Do not summarize — show the full guide.

---

# ZV Workflow

Your shipping pipeline. Idea → code → reviewed → live. Whole numbers are required. Decimals are optional.

---

## The Flow

```
CAPTURE     /zv01-triage → /zv02-create-issue → (/grill-me)
UNDERSTAND  /zv03-explore → (/zv03.5-research)
PLAN        /zv04-plan → (/zv04.5-challenge)
BUILD       /zv05-execute (auto-runs /simplify before final commit)
VERIFY      /zv06-review (auto-launches /zv07-codex in parallel for big diffs) → /zv08-qa
DOCUMENT    /zv09-document
SHIP        /zv10-ship → (/zv10.1-retro) → (/zv10.2-learn)
```

**Quick fix?** `/zv05` → `/zv06` → `/zv09` → `/zv10` (codex auto-launches if diff is big enough)
**Big feature?** Start from `/zv01`, use everything.

---

## All Commands (one-liner)

| # | Command | What it does |
|---|---------|-------------|
| 00.5 | `/zv00.5-setup` | One-time project setup (directories, GitHub CLI verification) |
| 01 | `/zv01-triage` | Look at the board, pick what to work on next |
| 02 | `/zv02-create-issue` | Quick-capture a bug or idea to GitHub |
| 02.5 | `/grill-me` | Stress-test a design — resolve every decision branch |
| 03 | `/zv03-explore` | Dig into the codebase to understand what needs to change |
| 03.5 | `/zv03.5-research` | Google/research how others solved similar problems |
| 04 | `/zv04-plan` | Write the implementation plan with checkboxes |
| 04.5 | `/zv04.5-challenge` | Stress-test the plan before committing to it |
| 05 | `/zv05-execute` | Build it. Follow the plan, commit as you go. Auto-runs `/simplify` at end |
| 06 | `/zv06-review` | Claude reviews + auto-launches Codex in parallel (≥50 lines or 3+ files) |
| 07 | `/zv07-codex` | Codex standalone review (auto-launched by 06, or run manually) |
| 08 | `/zv08-qa` | Test the app like a real user, find and fix bugs |
| 09 | `/zv09-document` | Update docs (CLAUDE.md, rules, changelog) — commit locally |
| 10 | `/zv10-ship` | Push, create PR, auto-merge, close GitHub issue, exit worktree |
| 10.1 | `/zv10.1-retro` | Weekly stats — what shipped, what's hot, what's slow |
| 10.2 | `/zv10.2-learn` | Teach me how something works (3 levels of depth) |

---

## Details

### `/zv00.5-setup` — Project Setup *(one-time, optional)*
Run once per project. Detects your stack, sets up directories, verifies GitHub CLI is connected.

---

### `/zv01-triage` — Pick Next Task
- Reads your GitHub issues (open, backlog, in progress)
- Detects where each issue is in the ZV workflow
- Recommends what to work on next
- Doesn't change anything — read-only

---

### `/zv02-create-issue` — Quick Capture
- You thought of something while working? Capture it to GitHub fast
- Asks a few questions to fill in the details, then creates the issue
- Get back to what you were doing

---

### `/grill-me` — Stress-Test the Design *(optional)*
- Interview you relentlessly about your plan or design
- Walk down each branch of the decision tree, resolving dependencies one-by-one
- If a question can be answered by exploring the codebase, explores the codebase instead
- Use before exploration to resolve ambiguity in the spec

---

### `/zv03-explore` — Exploration
- Deep dive into the codebase to understand what needs to change
- Identifies affected files, dependencies, edge cases, risks
- Never writes code — just builds understanding
- Saves findings to `ai/zv/explorations/`

---

### `/zv03.5-research` — Web Research *(optional)*
- Searches the internet for how others solved similar problems
- Best practices, library options, competitor patterns
- Use when the feature has external parallels worth studying

---

### `/zv04-plan` — Create Plan
- Produces a step-by-step plan with checkboxes
- Marks commit points (where to save progress)
- This becomes the contract for execution
- Saves to `ai/zv/plans/`

---

### `/zv04.5-challenge` — Scope Challenge *(optional)*
- "Is this the right problem? What if we do nothing?"
- "What already exists that partially solves this?"
- "Is this too complex? Can we do less?"
- Use before big features or when scope feels off

---

### `/zv05-execute` — Build It
- Follows the plan step by step
- Commits at each checkpoint
- Runs tests and lint after implementation
- **Auto-runs `/simplify`** after verify passes — cleans up redundancy, reuse, and quality before review
- Updates GitHub issue label to "status: in-progress"

---

### `/zv06-review` — Claude Code Review (+ Codex)
- Reviews its own code in two passes (security first, then quality)
- Auto-fixes obvious stuff (dead code, console.logs, magic numbers)
- **Auto-launches `/zv07-codex` in parallel** if diff ≥50 lines or 3+ files
- Merges Codex findings into one review file, dedupes overlaps
- Only asks you about things that change behavior or involve security
- Updates GitHub issue label to "status: in-review"
- Saves to `ai/zv/reviews/`

---

### `/zv07-codex` — Codex Review (standalone)
- Second opinion from a completely different AI (OpenAI Codex)
- Different model = different blind spots = catches what Claude missed
- Auto-fixes real bugs, dismisses false alarms, asks you about the rest
- **Usually auto-launched by `/zv06-review`** — run standalone for small diffs or re-runs

---

### `/zv08-qa` — QA Testing
- Tests the app like a real user clicking around
- Checks: pages load, buttons work, forms submit, data persists
- Finds bugs and fixes them automatically (up to a safety limit)
- Gives you a health score and ship/no-ship verdict
- Saves to `ai/zv/reviews/`

---

### `/zv09-document` — Document Before Ship
- Updates CLAUDE.md if the architecture changed
- Creates a changelog entry
- Saves to `ai/zv/changelogs/`
- Commits locally — Ship pushes everything

---

### `/zv10-ship` — Ship to Staging
- Merges latest code, runs all tests, pushes, creates a PR
- PR includes a "How to Test" checklist for you to click through
- Auto-merges to staging when CI passes
- Only stops for real problems (merge conflicts, test failures)

---

### `/zv10.1-retro` — Retrospective *(optional)*
- Analyzes what shipped over a time window (default: last 7 days)
- Commit count, lines of code, most-changed files, work patterns
- Use weekly or after a big milestone
- Arguments: `24h`, `14d`, `30d`, `compare`

---

### `/zv10.2-learn` — Learn Something *(optional)*
- Pick a concept, get it explained at three levels of depth
- Uses examples from your actual codebase
- Not a tutorial — a conversation with a peer who knows the code

---

## Quick Reference

```
REQUIRED                           OPTIONAL
01  Triage                         00.5  Setup (one-time)
02  Create Issue                   02.5  Grill Me
                                   03.5  Research
03  Explore                        04.5  Challenge
04  Plan                           10.1  Retro
05  Execute                        10.2  Learn
06  Review (Claude)
07  Codex Review
08  QA
09  Document
10  Ship
```

## GitHub Status Flow

```
Backlog → Todo → In Progress → In Review → Done
                      ↑            ↑          ↑
                   /zv05        /zv06       /zv10
```

## What Changed (2026-04-01)

- **Document/Ship reordered**: `/zv09-document` (Stage 9) → `/zv10-ship` (Stage 10) — document before ship so docs are included in the PR

## What Changed (2026-03-29)

- **`/zv05-execute` now auto-runs `/simplify`** after verify loop passes — mechanical cleanup (redundancy, reuse, quality) before code hits review
- Flow: build → verify → simplify → commit → review

## What Changed (2026-03-24)

- **NEW `/zv07-codex`** — Codex adversarial review, now a required step
- **`/zv08-qa`** — promoted from optional to required
- Steps renumbered: 07→09, 08→10, 08.5→10.1 retro, 09→10.2 learn (ship/document later reordered — see 2026-04-01)
- Rule: integers = required, decimals = optional
