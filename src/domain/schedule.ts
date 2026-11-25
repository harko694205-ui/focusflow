/**
 * Pure scheduling helpers for the timeline: wall-clock math, overlap layout,
 * conflict detection, free-time computation and per-task scheduled totals.
 *
 * Positions use local *wall-clock* minutes (09:30 → 570), so DST days still render
 * 00:00–24:00 and a block created at 09:00 stays at 09:00.
 */
import { DEFAULT_WORK_WEEK, type WorkWeek } from './constants';
import type { ID, Instant, Minutes, TimeBlock } from './types';

export const SNAP: Minutes = 15;
export const MIN_BLOCK: Minutes = 15;
export const DAY_MINUTES = 24 * 60;

/* -------------------------------------------------------------------------- */
/* Wall-clock helpers                                                         */
/* -------------------------------------------------------------------------- */

export function startOfLocalDay(t: Instant | Date): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Instant for `minutes` past local midnight of `day` (wall-clock; DST-safe). */
export function atMinute(day: Date | Instant, minutes: Minutes): Instant {
  const d = startOfLocalDay(day);
  d.setHours(0, minutes, 0, 0);
  return d.getTime();
}

/** Wall-clock minutes past local midnight. */
export function minuteOfDay(t: Instant): Minutes {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

/** End-of-block minute; a block ending exactly at midnight reports 1440, not 0. */
export function endMinuteOfDay(start: Instant, end: Instant): Minutes {
  const m = minuteOfDay(end);
  return m === 0 && end > start ? DAY_MINUTES : m;
}

export function dayKey(t: Instant | Date): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sameLocalDay(a: Instant, b: Instant): boolean {
  return dayKey(a) === dayKey(b);
}

export const snap = (m: Minutes, step: Minutes = SNAP) => Math.round(m / step) * step;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function durationMinutes(b: Pick<TimeBlock, 'start' | 'end'>): Minutes {
  return Math.round((b.end - b.start) / 60_000);
}

/* -------------------------------------------------------------------------- */
/* Overlap layout + conflicts                                                 */
/* -------------------------------------------------------------------------- */

export interface BlockLayout {
  /** 0-based lane within its overlap cluster. */
  lane: number;
  /** Number of lanes in the cluster (column is divided by this). */
  lanes: number;
  /** IDs of blocks this one overlaps. Empty = no conflict. */
  overlaps: ID[];
}

const overlapping = (a: Pick<TimeBlock, 'start' | 'end'>, b: Pick<TimeBlock, 'start' | 'end'>) => a.start < b.end && b.start < a.end;

/**
 * Classic calendar packing: sort by start, group transitively-overlapping blocks into clusters,
 * assign each block the first free lane. Back-to-back blocks (end === start) don't overlap.
 */
export function layoutBlocks(blocks: Array<Pick<TimeBlock, 'id' | 'start' | 'end'>>): Map<ID, BlockLayout> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const out = new Map<ID, BlockLayout>();

  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const lanesOf = new Map<ID, number>();

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const b of cluster) {
      out.set(b.id, {
        lane: lanesOf.get(b.id)!,
        lanes,
        overlaps: cluster.filter((o) => o.id !== b.id && overlapping(o, b)).map((o) => o.id),
      });
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const b of sorted) {
    if (b.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= b.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(b.end);
    } else laneEnds[lane] = b.end;
    lanesOf.set(b.id, lane);
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.end);
  }
  flush();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export interface Interval {
  start: Minutes;
  end: Minutes;
}

export function workIntervals(day: Date | Instant, week: WorkWeek = DEFAULT_WORK_WEEK): Interval[] {
  return week[new Date(day).getDay() as keyof WorkWeek];
}

/** Subtract busy intervals from free intervals (all in minutes-of-day). */
export function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
  let result = free.map((f) => ({ ...f }));
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of result) {
      if (b.end <= f.start || b.start >= f.end) next.push(f);
      else {
        if (b.start > f.start) next.push({ start: f.start, end: b.start });
        if (b.end < f.end) next.push({ start: b.end, end: f.end });
      }
    }
    result = next;
  }
  return result.filter((i) => i.end - i.start > 0);
}

const blockInterval = (b: Pick<TimeBlock, 'start' | 'end'>): Interval => ({ start: minuteOfDay(b.start), end: endMinuteOfDay(b.start, b.end) });

/** Unbooked working time on a day, optionally only from `fromMinute` on (e.g. now). */
export function freeIntervals(
  day: Date | Instant,
  dayBlocks: Array<Pick<TimeBlock, 'start' | 'end'>>,
  opts: { week?: WorkWeek; fromMinute?: Minutes; minLength?: Minutes } = {},
): Interval[] {
  let work = workIntervals(day, opts.week);
  if (opts.fromMinute !== undefined) work = subtractIntervals(work, [{ start: 0, end: opts.fromMinute }]);
  return subtractIntervals(work, dayBlocks.map(blockInterval)).filter((i) => i.end - i.start >= (opts.minLength ?? 1));
}

export interface DayLoad {
  capacity: Minutes;
  /** Minutes of blocks inside working hours (overlaps counted once). */
  booked: Minutes;
  /** Minutes of blocks outside working hours. */
  overtime: Minutes;
  free: Minutes;
}

export function dayLoad(day: Date | Instant, dayBlocks: Array<Pick<TimeBlock, 'start' | 'end'>>, week?: WorkWeek): DayLoad {
  const work = workIntervals(day, week);
  const capacity = work.reduce((a, i) => a + i.end - i.start, 0);
  const free = subtractIntervals(work, dayBlocks.map(blockInterval)).reduce((a, i) => a + i.end - i.start, 0);
  // Union of block intervals, to count overlapping blocks once.
  const union = subtractIntervals([{ start: 0, end: DAY_MINUTES }], dayBlocks.map(blockInterval));
  const busyTotal = DAY_MINUTES - union.reduce((a, i) => a + i.end - i.start, 0);
  const booked = capacity - free;
  return { capacity, booked, overtime: Math.max(0, busyTotal - booked), free };
}

/* -------------------------------------------------------------------------- */
/* Task ↔ schedule                                                            */
/* -------------------------------------------------------------------------- */

export interface TaskSchedule {
  minutes: Minutes;
  blockCount: number;
  /** Earliest block starting at/after `now`, if any. */
  next: Instant | null;
  /** Latest block end. */
  lastEnd: Instant | null;
}

export function scheduleByTask(blocks: TimeBlock[], now: Instant): Map<ID, TaskSchedule> {
  const map = new Map<ID, TaskSchedule>();
  for (const b of blocks) {
    if (b.kind !== 'task' || !b.taskId) continue;
    const s = map.get(b.taskId) ?? { minutes: 0, blockCount: 0, next: null, lastEnd: null };
    s.minutes += durationMinutes(b);
    s.blockCount += 1;
    if (b.end > now && (s.next === null || b.start < s.next)) s.next = b.start;
    if (s.lastEnd === null || b.end > s.lastEnd) s.lastEnd = b.end;
    map.set(b.taskId, s);
  }
  return map;
}

/** Group blocks by local day key. */
export function blocksByDay(blocks: TimeBlock[]): Map<string, TimeBlock[]> {
  const map = new Map<string, TimeBlock[]>();
  for (const b of blocks) {
    const k = dayKey(b.start);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(b);
  }
  return map;
}

/** Validation shared by the service and the UI. Returns an error message or null. */
export function validateSpan(start: Instant, end: Instant): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Invalid time.';
  if (end - start < MIN_BLOCK * 60_000) return `Blocks must be at least ${MIN_BLOCK} minutes.`;
  if (!sameLocalDay(start, end) && !(minuteOfDay(end) === 0 && sameLocalDay(start, end - 1))) return 'Blocks can’t cross midnight.';
  return null;
}
