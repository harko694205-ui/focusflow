# FocusFlow — Architecture & Implementation Plan

Status: **implemented** (Phases 1–7). This was the original proposal; the code is the source of truth where they differ. See README.md for the current feature set.

---

## 1. Requirements analysis

### What FocusFlow is
A personal **workload operating system**: tasks are not a list, they are *demand* placed against a finite *capacity* (your working hours). The app's job is to make the relationship between the two visible and testable.

Three layers, each built on the one before:

| Layer | Question it answers | Surfaces |
|---|---|---|
| **Organize** | What do I have to do? | Tasks |
| **Visualize** | Where does it fit, and where am I overloaded? | Timeline, Command Center |
| **Simulate** | What happens if I change something? | Simulator, Insights |

### The defining feature: the Simulator
A scenario is a **sandboxed fork of the committed schedule**. The user applies changes (“take Friday off”, “push Project X by a week”, “this task is actually 6h, not 2h”, “drop all P3 work”) and sees the consequences *before* committing:

- Which deadlines slip, and by how much
- Daily load vs. capacity (overload hours, idle hours)
- Focus fragmentation (how many uninterrupted deep-work blocks survive)
- Projected completion date per project
- A side-by-side / overlay diff against the baseline

Then **Commit** (apply atomically to real data) or **Discard**. Multiple scenarios can exist and be compared.

This implies the core of the product is a **deterministic scheduling + metrics engine** that is pure, fast and explainable. Everything else is UI over that engine.

### Implicit requirements I'm inferring
- **Capacity model**: weekly working-hours template + per-date overrides (day off, half day). Without this, “overload” has no meaning.
- **Estimates and actuals**: tasks need an estimate; Insights needs actuals (simple focus-session tracking) to compute estimate accuracy.
- **Fixed vs. flexible time**: meetings/events are locked; tasks are movable. The engine must respect locked blocks.
- **Explainability**: if the engine places or bumps a task, the user must be able to see why (deadline, priority, dependency, no capacity).
- **Data ownership**: since everything is local, JSON export/import is a must, not a nice-to-have.
- **Keyboard-first**: Linear/Raycast inspiration implies a command palette and shortcuts.

### Out of scope (v1)
Sync, collaboration, calendar import (ICS could be a later phase), recurring tasks (proposed for a later phase — they complicate the engine), mobile-first layouts (responsive down to tablet; desktop is primary).

---

## 2. Architecture

### Stack
| Concern | Choice | Notes |
|---|---|---|
| Build | Vite + React 19 + TypeScript (strict) | |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first `@theme` tokens) | Tokens live in one CSS file |
| Motion | Motion (`motion/react`, the current Framer Motion package) | |
| Icons | lucide-react | |
| Charts | Recharts | Lazy-loaded with Insights route |
| Persistence | Dexie.js + `dexie-react-hooks` (`useLiveQuery`) | IndexedDB is the source of truth |
| **Proposed additions** | | Need your OK |
| Routing | `react-router` | 6 routes + task deep links |
| UI state | `zustand` | Ephemeral state only: simulator draft, selection, palette |
| Dates | `date-fns` | DST-safe local-day math |
| Tests | Vitest | Engine is pure TS — heavily unit-tested |
| Fonts | `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` | Self-hosted, works offline |

Drag-and-drop on the timeline will be **custom pointer handling** (time↔pixel scale, snap to 15 min), not a DnD library — calendar-style resize/move is simpler and faster hand-rolled than adapted.

### Layering

```
┌─────────────────────────────────────────────────────────┐
│ UI (routes/, features/*/components)                     │
│   reads via hooks · dispatches commands                 │
├─────────────────────────────────────────────────────────┤
│ Application layer (features/*/hooks, services/)         │
│   useTasks(), useSchedule(range), useScenario(id)       │
│   commands: createTask, moveBlock, commitScenario …     │
├──────────────────────────┬──────────────────────────────┤
│ Engine (engine/)  PURE   │ Data (db/)                   │
│  scheduler, metrics,     │  Dexie schema, migrations,   │
│  scenario ops, diff      │  repositories, seed, export  │
│  no React, no Dexie      │                              │
│  runs in a Web Worker    │                              │
└──────────────────────────┴──────────────────────────────┘
```

Rules:
- **Engine is pure**: `(tasks, blocks, capacity, ops) → { schedule, metrics, explanations }`. No I/O. This makes it testable and lets the Simulator run it on every lever change.
- **Dexie is the single source of truth for committed data.** Components read with `useLiveQuery` (also gives free cross-tab sync).
- **Scenarios never mutate real data** until commit. A scenario is stored as a list of operations applied on top of the baseline in memory.
- Engine runs in a **Web Worker** once it exceeds a frame budget (start on main thread behind an async interface so the switch is a one-file change).

### Folder structure

```
src/
  app/            App shell, router, providers, layout (sidebar, top bar)
  routes/         command-center, timeline, tasks, simulator, insights, settings
  features/
    tasks/        list, detail panel, quick-capture, filters
    timeline/     time grid, block, drag/resize, unscheduled tray
    simulator/    levers panel, compare view, consequence panel
    insights/     chart modules
    command/      command palette, shortcuts registry
  engine/         scheduler.ts, metrics.ts, scenario.ts, diff.ts, explain.ts, __tests__/
  db/             schema.ts, migrations.ts, repos/*, seed.ts, backup.ts
  ui/             design-system primitives (Button, Panel, Kbd, Tooltip, Dialog …)
  lib/            time.ts (minute math, local-day keys), ids, format
  styles/         tokens.css (Tailwind @theme), globals.css
```

---

## 3. Data models

Conventions: IDs are ULIDs (sortable, client-generated). Instants are **epoch ms (UTC)**. Calendar days are **local `YYYY-MM-DD` keys**. Durations are **minutes**.

```ts
type ID = string;            // ULID
type Instant = number;       // epoch ms
type DayKey = string;        // 'YYYY-MM-DD', local
type Minutes = number;

type Priority = 0 | 1 | 2 | 3;               // 0 = urgent … 3 = low
type Energy = 'deep' | 'shallow' | 'admin';  // cognitive type of work
type TaskStatus = 'inbox' | 'todo' | 'in_progress' | 'done' | 'archived';

interface Project {
  id: ID; name: string; color: string;       // token name, not hex
  archived: boolean; createdAt: Instant;
}

interface Task {
  id: ID; title: string; notes?: string;
  projectId?: ID; tags: string[];
  status: TaskStatus; priority: Priority; energy: Energy;
  estimate: Minutes;                         // required for scheduling
  deadline?: Instant;                        // hard due
  earliestStart?: Instant;                   // can't start before
  dependsOn: ID[];                           // task ids
  splittable: boolean; minChunk: Minutes;    // e.g. true, 30
  createdAt: Instant; updatedAt: Instant; completedAt?: Instant;
}

interface TimeBlock {                        // something occupying the timeline
  id: ID;
  kind: 'task' | 'event' | 'buffer';         // event = fixed meeting etc.
  taskId?: ID; title?: string;               // title for events
  start: Instant; end: Instant;
  locked: boolean;                           // engine may not move it
  origin: 'manual' | 'auto';                 // placed by user vs engine
}

interface CapacityTemplate {                 // weekly working hours (singleton)
  id: 'default';
  week: Record<0|1|2|3|4|5|6, Array<{ start: Minutes; end: Minutes }>>; // minutes from midnight
  peakWindows: Array<{ start: Minutes; end: Minutes }>;                 // preferred deep-work time
  dailyFocusTarget: Minutes;
}

interface CapacityOverride {                 // per-date exception
  day: DayKey;
  intervals: Array<{ start: Minutes; end: Minutes }>;   // [] = day off
  reason?: string;
}

interface FocusSession {                     // actuals, for Insights
  id: ID; taskId: ID; start: Instant; end: Instant;
}

// ---- Simulator ----
type ScenarioOp =
  | { type: 'moveBlock';      blockId: ID; start: Instant; end: Instant }
  | { type: 'setEstimate';    taskId: ID; estimate: Minutes }
  | { type: 'setDeadline';    taskId: ID; deadline: Instant | null }
  | { type: 'setPriority';    taskId: ID; priority: Priority }
  | { type: 'deferTask';      taskId: ID; until: Instant }
  | { type: 'dropTask';       taskId: ID }
  | { type: 'addTask';        draft: Omit<Task, 'id'|'createdAt'|'updatedAt'>; tempId: ID }
  | { type: 'shiftProject';   projectId: ID; byDays: number }
  | { type: 'overrideDay';    day: DayKey; intervals: Array<{ start: Minutes; end: Minutes }> }
  | { type: 'setWeeklyHours'; week: CapacityTemplate['week'] }
  | { type: 'reschedule';     strategy: 'deadline' | 'priority' | 'balanced' };

interface Scenario {
  id: ID; name: string; notes?: string;
  ops: ScenarioOp[];                         // ordered; undo = pop
  baseRevision: number;                      // baseline revision when forked
  status: 'draft' | 'committed' | 'discarded';
  createdAt: Instant; updatedAt: Instant;
}

interface Revision {                         // audit trail of commits
  id: number;                                // auto-increment = baseline revision
  at: Instant; source: 'edit' | 'scenario';
  scenarioId?: ID; summary: string;
}

interface Setting { key: string; value: unknown }   // weekStart, timeFormat, accent, etc.
```

### Engine outputs (derived, never stored — or cached only)
```ts
interface ScheduleResult {
  blocks: TimeBlock[];                       // full placed schedule for horizon
  unplaced: Array<{ taskId: ID; reason: 'no_capacity' | 'blocked_dependency' | 'after_deadline_window' }>;
  explanations: Record<ID, string[]>;        // per block: why it landed here
}
interface Metrics {
  perDay: Record<DayKey, { capacity: Minutes; planned: Minutes; overload: Minutes; deepBlocks: number; switches: number }>;
  lateTasks: Array<{ taskId: ID; lateBy: Minutes }>;
  slack: Record<ID, Minutes>;                // time between projected finish and deadline
  projectFinish: Record<ID, Instant>;
  utilization: number;                       // planned / capacity over horizon
  fragmentation: number;                     // 0..1
  riskScore: number;                         // 0..100 composite
}
interface ScenarioDiff { moved: ID[]; added: ID[]; dropped: ID[]; metricDeltas: Partial<Record<keyof Metrics, number>> }
```

### Dexie schema (v1)
```ts
db.version(1).stores({
  projects:          'id, archived',
  tasks:             'id, status, projectId, deadline, priority, updatedAt, *tags',
  blocks:            'id, start, end, taskId, kind',
  capacityTemplate:  'id',
  capacityOverrides: 'day',
  focusSessions:     'id, taskId, start',
  scenarios:         'id, status, updatedAt',
  revisions:         '++id, at',
  settings:          'key',
});
```

### Scheduler (v1 algorithm)
Deterministic greedy fill over a configurable horizon (default 4 weeks):
1. Build free-capacity intervals = working hours − overrides − locked blocks.
2. Topologically order tasks by `dependsOn`; detect and report cycles.
3. Sort ready tasks by score: deadline urgency (slack) → priority → energy fit → age.
4. Place each task into the earliest free interval that fits (respecting `earliestStart`, `minChunk`, splitting if `splittable`); deep work prefers `peakWindows`.
5. Record an explanation string for each placement and a reason for each unplaced task.

Manual, non-auto blocks are respected as-is; only `origin: 'auto'` blocks are re-flowed. This keeps the user in control: the engine fills gaps, it never overrides a deliberate choice.

---

## 4. Design system

### Principles
Dense but calm. Information carried by **typography, alignment and numbers**, not boxes. Separation by **1px hairlines and background steps**, not shadows. One accent color, used sparingly for focus, selection and the “now” line.

### Color tokens (dark only for v1)
| Token | Value | Use |
|---|---|---|
| `bg-0` | `#0A0A0C` | App background |
| `bg-1` | `#101013` | Sidebar, panels |
| `bg-2` | `#16161A` | Raised surfaces, inputs |
| `bg-3` | `#1D1D22` | Hover, active rows |
| `line` | `rgba(255,255,255,0.06)` | Default hairlines |
| `line-strong` | `rgba(255,255,255,0.10)` | Inputs, focused panels |
| `fg-1` | `#EDEDF0` | Primary text |
| `fg-2` | `#A0A0AB` | Secondary text |
| `fg-3` | `#6A6A75` | Tertiary, labels, axis ticks |
| `accent` | `#7C83FF` (iris) | Focus ring, selection, now-line, primary button |
| `positive` | `#3DB88B` | Ahead of schedule, slack |
| `negative` | `#E5534B` | Late, overload |
| `warning` | `#D9A441` | At risk |

**Data-viz palette** (muted, distinguishable, colorblind-checked during Phase 0): energy types `deep` / `shallow` / `admin`, plus 8 desaturated project hues. Charts use `fg-3` axes, `line` gridlines, no chart borders, no gradients.

### Typography
- **Inter Variable** for UI, `font-feature-settings: 'cv11', 'ss01'`.
- **JetBrains Mono** for times, durations, metrics, IDs — always `tabular-nums`. This is where the “trading terminal” feel comes from.
- Scale (px): `11 · 12 · 13 (base) · 14 · 16 · 20 · 24`. Nothing larger than 24 in the app UI.
- Weights: 400 / 500 / 600 only.

### Shape, space, elevation
- 4px spacing grid. Row height 32px (dense) / 36px (default).
- Radius: `2` (tags), `4` (inputs, buttons), `6` (panels, popovers). No pill-shaped cards.
- Elevation: popovers/dialogs get `bg-2` + `line-strong` border + one soft shadow; nothing else has shadows.

### Motion
- Durations: `120ms` (hover, press), `180ms` (panels, popovers), `240ms` (route, layout).
- Easing: `cubic-bezier(0.2, 0, 0, 1)`; springs only for drag release and simulator block re-flow (blocks visibly slide to new positions when a lever changes — this is the signature interaction).
- `prefers-reduced-motion` disables layout animation globally.

### Core primitives (`src/ui/`)
Button, IconButton, Input, Textarea, Select, SegmentedControl, Checkbox, Kbd, Tooltip, Popover, Menu, Dialog, Sheet (side panel), Panel/Section header, Stat (label + mono value + delta), Delta (±, colored), Tag, ProgressBar/LoadBar, Sparkline, EmptyState, Toast, CommandPalette.

### Page layouts (sketch)
- **Shell**: 220px collapsible sidebar (6 nav items with shortcuts `G C`, `G T` …), slim top bar with breadcrumb + global search (`⌘K`).
- **Command Center**: now/next strip · today load bar vs capacity · 14-day load heatmap · at-risk tasks (lowest slack) · quick capture.
- **Timeline**: vertical time grid (day / 3-day / week), capacity shaded, overload hatched, now-line, unscheduled tray on the right, drag/resize with 15-min snap.
- **Tasks**: dense keyboard-navigable table (group by project/status/deadline), inline edit, detail sheet.
- **Simulator**: three columns — *Levers & op stack* (left) · *Baseline vs scenario timeline*, ghosted baseline under live scenario (center) · *Consequences*: metric deltas, slipped deadlines, explanations (right). Scenario tabs on top; Commit / Discard.
- **Insights**: estimate accuracy, planned vs actual, load distribution by energy/project, fragmentation trend, throughput.
- **Settings**: working hours editor, peak windows, week start, time format, export/import, seed demo data, reset.

---

## 5. Phased implementation plan

Each phase ends in a runnable, reviewable state. I'll stop for review after each.

| # | Phase | Deliverable |
|---|---|---|
| **0** | **Foundation** | Node install check, Vite+TS+Tailwind v4 scaffold, ESLint/Prettier, Vitest, tokens.css, fonts, app shell with sidebar + routing for all 6 pages (empty states), core UI primitives, `vercel.json` SPA rewrite. |
| **1** | **Data layer + Tasks** | Dexie schema, repositories, demo seed data, JSON export/import. Full Tasks page: create/edit/delete, filters, grouping, keyboard nav, detail sheet, quick capture. |
| **2** | **Engine** | `lib/time.ts` (DST-safe), capacity calculation, scheduler, metrics, explanations, scenario op application, diff. Comprehensive unit tests. No UI beyond a debug readout. |
| **3** | **Timeline** | Time grid (day/3-day/week), capacity shading, blocks, custom drag/resize with snap, locked events, unscheduled tray, “auto-fill” button driven by the engine. |
| **4** | **Simulator** | Scenario CRUD, lever controls for each op type, op stack with undo, ghosted compare timeline with animated re-flow, consequences panel, multi-scenario compare, commit (atomic Dexie transaction + revision) / discard, stale-op detection. |
| **5** | **Command Center + Insights** | Today/at-risk/heatmap views; Recharts modules (lazy route), focus-session timer for actuals. |
| **6** | **Settings + polish** | Working-hours editor, command palette (`⌘K`) and shortcut registry, empty/loading/error states, a11y pass (focus order, ARIA, contrast), performance pass, persistent-storage request, Vercel deploy. |

Rationale for the order: the engine (Phase 2) is built **before** the Timeline and Simulator so both are thin UIs over a tested core, rather than embedding scheduling logic in components.

---

## 6. Technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Node.js is not installed on this machine** (`node`/`npm` not found on PATH) | Blocks Phase 0 | Install Node 22 LTS before we start (e.g. `winget install OpenJS.NodeJS.LTS`). |
| **Time zones & DST** | Blocks shift by an hour, 23/25h days break the grid | Store UTC instants, compute days via `date-fns` in local time, all grid math through one `time.ts` module with DST unit tests. |
| **Scheduler scope creep** | “Optimization” can become an NP-hard rabbit hole | Ship a deterministic greedy heuristic with explanations; “optimize” = choose among a few strategies, not a solver. Predictable beats optimal for user trust. |
| **Simulator responsiveness** | Re-running engine on every slider tick could jank | Engine behind async interface; debounce levers; move to Web Worker if > ~8ms; memoize capacity intervals. |
| **Scenario staleness** | Baseline edited while a draft scenario exists; ops reference deleted tasks | Ops are replayable against current baseline; `baseRevision` mismatch shows a “rebased” notice; invalid ops are flagged and skipped, never silently applied. |
| **Commit atomicity** | Partial application corrupts data | Commit inside a single Dexie `rw` transaction across all tables + revision record. |
| **IndexedDB durability** | Browser may evict storage; Safari private mode quirks | `navigator.storage.persist()`, prominent export/backup, schema versioned with Dexie migrations from day one. |
| **Custom timeline drag** | Pointer edge cases (scroll during drag, touch, overlap) | Pointer Events + capture, transform-only movement during drag, write to DB on drop only; overlap lanes computed by a pure layout function (tested). |
| **Motion + large lists** | Layout animations on hundreds of rows are expensive | Animate only timeline blocks and panels; Tasks table uses no layout animation; reduced-motion respected. |
| **Recharts styling/bundle** | Default look is generic; adds ~100KB | Custom tick/tooltip components themed to tokens; Insights route lazy-loaded. |
| **Vercel SPA routing** | Deep links 404 on refresh | `vercel.json` rewrite all paths → `/index.html`. |
| **Metric meaningfulness** (product risk) | “Risk score” that feels arbitrary undermines the Simulator | Every composite metric is decomposable in the UI (hover shows its inputs); prefer concrete numbers (hours late, days slipped) over scores. |

---

## 7. Decisions needed before Phase 0

1. Approve the **proposed additions**: react-router, zustand, date-fns, Vitest, self-hosted fonts.
2. **Accent color**: iris `#7C83FF` (Linear-like) vs. amber `#E0A43B` (more trading-terminal).
3. **Week start**: Monday or Sunday default.
4. **Recurring tasks**: defer to post-v1 (recommended) or include in Phase 1/2.
5. Install **Node 22 LTS**.
