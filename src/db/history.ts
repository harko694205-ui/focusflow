/**
 * Demo history for Insights: about eight weeks of finished work with tracked time, generated
 * deterministically (seeded PRNG) relative to `now` so it always looks current.
 *
 * The patterns are deliberate so Insights has something to find:
 *  - hard work runs over its estimate more than easy work; client work runs over a bit more;
 *  - deep work happens mostly in the morning, admin in the afternoon;
 *  - planning and personal tasks get postponed more often.
 */
import { addDays, startOfWeek } from 'date-fns';
import type { Difficulty, ID, Priority, Task, TimeBlock, WorkSession } from '@/domain/types';

type Template = [title: string, difficulty: Difficulty, estimate: number, priority: Priority];

const TEMPLATES: Record<string, Template[]> = {
  'cat-product': [
    ['Fix flaky checkout e2e test', 2, 90, 1],
    ['Review design QA feedback', 1, 45, 2],
    ['Spec onboarding checklist', 3, 180, 1],
    ['Refactor pricing table component', 3, 240, 2],
    ['Ship dark-mode token fixes', 2, 120, 2],
    ['Write changelog for v2.3', 1, 30, 3],
    ['Prototype empty states', 3, 150, 2],
    ['Audit bundle size', 2, 90, 3],
  ],
  'cat-client': [
    ['Northwind weekly status report', 1, 45, 1],
    ['Prep quarterly review slides for Acme', 2, 120, 1],
    ['Answer Acme procurement questionnaire', 2, 90, 2],
    ['Draft SOW v2 scope', 3, 180, 0],
    ['Write up client workshop notes', 1, 60, 2],
  ],
  'cat-planning': [
    ['Sprint planning prep', 2, 60, 1],
    ['Update hiring plan spreadsheet', 1, 45, 2],
    ['Draft OKR progress update', 2, 90, 2],
    ['Roadmap dependency review', 3, 120, 2],
  ],
  'cat-hiring': [
    ['Phone screen — frontend candidate', 1, 45, 2],
    ['Write job post — product designer', 2, 90, 2],
    ['Debrief notes — onsite loop', 1, 30, 1],
    ['Review take-home submissions', 2, 120, 2],
  ],
  'cat-personal': [
    ['Expense report', 1, 30, 3],
    ['Renew car insurance', 1, 45, 3],
    ['Plan weekend trip logistics', 1, 60, 3],
  ],
};
const CATEGORY_WEIGHTS: Array<[string, number]> = [
  ['cat-product', 5],
  ['cat-client', 3],
  ['cat-planning', 2],
  ['cat-hiring', 2],
  ['cat-personal', 1],
];

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const at = (d: Date, minutes: number) => {
  const x = new Date(d);
  x.setHours(0, minutes, 0, 0);
  return x.getTime();
};
const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);
const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);

export interface DemoHistory {
  tasks: Task[];
  sessions: WorkSession[];
  blocks: TimeBlock[];
}

/**
 * @param categoryIds the workspace's category ids; demo ids are used when present, otherwise
 *   templates are spread over whatever categories exist.
 * @param busyUntilDaysAgo history stops this many days before today (keeps clear of the demo schedule).
 */
export function buildDemoHistory(now: number, startSeq: number, categoryIds: ID[], busyUntilDaysAgo = 3): DemoHistory {
  const rand = rng(20261125);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const resolveCat = (demoId: string, i: number) => (categoryIds.includes(demoId) ? demoId : categoryIds[i % categoryIds.length]);
  const weighted = CATEGORY_WEIGHTS.flatMap(([id, w]) => Array<string>(w).fill(id));

  const tasks: Task[] = [];
  const sessions: WorkSession[] = [];
  const blocks: TimeBlock[] = [];
  if (!categoryIds.length) return { tasks, sessions, blocks };

  const first = addDays(startOfWeek(now, { weekStartsOn: 1 }), -7 * 8);
  const last = addDays(new Date(now), -busyUntilDaysAgo);
  last.setHours(0, 0, 0, 0);
  let seq = startSeq;
  let k = 0;

  for (let day = first; day <= last; day = addDays(day, 1)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue;
    const taken: Array<[number, number]> = [];
    const free = (s: number, e: number) => s >= 510 && e <= 1080 && !(s < 795 && e > 750) && taken.every(([a, b]) => e <= a || s >= b);

    const perDay = rand() < 0.35 ? 2 : rand() < 0.85 ? 1 : 0;
    for (let n = 0; n < perDay; n++) {
      const demoCat = pick(weighted);
      const [title, difficulty, estimate, priority] = pick(TEMPLATES[demoCat]);
      const categoryId = resolveCat(demoCat, k++);

      // Actual vs estimate: hard work overruns most; client work a little extra.
      const base = difficulty === 3 ? between(1.1, 1.75) : difficulty === 2 ? between(0.9, 1.35) : between(0.75, 1.15);
      const factor = base * (demoCat === 'cat-client' ? 1.1 : 1);
      const actual = round5(estimate * factor);

      // Sessions: deep work in the morning, admin in the afternoon.
      const prefs = difficulty === 3 ? [510, 540, 570, 600, 795, 840] : difficulty === 2 ? [600, 630, 795, 840, 900, 540] : [840, 900, 930, 960, 795, 690];
      let left = actual;
      const mine: WorkSession[] = [];
      // Preferred starts first, then any 15-minute start in the workday, so no time is lost.
      const fallback = Array.from({ length: 38 }, (_, i) => 510 + i * 15);
      for (const p of [...prefs, ...fallback]) {
        if (left <= 0) break;
        const len = Math.min(left, round5(between(45, 120)));
        const s = p + Math.round(between(0, 3)) * 5;
        if (!free(s, s + len)) continue;
        taken.push([s, s + len]);
        mine.push({ id: crypto.randomUUID(), taskId: '', start: at(day, s), end: at(day, s + len), source: rand() < 0.8 ? 'timer' : 'manual', createdAt: at(day, s + len) });
        left -= len;
      }
      if (!mine.length) continue;
      mine.sort((a, b) => a.start - b.start);
      const completedAt = mine[mine.length - 1].end + 10 * MIN;

      // Deadlines: mostly met; hard work misses more often.
      const late = rand() < (difficulty === 3 ? 0.28 : 0.1);
      const deadline = late ? completedAt - Math.round(between(1, 20)) * 60 * MIN : completedAt + Math.round(between(2, 72)) * 60 * MIN;
      const postponeChance = demoCat === 'cat-planning' || demoCat === 'cat-personal' ? 0.45 : 0.15;
      const postponed = rand() < postponeChance ? 1 + Math.floor(rand() * 3) : 0;
      const rescheduled = rand() < 0.2 ? 1 + Math.floor(rand() * 2) : 0;
      const createdAt = at(addDays(day, -Math.round(between(2, 9))), 600);

      const id = crypto.randomUUID();
      tasks.push({
        id,
        seq: ++seq,
        title,
        notes: '',
        categoryId,
        status: 'done',
        priority,
        difficulty,
        estimate,
        deadline,
        createdAt,
        updatedAt: completedAt,
        completedAt,
        ...(postponed ? { postponed, firstDeadline: deadline - postponed * Math.round(between(1, 3)) * 86_400_000 } : {}),
        ...(rescheduled ? { rescheduled } : {}),
      });
      for (const s of mine) {
        sessions.push({ ...s, taskId: id });
        // The plan: blocks sized to the estimate, where the work actually happened.
        const planned = round15(((s.end - s.start) / MIN) / factor);
        blocks.push({ id: crypto.randomUUID(), kind: 'task', taskId: id, title: '', start: s.start, end: s.start + planned * MIN, createdAt, updatedAt: createdAt });
      }
    }
  }
  return { tasks, sessions, blocks };
}

/**
 * Tracked time for the demo's own tasks: past demo blocks were (mostly) worked, a little
 * shorter or longer than planned; finished demo tasks get time near their completion.
 */
export function buildDemoTracking(tasks: Task[], blocks: TimeBlock[], now: number): WorkSession[] {
  const rand = rng(7);
  const out: WorkSession[] = [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const b of blocks) {
    if (b.kind !== 'task' || !b.taskId || b.end > now) continue;
    const t = byId.get(b.taskId);
    if (!t || rand() < 0.1) continue; // sometimes a planned block just didn't happen
    const start = b.start + Math.round(rand() * 2) * 5 * MIN;
    const len = Math.round(((b.end - b.start) / MIN) * (0.75 + rand() * 0.4) / 5) * 5;
    out.push({ id: crypto.randomUUID(), taskId: b.taskId, start, end: start + len * MIN, source: 'timer', createdAt: start + len * MIN });
  }
  return out;
}
