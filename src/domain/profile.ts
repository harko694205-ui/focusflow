/**
 * Who the workspace is for. "Student" mode relabels categories as courses, defaults deadlines
 * to 11:59 pm and shows the week of the academic term.
 */
import { isValidTerm, type Term } from './term';

export type Mode = 'work' | 'student';

export interface Profile {
  mode: Mode;
  /** Current academic term (Student mode); null when not set. */
  term: Term | null;
  /** Default time for new deadlines, "HH:mm". */
  dueTime: string;
}

export const DUE_TIME_DEFAULTS: Record<Mode, string> = { work: '17:00', student: '23:59' };

export const DEFAULT_PROFILE: Profile = { mode: 'work', term: null, dueTime: DUE_TIME_DEFAULTS.work };

const isClock = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** Stored value → a usable profile; anything missing or invalid falls back to the default. */
export function readProfile(stored: unknown): Profile {
  const p = (stored ?? {}) as Partial<Profile>;
  const mode: Mode = p.mode === 'student' ? 'student' : 'work';
  return {
    mode,
    term: isValidTerm(p.term) ? { ...p.term, name: p.term.name.trim().slice(0, 40) } : null,
    dueTime: isClock(p.dueTime) ? p.dueTime : DUE_TIME_DEFAULTS[mode],
  };
}

/** Validate an edit; throws a user-facing message. */
export function validateProfile(p: Profile): Profile {
  if (!isClock(p.dueTime)) throw new Error('Enter the default due time as hh:mm.');
  if (p.term !== null && !isValidTerm(p.term)) throw new Error('Check the term: it needs a start date and 1–20 weeks.');
  return readProfile(p);
}

/** Words for the category concept in the current mode. */
export interface Terms {
  one: string;
  many: string;
  lower: string;
  lowerMany: string;
}

export function termsFor(mode: Mode): Terms {
  return mode === 'student'
    ? { one: 'Course', many: 'Courses', lower: 'course', lowerMany: 'courses' }
    : { one: 'Category', many: 'Categories', lower: 'category', lowerMany: 'categories' };
}
