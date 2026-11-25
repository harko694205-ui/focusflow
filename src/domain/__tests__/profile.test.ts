import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, readProfile, termsFor, validateProfile } from '../profile';

const term = { name: ' Fall 2026 ', start: '2026-09-24', weeks: 10, finals: true };

describe('profile', () => {
  it('defaults and repairs stored values', () => {
    expect(readProfile(undefined)).toEqual(DEFAULT_PROFILE);
    expect(readProfile({ mode: 'student' })).toEqual({ mode: 'student', term: null, dueTime: '23:59' });
    expect(readProfile({ mode: 'student', dueTime: '25:00', term: { start: 'nope' } })).toEqual({ mode: 'student', term: null, dueTime: '23:59' });
    expect(readProfile({ mode: 'x', dueTime: '09:30', term }).term?.name).toBe('Fall 2026');
    expect(readProfile({ mode: 'x' }).mode).toBe('work');
  });

  it('validates edits with readable messages', () => {
    expect(() => validateProfile({ mode: 'student', term: null, dueTime: '9pm' })).toThrow(/hh:mm/);
    expect(() => validateProfile({ mode: 'student', term: { ...term, weeks: 0 }, dueTime: '23:59' })).toThrow(/term/);
    expect(validateProfile({ mode: 'student', term, dueTime: '23:59' }).term?.weeks).toBe(10);
  });

  it('words the category concept per mode', () => {
    expect(termsFor('student')).toEqual({ one: 'Course', many: 'Courses', lower: 'course', lowerMany: 'courses' });
    expect(termsFor('work').many).toBe('Categories');
  });
});
