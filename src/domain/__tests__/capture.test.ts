import { describe, expect, it } from 'vitest';
import { courseAliases, learnEstimate, parseCapture } from '../capture';
import { makeTask } from '@/test/factory';

const categories = [
  { id: 'econ', name: 'ECON 11' },
  { id: 'mgmt', name: 'MGMT 1B' },
  { id: 'mus', name: 'MUSCLG M82' },
  { id: 'cs', name: 'CS 31' },
  { id: 'me', name: 'Personal' },
];
// Wednesday Nov 25 2026, 3 pm.
const NOW = new Date(2026, 10, 25, 15, 0).getTime();
const ctx = { categories, now: NOW, dueTime: '23:59' };
const parse = (s: string, now = NOW) => parseCapture(s, { ...ctx, now });
const at = (m: number, d: number, h = 23, min = 59) => new Date(2026, m, d, h, min).getTime();

describe('quick capture', () => {
  it('course, day and estimate from one line', () => {
    expect(parse('econ ps4 fri 2h')).toMatchObject({ title: 'PS4', categoryId: 'econ', courseWord: 'econ', deadline: at(10, 27), dueWords: 'fri', estimate: 120, priority: null });
  });

  it('connector words go with what they belong to', () => {
    expect(parse('read ch 4 for mgmt tmr')).toMatchObject({ title: 'Read ch 4', categoryId: 'mgmt', deadline: at(10, 26) });
    expect(parse('cs 31 hw5 due dec 3 5pm !')).toMatchObject({ title: 'HW5', categoryId: 'cs', courseWord: 'cs 31', deadline: at(11, 3, 17, 0), dueWords: 'due dec 3 5pm', priority: 1 });
  });

  it('leaves what it doesn’t recognise in the title', () => {
    expect(parse('email TA about regrade')).toMatchObject({ title: 'Email TA about regrade', categoryId: null, deadline: null, estimate: null });
  });

  it('recognises courses by subject, code, start of the subject, or #tag', () => {
    expect(parse('musc listening journal next mon')).toMatchObject({ title: 'Listening journal', categoryId: 'mus', deadline: at(11, 7) });
    expect(parse('#personal laundry')).toMatchObject({ categoryId: 'me', title: 'Laundry' });
    expect(parse('econ11 midterm review')).toMatchObject({ categoryId: 'econ' });
    expect(courseAliases(categories).get('comsci')).toBeUndefined(); // "CS 31" doesn't spell it that way
  });

  it('dates and times', () => {
    expect(parse('call mom 6pm').deadline).toBe(at(10, 25, 18, 0));
    expect(parse('call mom 9am').deadline).toBe(at(10, 26, 9, 0)); // passed today → tomorrow
    expect(parse('essay 12/3').deadline).toBe(at(11, 3));
    expect(parse('essay in 2 weeks').deadline).toBe(at(11, 9));
    expect(parse('quiz wed').deadline).toBe(at(10, 25)); // today, still before 11:59 pm
    expect(parse('quiz wed', at(10, 25, 23, 59) + 60_000).deadline).toBe(at(11, 2)); // after the due time → next week
    expect(parse('lab 3 dec 1st 2 h')).toMatchObject({ title: 'Lab 3', deadline: at(11, 1), estimate: 120 });
    expect(parse('apply for jobs jan 10').deadline).toBe(new Date(2027, 0, 10, 23, 59).getTime());
  });

  it('priority markers', () => {
    expect(parse('pay rent !!').priority).toBe(0);
    expect(parse('pay rent urgent').priority).toBe(0);
  });
});

describe('learned estimates', () => {
  const done = (id: string, title: string, categoryId: string, estimate: number) => makeTask({ id, title, categoryId, estimate, status: 'done' });
  const tasks = [
    done('a', 'Problem Set 1', 'econ', 60),
    done('b', 'PS2', 'econ', 60),
    done('c', 'HW 1', 'cs', 90),
    done('d', 'Reading 1', 'mgmt', 30),
  ];
  // Problem sets actually took 2h30 and 3h.
  const actual = new Map([
    ['a', 150],
    ['b', 180],
  ]);

  it('uses how long the same kind of work took in that course', () => {
    expect(learnEstimate('PS4', 'econ', tasks, actual)).toEqual({ estimate: 165, basis: 'course', samples: 2, label: 'problem sets' });
  });

  it('falls back to the same kind of work anywhere, then a typical guess', () => {
    expect(learnEstimate('HW 3', 'mgmt', tasks, actual)).toMatchObject({ basis: 'kind', samples: 3, estimate: 150 });
    expect(learnEstimate('Reading 2', 'econ', tasks, actual)).toMatchObject({ basis: 'guess', estimate: 60 });
  });
});
