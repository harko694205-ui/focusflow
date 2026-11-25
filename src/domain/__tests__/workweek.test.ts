import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '../constants';
import {
  dayProblem,
  normalizeWorkWeek,
  parseClock,
  presetOf,
  readWorkWeek,
  suggestInterval,
  weeklyMinutes,
  weekProblems,
  WORK_WEEK_PRESETS,
} from '../workweek';

const empty = (): WorkWeek => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });

describe('work week', () => {
  it('measures the default week', () => {
    expect(weeklyMinutes(DEFAULT_WORK_WEEK)).toBe(5 * (8 * 60 + 45));
    expect(presetOf(DEFAULT_WORK_WEEK)).toBe('default');
    expect(WORK_WEEK_PRESETS.every((p) => presetOf(normalizeWorkWeek(p.week)) === p.id)).toBe(true);
  });

  it('flags invalid days', () => {
    expect(dayProblem([{ start: 600, end: 540 }])).toMatch(/end after/);
    expect(dayProblem([{ start: 540, end: 720 }, { start: 705, end: 810 }])).toMatch(/overlap/);
    expect(dayProblem([{ start: 545, end: 600 }])).toMatch(/15-minute/);
    expect(dayProblem([{ start: 540, end: 1500 }])).toMatch(/within the day/);
    expect(dayProblem([{ start: 540, end: 600 }])).toBeNull();
    const w = { ...empty(), 3: [{ start: 600, end: 540 }] };
    expect(Object.keys(weekProblems(w))).toEqual(['3']);
  });

  it('normalizes: sorts and merges touching blocks; rejects empty weeks', () => {
    const w = { ...empty(), 1: [{ start: 780, end: 1020 }, { start: 540, end: 780 }] };
    expect(normalizeWorkWeek(w)[1]).toEqual([{ start: 540, end: 1020 }]);
    expect(() => normalizeWorkWeek(empty())).toThrow(/at least an hour/);
    expect(() => normalizeWorkWeek({ ...empty(), 2: [{ start: 600, end: 540 }] })).toThrow(/Tuesday/);
    expect(() => normalizeWorkWeek('x')).toThrow(/malformed/);
  });

  it('falls back to the default for missing or broken stored values', () => {
    expect(readWorkWeek(undefined)).toBe(DEFAULT_WORK_WEEK);
    expect(readWorkWeek({ 1: 'nope' })).toBe(DEFAULT_WORK_WEEK);
    const ok = { ...empty(), 6: [{ start: 600, end: 720 }] };
    expect(readWorkWeek(ok)[6]).toEqual([{ start: 600, end: 720 }]);
  });

  it('suggests a next block and parses clock text', () => {
    expect(suggestInterval([])).toEqual({ start: 540, end: 1020 });
    expect(suggestInterval([{ start: 540, end: 720 }])).toEqual({ start: 780, end: 900 });
    expect(suggestInterval([{ start: 0, end: 1440 }])).toBeNull();
    expect(parseClock('08:30')).toBe(510);
    expect(parseClock('24:00')).toBe(1440);
    expect(parseClock('7:5')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
  });
});
