# Generate Weekly UI/UX Audit Prompt

You are creating a tailored weekly visual and accessibility audit prompt for a project. The output is a complete `ai/prompts/audit-uiux-weekly.md` plus a `scripts/visual-qa.ts` Playwright script, both customized to the project.

## Step 1: Gather project context

Read `CLAUDE.md` (or `README.md`). Identify:

- **Project name** and type (SPA, multi-page, dashboard, landing page, etc.)
- **Framework**: Next.js, Remix, Vite+React, etc.
- **Styling**: Tailwind + CSS variables, shadcn/ui, styled-components, CSS modules, etc.
- **Theming**: how light/dark mode works (`data-theme`, `.dark` class, next-themes, media query)
- **Dev server**: port, command to start
- **Key pages/views**: list all user-facing routes or view states
- **Modals/overlays/drawers**: list all interactive overlays and how to trigger them
- **Navigation pattern**: sidebar, top nav, tabs, routes
- **Component library**: shadcn/ui, custom, MUI, etc.
- **Existing tooling**: any existing visual QA, Storybook, lint scripts

## Step 2: Discover pages and interactive states

Explore the codebase to build two lists:

**Base views** — every distinct page/view the user can navigate to:
- Check `app/` or `pages/` directory for routes
- Check sidebar/nav components for view switching
- Include any standalone routes (e.g., `/settings`, `/onboarding`)

**Interactive states** — modals, drawers, and overlays:
- Search for Modal, Dialog, Drawer, Overlay, Sheet, Popover components
- For each, find the trigger (what button/element opens it)
- Determine the Playwright selector to open it
- Note how to dismiss it (Escape, X button, overlay click)

## Step 3: Generate `scripts/visual-qa.ts`

Create a Playwright script tailored to the project. Include:

### Config
- `BASE_URL` from env var or default to project's dev port
- `DESKTOP_VIEWPORT = { width: 1440, height: 900 }`
- `MOBILE_VIEWPORT = { width: 375, height: 812 }`
- `SCREENSHOT_DIR`

### VIEWS array
One entry per page/view with:
- `name`: kebab-case identifier
- `setup`: navigate to the page, wait for load, handle any auth/redirects

### INTERACTIVE_STATES array
One entry per modal/drawer with:
- `name`: descriptive kebab-case (e.g., `settings-api-key-modal`)
- `setup`: navigate + trigger the modal open
- `dismiss`: Escape key or close button

Include form error states where applicable (submit empty form → screenshot validation).

### Theme switching
Adapt to the project's theming approach:
- `data-theme` attribute → `document.documentElement.setAttribute("data-theme", t)`
- `.dark` class (next-themes) → `document.documentElement.classList.toggle("dark")`
- Media query → use `page.emulateMedia({ colorScheme: theme })`

### Axe-core
Use tag-based WCAG 2.1 AA selection:
```ts
new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
```

### Keyboard/focus audit
`runKeyboardAudit()` function: Tab 10 times per view, screenshot each focus state, flag missing visible focus indicators.

### CLI flags
`--dark`, `--light`, `--mobile`, `--desktop`, `--skip-keyboard`

### Output
- Screenshots to `screenshots/{theme}/`, `screenshots/{theme}/mobile/`, `screenshots/{theme}/focus/`
- `qa-summary.json` with violations, focusIssues, screenshot count

## Step 4: Generate `ai/prompts/audit-uiux-weekly.md`

Follow this structure, tailored to the project:

```markdown
# /audit-uiux-weekly — {ProjectName} Visual & Accessibility Audit

> **Run:** `claude -p "$(cat ai/prompts/audit-uiux-weekly.md)" --allowedTools Edit,Write,Bash,Read,Glob,Grep --max-budget-usd 8`
>
> **Frequency:** Weekly
> **Duration:** ~15-20 min
> **Scope:** Screenshots, contrast, a11y, dark mode — requires dev server
> **Prereqs:** Dev server must be running

---

## Step 1: Color lint (no server needed)

[Project-specific color lint command — use existing lint script if available, or suggest creating one]

Color replacement guide tailored to the project's system:
- Tailwind + CSS vars: `bg-white` → `bg-[var(--bg-elevated)]`
- shadcn/ui: `bg-white` → `bg-background`
- CSS modules: flag hardcoded hex values

## Step 2: Visual QA screenshots + a11y

[Dev server check + visual-qa.ts command]

## Step 3: Review a11y violations

[qa-summary.json review with fix guidance]

### Critical (must fix)
- button-name, link-name, label, image-alt

### Serious (fix if possible)
- color-contrast (with project-specific variable guidance)
- heading-order
- landmark
- aria-required-attr

## Step 3b: Review keyboard/focus findings

[Focus issues review from qa-summary.json]

## Step 4: Structured visual review of screenshots

### 4a. Review every screenshot individually
[Screenshot paths for project]

Checklist table:
| Check | What to look for |
|-------|-----------------|
| White/light boxes | ... |
| Invisible text | ... |
| Text overflow | ... |
| Layout breaks | ... |
| Inconsistent spacing | ... |
| Orphaned UI elements | ... |
| Empty states | ... |
| Mobile layout | ... |
[Add project-specific checks, e.g., "Map overlay issues" for map-heavy apps]

### 4b. Light vs dark comparison
### 4c. Findings table
### 4d. Fix only high-confidence issues (>= 0.8)

## Rules
[Standard rules + project-specific constraints]

## Process
1. Run color lint → fix all
2. Run visual QA → review output
3. Fix all critical a11y issues
4. Fix serious a11y issues
5. Review screenshots using structured checklist
6. Compare light vs dark
7. Present findings table → fix high-confidence only
8. Regression check (last 3 audit log entries)
9. Verify (typecheck + lint)
10. Re-run visual QA
11. Commit + push
12. Log
```

## Step 5: Ensure dependencies

Check if Playwright and axe-core are installed:
```bash
npm ls @playwright/test @axe-core/playwright 2>/dev/null
```
If missing, inform the user they need to install:
```bash
npm install -D @playwright/test @axe-core/playwright && npx playwright install chromium
```

Also check for a color lint script. If none exists, suggest creating one or note it as a follow-up.

## Step 6: Add npm script

Check `package.json` for a `visual-qa` script. If missing, add:
```json
"visual-qa": "npx tsx scripts/visual-qa.ts"
```

## Step 7: Create supporting files

Create if they don't exist:
- `ai/prompts/daily-audit-log.md` — shared log with table header

## Step 8: Verify

- Run `npx tsc --noEmit` to confirm the script compiles
- Read back both files and confirm all paths, selectors, and commands are correct for this project
- Confirm the visual-qa script's VIEWS array covers all user-facing pages
- Confirm INTERACTIVE_STATES covers all modals/drawers found in Step 2
