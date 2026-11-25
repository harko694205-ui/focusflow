/**
 * FocusFlow scheduler: recommends when every open task should be worked on.
 *
 * Pure and deterministic: no clocks (callers pass `now`), no randomness, stable tie-breaking by
 * task seq, and block ids derived from `idPrefix`. Same input → same plan.
 *
 * What it weighs, and how:
 *
 * 1. Deadline: work is placed before the deadline whenever possible. A task's *effective*
 *    deadline is pulled earlier when something that depends on it is due soon (it must finish
 *    in time for the dependent to fit before its own deadline).
 * 2. Available time: working hours minus existing blocks, from `now` onward, minus days off.
 * 3. Duration: only the unscheduled part of the estimate (estimate − already blocked) is placed,
 *    split into sessions.
 * 4. Priority: decides who gets contested time. Default strategy is deadline-first with priority
 *    breaking ties between tasks due the same day; the `priority` strategy puts priority first.
 * 5. Difficulty: sets session rules. Hard work needs a long uninterrupted window (≥ 90m), is
 *    capped per day and shares a daily deep-work budget; easy work prefers the afternoon so the
 *    mornings stay free for focus.
 * 6. Dependencies: a task never starts before everything it depends on is planned to finish.
 *    If a dependency can't be fully planned, the dependent is reported as blocked.
 * 7. Existing commitments: events and already-scheduled blocks are fixed; the scheduler only
 *    adds blocks in the gaps and never moves or removes anything.
 *
 * Placement is front-loaded: each task takes the earliest suitable time, so work is never left
 * until the last free slot before a deadline. When the strict session rules can't fit a task
 * before its deadline, the rules are relaxed (any 15m+ gap, no daily caps); if it still doesn't
 * fit, the rest is placed after the deadline (flagged late), and anything beyond the horizon is
 * reported as unplaced.
 */
import { addDays } from 'date-fns';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '@/domain/constants';
import { cyclicTasks, liveDependencies } from '@/domain/dependencies';
import {
  atMinute,
  dayKey,
  durationMinutes,
  endMinuteOfDay,
  minuteOfDay,
  startOfLocalDay,
  subtractIntervals,
  workIntervals,
  type Interval,
} from '@/domain/schedule';
import type { Difficulty, ID, Instant, Minutes, Task, TimeBlock } from '@/domain/types';
import type { PlanStrategy, ScheduleState } from './types';

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

export interface SessionRules {
  /** Smallest free window a session may start in. */
  minWindow: Minutes;
  /** Longest single session. */
  maxSession: Minutes;
  /** Most time on this task per day. */
  dailyMax: Minutes;
}

export const SESSION_RULES: Record<Difficulty, SessionRules> = {
  1: { minWindow: 30, maxSession: 120, dailyMax: 240 },
  2: { minWindow: 60, maxSession: 150, dailyMax: 300 },
  3: { minWindow: 90, maxSession: 180, dailyMax: 180 },
};
/** Fallback rules when a task can't otherwise meet its deadline. */
export const RELAXED_RULES: SessionRules = { minWindow: 15, maxSession: 240, dailyMax: Infinity };
/** Hard-task minutes per day across all tasks (strict pass only). */
export const DEEP_WORK_DAILY_CAP: Minutes = 240;
/** Easy work looks at slots from this minute-of-day first. */
export const AFTERNOON: Minutes = 13 * 60;
export const STEP: Minutes = 15;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface PlanOptions {
  /** First day to plan (clamped to today). */
  from: Instant;
  /** Number of days from `from` the plan may use. */
  days: number;
  now: Instant;
  strategy?: PlanStrategy;
  /** Prefix for generated block ids (keeps replays stable). */
  idPrefix: string;
  week?: WorkWeek;
}

export type RecommendationStatus =
  /** Everything fits before the deadline. */
  | 'on_time'
  /** Already fully scheduled; nothing new needed. */
  | 'scheduled'
  /** Fully planned, but finishes after the deadline. */
  | 'late'
  /** Deadline already passed; placed as soon as possible. */
  | 'overdue'
  /** Not all of the work fits in the planning horizon. */
  | 'partial'
  /** Waiting on a dependency that can't be planned to finish. */
  | 'blocked';

export interface Recommendation {
  taskId: ID;
  status: RecommendationStatus;
  /** New sessions recommended for this task, in time order. */
  sessions: TimeBlock[];
  existingMinutes: Minutes;
  placedMinutes: Minutes;
  unplacedMinutes: Minutes;
  /** End of the last block (existing or new). Null when nothing is scheduled. */
  finish: Instant | null;
  /** Earliest moment work may start (now, or when dependencies finish). */
  earliestStart: Instant;
  /** Deadline after accounting for dependents (≤ the task's own deadline). */
  effectiveDeadline: Instant;
  /** Open dependencies this task waits for. */
  waitsFor: ID[];
  /** Open dependencies that couldn't be fully planned (status = blocked). */
  blockedBy: ID[];
  /** Session rules had to be relaxed to fit the deadline. */
  relaxed: boolean;
}

export interface SchedulePlan {
  /** All new blocks, in placement order. */
  blocks: TimeBlock[];
  recommendations: Map<ID, Recommendation>;
  /** Order tasks were planned in. */
  order: ID[];
  /** Tasks on a dependency loop (their links to each other were ignored). */
  cycles: ID[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Minutes already scheduled per task, across all blocks. */
export function scheduledMinutes(blocks: readonly TimeBlock[]): Map<ID, Minutes> {
  const m = new Map<ID, Minutes>();
  for (const b of blocks) if (b.kind === 'task' && b.taskId) m.set(b.taskId, (m.get(b.taskId) ?? 0) + durationMinutes(b));
  return m;
}

const ceilTo = (m: number, step: number) => Math.ceil(m / step) * step;
const floorTo = (m: number, step: number) => Math.floor(m / step) * step;

/**
 * The instant `minutes` of working time before `end` (ignores existing blocks — it's an
 * optimistic bound used to pull dependency deadlines forward).
 */
export function workTimeBefore(end: Instant, minutes: Minutes, week: WorkWeek, off: ReadonlySet<string>): Instant {
  if (minutes <= 0) return end;
  let left = minutes;
  let day = startOfLocalDay(end);
  for (let i = 0; i < 400; i++, day = addDays(day, -1)) {
    if (off.has(dayKey(day))) continue;
    const limit = i === 0 ? minuteOfDay(end) : Infinity;
    const ivs = workIntervals(day, week);
    for (let j = ivs.length - 1; j >= 0; j--) {
      const e = Math.min(ivs[j].end, limit);
      const s = ivs[j].start;
      if (e <= s) continue;
      if (e - s >= left) return atMinute(day, e - left);
      left -= e - s;
    }
  }
  return end - minutes * 60_000;
}

interface Day {
  key: string;
  date: Date;
  free: Interval[];
  deep: Minutes;
}

/* -------------------------------------------------------------------------- */
/* Planner                                                                    */
/* -------------------------------------------------------------------------- */

export function planSchedule(state: ScheduleState, opts: PlanOptions): SchedulePlan {
  const week = opts.week ?? DEFAULT_WORK_WEEK;
  const strategy = opts.strategy ?? 'deadline';
  const now = opts.now;
  const off = new Set(state.offDays ?? []);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const existing = scheduledMinutes(state.blocks);
  const existingFinish = new Map<ID, Instant>();
  for (const b of state.blocks)
    if (b.kind === 'task' && b.taskId) existingFinish.set(b.taskId, Math.max(existingFinish.get(b.taskId) ?? -Infinity, b.end));

  const open = state.tasks.filter((t) => t.status !== 'done');
  const need = new Map(open.map((t) => [t.id, Math.max(0, t.estimate - (existing.get(t.id) ?? 0))]));

  // Dependency graph over open tasks. Done dependencies are satisfied; links between tasks on a
  // cycle are dropped (reported in `cycles`).
  const cyclic = cyclicTasks(state.tasks);
  const deps = new Map<ID, ID[]>();
  const dependents = new Map<ID, ID[]>();
  for (const t of open) {
    const ds = liveDependencies(t, byId).filter((d) => byId.get(d)!.status !== 'done' && !(cyclic.has(t.id) && cyclic.has(d)));
    deps.set(t.id, ds);
    for (const d of ds) dependents.set(d, [...(dependents.get(d) ?? []), t.id]);
  }

  // Effective deadlines: a dependency must finish early enough for its dependents to fit.
  const eff = new Map<ID, Instant>();
  const effDeadline = (id: ID): Instant => {
    const cached = eff.get(id);
    if (cached !== undefined) return cached;
    eff.set(id, byId.get(id)!.deadline); // guard against re-entry
    let d = byId.get(id)!.deadline;
    for (const k of dependents.get(id) ?? []) d = Math.min(d, workTimeBefore(effDeadline(k), need.get(k) ?? 0, week, off));
    eff.set(id, d);
    return d;
  };
  for (const t of open) effDeadline(t.id);

  // Free time per day, from `now` onward, aligned to the 15-minute grid.
  const firstDay = startOfLocalDay(Math.max(opts.from, startOfLocalDay(now).getTime()));
  const lastDay = addDays(startOfLocalDay(opts.from), opts.days);
  const horizonEnd = lastDay.getTime();
  const busyByDay = new Map<string, Interval[]>();
  const deepByDay = new Map<string, Minutes>();
  for (const b of state.blocks) {
    const k = dayKey(b.start);
    if (b.kind === 'task' && b.taskId && byId.get(b.taskId)?.difficulty === 3) deepByDay.set(k, (deepByDay.get(k) ?? 0) + durationMinutes(b));
    if (!busyByDay.has(k)) busyByDay.set(k, []);
    busyByDay.get(k)!.push({ start: minuteOfDay(b.start), end: endMinuteOfDay(b.start, b.end) });
  }
  const days: Day[] = [];
  for (let d = firstDay; d < lastDay; d = addDays(d, 1)) {
    const k = dayKey(d);
    if (off.has(k)) continue;
    let free = workIntervals(d, week);
    if (k === dayKey(now)) free = subtractIntervals(free, [{ start: 0, end: ceilTo(minuteOfDay(now), STEP) }]);
    free = subtractIntervals(free, busyByDay.get(k) ?? [])
      .map((i) => ({ start: ceilTo(i.start, STEP), end: floorTo(i.end, STEP) }))
      .filter((i) => i.end - i.start >= STEP);
    days.push({ key: k, date: d, free, deep: deepByDay.get(k) ?? 0 });
  }

  // Order: list scheduling — repeatedly take the best task whose dependencies are planned.
  const key = (t: Task): Array<number> => {
    const e = eff.get(t.id)!;
    return strategy === 'priority'
      ? [t.priority, e, -t.difficulty, t.seq]
      : [startOfLocalDay(e).getTime(), t.priority, e, -t.difficulty, t.seq];
  };
  const cmp = (a: Task, b: Task) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };
  const pending = new Set(open.map((t) => t.id));
  const order: ID[] = [];
  while (pending.size) {
    const ready = [...pending].map((id) => byId.get(id)!).filter((t) => deps.get(t.id)!.every((d) => !pending.has(d)));
    // Only reachable with a cycle we failed to break; fall back to plain order.
    const pool = ready.length ? ready : [...pending].map((id) => byId.get(id)!);
    const next = pool.sort(cmp)[0];
    pending.delete(next.id);
    order.push(next.id);
  }

  const out: TimeBlock[] = [];
  const recs = new Map<ID, Recommendation>();
  const perTaskDay = new Map<string, Minutes>();

  for (const id of order) {
    const task = byId.get(id)!;
    const waitsFor = deps.get(id)!;
    const blockedBy = waitsFor.filter((d) => {
      const r = recs.get(d)!;
      return r.status === 'blocked' || r.unplacedMinutes > 0;
    });
    const depFinish = Math.max(...waitsFor.map((d) => recs.get(d)!.finish ?? -Infinity), -Infinity);
    const earliestStart = Math.max(now, opts.from, depFinish);
    const effectiveDeadline = eff.get(id)!;
    const sessions: TimeBlock[] = [];
    let left = need.get(id)!;
    let relaxed = false;
    let n = 0;

    const place = (until: Instant, rules: SessionRules, strict: boolean) => {
      const hard = task.difficulty === 3;
      for (const d of days) {
        if (left <= 0) return;
        const dayStart = d.date.getTime();
        if (dayStart >= until) return;
        if (atMinute(d.date, 24 * 60) <= earliestStart) continue;
        const lo = dayKey(earliestStart) === d.key ? ceilTo(minuteOfDay(earliestStart), STEP) : 0;
        const hi = dayKey(until) === d.key ? floorTo(minuteOfDay(until), STEP) : 24 * 60;
        const tdKey = `${id}|${d.key}`;
        // Easy work tries the afternoon first, keeping mornings for focus.
        const slots = d.free
          .map((s) => ({ start: Math.max(s.start, lo), end: Math.min(s.end, hi) }))
          .filter((s) => s.end - s.start >= STEP);
        if (task.difficulty === 1 && strict) slots.sort((a, b) => Number(a.end <= AFTERNOON) - Number(b.end <= AFTERNOON) || a.start - b.start);
        for (const slot of slots) {
          if (left <= 0) break;
          const len = slot.end - slot.start;
          if (len < Math.min(rules.minWindow, strict ? rules.minWindow : left)) continue;
          let cap = Math.min(len, rules.maxSession, rules.dailyMax - (perTaskDay.get(tdKey) ?? 0));
          if (strict && hard) cap = Math.min(cap, DEEP_WORK_DAILY_CAP - d.deep);
          const take = left <= cap ? Math.min(ceilTo(left, STEP), len) : floorTo(cap, STEP);
          if (take < STEP || take < Math.min(strict ? rules.minWindow : STEP, left)) continue;
          const block: TimeBlock = {
            id: `${opts.idPrefix}:${id}:${n++}`,
            kind: 'task',
            taskId: id,
            title: '',
            start: atMinute(d.date, slot.start),
            end: atMinute(d.date, slot.start + take),
            createdAt: now,
            updatedAt: now,
          };
          sessions.push(block);
          left -= take;
          perTaskDay.set(tdKey, (perTaskDay.get(tdKey) ?? 0) + take);
          if (hard) d.deep += take;
          d.free = subtractIntervals(d.free, [{ start: slot.start, end: slot.start + take }]).filter((i) => i.end - i.start >= STEP);
        }
      }
    };

    if (!blockedBy.length && left > 0) {
      place(task.deadline, SESSION_RULES[task.difficulty], true);
      if (left > 0) {
        const before = left;
        place(task.deadline, RELAXED_RULES, false);
        relaxed = left < before;
      }
      if (left > 0) place(horizonEnd, RELAXED_RULES, false);
    }

    sessions.sort((a, b) => a.start - b.start);
    out.push(...sessions);
    const placedMinutes = sessions.reduce((a, b) => a + durationMinutes(b), 0);
    const ends = [existingFinish.get(id), ...sessions.map((s) => s.end)].filter((x): x is number => x !== undefined);
    const finish = ends.length ? Math.max(...ends) : null;
    const unplacedMinutes = blockedBy.length ? need.get(id)! : Math.max(0, left);
    const status: RecommendationStatus = blockedBy.length
      ? 'blocked'
      : unplacedMinutes > 0
        ? 'partial'
        : task.deadline < now
          ? 'overdue'
          : finish !== null && finish > task.deadline
            ? 'late'
            : placedMinutes === 0
              ? 'scheduled'
              : 'on_time';
    recs.set(id, {
      taskId: id,
      status,
      sessions,
      existingMinutes: existing.get(id) ?? 0,
      placedMinutes,
      unplacedMinutes,
      finish,
      earliestStart,
      effectiveDeadline,
      waitsFor,
      blockedBy,
      relaxed,
    });
  }

  return { blocks: out, recommendations: recs, order, cycles: [...cyclic].filter((id) => byId.has(id)) };
}
