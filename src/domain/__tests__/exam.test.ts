import { describe, expect, it } from 'vitest';
import { differenceInCalendarDays } from 'date-fns';
import { DEFAULT_WORK_WEEK } from '../constants';
import { STUDENT_PRESET } from '../workweek';
import { assignTopics, examProgress, parseTopics, pickDays, planExamPrep, sessionTitle, studyDays, validateExam } from '../exam';
import type { ExamTopic, Task } from '../types';

const H = 60;
const at = (s: string) => new Date(s).getTime();
const NOW = at('2026-11-25T14:00'); // Wed, week 9
const week = STUDENT_PRESET.week; // Sat off
const topics: ExamTopic[] = [
  { id: 'a', name: 'Recursion', confidence: 1 },
  { id: 'b', name: 'Pointers', confidence: 2 },
  { id: 'c', name: 'Loops', confidence: 3 },
];
const final = { start: at('2026-12-07T08:00'), duration: 180, prepTarget: 12 * H, topics };

describe('planExamPrep', () => {
  const plan = planExamPrep({ exam: final, now: NOW, doneMinutes: 0, week });
  const days = plan.sessions.map((s) => new Date(s.day));

  it('spreads sessions over the days before, never on exam day or days without study hours', () => {
    expect(plan.status).toBe('ok');
    expect(plan.sessions.length).toBeGreaterThanOrEqual(6);
    for (const d of days) {
      expect(d.getTime()).toBeLessThan(at('2026-12-07T00:00'));
      expect(d.getDay()).not.toBe(6); // Saturday is off in the student preset
    }
    expect(new Set(plan.sessions.map((s) => s.day)).size).toBe(plan.sessions.length); // one per day
  });

  it('ends with a light review the day before, after a practice exam', () => {
    const last = plan.sessions[plan.sessions.length - 1];
    expect(last.kind).toBe('review');
    expect(differenceInCalendarDays(final.start, last.day)).toBe(1);
    expect(last.minutes).toBeLessThanOrEqual(60);
    expect(plan.sessions[plan.sessions.length - 2].kind).toBe('practice');
    expect(plan.sessions[plan.sessions.length - 2].minutes).toBe(180);
  });

  it('adds up to the prep target, with no session over 3h', () => {
    expect(plan.total).toBeGreaterThanOrEqual(12 * H * 0.95);
    expect(plan.total).toBeLessThanOrEqual(12 * H * 1.15);
    expect(Math.max(...plan.sessions.map((s) => s.minutes))).toBeLessThanOrEqual(180);
  });

  it('study sessions get longer toward the exam', () => {
    const study = plan.sessions.filter((s) => s.kind === 'study');
    expect(study[study.length - 1].minutes).toBeGreaterThanOrEqual(study[0].minutes);
  });

  it('weak topics come up more often than solid ones', () => {
    const count = (n: string) => plan.sessions.filter((s) => s.kind === 'study' && s.topics.includes(n)).length;
    expect(count('Recursion')).toBeGreaterThan(count('Loops'));
    expect(count('Loops')).toBeGreaterThanOrEqual(1);
    expect(plan.sessions[plan.sessions.length - 1].topics[0]).toBe('Recursion'); // review the weakest
  });

  it('only plans what is left', () => {
    const rest = planExamPrep({ exam: final, now: NOW, doneMinutes: 9 * H, week });
    expect(rest.remaining).toBe(3 * H);
    expect(rest.total).toBeLessThan(plan.total);
    expect(planExamPrep({ exam: final, now: NOW, doneMinutes: 12 * H, week }).status).toBe('done');
  });

  it('a quiz soon gets a short plan with no practice exam', () => {
    const quiz = { start: at('2026-11-30T10:00'), duration: 50, prepTarget: 2 * H, topics: [] };
    const p = planExamPrep({ exam: quiz, now: NOW, doneMinutes: 0, week });
    expect(p.sessions.every((s) => s.kind !== 'practice')).toBe(true);
    expect(p.sessions.length).toBeGreaterThanOrEqual(2);
    expect(p.total).toBeGreaterThanOrEqual(2 * H - 15);
  });

  it('says so when it cannot fit, or when no time is left', () => {
    const huge = { ...final, start: at('2026-11-28T09:00'), prepTarget: 40 * H };
    const tight = planExamPrep({ exam: huge, now: NOW, doneMinutes: 0, week });
    expect(tight.status).toBe('tight');
    expect(tight.note).toMatch(/fits before the exam/);

    const tomorrow = { ...final, start: at('2026-11-26T08:00') };
    const late = planExamPrep({ exam: tomorrow, now: at('2026-11-25T23:00'), doneMinutes: 0, week });
    expect(late.status).toBe('no-time');
    expect(planExamPrep({ exam: final, now: at('2026-12-08T09:00'), doneMinutes: 0, week }).status).toBe('no-time');
  });
});

describe('helpers', () => {
  it('studyDays skips days off and today when it is nearly over', () => {
    const d = studyDays({ start: at('2026-11-30T10:00') }, at('2026-11-25T21:30'), 2 * H, week);
    expect(d.map((x) => x.getDate())).toEqual([26, 27, 29]); // not 25 (late), not 28 (Saturday)
    const work = studyDays({ start: at('2026-11-30T10:00') }, NOW, 2 * H, DEFAULT_WORK_WEEK);
    expect(work.map((x) => x.getDate())).toEqual([25, 26, 27]); // weekends off in the work week
  });

  it('pickDays always keeps the last day and leans toward the exam', () => {
    const days = Array.from({ length: 10 }, (_, i) => new Date(2026, 10, 20 + i));
    const picked = pickDays(days, 4).map((d) => d.getDate());
    expect(picked).toHaveLength(4);
    expect(picked[3]).toBe(29);
    const gaps = picked.slice(1).map((d, i) => d - picked[i]);
    expect(gaps[gaps.length - 1]).toBeLessThanOrEqual(gaps[0]);
  });

  it('assignTopics: max 3 per session, no repeats within a session', () => {
    const many: ExamTopic[] = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: `T${i}`, confidence: 1 }));
    const out = assignTopics(many, 4);
    expect(out.every((s) => s.length <= 3 && new Set(s).size === s.length)).toBe(true);
    expect(new Set(out.flat()).size).toBe(7); // every topic gets covered
  });

  it('parses pasted topic lists', () => {
    expect(parseTopics('1. Recursion\n- Pointers\n\n• Linked lists\nRecursion')).toEqual(['Recursion', 'Pointers', 'Linked lists']);
    expect(parseTopics('Sets, Functions; Proofs')).toEqual(['Sets', 'Functions', 'Proofs']);
  });

  it('titles and validation', () => {
    expect(sessionTitle('Midterm 1', { kind: 'study', topics: ['Recursion', 'Pointers'] })).toBe('Midterm 1: study Recursion, Pointers');
    expect(sessionTitle('Final', { kind: 'practice', topics: [] })).toBe('Final: practice exam');
    const ok = { title: 'Midterm', categoryId: 'c', start: NOW, duration: 50, location: '', prepTarget: 300, topics: [], notes: '' };
    expect(validateExam(ok)).toEqual({});
    expect(Object.keys(validateExam({ ...ok, title: ' ', duration: 5, prepTarget: 0 }))).toEqual(['title', 'duration', 'prepTarget']);
  });
});

describe('examProgress', () => {
  const task = (over: Partial<Task>): Task => ({
    id: Math.random().toString(36),
    seq: 1,
    title: 'x',
    notes: '',
    categoryId: 'c',
    status: 'todo',
    priority: 1,
    difficulty: 2,
    estimate: 90,
    deadline: NOW,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    ...over,
  });

  it('counts finished sessions and tracked time; flags missed ones', () => {
    const done = task({ status: 'done', estimate: 90, deadline: at('2026-11-24T23:59') });
    const missed = task({ deadline: at('2026-11-24T23:59') });
    const partial = task({ deadline: at('2026-11-27T23:59') });
    const next = task({ deadline: at('2026-11-26T23:59') });
    const p = examProgress(final, [done, missed, partial, next], new Map([[partial.id, 30]]), NOW);
    expect(p.done).toBe(120);
    expect(p.planned).toBe(360);
    expect(p.missed).toEqual([missed]);
    expect(p.next?.id).toBe(next.id);
    expect(p.status).toBe('behind');
    expect(p.ratio).toBeCloseTo(120 / 720);
  });

  it('statuses: no plan, on track, ready, past', () => {
    expect(examProgress(final, [], new Map(), NOW).status).toBe('no-plan');
    expect(examProgress(final, [task({ deadline: at('2026-12-01T23:59') })], new Map(), NOW).status).toBe('on-track');
    expect(examProgress({ ...final, prepTarget: 90 }, [task({ status: 'done' })], new Map(), NOW).status).toBe('ready');
    expect(examProgress(final, [], new Map(), at('2026-12-07T09:00')).status).toBe('past');
  });
});
