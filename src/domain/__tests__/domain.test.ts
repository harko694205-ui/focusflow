import { describe, expect, it } from 'vitest';
import { workingMinutesBetween } from '../capacity';
import { computeRisk } from '../risk';
import { parseEstimate, validateDraft, isValid } from '../validation';
import { EMPTY_FILTER, filterTasks, groupTasks, sortTasks } from '../query';
import { combineDateTime, dueBucket, dueLabel } from '../dates';
import { summarize } from '../stats';
import { makeTask } from '@/test/factory';
import type { Category } from '../types';

// All dates are local-time constructed so tests are timezone-agnostic.
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m).getTime(); // Nov 2026; the 23rd is a Monday
const DAY = 525; // 8h45 default workday

describe('workingMinutesBetween', () => {
  it('counts a full working day', () => {
    expect(workingMinutesBetween(at(23), at(24))).toBe(DAY);
  });
  it('excludes lunch and off-hours', () => {
    expect(workingMinutesBetween(at(23, 12, 0), at(23, 14, 0))).toBe(30 + 45); // 12:00–12:30 + 13:15–14:00
  });
  it('skips weekends', () => {
    expect(workingMinutesBetween(at(27, 18), at(30, 8, 30))).toBe(0); // Fri evening → Mon morning
    expect(workingMinutesBetween(at(23), at(30))).toBe(5 * DAY);
  });
  it('returns 0 for empty or reversed ranges', () => {
    expect(workingMinutesBetween(at(24), at(23))).toBe(0);
    expect(workingMinutesBetween(at(24), at(24))).toBe(0);
  });
});

describe('computeRisk (EDF slack)', () => {
  const now = at(23, 8, 30); // Monday morning, start of day

  it('accumulates demand in deadline order', () => {
    const a = makeTask({ id: 'a', estimate: 300, deadline: at(23, 18) }); // 525 avail
    const b = makeTask({ id: 'b', estimate: 300, deadline: at(23, 18) }); // same deadline → demand 600
    const r = computeRisk([a, b], now);
    expect(r.get('a')!.slack).toBe(225);
    expect(r.get('a')!.level).toBe('on_track');
    expect(r.get('b')!.demand).toBe(600);
    expect(r.get('b')!.slack).toBe(-75);
    expect(r.get('b')!.level).toBe('late');
  });

  it('flags small slack as at risk and past deadlines as overdue', () => {
    const tight = makeTask({ id: 'tight', estimate: 480, deadline: at(23, 18) }); // slack 45
    const past = makeTask({ id: 'past', estimate: 60, deadline: at(20, 17) }); // 480 + 60 > 525
    const r = computeRisk([tight, past], now);
    expect(r.get('past')!.level).toBe('overdue');
    expect(r.get('tight')!.level).toBe('late'); // overdue work counts toward demand first
    const r2 = computeRisk([tight], now);
    expect(r2.get('tight')!.level).toBe('at_risk');
  });

  it('ignores completed tasks', () => {
    const done = makeTask({ id: 'd', status: 'done', estimate: 9999, deadline: at(23, 18) });
    const open = makeTask({ id: 'o', estimate: 60, deadline: at(23, 18) });
    const r = computeRisk([done, open], now);
    expect(r.has('d')).toBe(false);
    expect(r.get('o')!.slack).toBe(DAY - 60);
  });
});

describe('validation', () => {
  it('parses human estimates', () => {
    expect(parseEstimate('90')).toBe(90);
    expect(parseEstimate('45m')).toBe(45);
    expect(parseEstimate('1.5h')).toBe(90);
    expect(parseEstimate('1h30')).toBe(90);
    expect(parseEstimate('1h 30m')).toBe(90);
    expect(parseEstimate('2:15')).toBe(135);
    expect(parseEstimate('soon')).toBeNull();
    expect(parseEstimate('')).toBeNull();
  });

  it('requires title, category, estimate and deadline', () => {
    const e = validateDraft({ title: '  ', estimate: 2 });
    expect(Object.keys(e).sort()).toEqual(['categoryId', 'deadline', 'estimate', 'title']);
    expect(
      isValid(validateDraft({ title: 'x', categoryId: 'c', estimate: 30, deadline: 1, priority: 2, difficulty: 2, notes: '' })),
    ).toBe(true);
  });

  it('combines date and time inputs', () => {
    expect(combineDateTime('2026-11-23', '09:15')).toBe(at(23, 9, 15));
    expect(combineDateTime('nope', '09:15')).toBeNull();
  });
});

describe('query', () => {
  const now = at(23, 9);
  const cats: Category[] = [
    { id: 'c1', name: 'Work', color: 'iris', order: 0, createdAt: 0 },
    { id: 'c2', name: 'Home', color: 'teal', order: 1, createdAt: 0 },
  ];
  const tasks = [
    makeTask({ id: 'x1', title: 'Write report', categoryId: 'c1', priority: 1, difficulty: 3, estimate: 120, deadline: at(24, 17) }),
    makeTask({ id: 'x2', title: 'Groceries', categoryId: 'c2', priority: 3, difficulty: 1, estimate: 30, deadline: at(23, 18) }),
    makeTask({ id: 'x3', title: 'Review report draft', categoryId: 'c1', priority: 0, difficulty: 2, estimate: 45, deadline: at(20, 17) }),
    makeTask({ id: 'x4', title: 'Old thing', categoryId: 'c2', status: 'done', deadline: at(10) }),
  ];

  it('filters by status, facets and search', () => {
    expect(filterTasks(tasks, EMPTY_FILTER, now).map((t) => t.id)).toEqual(['x1', 'x2', 'x3']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, status: 'done' }, now).map((t) => t.id)).toEqual(['x4']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, categories: ['c1'] }, now).map((t) => t.id)).toEqual(['x1', 'x3']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, priorities: [0, 3] }, now).map((t) => t.id)).toEqual(['x2', 'x3']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, difficulties: [3] }, now).map((t) => t.id)).toEqual(['x1']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, due: ['overdue'] }, now).map((t) => t.id)).toEqual(['x3']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, search: 'report' }, now).map((t) => t.id)).toEqual(['x1', 'x3']);
    expect(filterTasks(tasks, { ...EMPTY_FILTER, search: 'draft report' }, now).map((t) => t.id)).toEqual(['x3']);
  });

  it('sorts in both directions with stable tiebreakers', () => {
    const open = tasks.slice(0, 3);
    expect(sortTasks(open, { key: 'deadline', dir: 'asc' }).map((t) => t.id)).toEqual(['x3', 'x2', 'x1']);
    expect(sortTasks(open, { key: 'deadline', dir: 'desc' }).map((t) => t.id)).toEqual(['x1', 'x2', 'x3']);
    expect(sortTasks(open, { key: 'priority', dir: 'asc' }).map((t) => t.id)).toEqual(['x3', 'x1', 'x2']);
    expect(sortTasks(open, { key: 'estimate', dir: 'desc' }).map((t) => t.id)).toEqual(['x1', 'x3', 'x2']);
    expect(sortTasks(open, { key: 'title', dir: 'asc' }).map((t) => t.id)).toEqual(['x2', 'x3', 'x1']);
    const risk = computeRisk(open, now);
    expect(sortTasks(open, { key: 'risk', dir: 'asc' }, risk)[0].id).toBe('x3'); // overdue first
  });

  it('groups in a fixed, meaningful order', () => {
    const open = sortTasks(tasks.slice(0, 3), { key: 'deadline', dir: 'asc' });
    expect(groupTasks(open, 'due', cats, now).map((g) => g.key)).toEqual(['overdue', 'today', 'tomorrow']);
    expect(groupTasks(open, 'category', cats, now).map((g) => [g.key, g.tasks.length])).toEqual([
      ['c1', 2],
      ['c2', 1],
    ]);
    expect(groupTasks(open, 'none', cats, now)).toHaveLength(1);
  });

  it('labels deadlines relative to now', () => {
    expect(dueBucket(at(23, 18), now)).toBe('today');
    expect(dueLabel(at(24, 17), now)).toBe('Tomorrow');
    expect(dueLabel(at(24, 17), now, { withTime: true })).toBe('Tomorrow 17:00');
  });
});

describe('summarize', () => {
  it('aggregates open work, risk and completions', () => {
    const now = at(25, 9); // Wednesday
    const tasks = [
      makeTask({ id: 's1', estimate: 60, deadline: at(26, 17) }),
      makeTask({ id: 's2', estimate: 120, deadline: at(24, 17) }), // overdue
      makeTask({ id: 's3', status: 'done', estimate: 30, completedAt: at(24, 10) }), // this week
      makeTask({ id: 's4', status: 'done', estimate: 30, completedAt: at(20, 10) }), // last week
    ];
    const s = summarize(tasks, computeRisk(tasks, now), now);
    expect(s.openCount).toBe(2);
    expect(s.openMinutes).toBe(180);
    expect(s.overdueCount).toBe(1);
    expect(s.dueSoonCount).toBe(2);
    expect(s.completedThisWeek).toBe(1);
    expect(s.completedThisWeekMinutes).toBe(30);
  });
});
