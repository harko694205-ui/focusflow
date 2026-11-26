import { describe, expect, it } from 'vitest';
import { canvasItems, canvasNotes, courseCode, guessWork, matchCourse, normalizeFeedUrl, parseIcs, parseIcsDate, splitSummary, suggestCourseName } from '../canvas';
import { FEED } from '@/test/canvasFeed';


describe('iCalendar parsing', () => {
  const events = parseIcs(FEED);

  it('reads events, unfolding lines and unescaping text, ignoring alarms', () => {
    expect(events.map((e) => e.uid)).toEqual(['event-assignment-501', 'event-assignment-502', 'event-assignment-503', 'event-calendar-event-77']);
    expect(events[0].description).toBe('Problems 1, 2 and 4.\nSubmit on Gradescope; show your work.');
    expect(events[0].url).toBe('https://bruinlearn.ucla.edu/courses/1/assignments/501');
  });

  it('handles UTC, all-day and zoned times', () => {
    expect(events[0].start).toBe(Date.UTC(2026, 9, 17, 6, 59));
    expect(events[1]).toMatchObject({ allDay: true, start: new Date(2026, 9, 20).getTime() });
    // 5 pm in Los Angeles (PDT, UTC−7) on Oct 23.
    expect(events[2].start).toBe(Date.UTC(2026, 9, 24, 0, 0));
    // Winter (PST, UTC−8), and across the November DST change.
    expect(parseIcsDate('20261110T090000', { TZID: 'America/Los_Angeles' })!.t).toBe(Date.UTC(2026, 10, 10, 17, 0));
    expect(parseIcsDate('20261101T013000', { TZID: 'Not/AZone' })!.t).toBe(new Date(2026, 10, 1, 1, 30).getTime());
  });

  it('rejects files that aren’t calendars', () => {
    expect(() => parseIcs('{"format":"focusflow-backup"}')).toThrow(/calendar/);
  });
});

describe('Canvas items', () => {
  const items = canvasItems(parseIcs(FEED), '23:59');
  const by = (uid: string) => items.find((i) => i.uid === uid)!;

  it('splits the course out of the title and classifies items', () => {
    expect(by('event-assignment-501')).toMatchObject({ title: 'Homework 3', course: 'COM SCI 31 - Lec 1 - Fall 2026', kind: 'assignment', exam: false, estimate: 120 });
    expect(by('event-assignment-503')).toMatchObject({ title: 'Midterm 1', exam: true });
    expect(by('event-calendar-event-77').kind).toBe('event');
    expect(splitSummary('Lab [draft] 2')).toEqual({ title: 'Lab [draft] 2', course: null });
  });

  it('all-day assignments are due at the default due time', () => {
    expect(by('event-assignment-502').due).toBe(new Date(2026, 9, 20, 23, 59).getTime());
  });

  it('guesses the work from the title', () => {
    expect(guessWork('Final Project Proposal')).toMatchObject({ estimate: 240, exam: false });
    expect(guessWork('Final Exam')).toMatchObject({ exam: true });
    expect(guessWork('Quiz 4').estimate).toBe(30);
    expect(guessWork('Week 3 Discussion Post').estimate).toBe(30);
    expect(guessWork('Problem Set 5').estimate).toBe(120);
  });

  it('notes link back to BruinLearn', () => {
    expect(canvasNotes(by('event-assignment-501'))).toMatch(/^From BruinLearn: https:\/\/bruinlearn\.ucla\.edu\/courses\/1\/assignments\/501\n\nProblems 1/);
  });
});

describe('courses', () => {
  it('reads UCLA course codes in their different spellings', () => {
    expect(courseCode('COM SCI 31 - Lec 1 - Fall 2026')).toMatchObject({ dept: 'CS', num: '31', label: 'COM SCI 31' });
    expect(courseCode('26F-COMSCI31-1')).toMatchObject({ dept: 'CS', num: '31' });
    expect(courseCode('CS 31')).toMatchObject({ dept: 'CS', num: '31' });
    expect(courseCode('MATH 33A Linear Algebra')).toMatchObject({ dept: 'MATH', num: '33A' });
    expect(courseCode('Psychology')).toBeNull();
  });

  it('matches Canvas courses to existing ones', () => {
    const cats = [
      { id: 'cs', name: 'CS 31' },
      { id: 'math', name: 'MATH 33A' },
      { id: 'writing', name: 'Eng Comp 3' },
    ];
    expect(matchCourse('COM SCI 31 - Lec 1 - Fall 2026', cats)).toBe('cs');
    expect(matchCourse('MATH 33A Linear Algebra - Fall 2026', cats)).toBe('math');
    expect(matchCourse('26F-ENGCOMP3-4', cats)).toBe('writing');
    expect(matchCourse('PHYSICS 1A', cats)).toBeNull();
    expect(suggestCourseName('PHYSICS 1A - Lec 2 - Fall 2026')).toBe('PHYSICS 1A');
  });

  it('accepts only Canvas calendar feed links', () => {
    expect(normalizeFeedUrl('webcal://bruinlearn.ucla.edu/feeds/calendars/user_abc123.ics')).toBe('https://bruinlearn.ucla.edu/feeds/calendars/user_abc123.ics');
    expect(normalizeFeedUrl('https://ucla.instructure.com/feeds/calendars/user_abc.ics')).not.toBeNull();
    expect(normalizeFeedUrl('https://evil.example/feeds/calendars/user_abc.ics')).toBeNull();
    expect(normalizeFeedUrl('https://bruinlearn.ucla.edu.evil.example/feeds/calendars/user_abc.ics')).toBeNull();
    expect(normalizeFeedUrl('https://bruinlearn.ucla.edu/courses/1')).toBeNull();
    expect(normalizeFeedUrl('http://bruinlearn.ucla.edu/feeds/calendars/user_abc.ics')).toBeNull();
  });
});
