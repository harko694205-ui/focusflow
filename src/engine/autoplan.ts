/**
 * Deterministic auto-planner.
 *
 * Greedy earliest-fit: tasks are ordered by the chosen strategy, then each task's unscheduled
 * minutes are placed into the earliest free working time (working hours minus existing blocks),
 * in chunks between MIN_CHUNK and MAX_CHUNK. Earlier days are always preferred, so a task that
 * can't finish before its deadline still lands as early as possible — and shows up as late.
 *
 * Same input → same output: no randomness, no clock reads, stable tie-breaking by task seq, and
 * block ids derived from the op id.
 */
import { addDays } from 'date-fns';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '@/domain/constants';
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
import type { ID, Instant, Minutes, Task, TimeBlock } from '@/domain/types';
import type { PlanStrategy, ScheduleState } from './types';

export const MIN_CHUNK: Minutes = 30;
export const MAX_CHUNK: Minutes = 180;
const STEP: Minutes = 15;

export interface AutoplanOptions {
  from: Instant;
  days: number;
  strategy: PlanStrategy;
  now: Instant;
  /** Prefix for generated block ids (keeps replays stable). */
  idPrefix: string;
  week?: WorkWeek;
}

export function orderTasks(tasks: readonly Task[], strategy: PlanStrategy): Task[] {
  return [...tasks].sort((a, b) =>
    strategy === 'priority'
      ? a.priority - b.priority || a.deadline - b.deadline || a.seq - b.seq
      : a.deadline - b.deadline || a.priority - b.priority || a.seq - b.seq,
  );
}

/** Minutes already scheduled per task, across all blocks. */
export function scheduledMinutes(blocks: readonly TimeBlock[]): Map<ID, Minutes> {
  const m = new Map<ID, Minutes>();
  for (const b of blocks) if (b.kind === 'task' && b.taskId) m.set(b.taskId, (m.get(b.taskId) ?? 0) + durationMinutes(b));
  return m;
}

const ceilTo = (m: number, step: number) => Math.ceil(m / step) * step;

export function autoplan(state: ScheduleState, opts: AutoplanOptions): TimeBlock[] {
  const week = opts.week ?? DEFAULT_WORK_WEEK;
  const done = scheduledMinutes(state.blocks);
  const queue = orderTasks(
    state.tasks.filter((t) => t.status !== 'done'),
    opts.strategy,
  )
    .map((t) => ({ task: t, need: Math.max(0, t.estimate - (done.get(t.id) ?? 0)) }))
    .filter((x) => x.need > 0);
  if (!queue.length) return [];

  // Free time per day, from `now` onward, rounded to the 15-minute grid.
  const firstDay = startOfLocalDay(Math.max(opts.from, startOfLocalDay(opts.now).getTime()));
  const lastDay = addDays(startOfLocalDay(opts.from), opts.days);
  const busyByDay = new Map<string, Interval[]>();
  for (const b of state.blocks) {
    const k = dayKey(b.start);
    if (!busyByDay.has(k)) busyByDay.set(k, []);
    busyByDay.get(k)!.push({ start: minuteOfDay(b.start), end: endMinuteOfDay(b.start, b.end) });
  }
  const off = new Set(state.offDays ?? []);
  const days: Array<{ day: Date; free: Interval[] }> = [];
  for (let d = firstDay; d < lastDay; d = addDays(d, 1)) {
    if (off.has(dayKey(d))) continue; // day off in this scenario
    let free = workIntervals(d, week);
    if (dayKey(d) === dayKey(opts.now)) free = subtractIntervals(free, [{ start: 0, end: ceilTo(minuteOfDay(opts.now), STEP) }]);
    free = subtractIntervals(free, busyByDay.get(dayKey(d)) ?? [])
      .map((i) => ({ start: ceilTo(i.start, STEP), end: Math.floor(i.end / STEP) * STEP }))
      .filter((i) => i.end - i.start >= STEP);
    days.push({ day: d, free });
  }

  const out: TimeBlock[] = [];
  for (const { task, need: initialNeed } of queue) {
    let need = initialNeed;
    let n = 0;
    for (const d of days) {
      if (need <= 0) break;
      for (let i = 0; i < d.free.length && need > 0; i++) {
        const slot = d.free[i];
        const len = slot.end - slot.start;
        // Avoid fragments: a chunk must be ≥ MIN_CHUNK unless it finishes the task.
        if (len < Math.min(MIN_CHUNK, need)) continue;
        const chunk = Math.min(need, len, MAX_CHUNK);
        const size = chunk === need ? ceilTo(chunk, STEP) : Math.floor(chunk / STEP) * STEP;
        const take = Math.min(size, len);
        out.push({
          id: `${opts.idPrefix}:${task.id}:${n++}`,
          kind: 'task',
          taskId: task.id,
          title: '',
          start: atMinute(d.day, slot.start),
          end: atMinute(d.day, slot.start + take),
          createdAt: opts.now,
          updatedAt: opts.now,
        });
        need -= take;
        // Consume the slot (in place on our private copy).
        d.free[i] = { start: slot.start + take, end: slot.end };
        if (d.free[i].end - d.free[i].start < STEP) {
          d.free.splice(i, 1);
          i--;
        }
      }
    }
  }
  return out;
}
