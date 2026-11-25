/**
 * Academic term awareness (Student mode): which week of the quarter a date falls in.
 *
 * Follows the UCLA quarter convention: weeks run Monday–Sunday; a term whose first day of
 * instruction is Thursday–Sunday starts with a partial "Week 0" (Fall), otherwise the first
 * week is Week 1 (Winter, Spring). After the instruction weeks comes finals week.
 */
import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns';
import type { Instant } from './types';

export interface Term {
  /** e.g. "Fall 2026". */
  name: string;
  /** First day of instruction, yyyy-MM-dd (local). */
  start: string;
  /** Instruction weeks, not counting a Week 0. UCLA quarters have 10. */
  weeks: number;
  /** A finals week follows the last instruction week. */
  finals: boolean;
  /** Days with no classes (holidays), yyyy-MM-dd. */
  holidays?: string[];
}

export type TermPhase = 'before' | 'instruction' | 'finals' | 'after';

export interface TermWeek {
  phase: TermPhase;
  /** Week number during instruction (0 for a partial first week); null otherwise. */
  week: number | null;
  /** "Week 6", "Finals week", "Starts in 5 days", "Break". */
  label: string;
  /** Compact form for chips: "Wk 6", "Finals", "Break". */
  short: string;
}

const weekStart = (d: Date) => startOfWeek(d, { weekStartsOn: 1 });

export function isValidTerm(t: Partial<Term> | null | undefined): t is Term {
  return (
    !!t &&
    typeof t.name === 'string' &&
    typeof t.start === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(t.start) &&
    !Number.isNaN(parseISO(t.start).getTime()) &&
    typeof t.weeks === 'number' &&
    Number.isInteger(t.weeks) &&
    t.weeks >= 1 &&
    t.weeks <= 20 &&
    typeof t.finals === 'boolean' &&
    (t.holidays === undefined || (Array.isArray(t.holidays) && t.holidays.every((h) => typeof h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(h))))
  );
}

/** Monday of Week 1. */
export function weekOneStart(term: Term): Date {
  const start = parseISO(term.start);
  const day = start.getDay(); // 0 Sun … 6 Sat
  const startsLate = day === 0 || day >= 4; // Thu–Sun → partial Week 0 first
  return startsLate ? addDays(weekStart(start), 7) : weekStart(start);
}

/** Monday of finals week (or of the week after instruction when there's no finals week). */
export function finalsStart(term: Term): Date {
  return addDays(weekOneStart(term), term.weeks * 7);
}

/** The day after the term ends. */
export function termEnd(term: Term): Date {
  return addDays(finalsStart(term), term.finals ? 7 : 0);
}

export function termWeek(term: Term, at: Instant | Date): TermWeek {
  const day = new Date(at);
  const start = parseISO(term.start);
  if (differenceInCalendarDays(day, start) < 0) {
    const n = differenceInCalendarDays(start, day);
    return { phase: 'before', week: null, label: n === 1 ? 'Starts tomorrow' : `Starts in ${n} days`, short: 'Soon' };
  }
  const fromWeekOne = Math.floor(differenceInCalendarDays(day, weekOneStart(term)) / 7);
  const week = fromWeekOne + 1; // Week 0 when before Week 1's Monday
  if (week <= term.weeks) return { phase: 'instruction', week, label: `Week ${week}`, short: `Wk ${week}` };
  if (term.finals && week === term.weeks + 1) return { phase: 'finals', week: null, label: 'Finals week', short: 'Finals' };
  return { phase: 'after', week: null, label: 'Break', short: 'Break' };
}

/** "Finals start Mon Dec 7 · in 3 weeks", or null once finals have begun. */
export function finalsCountdown(term: Term, at: Instant | Date): string | null {
  if (!term.finals) return null;
  const f = finalsStart(term);
  const days = differenceInCalendarDays(f, new Date(at));
  if (days <= 0) return null;
  const when = days < 7 ? `in ${days} day${days === 1 ? '' : 's'}` : `in ${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'}`;
  return `Finals start ${format(f, 'EEE MMM d')} · ${when}`;
}

/** A sensible starting term for the current date (editable in Settings). UCLA-style quarters. */
export function suggestTerm(now: Instant): Term {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-based
  // Rough quarter boundaries: Winter Jan–Mar, Spring Apr–Jun, Summer Jul–Sep, Fall late Sep–Dec.
  if (m <= 2) return { name: `Winter ${y}`, start: format(firstWeekday(y, 0, 2, 1), 'yyyy-MM-dd'), weeks: 10, finals: true };
  if (m <= 5) return { name: `Spring ${y}`, start: format(firstWeekday(y, 2, 25, 1), 'yyyy-MM-dd'), weeks: 10, finals: true };
  if (m <= 7) return { name: `Summer ${y}`, start: format(firstWeekday(y, 5, 22, 1), 'yyyy-MM-dd'), weeks: 6, finals: false };
  return { name: `Fall ${y}`, start: format(firstWeekday(y, 8, 22, 4), 'yyyy-MM-dd'), weeks: 10, finals: true };
}

/** First date on or after (year, month, day) that falls on `weekday` (0 Sun … 6 Sat). */
function firstWeekday(year: number, month: number, day: number, weekday: number): Date {
  const d = new Date(year, month, day);
  return addDays(d, (weekday - d.getDay() + 7) % 7);
}
