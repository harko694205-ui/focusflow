/**
 * Focus Mode's pomodoro engine. Pure: every function takes the session and a timestamp and
 * returns a new session, so the countdown survives reloads (it is derived from timestamps,
 * never from a ticking counter) and can be tested without timers.
 *
 * A session alternates focus and break phases. A phase is either running (`runStart` set) or
 * stopped: paused part-way, or waiting to be started after the previous phase ended. Time
 * spent in focus phases is the actual work time; the service records each focus "run"
 * (start → pause/end) as a WorkSession.
 */
import type { ID, Instant, Minutes } from './types';

export type FocusPhase = 'focus' | 'short_break' | 'long_break';

export interface FocusSettings {
  focus: Minutes;
  shortBreak: Minutes;
  longBreak: Minutes;
  /** A long break after every Nth focus interval. */
  longEvery: number;
  /** Start the break as soon as a focus interval ends. */
  autoStartBreaks: boolean;
  /** Start the next focus interval as soon as a break ends. */
  autoStartFocus: boolean;
  sound: boolean;
  notifications: boolean;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  longEvery: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  sound: true,
  notifications: false,
};

export const FOCUS_PRESETS: Array<{ id: string; label: string; focus: Minutes; shortBreak: Minutes; longBreak: Minutes }> = [
  { id: 'classic', label: '25 / 5', focus: 25, shortBreak: 5, longBreak: 15 },
  { id: 'long', label: '50 / 10', focus: 50, shortBreak: 10, longBreak: 20 },
  { id: 'deep', label: '90 / 20', focus: 90, shortBreak: 20, longBreak: 30 },
];

export const LIMITS = { focus: [5, 180], shortBreak: [1, 60], longBreak: [1, 90], longEvery: [2, 8] } as const;

/** Focus time since the last break after which Focus Mode suggests stopping for one. */
export const BREAK_NUDGE_MS = 90 * 60_000;
/** A phase ending longer ago than this happened while nobody was watching. */
export const LIVE_GRACE_MS = 5_000;

export interface FocusSession {
  taskId: ID;
  startedAt: Instant;
  phase: FocusPhase;
  /** Start of the current running stretch; null while paused or waiting to start. */
  runStart: Instant | null;
  /** Phase time accumulated before `runStart` (earlier stretches, split by pauses). */
  elapsed: number;
  /** Focus intervals completed in full. */
  completed: number;
  /** Focus time in finished stretches (ms). The running stretch is added by `focusTime`. */
  focusMs: number;
  /** Focus time in finished stretches since the last break taken (ms). */
  sinceBreakMs: number;
  /** Breaks skipped in a row. */
  skippedBreaks: number;
  settings: FocusSettings;
}

/** A finished stretch of focus: recorded as actual work time. */
export interface FocusRun {
  start: Instant;
  end: Instant;
}

export type FocusEvent = { type: 'focus_done' | 'break_done'; at: Instant; next: FocusPhase; live: boolean };

const MIN = 60_000;
const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Math.round(x)));

/** Coerce stored or edited settings into valid ones. */
export function normalizeSettings(s: Partial<FocusSettings> | null | undefined): FocusSettings {
  const d = { ...DEFAULT_FOCUS_SETTINGS, ...(s ?? {}) };
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    focus: clamp(num(d.focus, 25), LIMITS.focus),
    shortBreak: clamp(num(d.shortBreak, 5), LIMITS.shortBreak),
    longBreak: clamp(num(d.longBreak, 15), LIMITS.longBreak),
    longEvery: clamp(num(d.longEvery, 4), LIMITS.longEvery),
    autoStartBreaks: !!d.autoStartBreaks,
    autoStartFocus: !!d.autoStartFocus,
    sound: !!d.sound,
    notifications: !!d.notifications,
  };
}

export function phaseMs(phase: FocusPhase, s: FocusSettings): number {
  return (phase === 'focus' ? s.focus : phase === 'short_break' ? s.shortBreak : s.longBreak) * MIN;
}

export const isBreak = (p: FocusPhase) => p !== 'focus';
export const isRunning = (s: FocusSession) => s.runStart !== null;

export function createSession(taskId: ID, settings: FocusSettings, now: Instant): FocusSession {
  return {
    taskId,
    startedAt: now,
    phase: 'focus',
    runStart: now,
    elapsed: 0,
    completed: 0,
    focusMs: 0,
    sinceBreakMs: 0,
    skippedBreaks: 0,
    settings: normalizeSettings(settings),
  };
}

const runMs = (s: FocusSession, now: Instant) => (s.runStart === null ? 0 : Math.max(0, now - s.runStart));

/** Time spent in the current phase. */
export function phaseElapsed(s: FocusSession, now: Instant): number {
  return s.elapsed + runMs(s, now);
}

export function phaseLength(s: FocusSession): number {
  return phaseMs(s.phase, s.settings);
}

export function remaining(s: FocusSession, now: Instant): number {
  return Math.max(0, phaseLength(s) - phaseElapsed(s, now));
}

/** 0–1 through the current phase. */
export function progress(s: FocusSession, now: Instant): number {
  return Math.min(1, phaseElapsed(s, now) / phaseLength(s));
}

/** When the running phase ends; null when stopped. */
export function dueAt(s: FocusSession): Instant | null {
  return s.runStart === null ? null : s.runStart + phaseLength(s) - s.elapsed;
}

/** The phase ran out but hasn't been moved on yet (settle() does that). */
export function isDue(s: FocusSession, now: Instant): boolean {
  const due = dueAt(s);
  return due !== null && now >= due;
}

/** Phase ended and the next one is waiting to be started. */
export function isWaiting(s: FocusSession): boolean {
  return s.runStart === null && s.elapsed === 0;
}

export function isPaused(s: FocusSession): boolean {
  return s.runStart === null && s.elapsed > 0;
}

/** Total focus time in this session, including the running stretch. */
export function focusTime(s: FocusSession, now: Instant): number {
  return s.focusMs + (s.phase === 'focus' ? runMs(s, now) : 0);
}

/** Focus time since the last break was taken. */
export function focusSinceBreak(s: FocusSession, now: Instant): number {
  return s.sinceBreakMs + (s.phase === 'focus' ? runMs(s, now) : 0);
}

/** Suggest a break: long unbroken focus, typically after skipping breaks. */
export function needsBreak(s: FocusSession, now: Instant): boolean {
  return s.phase === 'focus' && focusSinceBreak(s, now) >= Math.max(BREAK_NUDGE_MS, 2 * s.settings.focus * MIN);
}

/** Close the running stretch at `at` (folding it into the counters). */
function closeRun(s: FocusSession, at: Instant): { session: FocusSession; run: FocusRun | null } {
  if (s.runStart === null) return { session: s, run: null };
  const end = Math.max(s.runStart, at);
  const ms = end - s.runStart;
  const focus = s.phase === 'focus';
  return {
    session: {
      ...s,
      runStart: null,
      elapsed: s.elapsed + ms,
      focusMs: s.focusMs + (focus ? ms : 0),
      sinceBreakMs: s.sinceBreakMs + (focus ? ms : 0),
    },
    run: focus && ms > 0 ? { start: s.runStart, end } : null,
  };
}

export function pause(s: FocusSession, now: Instant): { session: FocusSession; run: FocusRun | null } {
  return closeRun(s, now);
}

export function resume(s: FocusSession, now: Instant): FocusSession {
  return s.runStart === null ? { ...s, runStart: now } : s;
}

/** The break that follows the `completed`-th focus interval. */
export function nextBreak(completed: number, settings: FocusSettings): FocusPhase {
  return completed > 0 && completed % settings.longEvery === 0 ? 'long_break' : 'short_break';
}

/**
 * End the current phase at `at` and set up the next one.
 * - `complete`: the phase ran its full length. A completed focus interval counts.
 * - `skip`: cut short. Skipping focus goes straight to a break without counting the interval;
 *   skipping a break goes back to focus without resetting the time-since-break.
 * `live` = someone is watching; when false, the next phase never auto-starts a focus
 * interval (no phantom work time is recorded while the app was closed).
 */
export function advance(
  s: FocusSession,
  at: Instant,
  how: 'complete' | 'skip',
  live = true,
): { session: FocusSession; run: FocusRun | null; event: FocusEvent } {
  const { session: closed, run } = closeRun(s, at);
  if (closed.phase === 'focus') {
    const completed = closed.completed + (how === 'complete' ? 1 : 0);
    const next = how === 'complete' ? nextBreak(completed, closed.settings) : 'short_break';
    return {
      session: { ...closed, phase: next, completed, elapsed: 0, runStart: closed.settings.autoStartBreaks ? at : null },
      run,
      event: { type: 'focus_done', at, next, live },
    };
  }
  const tookBreak = how === 'complete';
  return {
    session: {
      ...closed,
      phase: 'focus',
      elapsed: 0,
      runStart: closed.settings.autoStartFocus && live ? at : null,
      sinceBreakMs: tookBreak ? 0 : closed.sinceBreakMs,
      skippedBreaks: tookBreak ? 0 : closed.skippedBreaks + 1,
    },
    run,
    event: { type: 'break_done', at, next: 'focus', live },
  };
}

/**
 * Move on every phase that has run out by `now`, each at the moment it ended. Returns the
 * finished focus runs (to record) and the transitions (for reminders).
 */
export function settle(s: FocusSession, now: Instant): { session: FocusSession; runs: FocusRun[]; events: FocusEvent[] } {
  const runs: FocusRun[] = [];
  const events: FocusEvent[] = [];
  let cur = s;
  for (let guard = 0; guard < 50; guard++) {
    const due = dueAt(cur);
    if (due === null || due > now) break;
    const r = advance(cur, due, 'complete', now - due <= LIVE_GRACE_MS);
    cur = r.session;
    if (r.run) runs.push(r.run);
    events.push(r.event);
  }
  return { session: cur, runs, events };
}

/** Apply new settings mid-session; the current phase keeps its elapsed time. */
export function withSettings(s: FocusSession, settings: FocusSettings): FocusSession {
  return { ...s, settings: normalizeSettings(settings) };
}

/** Focus intervals still needed to cover the remaining estimate (at least 1 while open). */
export function intervalsLeft(estimate: Minutes, tracked: Minutes, focus: Minutes): number {
  return Math.max(1, Math.ceil(Math.max(0, estimate - tracked) / focus));
}

export const PHASE_LABEL: Record<FocusPhase, string> = { focus: 'Focus', short_break: 'Short break', long_break: 'Long break' };
