import { differenceInCalendarDays, format, isSameYear } from 'date-fns';
import type { Instant } from './types';

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later';

export const DUE_BUCKETS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'Next 7 days',
  next_week: 'Next 14 days',
  later: 'Later',
};

export function dueBucket(deadline: Instant, now: Instant): DueBucket {
  if (deadline < now) return 'overdue';
  const days = differenceInCalendarDays(deadline, now);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 7) return 'this_week';
  if (days < 14) return 'next_week';
  return 'later';
}

/** Compact, human deadline label: "Today 17:00", "Tomorrow", "Fri", "Dec 4", "Jan 3 2027". */
export function dueLabel(deadline: Instant, now: Instant, opts: { withTime?: boolean } = {}): string {
  const d = new Date(deadline);
  const days = differenceInCalendarDays(deadline, now);
  const time = format(d, 'HH:mm');
  const t = opts.withTime ? ` ${time}` : '';
  if (days === 0) return `Today${opts.withTime || deadline < now ? ` ${time}` : ''}`;
  if (days === 1) return `Tomorrow${t}`;
  if (days === -1) return `Yesterday${t}`;
  if (days > 1 && days < 7) return `${format(d, 'EEE')}${t}`;
  return isSameYear(d, now) ? `${format(d, 'MMM d')}${t}` : format(d, 'MMM d yyyy');
}

/** Combine a yyyy-MM-dd date and HH:mm time (local) into an instant. */
export function combineDateTime(date: string, time: string): Instant | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time || '17:00');
  if (!m || !t) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function splitDateTime(t: Instant): { date: string; time: string } {
  return { date: format(t, 'yyyy-MM-dd'), time: format(t, 'HH:mm') };
}
