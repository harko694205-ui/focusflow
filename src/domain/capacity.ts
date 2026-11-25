import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import type { Instant, Minutes } from './types';

const DAY_MS = 86_400_000;

function startOfLocalDay(t: Instant): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Working minutes available between two instants under a weekly template.
 * Walks local calendar days, so DST transitions are handled by the Date API.
 */
export function workingMinutesBetween(from: Instant, to: Instant, week: WorkWeek = DEFAULT_WORK_WEEK): Minutes {
  if (to <= from) return 0;
  let total = 0;
  const cursor = startOfLocalDay(from);
  // Guard against absurd ranges (e.g. a deadline years away): cap at ~3 years of days.
  for (let i = 0; i < 1100 && cursor.getTime() < to; i++) {
    const dayStart = cursor.getTime();
    for (const { start, end } of week[cursor.getDay() as keyof WorkWeek]) {
      const s = Math.max(from, dayStart + start * 60_000);
      const e = Math.min(to, dayStart + end * 60_000);
      if (e > s) total += (e - s) / 60_000;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.round(total);
}

/** Capacity for a whole local calendar day. */
export function dayCapacity(day: Date, week: WorkWeek = DEFAULT_WORK_WEEK): Minutes {
  return week[day.getDay() as keyof WorkWeek].reduce((a, r) => a + (r.end - r.start), 0);
}

export { DAY_MS };
