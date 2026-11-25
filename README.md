# FocusFlow

A personal workload operating system. Tasks are treated as demand against a finite capacity — your working hours — and FocusFlow shows where the two collide, plans around it, lets you test changes before committing, and learns from how your work actually goes.

Everything runs in the browser. There is no backend, no account and no AI service: data lives in IndexedDB on your device.

## Features

| Area | What it does |
|---|---|
| **Command Center** | Today at a glance: open work, deadline risk, 7-day load, a load forecast and the day's schedule. |
| **Tasks** | Keyboard-driven list with grouping, filters, priorities, difficulty, estimates, deadlines and dependencies. |
| **Timeline** | Day/week calendar against your working hours; drag, resize and keyboard-nudge blocks; unscheduled tray. |
| **Automatic scheduling** | A deterministic scheduler recommends when to do each task, weighing deadline, priority, difficulty, dependencies, free time and existing commitments. |
| **Simulator** | Fork the schedule into scenarios — move, add or remove blocks, take a day off, change estimates, deadlines or priorities, auto-plan — compare against the baseline, then apply or discard. |
| **Insights** | Completion rate, estimate accuracy, weekly workload, most productive hours, frequently postponed tasks and time by category — plus estimate suggestions in the task editor. |
| **Focus Mode** | A full-screen pomodoro workspace for one task with break reminders; focus time is recorded as actual time. |
| **Settings** | Working hours, Focus Mode defaults, categories, backup export/import and data reset. |

Press <kbd>?</kbd> anywhere for keyboard shortcuts, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> for the command palette.

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Framer Motion · Radix UI · Lucide · Recharts · Dexie (IndexedDB) · Zustand · Vitest

## Getting started

Requires Node.js 20.19+ or 22.12+ (what Vite 8 needs).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (watch mode); `npx vitest run` for a single run
npm run typecheck
npm run build      # production build into dist/
npm run preview    # serve dist/ with the production headers from vercel.json
```

A new browser profile starts with a demo workspace, including eight weeks of sample history. Settings → Data can clear it, reload it, or import a backup.

## Architecture

```
src/
  domain/    Pure logic: risk, capacity, working hours, insights, pomodoro engine, validation
  engine/    Scheduler and the simulator (scenario ops, analysis, diff/apply plan)
  services/  The only code that writes to IndexedDB — each command is one transaction
  features/  UI building blocks per area, plus actions (toast + undo around services)
  routes/    Pages, loaded on demand (code-split per route)
  hooks/     Live queries (re-render when IndexedDB changes, in any tab)
  db/        Dexie schema, migrations, demo seed and generated history
  ui/        Design-system primitives
```

Rules the code follows:

- **Domain and engine are pure** — no I/O, no clock reads (time is passed in) — and carry most of the unit tests.
- **Only services write to the database**, always inside a transaction; they return what changed so actions can offer undo.
- **One global undo stack**: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd> reverts the latest change wherever it happened.
- **Working hours are data**, read live and passed to every capacity, risk and scheduling calculation.

## Data and privacy

- Stored in this browser only (IndexedDB). Clearing site data deletes it — export a backup from Settings → Data to keep or move it.
- Backups are a single JSON file with tasks, categories, schedule, time entries, scenarios and preferences. Imports are validated before anything is written.
- No network requests are made after the app loads; the production Content-Security-Policy (`connect-src 'self'`) enforces it.

## Deploying to Vercel

The repo is ready for Vercel as a static site:

1. Push the repository to GitHub/GitLab/Bitbucket.
2. In Vercel, **Add New → Project**, import the repository. The settings come from `vercel.json` (framework Vite, `npm run build`, output `dist`).
3. Deploy.

`vercel.json` also:

- rewrites every path to `index.html` so deep links like `/settings#data` work;
- caches hashed assets for a year and revalidates `index.html` on every visit, so new releases are picked up immediately;
- sends security headers (CSP, `nosniff`, referrer and permissions policies). `npm run preview` serves the same headers locally — check there after changing dependencies.

Or from the command line: `npx vercel` (preview) and `npx vercel --prod`.

## Accessibility

- All controls have accessible names; dialogs, menus and popovers trap and restore focus (Radix).
- A "Skip to content" link, a page title per route, and focus moved to the page after navigation.
- Text contrast meets WCAG AA; animations respect the OS "reduce motion" setting.
- Keyboard alternatives for pointer interactions: timeline blocks can be focused with <kbd>Tab</kbd> and moved with the arrow keys (<kbd>Shift</kbd>+arrows to resize).
