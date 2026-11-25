/**
 * Recurring classes: a weekly pattern ("Mon/Wed 10:00–11:50") expanded into the term's dated
 * meetings. Pure — the service turns meetings into timeline event blocks.
 */
import { addDays, parseISO } from 'date-fns';
import { dayKey, startOfLocalDay } from './schedule';
import { finalsStart, type Term } from './term';
import type { ClassDraft, ClassMeeting, Instant } from './types';

export const CLASS_KINDS = ['Lecture', 'Discussion', 'Lab', 'Seminar', 'Studio'] as const;
export const KIND_MAX = 30;

/** Mon … Sun, with single-letter labels as used on class schedules (R = Thursday). */
export const CLASS_DAYS: Array<{ day: number; letter: string; short: string }> = [
  { day: 1, letter: 'M', short: 'Mon' },
  { day: 2, letter: 'T', short: 'Tue' },
  { day: 3, letter: 'W', short: 'Wed' },
  { day: 4, letter: 'R', short: 'Thu' },
  { day: 5, letter: 'F', short: 'Fri' },
  { day: 6, letter: 'S', short: 'Sat' },
  { day: 0, letter: 'U', short: 'Sun' },
];

export type ClassErrors = Partial<Record<'categoryId' | 'kind' | 'days' | 'time', string>>;

export function validateClass(d: ClassDraft): ClassErrors {
  const e: ClassErrors = {};
  if (!d.categoryId) e.categoryId = 'Pick the course.';
  if (!d.kind.trim()) e.kind = 'Say what kind of class it is.';
  else if (d.kind.trim().length > KIND_MAX) e.kind = 'That’s too long.';
  if (!d.days.length) e.days = 'Pick the days it meets.';
  else if (!d.days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)) e.days = 'Unknown day.';
  if (!Number.isFinite(d.start) || !Number.isFinite(d.end) || d.start < 0 || d.end > 24 * 60) e.time = 'Enter start and end times.';
  else if (d.end <= d.start) e.time = 'It has to end after it starts.';
  else if (d.end - d.start < 10) e.time = 'At least 10 minutes.';
  return e;
}

/** "MW", "TR", "MWF" — the compact day pattern from a schedule of classes. */
export function dayPattern(days: number[]): string {
  return CLASS_DAYS.filter((d) => days.includes(d.day))
    .map((d) => d.letter)
    .join('');
}

/** Dates (half-open: `until` excluded) that classes meet in. */
export interface ClassRange {
  from: Date;
  until: Date;
}

/**
 * Instruction weeks of the term (classes stop when finals week starts). Without a term: the
 * next ten weeks from today.
 */
export function classRange(term: Term | null, now: Instant): ClassRange {
  if (term) return { from: startOfLocalDay(parseISO(term.start)), until: finalsStart(term) };
  const from = startOfLocalDay(now);
  return { from, until: addDays(from, 70) };
}

export interface Meeting {
  start: Instant;
  end: Instant;
}

/** Every meeting of a class within the range, skipping holidays. */
export function expandClass(c: Pick<ClassMeeting, 'days' | 'start' | 'end'>, range: ClassRange, holidays: readonly string[] = []): Meeting[] {
  const skip = new Set(holidays);
  const out: Meeting[] = [];
  for (let d = startOfLocalDay(range.from); d < range.until; d = addDays(d, 1)) {
    if (!c.days.includes(d.getDay()) || skip.has(dayKey(d))) continue;
    // Build from the local date (not "midnight + minutes") so DST changes don't shift classes.
    const s = new Date(d);
    s.setHours(0, c.start, 0, 0);
    const e = new Date(d);
    e.setHours(0, c.end, 0, 0);
    out.push({ start: s.getTime(), end: e.getTime() });
  }
  return out;
}

/** Event title for a class meeting, e.g. "CS 31 Lecture". */
export function classTitle(courseName: string, kind: string): string {
  return `${courseName} ${kind}`.trim();
}

/** Weekly minutes spent in this class. */
export function weeklyClassMinutes(c: Pick<ClassMeeting, 'days' | 'start' | 'end'>): number {
  return c.days.length * (c.end - c.start);
}
