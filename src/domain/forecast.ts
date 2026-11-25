import { addDays, format, isWeekend } from 'date-fns';
import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import { blocksByDay, dayKey, durationMinutes, endMinuteOfDay, minuteOfDay, startOfLocalDay, workIntervals } from './schedule';
import type { ID, Instant, Minutes, Task, TimeBlock } from './types';

/** One day of scheduled load, split by task difficulty (hard/medium/easy) plus fixed events. */
export interface DayLoadRow {
  key: string;
  label: string;
  dow: string;
  date: Date;
  capacity: Minutes;
  /** Hard tasks. */
  deep: Minutes;
  /** Medium tasks. */
  shallow: Minutes;
  /** Easy tasks. */
  admin: Minutes;
  events: Minutes;
  isToday: boolean;
  weekend: boolean;
}

export function buildLoadForecast(
  blocks: TimeBlock[],
  taskMap: Map<ID, Task>,
  from: Instant,
  days: number,
  week: WorkWeek = DEFAULT_WORK_WEEK,
): DayLoadRow[] {
  const byDay = blocksByDay(blocks);
  const start = startOfLocalDay(from);
  const todayKey = dayKey(Date.now());
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const k = dayKey(date);
    const row: DayLoadRow = {
      key: k,
      label: format(date, 'd'),
      dow: format(date, 'EEEEE'),
      date,
      capacity: workIntervals(date, week).reduce((a, w) => a + w.end - w.start, 0),
      deep: 0,
      shallow: 0,
      admin: 0,
      events: 0,
      isToday: k === todayKey,
      weekend: isWeekend(date),
    };
    for (const b of byDay.get(k) ?? []) {
      const m = durationMinutes(b);
      if (b.kind === 'event') row.events += m;
      else {
        const d = taskMap.get(b.taskId ?? '')?.difficulty ?? 2;
        if (d === 3) row.deep += m;
        else if (d === 2) row.shallow += m;
        else row.admin += m;
      }
    }
    return row;
  });
}

/** Today's blocks in the shape the Today panel renders (minutes-of-day + display attributes). */
export function todayStrip(
  blocks: TimeBlock[],
  taskMap: Map<ID, Task>,
  colorOf: (task: Task) => string,
  categoryName: (task: Task) => string | undefined,
  now: Instant,
) {
  const k = dayKey(now);
  return blocks
    .filter((b) => dayKey(b.start) === k)
    .sort((a, b) => a.start - b.start)
    .map((b) => {
      const task = b.taskId ? taskMap.get(b.taskId) : undefined;
      return {
        id: b.id,
        start: minuteOfDay(b.start),
        end: endMinuteOfDay(b.start, b.end),
        title: b.kind === 'event' ? b.title : (task?.title ?? 'Deleted task'),
        kind: b.kind,
        energy: task ? (task.difficulty === 3 ? ('deep' as const) : task.difficulty === 2 ? ('shallow' as const) : ('admin' as const)) : undefined,
        color: task ? colorOf(task) : undefined,
        category: task ? categoryName(task) : undefined,
      };
    });
}

/** Working-hours envelope for a day: first start, last end, and the first break. */
export function workdayEnvelope(day: Instant, week: WorkWeek = DEFAULT_WORK_WEEK) {
  const w = workIntervals(day, week);
  if (!w.length) return { start: 0, end: 0, lunch: { start: 0, end: 0 } };
  const lunch = w.length > 1 ? { start: w[0].end, end: w[1].start } : { start: w[0].end, end: w[0].end };
  return { start: w[0].start, end: w[w.length - 1].end, lunch };
}
