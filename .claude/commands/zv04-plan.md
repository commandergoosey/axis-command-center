# Plan Creation Stage

## Wiki Context Load

Before writing the plan, load architectural context:

1. Read `/Users/commandergoosey/Projects/Brain Work/projects/axis/index.md`
2. Read 1-2 wiki pages most relevant to the implementation approach:
   - If the plan involves schema → `data-model.md`
   - If the plan involves auth/security → `architecture.md` (auth model section)
   - If the plan touches an area with known issues → `troubleshooting.md`
3. Factor wiki knowledge into the plan — especially documented constraints, prior dead ends, and architectural patterns

Skip if `/zv03-explore` already loaded wiki context in this session (don't re-read the same pages).

Based on our full exchange, produce a markdown plan document.

## Requirements

- Include clear, minimal, concise steps.
- Track the status of each step using checkboxes.
- Include dynamic tracking of overall progress percentage (at top).
- Do NOT add extra scope or unnecessary complexity beyond explicitly clarified details.
- Steps should be modular, elegant, minimal, and integrate seamlessly within the existing codebase.

## Output

Save the plan to `ai/zv/plans/YYYY-MM-DD-<short-slug>.md` (create directories if needed). Use today's date and a kebab-case slug from the feature name.

Use this structure:

```markdown
# Implementation Plan: [Feature Name]

**Issue:** #42 (if applicable)
**Overall Progress:** `0%`

## TLDR
Short summary of what we're building and why.

## Critical Decisions
Key architectural/implementation choices made during exploration:
- Decision 1: [choice] — [brief rationale]
- Decision 2: [choice] — [brief rationale]

## Verification
How to confirm the implementation works:
- [ ] Build passes (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Manual check: [specific thing to verify]
- [ ] [Any other verification steps]

## Tasks

- [ ] **Step 1: [Name]** ← commit point
  - [ ] Subtask 1
  - [ ] Subtask 2

- [ ] **Step 2: [Name]** ← commit point
  - [ ] Subtask 1
  - [ ] Subtask 2

- [ ] **Step 3: [Name]** ← commit point
  - [ ] Subtask 1
  - [ ] Subtask 2

## Sprint Contract

### FUNC — Functional Acceptance
- [ ] [FUNC-1] Concrete testable behavior
- [ ] [FUNC-2] Another testable behavior

### SEC — Security
- [ ] [SEC-1] Specific security property

### UI — Visual Requirements *(omit if backend-only)*
- [ ] [UI-1] Specific visual requirement

### PERF — Performance *(omit if no concerns)*
- [ ] [PERF-1] Measurable constraint

### REG — Regression Scope
- [ ] [REG-1] What must NOT break
- [ ] [REG-2] Another thing that must NOT break
```

Mark commit points (← commit point) after each major step to guide execution cadence.

## Sprint Contract Rules

The Sprint Contract is the grading rubric for `/zv06-review` and `/zv08-qa`. It MUST be included in every plan.

- **FUNC** (3–7 items, required): Observable behaviors a user or test can verify. Each is one testable statement.
- **SEC** (1–3 items, required): Security properties the implementation must uphold.
- **UI** (1–3 items, omit if backend-only): Specific visual/layout requirements.
- **PERF** (1–2 items, omit if no performance concerns): Measurable constraints (e.g., "< 200ms", "no layout shift").
- **REG** (2–4 items, required): Existing features that must NOT break.

**Quality bar:** Every criterion must be a single testable statement with a clear PASS/FAIL boundary. "Works correctly" or "looks good" are NOT valid. Use concrete verbs: "renders", "returns", "blocks", "persists", "shows error when…".

Use `[TAG-N]` prefixes (e.g., `[FUNC-1]`, `[SEC-2]`) so review and QA can cross-reference results.

Again, it's still not time to build yet. Just write the clear plan document. No extra complexity or extra scope beyond what we discussed.
