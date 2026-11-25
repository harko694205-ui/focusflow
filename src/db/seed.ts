import type { Category, CategoryColor, Difficulty, Priority, Task, TaskStatus, TimeBlock } from '@/domain/types';

/**
 * Realistic demo workspace, generated relative to `now` so deadlines always look current.
 * Loaded on first run; can be cleared or reloaded from the Tasks empty state.
 */

const CATS: Array<[id: string, name: string, color: CategoryColor]> = [
  ['cat-product', 'Product', 'iris'],
  ['cat-client', 'Client work', 'amber'],
  ['cat-planning', 'Planning', 'teal'],
  ['cat-hiring', 'Hiring', 'rose'],
  ['cat-personal', 'Personal', 'slate'],
];

type Row = [
  title: string,
  cat: string,
  priority: Priority,
  difficulty: Difficulty,
  estimate: number,
  /** Days from today, and local time HH:mm */
  dueDays: number,
  dueTime: string,
  status: TaskStatus,
  notes?: string,
];

const ROWS: Row[] = [
  ['Checkout flow QA pass across breakpoints', 'cat-product', 0, 2, 360, 4, '17:00', 'in_progress', 'Mobile Safari and the 768–1024 range still untested. Log issues in the QA board.'],
  ['Pricing page — component build', 'cat-product', 1, 3, 270, 5, '12:00', 'in_progress'],
  ['Design tokens migration for marketing site', 'cat-product', 2, 3, 360, 6, '17:00', 'todo'],
  ['Write release notes for v2.4', 'cat-product', 2, 1, 45, 7, '10:00', 'todo'],
  ['Accessibility audit fixes — focus order', 'cat-product', 1, 2, 150, 9, '17:00', 'todo'],
  ['SOW v3 sign-off with legal', 'cat-client', 0, 2, 180, 2, '16:00', 'todo', 'Legal flagged clause 7.2 (liability cap). Need redlines back before the call.'],
  ['Northwind kickoff deck — data appendix', 'cat-client', 2, 2, 150, 2, '14:00', 'todo'],
  ['Invoice Northwind for November', 'cat-client', 1, 1, 20, -1, '17:00', 'todo'],
  ['Team capacity model — first draft', 'cat-planning', 1, 3, 480, 7, '17:00', 'todo', 'Inputs: headcount plan, PTO calendar, historical velocity.'],
  ['Collect OKR inputs from leads', 'cat-planning', 2, 1, 90, 3, '12:00', 'todo'],
  ['Q1 roadmap review prep', 'cat-planning', 1, 2, 120, 8, '09:00', 'todo'],
  ['Prepare offer packet & comp band', 'cat-hiring', 1, 2, 90, 1, '12:00', 'todo'],
  ['Write interview scorecard — backend loop', 'cat-hiring', 2, 1, 30, 1, '18:00', 'todo'],
  ['Screen 6 inbound applications', 'cat-hiring', 3, 1, 60, 10, '17:00', 'todo'],
  ['Quarterly estimated tax payment', 'cat-personal', 2, 1, 60, 20, '17:00', 'todo'],
  ['Renew passport', 'cat-personal', 3, 1, 45, 30, '17:00', 'todo'],
  // Completed recently
  ['Draft SOW v3 redlines', 'cat-client', 1, 2, 120, -1, '17:00', 'done'],
  ['Pricing page — wireframes sign-off', 'cat-product', 1, 2, 90, -2, '12:00', 'done'],
  ['Book venue for team offsite', 'cat-planning', 2, 1, 30, -3, '17:00', 'done'],
  ['Phone screen — backend candidate #3', 'cat-hiring', 2, 1, 45, -2, '15:00', 'done'],
];

function at(now: number, dayOffset: number, hhmm: string): number {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function buildSeed(now: number): { categories: Category[]; tasks: Task[] } {
  const categories: Category[] = CATS.map(([id, name, color], i) => ({ id, name, color, order: i, createdAt: now - 30 * 86_400_000 }));
  const tasks: Task[] = ROWS.map(([title, categoryId, priority, difficulty, estimate, dueDays, dueTime, status, notes], i) => {
    const deadline = at(now, dueDays, dueTime);
    const createdAt = now - (14 - (i % 10)) * 86_400_000;
    return {
      id: crypto.randomUUID(),
      seq: i + 1,
      title,
      notes: notes ?? '',
      categoryId,
      status,
      priority,
      difficulty,
      estimate,
      deadline,
      createdAt,
      updatedAt: createdAt,
      completedAt: status === 'done' ? Math.min(deadline, now) - 3 * 3_600_000 : null,
    };
  });
  return { categories, tasks };
}

/* -------------------------------------------------------------------------- */
/* Demo schedule                                                              */
/* -------------------------------------------------------------------------- */

/** [day offset from today, start, end, seed task title — or "@Event title"] */
const SCHEDULE: Array<[number, string, string, string]> = [
  [-2, '10:00', '11:30', 'Pricing page — wireframes sign-off'],
  [-1, '09:00', '11:00', 'Pricing page — component build'],
  [-1, '14:00', '16:00', 'Draft SOW v3 redlines'],
  [0, '09:00', '11:00', 'Pricing page — component build'],
  [0, '11:30', '12:30', 'SOW v3 sign-off with legal'],
  [0, '13:15', '15:15', 'Team capacity model — first draft'],
  [0, '15:30', '16:15', '@Interview · Backend loop (2/4)'],
  [0, '16:15', '16:45', 'Write interview scorecard — backend loop'],
  [0, '16:45', '18:00', 'Checkout flow QA pass across breakpoints'],
  [1, '08:30', '10:00', 'Prepare offer packet & comp band'],
  [1, '09:30', '10:30', '@Leadership sync'], // deliberate overlap → conflict demo
  [1, '13:15', '15:45', 'Checkout flow QA pass across breakpoints'],
  [1, '16:00', '17:00', 'Northwind kickoff deck — data appendix'],
  [2, '09:00', '11:00', 'Design tokens migration for marketing site'],
  [2, '14:00', '15:00', '@Northwind kickoff call'],
  [2, '15:15', '16:45', 'Collect OKR inputs from leads'],
  [5, '09:00', '12:00', 'Team capacity model — first draft'],
  [6, '13:15', '15:15', 'Accessibility audit fixes — focus order'],
];
const STANDUP_DAYS = [-2, -1, 0, 1, 2, 3, 4, 5, 6];

/**
 * Demo time blocks for the seeded tasks, relative to `now`. Tasks are matched by title, so
 * this is safe to run against any workspace: unknown or renamed tasks are simply skipped.
 * Weekend days are skipped.
 */
export function buildDemoBlocks(tasks: Task[], now: number): TimeBlock[] {
  const byTitle = new Map(tasks.map((t) => [t.title, t]));
  const out: TimeBlock[] = [];
  const add = (offset: number, start: string, end: string, label: string) => {
    const s = at(now, offset, start);
    const day = new Date(s).getDay();
    if (day === 0 || day === 6) return;
    const isEvent = label.startsWith('@');
    const task = isEvent ? undefined : byTitle.get(label);
    if (!isEvent && !task) return;
    out.push({
      id: crypto.randomUUID(),
      kind: isEvent ? 'event' : 'task',
      taskId: task?.id ?? null,
      title: isEvent ? label.slice(1) : '',
      start: s,
      end: at(now, offset, end),
      createdAt: now,
      updatedAt: now,
    });
  };
  // Only seed a schedule when the workspace looks like the demo.
  if (!byTitle.has('Pricing page — component build')) return [];
  for (const d of STANDUP_DAYS) add(d, '11:00', '11:30', '@Standup + design sync');
  for (const [d, s, e, label] of SCHEDULE) add(d, s, e, label);
  return out;
}
