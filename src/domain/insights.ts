/**
 * Insights: what your history says about how you work. Pure functions over tasks, time blocks
 * (the plan) and work sessions (what actually happened), so every number is testable.
 *
 * Sources, in order of trust:
 *  - Work sessions (focus timer / logged time) are "actual" time.
 *  - When a finished task has no tracked time, its scheduled blocks before completion stand in
 *    for actual time, marked as `scheduled` so the UI can say so.
 */
import { addDays, format, startOfWeek } from 'date-fns';
import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import { durationMinutes, workIntervals } from './schedule';
import type { Difficulty, ID, Instant, Minutes, Task, TimeBlock, WorkSession } from './types';

const MIN = 60_000;
const DAY = 86_400_000;

export interface InsightsInput {
  tasks: readonly Task[];
  blocks: readonly TimeBlock[];
  sessions: readonly WorkSession[];
  now: Instant;
  /** Number of weeks to look back, ending with (and including) the current week. */
  weeks: number;
  week?: WorkWeek;
}

export interface InsightRange {
  from: Instant;
  to: Instant;
  weekStarts: Date[];
}

export function insightRange(now: Instant, weeks: number): InsightRange {
  const current = startOfWeek(now, { weekStartsOn: 1 });
  const first = addDays(current, -7 * (weeks - 1));
  return { from: first.getTime(), to: now, weekStarts: Array.from({ length: weeks }, (_, i) => addDays(first, 7 * i)) };
}

const weekKey = (t: Instant | Date) => format(startOfWeek(t, { weekStartsOn: 1 }), 'yyyy-MM-dd');
const overlap = (s: number, e: number, from: number, to: number) => Math.max(0, Math.min(e, to) - Math.max(s, from));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* -------------------------------------------------------------------------- */
/* 1. Completion                                                              */
/* -------------------------------------------------------------------------- */

export interface CompletionWeek {
  key: string;
  label: string;
  /** Tasks due this week (deadline already passed). */
  due: number;
  onTime: number;
  late: number;
  missed: number;
  /** Tasks finished this week, whenever they were due (throughput). */
  finished: number;
}

export interface CompletionStats {
  due: number;
  completed: number;
  onTime: number;
  late: number;
  /** Past their deadline and still open. */
  missed: number;
  /** completed / due */
  rate: number | null;
  /** onTime / due */
  onTimeRate: number | null;
  /** Median minutes past the deadline, for late completions. */
  medianLateBy: Minutes | null;
  weekly: CompletionWeek[];
}

export function completionStats(tasks: readonly Task[], range: InsightRange): CompletionStats {
  const weeks = new Map<string, CompletionWeek>(
    range.weekStarts.map((d) => [weekKey(d), { key: weekKey(d), label: format(d, 'MMM d'), due: 0, onTime: 0, late: 0, missed: 0, finished: 0 }]),
  );
  let due = 0;
  let onTime = 0;
  let late = 0;
  let missed = 0;
  const lateBy: number[] = [];
  for (const t of tasks) {
    if (t.status === 'done' && t.completedAt !== null && t.completedAt >= range.from && t.completedAt <= range.to) {
      const w = weeks.get(weekKey(t.completedAt));
      if (w) w.finished++;
    }
    if (t.deadline < range.from || t.deadline > range.to) continue;
    due++;
    const w = weeks.get(weekKey(t.deadline));
    if (w) w.due++;
    if (t.status === 'done' && t.completedAt !== null) {
      if (t.completedAt <= t.deadline) {
        onTime++;
        if (w) w.onTime++;
      } else {
        late++;
        lateBy.push((t.completedAt - t.deadline) / MIN);
        if (w) w.late++;
      }
    } else {
      missed++;
      if (w) w.missed++;
    }
  }
  return {
    due,
    completed: onTime + late,
    onTime,
    late,
    missed,
    rate: ratio(onTime + late, due),
    onTimeRate: ratio(onTime, due),
    medianLateBy: median(lateBy),
    weekly: [...weeks.values()],
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Estimated vs actual                                                     */
/* -------------------------------------------------------------------------- */

export type ActualSource = 'tracked' | 'scheduled';

export function groupByTask<T extends { taskId: ID | null }>(items: readonly T[]): Map<ID, T[]> {
  const m = new Map<ID, T[]>();
  for (const x of items) {
    if (!x.taskId) continue;
    if (!m.has(x.taskId)) m.set(x.taskId, []);
    m.get(x.taskId)!.push(x);
  }
  return m;
}

/** Actual time on a task: tracked sessions, else (for finished tasks) blocks scheduled before completion. */
export function actualTime(
  task: Task,
  sessions: readonly WorkSession[] = [],
  blocks: readonly TimeBlock[] = [],
): { minutes: Minutes; source: ActualSource } | null {
  const tracked = sessions.reduce((a, s) => a + (s.end - s.start) / MIN, 0);
  if (tracked > 0) return { minutes: Math.round(tracked), source: 'tracked' };
  if (task.status !== 'done' || task.completedAt === null) return null;
  const planned = blocks.filter((b) => b.kind === 'task' && b.start < task.completedAt!).reduce((a, b) => a + durationMinutes(b), 0);
  return planned > 0 ? { minutes: planned, source: 'scheduled' } : null;
}

export interface AccuracyRow {
  task: Task;
  estimate: Minutes;
  actual: Minutes;
  source: ActualSource;
  /** actual / estimate (1 = spot on, 1.5 = took 50% longer). */
  ratio: number;
}

export interface AccuracyGroup<K> {
  key: K;
  n: number;
  estimate: Minutes;
  actual: Minutes;
  ratio: number | null;
}

export interface AccuracyStats {
  rows: AccuracyRow[];
  tracked: number;
  scheduled: number;
  /** Total actual / total estimate. */
  ratio: number | null;
  medianRatio: number | null;
  /** Share of tasks within ±20% of the estimate (0.8–1.25×). */
  withinBand: number | null;
  byCategory: AccuracyGroup<ID>[];
  byDifficulty: AccuracyGroup<Difficulty>[];
}

export const ACCURATE_BAND = { low: 0.8, high: 1.25 } as const;

/** Finished tasks completed in [from, to] that have actual time. */
export function accuracyRows(
  tasks: readonly Task[],
  sessionsByTask: ReadonlyMap<ID, WorkSession[]>,
  blocksByTask: ReadonlyMap<ID, TimeBlock[]>,
  from = -Infinity,
  to = Infinity,
): AccuracyRow[] {
  const rows: AccuracyRow[] = [];
  for (const t of tasks) {
    if (t.status !== 'done' || t.completedAt === null || t.completedAt < from || t.completedAt > to) continue;
    const a = actualTime(t, sessionsByTask.get(t.id), blocksByTask.get(t.id));
    if (!a) continue;
    rows.push({ task: t, estimate: t.estimate, actual: a.minutes, source: a.source, ratio: a.minutes / t.estimate });
  }
  return rows.sort((a, b) => (b.task.completedAt ?? 0) - (a.task.completedAt ?? 0));
}

function group<K>(rows: AccuracyRow[], key: (r: AccuracyRow) => K): AccuracyGroup<K>[] {
  const m = new Map<K, AccuracyGroup<K>>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, n: 0, estimate: 0, actual: 0, ratio: null };
    g.n++;
    g.estimate += r.estimate;
    g.actual += r.actual;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, ratio: ratio(g.actual, g.estimate) })).sort((a, b) => b.n - a.n);
}

export function accuracyStats(rows: AccuracyRow[]): AccuracyStats {
  const est = rows.reduce((a, r) => a + r.estimate, 0);
  const act = rows.reduce((a, r) => a + r.actual, 0);
  return {
    rows,
    tracked: rows.filter((r) => r.source === 'tracked').length,
    scheduled: rows.filter((r) => r.source === 'scheduled').length,
    ratio: ratio(act, est),
    medianRatio: median(rows.map((r) => r.ratio)),
    withinBand: rows.length ? rows.filter((r) => r.ratio >= ACCURATE_BAND.low && r.ratio <= ACCURATE_BAND.high).length / rows.length : null,
    byCategory: group(rows, (r) => r.task.categoryId),
    byDifficulty: group(rows, (r) => r.task.difficulty).sort((a, b) => a.key - b.key),
  };
}

export interface Calibration {
  /** Typical actual / estimate for similar work. */
  factor: number;
  n: number;
  basis: 'category+difficulty' | 'difficulty' | 'category';
}

export const CALIBRATION_MIN_SAMPLES = 3;

/**
 * How long similar finished tasks really took, relative to their estimate. Tries the most specific
 * match with enough history: same category and difficulty, then difficulty, then category.
 * Uses the median so one outlier doesn't swing it.
 */
export function calibrationFor(rows: readonly AccuracyRow[], categoryId: ID, difficulty: Difficulty, excludeTaskId?: ID): Calibration | null {
  const pool = rows.filter((r) => r.task.id !== excludeTaskId);
  const tries: Array<[Calibration['basis'], AccuracyRow[]]> = [
    ['category+difficulty', pool.filter((r) => r.task.categoryId === categoryId && r.task.difficulty === difficulty)],
    ['difficulty', pool.filter((r) => r.task.difficulty === difficulty)],
    ['category', pool.filter((r) => r.task.categoryId === categoryId)],
  ];
  for (const [basis, rs] of tries) if (rs.length >= CALIBRATION_MIN_SAMPLES) return { factor: median(rs.map((r) => r.ratio))!, n: rs.length, basis };
  return null;
}

/* -------------------------------------------------------------------------- */
/* 3. Weekly workload                                                         */
/* -------------------------------------------------------------------------- */

export interface WeekLoad {
  key: string;
  label: string;
  start: Instant;
  /** Tracked work (sessions). */
  tracked: Minutes;
  /** Task blocks on the timeline. */
  scheduled: Minutes;
  /** Events (meetings etc.). */
  events: Minutes;
  capacity: Minutes;
  /** Sum of estimates of tasks finished this week. */
  completedEstimate: Minutes;
  current: boolean;
}

export function weeklyWorkload(input: InsightsInput, range: InsightRange): WeekLoad[] {
  const week = input.week ?? DEFAULT_WORK_WEEK;
  return range.weekStarts.map((d) => {
    const s = d.getTime();
    const e = addDays(d, 7).getTime();
    const sum = <T extends { start: number; end: number }>(xs: readonly T[]) => xs.reduce((a, x) => a + overlap(x.start, x.end, s, e), 0) / MIN;
    let capacity = 0;
    for (let i = 0; i < 7; i++) capacity += workIntervals(addDays(d, i), week).reduce((a, iv) => a + iv.end - iv.start, 0);
    return {
      key: weekKey(d),
      label: format(d, 'MMM d'),
      start: s,
      tracked: Math.round(sum(input.sessions)),
      scheduled: Math.round(sum(input.blocks.filter((b) => b.kind === 'task'))),
      events: Math.round(sum(input.blocks.filter((b) => b.kind === 'event'))),
      capacity,
      completedEstimate: input.tasks
        .filter((t) => t.status === 'done' && t.completedAt !== null && t.completedAt >= s && t.completedAt < e)
        .reduce((a, t) => a + t.estimate, 0),
      current: input.now >= s && input.now < e,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* 4. Most productive hours                                                   */
/* -------------------------------------------------------------------------- */

export interface HourStats {
  /** Tracked minutes, [weekday 0 = Mon … 6 = Sun][hour 0–23]. */
  grid: number[][];
  byHour: number[];
  byWeekday: number[];
  total: Minutes;
  /** The best two consecutive hours across all weekdays. */
  peak: { startHour: number; minutes: Minutes; share: number } | null;
  /** Weekday (0 = Mon) with the most tracked time. */
  bestWeekday: number | null;
  /** Tasks completed per hour of day. */
  completionsByHour: number[];
}

const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7;

export function productiveHours(sessions: readonly WorkSession[], tasks: readonly Task[], range: InsightRange): HourStats {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const s of sessions) {
    let t = Math.max(s.start, range.from);
    const end = Math.min(s.end, range.to);
    while (t < end) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const stop = Math.min(nextHour, end);
      grid[weekdayIndex(d)][d.getHours()] += (stop - t) / MIN;
      t = stop;
    }
  }
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((a, row) => a + row[h], 0));
  const byWeekday = grid.map((row) => row.reduce((a, x) => a + x, 0));
  const total = byHour.reduce((a, x) => a + x, 0);
  let peak: HourStats['peak'] = null;
  for (let h = 0; h < 23; h++) {
    const m = byHour[h] + byHour[h + 1];
    if (m > 0 && (!peak || m > peak.minutes)) peak = { startHour: h, minutes: m, share: m / total };
  }
  const bestWeekday = total > 0 ? byWeekday.indexOf(Math.max(...byWeekday)) : null;
  const completionsByHour = new Array<number>(24).fill(0);
  for (const t of tasks)
    if (t.status === 'done' && t.completedAt !== null && t.completedAt >= range.from && t.completedAt <= range.to) completionsByHour[new Date(t.completedAt).getHours()]++;
  return {
    grid: grid.map((r) => r.map(Math.round)),
    byHour: byHour.map(Math.round),
    byWeekday: byWeekday.map(Math.round),
    total: Math.round(total),
    peak: peak && { ...peak, minutes: Math.round(peak.minutes) },
    bestWeekday,
    completionsByHour,
  };
}

/* -------------------------------------------------------------------------- */
/* 5. Frequently postponed                                                    */
/* -------------------------------------------------------------------------- */

export interface PostponedRow {
  task: Task;
  /** Deadline pushed to a later day. */
  postponed: number;
  /** Scheduled work moved to a later day. */
  rescheduled: number;
  total: number;
  /** Days between the original and current deadline. */
  slipDays: number | null;
}

export interface PostponedStats {
  rows: PostponedRow[];
  /** Share of tasks (created in range) postponed at least once. */
  rate: number | null;
  byCategory: Array<{ categoryId: ID; tasks: number; total: number }>;
}

export function postponedStats(tasks: readonly Task[], range: InsightRange): PostponedStats {
  const rows: PostponedRow[] = tasks
    .map((t) => {
      const postponed = t.postponed ?? 0;
      const rescheduled = t.rescheduled ?? 0;
      return {
        task: t,
        postponed,
        rescheduled,
        total: postponed + rescheduled,
        slipDays: t.firstDeadline !== undefined ? Math.round((t.deadline - t.firstDeadline) / DAY) : null,
      };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || (b.slipDays ?? 0) - (a.slipDays ?? 0) || a.task.seq - b.task.seq);
  const recent = tasks.filter((t) => t.createdAt >= range.from && t.createdAt <= range.to);
  const cats = new Map<ID, { categoryId: ID; tasks: number; total: number }>();
  for (const r of rows) {
    const c = cats.get(r.task.categoryId) ?? { categoryId: r.task.categoryId, tasks: 0, total: 0 };
    c.tasks++;
    c.total += r.total;
    cats.set(r.task.categoryId, c);
  }
  return {
    rows,
    rate: recent.length ? recent.filter((t) => (t.postponed ?? 0) + (t.rescheduled ?? 0) > 0).length / recent.length : null,
    byCategory: [...cats.values()].sort((a, b) => b.total - a.total),
  };
}

/* -------------------------------------------------------------------------- */
/* 6. Time allocation by category                                             */
/* -------------------------------------------------------------------------- */

export interface CategoryAllocation {
  categoryId: ID;
  tracked: Minutes;
  scheduled: Minutes;
  /** Share of the chosen basis (tracked if anything is tracked, else scheduled). */
  share: number;
}

export interface AllocationStats {
  basis: 'tracked' | 'scheduled';
  total: Minutes;
  rows: CategoryAllocation[];
}

export function categoryAllocation(input: InsightsInput, range: InsightRange): AllocationStats {
  const catOf = new Map(input.tasks.map((t) => [t.id, t.categoryId]));
  const m = new Map<ID, { tracked: number; scheduled: number }>();
  const add = (taskId: ID | null, field: 'tracked' | 'scheduled', mins: number) => {
    const c = taskId ? catOf.get(taskId) : undefined;
    if (!c || mins <= 0) return;
    const row = m.get(c) ?? { tracked: 0, scheduled: 0 };
    row[field] += mins;
    m.set(c, row);
  };
  for (const s of input.sessions) add(s.taskId, 'tracked', overlap(s.start, s.end, range.from, range.to) / MIN);
  for (const b of input.blocks) if (b.kind === 'task') add(b.taskId, 'scheduled', overlap(b.start, b.end, range.from, range.to) / MIN);
  const trackedTotal = [...m.values()].reduce((a, r) => a + r.tracked, 0);
  const basis = trackedTotal > 0 ? 'tracked' : 'scheduled';
  const total = [...m.values()].reduce((a, r) => a + r[basis], 0);
  return {
    basis,
    total: Math.round(total),
    rows: [...m.entries()]
      .map(([categoryId, r]) => ({ categoryId, tracked: Math.round(r.tracked), scheduled: Math.round(r.scheduled), share: total ? r[basis] / total : 0 }))
      .sort((a, b) => b.share - a.share),
  };
}

/* -------------------------------------------------------------------------- */
/* All together                                                               */
/* -------------------------------------------------------------------------- */

export interface Insights {
  range: InsightRange;
  completion: CompletionStats;
  accuracy: AccuracyStats;
  workload: WeekLoad[];
  hours: HourStats;
  postponed: PostponedStats;
  allocation: AllocationStats;
  /** Tracked minutes in range. */
  trackedTotal: Minutes;
}

export function computeInsights(input: InsightsInput): Insights {
  const range = insightRange(input.now, input.weeks);
  const sessionsByTask = groupByTask(input.sessions);
  const blocksByTask = groupByTask(input.blocks);
  const workload = weeklyWorkload(input, range);
  return {
    range,
    completion: completionStats(input.tasks, range),
    accuracy: accuracyStats(accuracyRows(input.tasks, sessionsByTask, blocksByTask, range.from, range.to)),
    workload,
    hours: productiveHours(input.sessions, input.tasks, range),
    postponed: postponedStats(input.tasks, range),
    allocation: categoryAllocation(input, range),
    trackedTotal: workload.reduce((a, w) => a + w.tracked, 0),
  };
}
