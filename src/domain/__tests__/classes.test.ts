import { describe, expect, it } from 'vitest';
import { classRange, classTitle, dayPattern, expandClass, validateClass, weeklyClassMinutes } from '../classes';
import { isValidTerm, type Term } from '../term';

const fall: Term = { name: 'Fall 2026', start: '2026-09-24', weeks: 10, finals: true, holidays: ['2026-11-11', '2026-11-26', '2026-11-27'] };
const lecture = { days: [1, 3], start: 10 * 60, end: 11 * 60 + 50 }; // MW 10:00–11:50
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5);

describe('class range', () => {
  it('covers instruction weeks: first day of instruction up to finals week', () => {
    const r = classRange(fall, Date.now());
    expect(r.from.toDateString()).toBe(new Date(2026, 8, 24).toDateString());
    expect(r.until.toDateString()).toBe(new Date(2026, 11, 7).toDateString()); // finals start, excluded
  });

  it('without a term: the next ten weeks', () => {
    const now = new Date('2026-11-25T15:00').getTime();
    const r = classRange(null, now);
    expect(r.from.toDateString()).toBe(new Date(2026, 10, 25).toDateString());
    expect(Math.round((r.until.getTime() - r.from.getTime()) / 86_400_000)).toBe(70);
  });
});

describe('expandClass', () => {
  const meetings = expandClass(lecture, classRange(fall, 0), fall.holidays);

  it('meets on its days for the whole term, at the same local time', () => {
    // Fall: Thu Sep 24 start → the first Monday is Sep 28; last Wednesday before finals is Dec 2.
    expect(new Date(meetings[0].start).toDateString()).toBe(new Date(2026, 8, 28).toDateString());
    expect(new Date(meetings[meetings.length - 1].start).toDateString()).toBe(new Date(2026, 11, 2).toDateString());
    expect(meetings.every((m) => [1, 3].includes(new Date(m.start).getDay()))).toBe(true);
    // Across the DST change (Nov 1) the clock time stays 10:00–11:50.
    expect(new Set(meetings.map((m) => `${hm(m.start)}–${hm(m.end)}`))).toEqual(new Set(['10:00–11:50']));
  });

  it('skips holidays', () => {
    const days = meetings.map((m) => new Date(m.start).toDateString());
    expect(days).not.toContain(new Date(2026, 10, 11).toDateString()); // Veterans Day (Wed)
    expect(meetings).toHaveLength(10 * 2 - 1);
  });

  it('a Thursday discussion meets in Week 0 but not on Thanksgiving', () => {
    const disc = expandClass({ days: [4], start: 14 * 60, end: 14 * 60 + 50 }, classRange(fall, 0), fall.holidays);
    const days = disc.map((m) => new Date(m.start).toDateString());
    expect(days[0]).toBe(new Date(2026, 8, 24).toDateString());
    expect(days).not.toContain(new Date(2026, 10, 26).toDateString());
  });
});

describe('helpers', () => {
  it('validates', () => {
    expect(validateClass({ categoryId: 'c', kind: 'Lecture', days: [1], start: 600, end: 650, location: '' })).toEqual({});
    expect(Object.keys(validateClass({ categoryId: '', kind: ' ', days: [], start: 600, end: 590, location: '' }))).toEqual(['categoryId', 'kind', 'days', 'time']);
  });

  it('formats', () => {
    expect(dayPattern([3, 1])).toBe('MW');
    expect(dayPattern([2, 4])).toBe('TR');
    expect(dayPattern([1, 3, 5])).toBe('MWF');
    expect(classTitle('CS 31', 'Lecture')).toBe('CS 31 Lecture');
    expect(weeklyClassMinutes(lecture)).toBe(220);
  });

  it('terms accept holiday lists', () => {
    expect(isValidTerm(fall)).toBe(true);
    expect(isValidTerm({ ...fall, holidays: ['Nov 26'] })).toBe(false);
  });
});
