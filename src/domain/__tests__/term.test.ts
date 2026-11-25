import { describe, expect, it } from 'vitest';
import { finalsCountdown, finalsStart, isValidTerm, suggestTerm, termEnd, termWeek, weekOneStart, type Term } from '../term';

const at = (s: string) => new Date(`${s}T12:00:00`).getTime();
const fall: Term = { name: 'Fall 2026', start: '2026-09-24', weeks: 10, finals: true }; // a Thursday
const winter: Term = { name: 'Winter 2027', start: '2027-01-04', weeks: 10, finals: true }; // a Monday

describe('term weeks', () => {
  it('a Thursday start begins with a partial Week 0 (UCLA fall)', () => {
    expect(weekOneStart(fall).getDate()).toBe(28); // Mon Sep 28
    expect(termWeek(fall, at('2026-09-24')).label).toBe('Week 0');
    expect(termWeek(fall, at('2026-09-27')).label).toBe('Week 0'); // Sunday
    expect(termWeek(fall, at('2026-09-28')).label).toBe('Week 1');
    expect(termWeek(fall, at('2026-11-25')).label).toBe('Week 9');
    expect(termWeek(fall, at('2026-12-06')).label).toBe('Week 10');
  });

  it('finals week follows week 10, then break', () => {
    expect(finalsStart(fall).toDateString()).toBe(new Date(2026, 11, 7).toDateString());
    expect(termWeek(fall, at('2026-12-07'))).toMatchObject({ phase: 'finals', label: 'Finals week', short: 'Finals' });
    expect(termWeek(fall, at('2026-12-13')).phase).toBe('finals');
    expect(termWeek(fall, at('2026-12-14'))).toMatchObject({ phase: 'after', label: 'Break' });
    expect(termEnd(fall).toDateString()).toBe(new Date(2026, 11, 14).toDateString());
  });

  it('a Monday start is Week 1 straight away (winter, spring)', () => {
    expect(termWeek(winter, at('2027-01-04'))).toMatchObject({ phase: 'instruction', week: 1, short: 'Wk 1' });
    expect(termWeek(winter, at('2027-03-14')).label).toBe('Week 10');
    expect(termWeek(winter, at('2027-03-15')).label).toBe('Finals week');
  });

  it('counts down before the term starts', () => {
    expect(termWeek(fall, at('2026-09-23')).label).toBe('Starts tomorrow');
    expect(termWeek(fall, at('2026-09-19'))).toMatchObject({ phase: 'before', label: 'Starts in 5 days' });
  });

  it('without a finals week the term ends after instruction', () => {
    const summer: Term = { name: 'Summer A', start: '2026-06-22', weeks: 6, finals: false };
    expect(termWeek(summer, at('2026-08-02')).label).toBe('Week 6');
    expect(termWeek(summer, at('2026-08-03')).label).toBe('Break');
    expect(finalsCountdown(summer, at('2026-07-01'))).toBeNull();
  });

  it('finals countdown', () => {
    expect(finalsCountdown(fall, at('2026-11-25'))).toBe('Finals start Mon Dec 7 · in 2 weeks');
    expect(finalsCountdown(fall, at('2026-12-04'))).toBe('Finals start Mon Dec 7 · in 3 days');
    expect(finalsCountdown(fall, at('2026-12-07'))).toBeNull();
  });
});

describe('term validation and suggestions', () => {
  it('validates stored terms', () => {
    expect(isValidTerm(fall)).toBe(true);
    expect(isValidTerm({ ...fall, start: '2026-13-40' })).toBe(false);
    expect(isValidTerm({ ...fall, weeks: 0 })).toBe(false);
    expect(isValidTerm(null)).toBe(false);
  });

  it('suggests the quarter for the date', () => {
    expect(suggestTerm(at('2026-11-25'))).toMatchObject({ name: 'Fall 2026', start: '2026-09-24', weeks: 10 });
    expect(suggestTerm(at('2027-02-10'))).toMatchObject({ name: 'Winter 2027', start: '2027-01-04' });
    expect(new Date(suggestTerm(at('2027-02-10')).start + 'T12:00').getDay()).toBe(1);
  });
});
