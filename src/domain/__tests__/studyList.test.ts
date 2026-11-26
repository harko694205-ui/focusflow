import { describe, expect, it } from 'vitest';
import { courseName, parseClock12, parseDays, parseStudyList } from '../studyList';
import { STUDY_LIST_MD, STUDY_LIST_TEXT } from '@/test/studyList';

describe('Study List parsing', () => {
  for (const [label, text] of [
    ['with links', STUDY_LIST_MD],
    ['as plain text', STUDY_LIST_TEXT],
  ] as const) {
    it(`reads courses, sections and finals (${label})`, () => {
      const courses = parseStudyList(text);
      expect(courses.map((c) => c.name)).toEqual(['ECON 11', 'MGMT 1B', 'MUSCLG M82']);
      const [econ, mgmt, mus] = courses;
      expect(econ.sections).toEqual([
        { section: 'Lec 2', kind: 'Lecture', status: 'Enrolled', days: [1, 3], start: 17 * 60, end: 18 * 60 + 15, location: 'Broad Art Center 2160E' },
        { section: 'Dis 2B', kind: 'Discussion', status: 'Enrolled', days: [5], start: 11 * 60, end: 11 * 60 + 50, location: 'Bunche Hall 2160' },
      ]);
      expect(econ.final).toEqual({ start: new Date(2026, 11, 10, 11, 30).getTime(), duration: 180, location: 'Broad Art Center 2160E or Franz Hall 1178' });
      expect(mgmt.sections.map((s) => [s.section, s.days, s.start])).toEqual([
        ['Lec 1', [2, 4], 8 * 60],
        ['Dis 1D', [5], 12 * 60],
      ]);
      expect(mgmt.final?.location).toBe('Entrepreneurs Hall C314');
      expect(mus.final).toBeNull(); // "Consult instructor"
      expect(mus.title).toBe('Music and Holocaust: Individual Experience');
      expect(mus.sections[0]).toMatchObject({ days: [2, 4], start: 13 * 60, end: 14 * 60 + 50, location: 'Schoenberg Music Building 1200' });
    });
  }

  it('reads rows whose tabs were turned into spaces', () => {
    const [c] = parseStudyList('Economics\n\n11 - Microeconomic Theory\n Lec 2 Enrolled Not Applicable MW 5pm-6:15pm Broad Art Center 2160E 4.0 Smith, A.');
    expect(c.sections[0]).toMatchObject({ days: [1, 3], start: 1020, end: 1095, location: 'Broad Art Center 2160E' });
  });

  it('explains when nothing looks like a Study List', () => {
    expect(() => parseStudyList('hello')).toThrow(/Study List/);
  });

  it('helpers', () => {
    expect(parseClock12('12pm')).toBe(720);
    expect(parseClock12('12:30am')).toBe(30);
    expect(parseClock12('6:15pm')).toBe(1095);
    expect(parseDays('TR')).toEqual([2, 4]);
    expect(parseDays('TBA')).toBeNull();
    expect(courseName('Computer Science', '31')).toBe('COM SCI 31');
    expect(courseName('Underwater Basketry', '5')).toBe('Underwater Basketry 5');
  });
});
