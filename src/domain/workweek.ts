/**
 * Working hours: the weekly template every capacity, risk and scheduling calculation uses.
 * Minutes from local midnight; index 0 = Sunday (Date#getDay()).
 */
import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import type { Minutes } from './types';

export type Weekday = keyof WorkWeek;
export type WorkInterval = WorkWeek[Weekday][number];

/** Monday first, as shown in Settings. */
export const WEEKDAYS: Array<{ day: Weekday; short: string; long: string }> = [
  { day: 1, short: 'Mon', long: 'Monday' },
  { day: 2, short: 'Tue', long: 'Tuesday' },
  { day: 3, short: 'Wed', long: 'Wednesday' },
  { day: 4, short: 'Thu', long: 'Thursday' },
  { day: 5, short: 'Fri', long: 'Friday' },
  { day: 6, short: 'Sat', long: 'Saturday' },
  { day: 0, short: 'Sun', long: 'Sunday' },
];

export const STEP = 15;
export const MAX_INTERVALS = 4;
/** A working week needs at least this much time for anything to be scheduled. */
export const MIN_WEEKLY: Minutes = 60;

const hm = (h: number, m = 0) => h * 60 + m;
const days = (ivs: WorkInterval[], on: Weekday[]): WorkWeek => {
  const w = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } as WorkWeek;
  for (const d of on) w[d] = ivs.map((x) => ({ ...x }));
  return w;
};
const WEEKDAYS_ONLY: Weekday[] = [1, 2, 3, 4, 5];

export const WORK_WEEK_PRESETS: Array<{ id: string; label: string; hint: string; week: WorkWeek }> = [
  { id: 'default', label: 'Standard', hint: 'Mon–Fri · 08:30–18:00 with lunch', week: DEFAULT_WORK_WEEK },
  { id: 'nine-five', label: '9 to 5', hint: 'Mon–Fri · 09:00–17:00 with lunch', week: days([{ start: hm(9), end: hm(12) }, { start: hm(13), end: hm(17) }], WEEKDAYS_ONLY) },
  {
    id: 'four-day',
    label: '4-day week',
    hint: 'Mon–Thu · 08:00–18:30 with lunch',
    week: days([{ start: hm(8), end: hm(12, 30) }, { start: hm(13, 15), end: hm(18, 30) }], [1, 2, 3, 4]),
  },
  {
    id: 'part-time',
    label: 'Mornings',
    hint: 'Mon–Fri · 08:30–13:00',
    week: days([{ start: hm(8, 30), end: hm(13) }], WEEKDAYS_ONLY),
  },
  {
    // Study time: days around classes, evenings, and Sunday; Saturday off.
    id: 'student',
    label: 'Student',
    hint: 'Mon–Fri days + evenings · Sun',
    week: {
      ...days([{ start: hm(10), end: hm(12) }, { start: hm(13), end: hm(17) }, { start: hm(19), end: hm(22) }], WEEKDAYS_ONLY),
      0: [
        { start: hm(13), end: hm(17) },
        { start: hm(19), end: hm(22) },
      ],
    },
  },
];

export const STUDENT_PRESET = WORK_WEEK_PRESETS.find((p) => p.id === 'student')!;

export function dayMinutes(ivs: readonly WorkInterval[]): Minutes {
  return ivs.reduce((a, x) => a + (x.end - x.start), 0);
}

export function weeklyMinutes(week: WorkWeek): Minutes {
  return WEEKDAYS.reduce((a, { day }) => a + dayMinutes(week[day]), 0);
}

export function sameWeek(a: WorkWeek, b: WorkWeek): boolean {
  return WEEKDAYS.every(({ day }) => a[day].length === b[day].length && a[day].every((x, i) => x.start === b[day][i].start && x.end === b[day][i].end));
}

export function presetOf(week: WorkWeek): string | null {
  return WORK_WEEK_PRESETS.find((p) => sameWeek(p.week, week))?.id ?? null;
}

/** Problems with one day's intervals, as user-facing text; null when fine. */
export function dayProblem(ivs: readonly WorkInterval[]): string | null {
  if (ivs.length > MAX_INTERVALS) return `At most ${MAX_INTERVALS} blocks a day.`;
  const sorted = [...ivs].sort((a, b) => a.start - b.start);
  for (const x of sorted) {
    if (!Number.isFinite(x.start) || !Number.isFinite(x.end)) return 'Enter a start and end time.';
    if (x.start < 0 || x.end > 24 * 60) return 'Times must be within the day.';
    if (x.end <= x.start) return 'Each block must end after it starts.';
    if (x.start % STEP || x.end % STEP) return `Use ${STEP}-minute steps.`;
  }
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end) return 'Blocks overlap.';
  return null;
}

export function weekProblems(week: WorkWeek): Partial<Record<Weekday, string>> {
  const out: Partial<Record<Weekday, string>> = {};
  for (const { day } of WEEKDAYS) {
    const p = dayProblem(week[day] ?? []);
    if (p) out[day] = p;
  }
  return out;
}

/** Validate and tidy a work week (sorted intervals, adjacent blocks merged). Throws on invalid input. */
export function normalizeWorkWeek(input: unknown): WorkWeek {
  const w = input as Partial<WorkWeek> | null;
  if (!w || typeof w !== 'object') throw new Error('Working hours are malformed.');
  const out = {} as WorkWeek;
  for (const { day, long } of WEEKDAYS) {
    const ivs = w[day] ?? [];
    if (!Array.isArray(ivs) || !ivs.every((x) => x && typeof x.start === 'number' && typeof x.end === 'number')) throw new Error('Working hours are malformed.');
    const p = dayProblem(ivs);
    if (p) throw new Error(`${long}: ${p}`);
    const merged: WorkInterval[] = [];
    for (const x of [...ivs].sort((a, b) => a.start - b.start)) {
      const last = merged[merged.length - 1];
      if (last && last.end === x.start) last.end = x.end;
      else merged.push({ start: x.start, end: x.end });
    }
    out[day] = merged;
  }
  if (weeklyMinutes(out) < MIN_WEEKLY) throw new Error('Add at least an hour of working time to the week.');
  return out;
}

/** Stored value → a usable week, falling back to the default when missing or broken. */
export function readWorkWeek(stored: unknown): WorkWeek {
  if (stored === undefined || stored === null) return DEFAULT_WORK_WEEK;
  try {
    return normalizeWorkWeek(stored);
  } catch {
    return DEFAULT_WORK_WEEK;
  }
}

/** A sensible new block for a day: after the last one, else the default day's first block. */
export function suggestInterval(ivs: readonly WorkInterval[]): WorkInterval | null {
  if (ivs.length >= MAX_INTERVALS) return null;
  if (!ivs.length) return { start: hm(9), end: hm(17) };
  const lastEnd = Math.max(...ivs.map((x) => x.end));
  const start = lastEnd + 60;
  if (start + 30 > 24 * 60) return null;
  return { start, end: Math.min(start + 120, 24 * 60) };
}

/** "08:30" ⇄ minutes. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}
