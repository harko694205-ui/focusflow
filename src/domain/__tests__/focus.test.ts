import { describe, expect, it } from 'vitest';
import {
  advance,
  createSession,
  DEFAULT_FOCUS_SETTINGS,
  dueAt,
  focusSinceBreak,
  focusTime,
  intervalsLeft,
  isPaused,
  isWaiting,
  needsBreak,
  nextBreak,
  normalizeSettings,
  pause,
  progress,
  remaining,
  resume,
  settle,
  withSettings,
  type FocusSettings,
} from '../focus';

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 23, 9, 0);
const settings = (over: Partial<FocusSettings> = {}) => ({ ...DEFAULT_FOCUS_SETTINGS, ...over });

describe('countdown', () => {
  it('is derived from timestamps', () => {
    const s = createSession('t1', settings(), T0);
    expect(remaining(s, T0)).toBe(25 * MIN);
    expect(remaining(s, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(progress(s, T0 + 5 * MIN)).toBeCloseTo(0.2);
    expect(dueAt(s)).toBe(T0 + 25 * MIN);
    expect(focusTime(s, T0 + 7 * MIN)).toBe(7 * MIN);
  });

  it('pausing freezes the countdown and closes a focus run', () => {
    const s = createSession('t1', settings(), T0);
    const { session: p, run } = pause(s, T0 + 10 * MIN);
    expect(run).toEqual({ start: T0, end: T0 + 10 * MIN });
    expect(isPaused(p)).toBe(true);
    expect(remaining(p, T0 + 60 * MIN)).toBe(15 * MIN);
    expect(dueAt(p)).toBeNull();

    const r = resume(p, T0 + 30 * MIN);
    expect(remaining(r, T0 + 35 * MIN)).toBe(10 * MIN);
    expect(dueAt(r)).toBe(T0 + 45 * MIN);
    expect(focusTime(r, T0 + 35 * MIN)).toBe(15 * MIN);
  });
});

describe('phase transitions', () => {
  it('a full focus interval counts and starts the break automatically', () => {
    const s = createSession('t1', settings(), T0);
    const { session, run, event } = advance(s, T0 + 25 * MIN, 'complete');
    expect(run).toEqual({ start: T0, end: T0 + 25 * MIN });
    expect(event).toMatchObject({ type: 'focus_done', next: 'short_break' });
    expect(session).toMatchObject({ phase: 'short_break', completed: 1, runStart: T0 + 25 * MIN, elapsed: 0 });
    expect(focusTime(session, T0 + 27 * MIN)).toBe(25 * MIN); // break time isn't focus time
  });

  it('every 4th interval earns a long break', () => {
    expect([1, 2, 3, 4, 5, 8].map((n) => nextBreak(n, settings()))).toEqual([
      'short_break',
      'short_break',
      'short_break',
      'long_break',
      'short_break',
      'long_break',
    ]);
  });

  it('after a break the next focus waits for the user unless auto-start is on', () => {
    let s = createSession('t1', settings(), T0);
    s = advance(s, T0 + 25 * MIN, 'complete').session;
    const waiting = advance(s, T0 + 30 * MIN, 'complete').session;
    expect(waiting.phase).toBe('focus');
    expect(isWaiting(waiting)).toBe(true);
    expect(remaining(waiting, T0 + 99 * MIN)).toBe(25 * MIN);

    const auto = advance({ ...s, settings: settings({ autoStartFocus: true }) }, T0 + 30 * MIN, 'complete').session;
    expect(auto.runStart).toBe(T0 + 30 * MIN);
  });

  it('skipping focus goes to a short break without counting the interval', () => {
    const s = createSession('t1', settings(), T0);
    const { session, run } = advance(s, T0 + 12 * MIN, 'skip');
    expect(session).toMatchObject({ phase: 'short_break', completed: 0 });
    expect(run).toEqual({ start: T0, end: T0 + 12 * MIN });
  });

  it('skipping breaks builds up time-since-break until a break is taken', () => {
    let s = createSession('t1', settings({ autoStartFocus: true }), T0);
    let t = T0;
    for (let i = 0; i < 3; i++) {
      t += 25 * MIN;
      s = advance(s, t, 'complete').session; // break starts
      s = advance(s, t, 'skip').session; // skipped immediately
    }
    expect(s.skippedBreaks).toBe(3);
    expect(focusSinceBreak(s, t + 20 * MIN)).toBe(95 * MIN);
    expect(needsBreak(s, t + 20 * MIN)).toBe(true);

    s = advance(s, t + 25 * MIN, 'complete').session; // 4th interval → long break
    expect(s.phase).toBe('long_break');
    s = advance(s, t + 40 * MIN, 'complete').session;
    expect(s.skippedBreaks).toBe(0);
    expect(focusSinceBreak(s, t + 40 * MIN)).toBe(0);
    expect(needsBreak(s, t + 40 * MIN)).toBe(false);
  });
});

describe('settle', () => {
  it('moves on each phase at the moment it ended', () => {
    const s = createSession('t1', settings(), T0);
    const live = settle(s, T0 + 25 * MIN + 1_000);
    expect(live.runs).toEqual([{ start: T0, end: T0 + 25 * MIN }]);
    expect(live.events).toEqual([{ type: 'focus_done', at: T0 + 25 * MIN, next: 'short_break', live: true }]);
    expect(live.session.phase).toBe('short_break');
    expect(remaining(live.session, T0 + 26 * MIN)).toBe(4 * MIN);
  });

  it('does nothing before the phase is due', () => {
    const s = createSession('t1', settings(), T0);
    expect(settle(s, T0 + 10 * MIN)).toEqual({ session: s, runs: [], events: [] });
  });

  it('catching up after the app was closed never invents focus time', () => {
    const s = createSession('t1', settings({ autoStartFocus: true }), T0);
    const r = settle(s, T0 + 5 * 60 * MIN);
    // Focus ended → break auto-started → break ended; the next focus waits.
    expect(r.runs).toEqual([{ start: T0, end: T0 + 25 * MIN }]);
    expect(r.events.map((e) => [e.type, e.live])).toEqual([
      ['focus_done', false],
      ['break_done', false],
    ]);
    expect(r.session.phase).toBe('focus');
    expect(isWaiting(r.session)).toBe(true);
    expect(focusTime(r.session, T0 + 5 * 60 * MIN)).toBe(25 * MIN);
  });

  it('chains live transitions when auto-start is on both ways', () => {
    const s = createSession('t1', settings({ autoStartFocus: true, focus: 5, shortBreak: 1 }), T0);
    const r = settle(s, T0 + 6 * MIN);
    expect(r.events.map((e) => e.type)).toEqual(['focus_done', 'break_done']);
    expect(r.session.runStart).toBe(T0 + 6 * MIN);
  });
});

describe('settings', () => {
  it('normalizes out-of-range and missing values', () => {
    expect(normalizeSettings({ focus: 0, shortBreak: 999, longEvery: 1.4 })).toMatchObject({ focus: 5, shortBreak: 60, longEvery: 2, longBreak: 15 });
    expect(normalizeSettings(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(normalizeSettings({ focus: Number.NaN }).focus).toBe(25);
  });

  it('changing the length mid-phase keeps the elapsed time', () => {
    const s = createSession('t1', settings(), T0);
    const longer = withSettings(s, settings({ focus: 50 }));
    expect(remaining(longer, T0 + 20 * MIN)).toBe(30 * MIN);
  });
});

describe('intervalsLeft', () => {
  it('covers the remaining estimate, at least one', () => {
    expect(intervalsLeft(120, 0, 25)).toBe(5);
    expect(intervalsLeft(120, 70, 25)).toBe(2);
    expect(intervalsLeft(60, 90, 25)).toBe(1);
  });
});
