import { describe, expect, it } from 'vitest';
import { atMinute } from '@/domain/schedule';
import type { TimeBlock, WorkSession } from '@/domain/types';
import { makeTask } from '@/test/factory';
import {
  accuracyRows,
  accuracyStats,
  actualTime,
  calibrationFor,
  categoryAllocation,
  completionStats,
  computeInsights,
  groupByTask,
  insightRange,
  postponedStats,
  productiveHours,
  weeklyWorkload,
} from '../insights';

const MON = new Date(2026, 10, 23); // Monday
const day = (n: number) => new Date(2026, 10, 23 + n);
const at = (d: Date, h: number, m = 0) => atMinute(d, h * 60 + m);
const NOW = at(day(2), 12); // Wed noon
const range = insightRange(NOW, 2); // Mon Nov 16 → now

let n = 0;
const session = (taskId: string, start: number, end: number): WorkSession => ({ id: `s${++n}`, taskId, start, end, source: 'timer', createdAt: end });
const block = (taskId: string | null, start: number, end: number, kind: 'task' | 'event' = 'task'): TimeBlock => ({
  id: `b${++n}`,
  kind,
  taskId,
  title: '',
  start,
  end,
  createdAt: 0,
  updatedAt: 0,
});

describe('insightRange', () => {
  it('covers whole weeks back from the current one, Monday first', () => {
    expect(range.weekStarts.map((d) => d.getDate())).toEqual([16, 23]);
    expect(range.from).toBe(new Date(2026, 10, 16).getTime());
    expect(range.to).toBe(NOW);
  });
});

describe('completion', () => {
  it('counts on-time, late and missed among tasks already due, by deadline week', () => {
    const tasks = [
      makeTask({ id: 'on', status: 'done', deadline: at(MON, 17), completedAt: at(MON, 15) }),
      makeTask({ id: 'late', status: 'done', deadline: at(day(-3), 17), completedAt: at(day(-3), 19) }),
      makeTask({ id: 'missed', status: 'todo', deadline: at(day(1), 17) }),
      makeTask({ id: 'future', status: 'todo', deadline: at(day(4), 17) }), // not due yet
      makeTask({ id: 'old', status: 'done', deadline: at(day(-30), 17), completedAt: at(MON, 10) }), // due before range, finished in it
    ];
    const c = completionStats(tasks, range);
    expect(c).toMatchObject({ due: 3, completed: 2, onTime: 1, late: 1, missed: 1, medianLateBy: 120 });
    expect(c.rate).toBeCloseTo(2 / 3);
    expect(c.onTimeRate).toBeCloseTo(1 / 3);
    expect(c.weekly.map((w) => [w.label, w.due, w.onTime, w.late, w.missed, w.finished])).toEqual([
      ['Nov 16', 1, 0, 1, 0, 1],
      ['Nov 23', 2, 1, 0, 1, 2],
    ]);
  });

  it('has no rate when nothing was due', () => {
    expect(completionStats([], range).rate).toBeNull();
  });
});

describe('estimated vs actual', () => {
  const a = makeTask({ id: 'a', status: 'done', estimate: 60, completedAt: at(MON, 18), categoryId: 'c1', difficulty: 3 });
  const b = makeTask({ id: 'b', status: 'done', estimate: 120, completedAt: at(MON, 18), categoryId: 'c2', difficulty: 1 });
  const c = makeTask({ id: 'c', status: 'done', estimate: 60, completedAt: at(MON, 18), categoryId: 'c1', difficulty: 3 });
  const open = makeTask({ id: 'open', estimate: 60 });

  it('prefers tracked time, falls back to blocks before completion, ignores open tasks', () => {
    expect(actualTime(a, [session('a', at(MON, 9), at(MON, 10, 30))], [block('a', at(MON, 9), at(MON, 12))])).toEqual({ minutes: 90, source: 'tracked' });
    expect(actualTime(b, [], [block('b', at(MON, 9), at(MON, 11)), block('b', at(day(1), 9), at(day(1), 10))])).toEqual({ minutes: 120, source: 'scheduled' });
    expect(actualTime(open, [], [block('open', at(MON, 9), at(MON, 10))])).toBeNull();
  });

  it('summarises accuracy overall, by category and by difficulty', () => {
    const sessions = [session('a', at(MON, 9), at(MON, 10, 30)), session('c', at(MON, 13), at(MON, 14, 30))];
    const blocks = [block('b', at(MON, 9), at(MON, 11))];
    const rows = accuracyRows([a, b, c, open], groupByTask(sessions), groupByTask(blocks));
    const s = accuracyStats(rows);
    expect(rows).toHaveLength(3);
    expect(s).toMatchObject({ tracked: 2, scheduled: 1, medianRatio: 1.5 });
    expect(s.ratio).toBeCloseTo(300 / 240);
    expect(s.withinBand).toBeCloseTo(1 / 3);
    expect(s.byCategory.find((g) => g.key === 'c1')).toMatchObject({ n: 2, estimate: 120, actual: 180, ratio: 1.5 });
    expect(s.byDifficulty.map((g) => g.key)).toEqual([1, 3]);
  });

  it('calibrates from the most specific history with enough samples', () => {
    const mk = (id: string, cat: string, diff: 1 | 2 | 3, est: number, act: number) => ({
      task: makeTask({ id, categoryId: cat, difficulty: diff }),
      estimate: est,
      actual: act,
      source: 'tracked' as const,
      ratio: act / est,
    });
    const rows = [mk('1', 'p', 3, 60, 90), mk('2', 'p', 3, 60, 80), mk('3', 'x', 3, 60, 120), mk('4', 'p', 1, 60, 60)];
    expect(calibrationFor(rows, 'p', 3)).toMatchObject({ basis: 'difficulty', n: 3, factor: 1.5 });
    expect(calibrationFor([...rows, mk('5', 'p', 3, 60, 75)], 'p', 3)).toMatchObject({ basis: 'category+difficulty', n: 3, factor: 80 / 60 }); // median of 1.5, 1.33, 1.25
    expect(calibrationFor(rows, 'z', 2)).toBeNull();
    // Excluding task 3 leaves only two hard tasks → falls back to the category.
    expect(calibrationFor(rows, 'p', 3, '3')).toMatchObject({ basis: 'category', n: 3, factor: 80 / 60 });
  });
});

describe('weekly workload', () => {
  it('sums tracked, scheduled and event time per week, clipped to week bounds', () => {
    const input = {
      tasks: [makeTask({ id: 't', status: 'done', estimate: 90, completedAt: at(MON, 16) })],
      blocks: [block('t', at(MON, 9), at(MON, 11)), block(null, at(MON, 14), at(MON, 15), 'event'), block('t', at(day(-3), 9), at(day(-3), 10))],
      sessions: [session('t', at(MON, 9), at(MON, 10, 15)), session('t', at(day(-1), 23), at(MON, 1))], // crosses into this week
      now: NOW,
      weeks: 2,
    };
    const [prev, cur] = weeklyWorkload(input, range);
    expect(prev).toMatchObject({ scheduled: 60, tracked: 60, events: 0, current: false, capacity: 5 * 525 });
    expect(cur).toMatchObject({ scheduled: 120, tracked: 75 + 60, events: 60, completedEstimate: 90, current: true });
  });
});

describe('productive hours', () => {
  it('splits sessions across hours and finds the peak two-hour window', () => {
    const sessions = [session('t', at(MON, 9, 30), at(MON, 11)), session('t', at(day(1), 10), at(day(1), 11)), session('t', at(day(1), 15), at(day(1), 15, 20))];
    const h = productiveHours(sessions, [makeTask({ status: 'done', completedAt: at(MON, 16, 40) })], range);
    expect(h.grid[0][9]).toBe(30);
    expect(h.grid[0][10]).toBe(60);
    expect(h.grid[1][10]).toBe(60);
    expect(h.byHour[10]).toBe(120);
    expect(h.total).toBe(170);
    expect(h.peak).toMatchObject({ startHour: 9, minutes: 150 });
    expect(h.bestWeekday).toBe(0);
    expect(h.completionsByHour[16]).toBe(1);
  });

  it('is empty without tracked time', () => {
    const h = productiveHours([], [], range);
    expect(h.peak).toBeNull();
    expect(h.bestWeekday).toBeNull();
  });
});

describe('postponed', () => {
  it('ranks tasks by how often they were pushed and how far they slipped', () => {
    const tasks = [
      makeTask({ id: 'a', postponed: 1, rescheduled: 2, firstDeadline: at(MON, 17), deadline: at(day(3), 17), createdAt: at(MON, 8), categoryId: 'p' }),
      makeTask({ id: 'b', postponed: 3, firstDeadline: at(MON, 17), deadline: at(day(7), 17), createdAt: at(MON, 8), categoryId: 'p' }),
      makeTask({ id: 'c', createdAt: at(MON, 8) }),
      makeTask({ id: 'd', rescheduled: 1, createdAt: at(MON, 8), categoryId: 'q' }),
    ];
    const p = postponedStats(tasks, range);
    expect(p.rows.map((r) => [r.task.id, r.total, r.slipDays])).toEqual([
      ['b', 3, 7],
      ['a', 3, 3],
      ['d', 1, null],
    ]);
    expect(p.rate).toBeCloseTo(3 / 4);
    expect(p.byCategory[0]).toEqual({ categoryId: 'p', tasks: 2, total: 6 });
  });
});

describe('category allocation', () => {
  const tasks = [makeTask({ id: 'p', categoryId: 'prod' }), makeTask({ id: 'h', categoryId: 'hire' })];
  it('uses tracked time when there is any', () => {
    const a = categoryAllocation(
      { tasks, blocks: [block('h', at(MON, 9), at(MON, 17))], sessions: [session('p', at(MON, 9), at(MON, 12)), session('h', at(MON, 13), at(MON, 14))], now: NOW, weeks: 2 },
      range,
    );
    expect(a.basis).toBe('tracked');
    expect(a.rows.map((r) => [r.categoryId, r.share])).toEqual([
      ['prod', 0.75],
      ['hire', 0.25],
    ]);
  });
  it('falls back to scheduled time', () => {
    const a = categoryAllocation({ tasks, blocks: [block('h', at(MON, 9), at(MON, 10))], sessions: [], now: NOW, weeks: 2 }, range);
    expect(a).toMatchObject({ basis: 'scheduled', total: 60 });
  });
});

describe('computeInsights', () => {
  it('ties everything together', () => {
    const i = computeInsights({ tasks: [], blocks: [], sessions: [session('x', at(MON, 9), at(MON, 10))], now: NOW, weeks: 4 });
    expect(i.workload).toHaveLength(4);
    expect(i.trackedTotal).toBe(60);
  });
});
