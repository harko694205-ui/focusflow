/**
 * Quick capture: one line → a task. "econ ps4 fri 2h" becomes "Ps4" in ECON 11, due Friday at the
 * default due time, 2 hours. Anything not recognised stays in the title, so nothing typed is lost.
 * Estimates left out are learned from how long similar finished work actually took. Pure functions.
 */
import { addDays, startOfDay } from 'date-fns';
import { courseCode, guessWork, WORK, workKind } from './canvas';
import { LIMITS } from './constants';
import type { Category, ID, Minutes, Priority, Task } from './types';
import { parseEstimate } from './validation';

export interface CaptureContext {
  categories: Pick<Category, 'id' | 'name'>[];
  now: number;
  /** Default due time, "HH:mm". */
  dueTime: string;
}

export interface Capture {
  title: string;
  categoryId: ID | null;
  /** The words that picked the course, e.g. "econ". */
  courseWord: string | null;
  deadline: number | null;
  /** The words that set the deadline, e.g. "fri 5pm". */
  dueWords: string | null;
  estimate: Minutes | null;
  priority: Priority | null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Words that can name each course: "econ", "econ11", "cs31", "comsci31", "planning"… (unambiguous ones only). */
export function courseAliases(categories: Pick<Category, 'id' | 'name'>[]): Map<string, ID> {
  const seen = new Map<string, Set<ID>>();
  const add = (alias: string, id: ID) => {
    if (alias.length < 2) return;
    if (!seen.has(alias)) seen.set(alias, new Set());
    seen.get(alias)!.add(id);
  };
  for (const c of categories) {
    add(squash(c.name), c.id);
    const words = c.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (words[0] && /^[a-z]{2,}$/.test(words[0])) add(words[0], c.id);
    const code = courseCode(c.name);
    if (code) {
      const dept = code.dept.toLowerCase();
      const num = code.num.toLowerCase();
      add(dept, c.id);
      add(dept + num, c.id);
      add(squash(code.label), c.id);
      add(squash(code.label).replace(num, ''), c.id);
    }
  }
  const out = new Map<string, ID>();
  for (const [alias, ids] of seen) if (ids.size === 1) out.set(alias, [...ids][0]);
  return out;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const CONNECTORS = new Set(['by', 'due', 'on', 'at', 'before', 'for', 'until', '-', '–', '@']);

/** "dec", "Dec.", "december", "sept" → 11, 11, 11, 8; -1 otherwise. */
function monthOf(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  return w.length < 3 ? -1 : MONTHS.findIndex((m) => m.startsWith(w));
}

/** "5pm", "5:30pm", "17:00", "noon", "midnight" → minutes from midnight. */
function clockOf(word: string): number | null {
  const w = word.toLowerCase();
  if (w === 'noon') return 12 * 60;
  if (w === 'midnight') return 23 * 60 + 59;
  let m = /^(\d{1,2})(?::(\d{2}))?([ap])m?$/.exec(w);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    return ((h % 12) + (m[3] === 'p' ? 12 : 0)) * 60 + Number(m[2] ?? 0);
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(w);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

/** A date phrase starting at word i: returns the day and how many words it used. */
function dateAt(words: string[], i: number, now: Date): { day: Date; used: number; weekday?: boolean } | null {
  const w = words[i].toLowerCase().replace(/[.,]$/, '');
  const today = startOfDay(now);
  if (['today', 'tonight', 'tod', 'eod'].includes(w)) return { day: today, used: 1 };
  if (['tomorrow', 'tmr', 'tmrw', 'tom', 'tmw'].includes(w)) return { day: addDays(today, 1), used: 1 };
  // "fri" = the coming Friday (today if it's Friday); "next fri" = a week after that.
  const lead = w === 'next' || w === 'this';
  const wd = WEEKDAYS[(lead ? (words[i + 1] ?? '') : w).toLowerCase().replace(/[.,]$/, '')];
  if (wd !== undefined) {
    const ahead = (wd - today.getDay() + 7) % 7 + (w === 'next' ? 7 : 0);
    return { day: addDays(today, ahead), used: lead ? 2 : 1, weekday: true };
  }
  // "in 3 days", "in 2 weeks", "in a week"
  if (w === 'in' && words[i + 2]) {
    const n = words[i + 1].toLowerCase() === 'a' ? 1 : Number(words[i + 1]);
    const unit = words[i + 2].toLowerCase();
    if (Number.isInteger(n) && n > 0 && n < 100) {
      if (/^days?$/.test(unit)) return { day: addDays(today, n), used: 3 };
      if (/^(weeks?|wks?)$/.test(unit)) return { day: addDays(today, 7 * n), used: 3 };
    }
  }
  // "12/3", "12/3/26"
  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(w);
  if (slash) return { day: upcoming(Number(slash[1]) - 1, Number(slash[2]), slash[3], today), used: 1 };
  // "dec 3", "december 3rd", "3 dec"
  const mo = monthOf(w);
  const dayNum = (s?: string) => (s && /^\d{1,2}(st|nd|rd|th)?,?$/i.test(s) ? parseInt(s, 10) : NaN);
  if (mo >= 0 && dayNum(words[i + 1]) >= 1) return { day: upcoming(mo, dayNum(words[i + 1]), undefined, today), used: 2 };
  // "3 dec" — unless a day follows the month ("lab 3 dec 1st" is Dec 1).
  if (dayNum(w) >= 1 && words[i + 1] && monthOf(words[i + 1]) >= 0 && !(dayNum(words[i + 2]) >= 1)) return { day: upcoming(monthOf(words[i + 1]), dayNum(w), undefined, today), used: 2 };
  return null;
}

/** The next time this month/day comes round (this year, or next year if it has passed). */
function upcoming(month: number, day: number, year: string | undefined, today: Date): Date {
  if (year) return new Date(year.length === 2 ? 2000 + Number(year) : Number(year), month, day);
  const d = new Date(today.getFullYear(), month, day);
  return d < today ? new Date(today.getFullYear() + 1, month, day) : d;
}

export function parseCapture(input: string, ctx: CaptureContext): Capture {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const used = new Array(words.length).fill(false);
  const now = new Date(ctx.now);
  const out: Capture = { title: '', categoryId: null, courseWord: null, deadline: null, dueWords: null, estimate: null, priority: null };

  // Estimate: "2h", "30m", "1.5h", "1h30", "~45min", "90 min".
  words.forEach((w, i) => {
    if (out.estimate !== null || used[i]) return;
    const raw = w.toLowerCase().replace(/^~/, '');
    const unit = /^(h|hr|hrs|hours?|m|min|mins|minutes?)$/;
    const split = /^\d+(\.\d+)?$/.test(raw) && unit.test(words[i + 1]?.toLowerCase() ?? '');
    const text = split ? raw + words[i + 1].toLowerCase() : raw;
    if (!/^\d+(\.\d+)?(h|hr|hrs|hours?|m|min|mins|minutes?)$|^\d+h\d+m?$/.test(text)) return;
    const mins = parseEstimate(text.replace(/(hrs?|hours?)$/, 'h').replace(/(mins?|minutes?)$/, 'm'));
    if (!mins || mins < LIMITS.estimateMin || mins > LIMITS.estimateMax) return;
    out.estimate = mins;
    used[i] = true;
    if (split) used[i + 1] = true;
  });

  // Priority: "!" high, "!!" urgent, "urgent", "asap".
  words.forEach((w, i) => {
    if (used[i]) return;
    if (/^!{2,}$/.test(w) || /^(urgent|asap)$/i.test(w)) out.priority = 0;
    else if (w === '!') out.priority = out.priority ?? 1;
    else return;
    used[i] = true;
  });

  // Deadline: a date phrase and/or a time, with an optional "by"/"due" in front.
  let day: Date | null = null;
  let weekday = false;
  let clock: number | null = null;
  const dueIdx: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    if (!day) {
      const d = dateAt(words, i, now);
      if (d) {
        day = d.day;
        weekday = !!d.weekday;
        for (let k = i; k < i + d.used; k++) {
          used[k] = true;
          dueIdx.push(k);
        }
        i += d.used - 1;
        continue;
      }
    }
    if (clock === null) {
      const c = clockOf(words[i]);
      if (c !== null) {
        clock = c;
        used[i] = true;
        dueIdx.push(i);
      }
    }
  }
  if (day || clock !== null) {
    const [dh, dm] = ctx.dueTime.split(':').map(Number);
    const mins = clock ?? dh * 60 + dm;
    let d = day ?? startOfDay(now);
    let at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
    // Already passed: a bare time means tomorrow; "fri" on a Friday evening means next Friday.
    if ((!day || weekday) && at.getTime() <= ctx.now) {
      d = addDays(d, day ? 7 : 1);
      at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60);
    }
    out.deadline = at.getTime();
    // Swallow a connector right before the date ("due fri", "by 5pm").
    const first = Math.min(...dueIdx);
    if (first > 0 && !used[first - 1] && CONNECTORS.has(words[first - 1].toLowerCase())) {
      used[first - 1] = true;
      dueIdx.push(first - 1);
    }
    out.dueWords = dueIdx.sort((a, b) => a - b).map((k) => words[k]).join(' ');
  }

  // Course: "#econ", or a word (or two, "cs 31") that names exactly one course.
  const aliases = courseAliases(ctx.categories);
  for (let i = 0; i < words.length && !out.categoryId; i++) {
    if (used[i]) continue;
    const w = squash(words[i]);
    const pair = i + 1 < words.length && !used[i + 1] ? w + squash(words[i + 1]) : null;
    if (pair && aliases.has(pair) && /\d/.test(words[i + 1])) {
      out.categoryId = aliases.get(pair)!;
      out.courseWord = `${words[i]} ${words[i + 1]}`;
      used[i] = used[i + 1] = true;
    } else if (aliases.has(w)) {
      out.categoryId = aliases.get(w)!;
      out.courseWord = words[i];
      used[i] = true;
    }
  }
  // Still nothing: a 4+ letter start of one course's subject ("musc" → MUSCLG M82, "acct"… no).
  for (let i = 0; i < words.length && !out.categoryId; i++) {
    const w = squash(words[i]);
    if (used[i] || !/^[a-z]{4,}$/.test(w)) continue;
    const hits = new Set([...aliases].filter(([a]) => /^[a-z]+$/.test(a) && a.length > w.length && a.startsWith(w)).map(([, id]) => id));
    if (hits.size === 1) {
      out.categoryId = [...hits][0];
      out.courseWord = words[i];
      used[i] = true;
    }
  }

  const rest = words.filter((_, i) => !used[i]).map((w) => (/^(hw|ps|pset)\d*$/i.test(w) ? w.replace(/^[a-z]+/i, (p) => p.toUpperCase()) : w));
  while (rest.length && CONNECTORS.has(rest[rest.length - 1].toLowerCase())) rest.pop();
  while (rest.length && CONNECTORS.has(rest[0].toLowerCase())) rest.shift();
  const title = rest.join(' ');
  out.title = (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, LIMITS.titleMax);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Learned estimates                                                          */
/* -------------------------------------------------------------------------- */

export interface LearnedEstimate {
  estimate: Minutes;
  /** 'course': similar finished work in this course; 'kind': similar work anywhere; 'guess': no history yet. */
  basis: 'course' | 'kind' | 'guess';
  samples: number;
  /** "problem sets", "readings"… */
  label: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round15 = (m: number) => Math.min(600, Math.max(15, Math.round(m / 15) * 15));

/**
 * How long this will probably take, from how long similar finished work actually took (tracked
 * time when there is some, else its estimate): same kind in the same course first, then the same
 * kind anywhere, then a typical default.
 */
export function learnEstimate(title: string, categoryId: ID | null, tasks: Task[], actual: ReadonlyMap<ID, Minutes>): LearnedEstimate {
  const kind = workKind(title);
  const label = WORK[kind].label;
  const done = tasks.filter((t) => t.status === 'done' && !t.examId && workKind(t.title) === kind);
  const value = (t: Task) => ((actual.get(t.id) ?? 0) >= 10 ? actual.get(t.id)! : t.estimate);
  const inCourse = categoryId ? done.filter((t) => t.categoryId === categoryId) : [];
  if (inCourse.length >= 2) return { estimate: round15(median(inCourse.map(value))), basis: 'course', samples: inCourse.length, label };
  if (kind !== 'other' && done.length >= 3) return { estimate: round15(median(done.map(value))), basis: 'kind', samples: done.length, label };
  return { estimate: guessWork(title).estimate, basis: 'guess', samples: 0, label };
}
