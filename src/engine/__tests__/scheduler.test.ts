import { describe, expect, it } from 'vitest';
import type { WorkWeek } from '@/domain/constants';
import { cyclicTasks, validateDependencies, wouldCreateCycle } from '@/domain/dependencies';
import { atMinute, dayKey, layoutBlocks, minuteOfDay } from '@/domain/schedule';
import type { Task, TimeBlock } from '@/domain/types';
import { makeTask } from '@/test/factory';
import { DEEP_WORK_DAILY_CAP, planSchedule, SESSION_RULES, workTimeBefore, type PlanOptions } from '../scheduler';
import type { ScheduleState } from '../types';

const MON = new Date(2026, 10, 23); // Monday
const day = (n: number) => new Date(2026, 10, 23 + n);
const at = (d: Date, h: number, m = 0) => atMinute(d, h * 60 + m);
const NOW = at(MON, 8);
const opts = (over: Partial<PlanOptions> = {}): PlanOptions => ({ from: MON.getTime(), days: 5, now: NOW, idPrefix: 'p', ...over });

let bn = 0;
const block = (start: number, end: number, over: Partial<TimeBlock> = {}): TimeBlock => ({
  id: `b${++bn}`,
  kind: 'task',
  taskId: null,
  title: '',
  start,
  end,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const event = (start: number, end: number) => block(start, end, { kind: 'event', title: 'Meeting' });
const span = (b: TimeBlock) => [dayKey(b.start), minuteOfDay(b.start), minuteOfDay(b.end)] as const;
const mins = (bs: TimeBlock[]) => bs.reduce((a, b) => a + (b.end - b.start) / 60_000, 0);
const plan = (state: ScheduleState, o?: Partial<PlanOptions>) => planSchedule(state, opts(o));
const task = (over: Partial<Task>) => makeTask({ deadline: at(day(4), 17), ...over });

/** No two blocks overlap and nothing lands outside working hours (default week). */
function expectClean(blocks: TimeBlock[]) {
  const lay = layoutBlocks(blocks);
  expect([...lay.values()].every((l) => l.overlaps.length === 0)).toBe(true);
}

/* -------------------------------------------------------------------------- */

describe('the brief example', () => {
  // Free time before the Friday deadline: Mon 2h, Tue 1h, Wed 4h, Thu 2h.
  const week: WorkWeek = {
    0: [],
    1: [{ start: 540, end: 660 }],
    2: [{ start: 540, end: 600 }],
    3: [{ start: 540, end: 780 }],
    4: [{ start: 540, end: 660 }],
    5: [{ start: 540, end: 1020 }],
    6: [],
  };
  const deadline = at(day(4), 9); // Friday 09:00

  it('splits a 3h assignment across Monday and Wednesday instead of leaving it to Thursday', () => {
    const a = task({ id: 'a', estimate: 180, difficulty: 3, deadline });
    const p = plan({ tasks: [a], blocks: [] }, { week });
    expect(p.blocks.map(span)).toEqual([
      [dayKey(MON), 540, 660], // Mon 2h
      [dayKey(day(2)), 540, 600], // Wed 1h — Tuesday's single free hour is too short for hard work
    ]);
    expect(p.recommendations.get('a')).toMatchObject({ status: 'on_time', placedMinutes: 180, unplacedMinutes: 0, relaxed: false });
  });

  it('uses Tuesday for medium work, which needs a shorter window', () => {
    const a = task({ id: 'a', estimate: 180, difficulty: 2, deadline });
    expect(plan({ tasks: [a], blocks: [] }, { week }).blocks.map(span)).toEqual([
      [dayKey(MON), 540, 660],
      [dayKey(day(1)), 540, 600],
    ]);
  });
});

describe('available time and existing commitments', () => {
  it('never overlaps events or existing blocks, and leaves existing blocks alone', () => {
    const x = task({ id: 'x', estimate: 120 });
    const y = task({ id: 'y', estimate: 180, deadline: at(day(1), 17) });
    const meeting = event(at(MON, 9), at(MON, 10));
    const booked = block(at(MON, 10), at(MON, 11), { taskId: 'x' });
    const p = plan({ tasks: [x, y], blocks: [meeting, booked] });
    expectClean([meeting, booked, ...p.blocks]);
    expect(p.blocks.some((b) => b.id === booked.id)).toBe(false);
    // X already has 1h blocked → only 1h more is placed.
    expect(mins(p.recommendations.get('x')!.sessions)).toBe(60);
    for (const b of p.blocks) {
      const s = minuteOfDay(b.start);
      const e = minuteOfDay(b.end);
      expect((s >= 510 && e <= 750) || (s >= 795 && e <= 1080)).toBe(true);
    }
  });

  it('reports fully-booked tasks as scheduled without adding anything', () => {
    const x = task({ id: 'x', estimate: 60 });
    const p = plan({ tasks: [x], blocks: [block(at(day(1), 9), at(day(1), 10), { taskId: 'x' })] });
    expect(p.blocks).toEqual([]);
    expect(p.recommendations.get('x')!.status).toBe('scheduled');
  });

  it('never plans in the past, on days off, or for done tasks', () => {
    const now = at(MON, 14, 7);
    const a = task({ id: 'a', estimate: 600 });
    const done = task({ id: 'done', status: 'done', estimate: 60 });
    const p = plan({ tasks: [a, done], blocks: [], offDays: [dayKey(day(1))] }, { now });
    expect(p.blocks.every((b) => b.start >= at(MON, 14, 15))).toBe(true);
    expect(p.blocks.some((b) => dayKey(b.start) === dayKey(day(1)))).toBe(false);
    expect(p.recommendations.has('done')).toBe(false);
  });

  it('front-loads: work goes on the first suitable day, not the last', () => {
    const a = task({ id: 'a', estimate: 60, difficulty: 2 });
    expect(dayKey(plan({ tasks: [a], blocks: [] }).blocks[0].start)).toBe(dayKey(MON));
  });
});

describe('deadline and priority', () => {
  const early = task({ id: 'early', seq: 1, priority: 3, estimate: 300, deadline: at(day(1), 17) });
  const urgent = task({ id: 'urgent', seq: 2, priority: 0, estimate: 300, deadline: at(day(4), 17) });

  it('deadline strategy: the earlier deadline wins contested time', () => {
    const p = plan({ tasks: [urgent, early], blocks: [] }, { days: 1 });
    expect(p.order).toEqual(['early', 'urgent']);
    expect(minuteOfDay(p.recommendations.get('early')!.sessions[0].start)).toBe(510);
  });

  it('priority strategy: urgent work goes first', () => {
    const p = plan({ tasks: [early, urgent], blocks: [] }, { days: 1, strategy: 'priority' });
    expect(p.order).toEqual(['urgent', 'early']);
  });

  it('priority breaks ties between tasks due the same day', () => {
    const a = task({ id: 'a', seq: 1, priority: 2, deadline: at(day(2), 12) });
    const b = task({ id: 'b', seq: 2, priority: 0, deadline: at(day(2), 17) });
    expect(plan({ tasks: [a, b], blocks: [] }).order).toEqual(['b', 'a']);
  });

  it('relaxes session rules rather than miss a deadline', () => {
    const a = task({ id: 'a', estimate: 240, difficulty: 3, deadline: at(MON, 18) });
    const r = plan({ tasks: [a], blocks: [] }).recommendations.get('a')!;
    expect(r).toMatchObject({ status: 'on_time', relaxed: true, placedMinutes: 240 });
    expect(r.finish).toBeLessThanOrEqual(a.deadline);
  });

  it('places what does not fit after the deadline (late), and reports what exceeds the horizon', () => {
    const a = task({ id: 'a', estimate: 600, deadline: at(MON, 18) });
    const late = plan({ tasks: [a], blocks: [] }, { days: 3 }).recommendations.get('a')!;
    expect(late.status).toBe('late');
    expect(late.placedMinutes).toBe(600);
    expect(mins(late.sessions.filter((s) => s.end <= a.deadline))).toBe(525); // all of Monday
    const partial = plan({ tasks: [a], blocks: [] }, { days: 1 }).recommendations.get('a')!;
    expect(partial).toMatchObject({ status: 'partial', unplacedMinutes: 75 });
  });

  it('plans overdue work as soon as possible', () => {
    const a = task({ id: 'a', estimate: 60, deadline: at(day(-1), 17) });
    const r = plan({ tasks: [a], blocks: [] }).recommendations.get('a')!;
    expect(r.status).toBe('overdue');
    expect(dayKey(r.sessions[0].start)).toBe(dayKey(MON));
  });
});

describe('difficulty', () => {
  it('spreads hard work across days (daily cap) in long sessions', () => {
    const a = task({ id: 'a', estimate: 360, difficulty: 3 });
    const s = plan({ tasks: [a], blocks: [] }).blocks;
    const perDay = new Map<string, number>();
    for (const b of s) perDay.set(dayKey(b.start), (perDay.get(dayKey(b.start)) ?? 0) + mins([b]));
    expect([...perDay.values()]).toEqual([180, 180]);
    expect(s.every((b) => mins([b]) <= SESSION_RULES[3].maxSession)).toBe(true);
  });

  it('caps deep work per day across all hard tasks', () => {
    const tasks = [task({ id: 'h1', seq: 1, estimate: 360, difficulty: 3 }), task({ id: 'h2', seq: 2, estimate: 360, difficulty: 3 })];
    const p = plan({ tasks, blocks: [] });
    const perDay = new Map<string, number>();
    for (const b of p.blocks) perDay.set(dayKey(b.start), (perDay.get(dayKey(b.start)) ?? 0) + mins([b]));
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(DEEP_WORK_DAILY_CAP);
    expect(p.recommendations.get('h1')!.status).toBe('on_time');
    expect(p.recommendations.get('h2')!.status).toBe('on_time');
  });

  it('keeps mornings for focus: easy work prefers the afternoon', () => {
    const a = task({ id: 'a', estimate: 60, difficulty: 1 });
    const [b] = plan({ tasks: [a], blocks: [] }).blocks;
    expect([dayKey(b.start), minuteOfDay(b.start)]).toEqual([dayKey(MON), 795]);
  });
});

describe('dependencies', () => {
  it('starts a task only after its dependency finishes, pulling the dependency forward', () => {
    const a = task({ id: 'a', seq: 1, estimate: 120 }); // due Fri
    const b = task({ id: 'b', seq: 2, estimate: 120, deadline: at(day(1), 12), dependsOn: ['a'] }); // due Tue noon
    const p = plan({ tasks: [b, a], blocks: [] });
    const ra = p.recommendations.get('a')!;
    const rb = p.recommendations.get('b')!;
    expect(p.order).toEqual(['a', 'b']);
    expect(ra.effectiveDeadline).toBe(at(day(1), 10)); // 2h of work time before Tue 12:00
    expect(rb.sessions[0].start).toBeGreaterThanOrEqual(ra.finish!);
    expect(rb.waitsFor).toEqual(['a']);
    expect(rb.status).toBe('on_time');
  });

  it('a dependency due later still goes first when its dependent is urgent', () => {
    const a = task({ id: 'a', seq: 1, priority: 3, estimate: 240, deadline: at(day(4), 17) });
    const other = task({ id: 'other', seq: 2, priority: 0, estimate: 240, deadline: at(day(2), 17) });
    const b = task({ id: 'b', seq: 3, priority: 1, estimate: 120, deadline: at(day(1), 17), dependsOn: ['a'] });
    const p = plan({ tasks: [other, b, a], blocks: [] });
    expect(p.order.indexOf('a')).toBeLessThan(p.order.indexOf('other'));
    expect(p.recommendations.get('b')!.status).toBe('on_time');
  });

  it('respects existing blocks of a dependency', () => {
    const a = task({ id: 'a', seq: 1, estimate: 60 });
    const b = task({ id: 'b', seq: 2, estimate: 60, dependsOn: ['a'] });
    const done = block(at(day(1), 13, 15), at(day(1), 14, 15), { taskId: 'a' });
    const p = plan({ tasks: [a, b], blocks: [done] });
    expect(p.recommendations.get('b')!.sessions[0].start).toBeGreaterThanOrEqual(done.end);
  });

  it('reports dependents of work that cannot be planned as blocked', () => {
    const a = task({ id: 'a', seq: 1, estimate: 600, difficulty: 3 });
    const b = task({ id: 'b', seq: 2, estimate: 60, dependsOn: ['a'] });
    const c = task({ id: 'c', seq: 3, estimate: 60, dependsOn: ['b'] });
    const p = plan({ tasks: [a, b, c], blocks: [] }, { days: 1 });
    expect(p.recommendations.get('a')!.status).toBe('partial');
    expect(p.recommendations.get('b')).toMatchObject({ status: 'blocked', blockedBy: ['a'], sessions: [] });
    expect(p.recommendations.get('c')).toMatchObject({ status: 'blocked', blockedBy: ['b'] });
  });

  it('ignores done and missing dependencies', () => {
    const a = task({ id: 'a', status: 'done' });
    const b = task({ id: 'b', estimate: 60, dependsOn: ['a', 'ghost'] });
    const r = plan({ tasks: [a, b], blocks: [] }).recommendations.get('b')!;
    expect(r.waitsFor).toEqual([]);
    expect(r.status).toBe('on_time');
  });

  it('survives a dependency loop from imported data and reports it', () => {
    const a = task({ id: 'a', seq: 1, dependsOn: ['b'] });
    const b = task({ id: 'b', seq: 2, dependsOn: ['a'] });
    const p = plan({ tasks: [a, b], blocks: [] });
    expect(p.cycles.sort()).toEqual(['a', 'b']);
    expect(p.recommendations.get('a')!.status).toBe('on_time');
    expect(p.recommendations.get('b')!.status).toBe('on_time');
  });
});

describe('determinism', () => {
  it('same input → same plan, regardless of input order', () => {
    const tasks = [
      task({ id: 'a', seq: 1, estimate: 200, difficulty: 3 }),
      task({ id: 'b', seq: 2, estimate: 90, difficulty: 1, deadline: at(day(2), 12) }),
      task({ id: 'c', seq: 3, estimate: 150, dependsOn: ['a'] }),
    ];
    const blocks = [event(at(MON, 11), at(MON, 11, 30))];
    const one = plan({ tasks, blocks });
    const two = plan({ tasks: [...tasks].reverse(), blocks });
    expect(JSON.stringify(two.blocks)).toBe(JSON.stringify(one.blocks));
    expectClean([...blocks, ...one.blocks]);
  });
});

describe('workTimeBefore', () => {
  const week = { 0: [], 1: [{ start: 510, end: 750 }, { start: 795, end: 1080 }], 2: [{ start: 510, end: 750 }, { start: 795, end: 1080 }], 3: [], 4: [], 5: [], 6: [] } as WorkWeek;
  it('walks back through working hours only', () => {
    expect(workTimeBefore(at(day(1), 12), 120, week, new Set())).toBe(at(day(1), 10));
    expect(workTimeBefore(at(day(1), 9), 120, week, new Set())).toBe(at(MON, 16, 30));
    expect(workTimeBefore(at(day(1), 9), 120, week, new Set([dayKey(MON)]))).toBeLessThan(at(MON, 0));
  });
});

describe('dependency graph helpers', () => {
  const a = { id: 'a', dependsOn: ['b'] };
  const b = { id: 'b', dependsOn: ['c'] };
  const c = { id: 'c' };
  const byId = new Map([a, b, c].map((t) => [t.id, t]));

  it('detects loops before they are created', () => {
    expect(wouldCreateCycle('c', 'a', byId)).toBe(true);
    expect(wouldCreateCycle('a', 'c', byId)).toBe(false);
    expect(wouldCreateCycle('a', 'a', byId)).toBe(true);
    expect(validateDependencies('c', ['a'], byId)).toMatch(/loop/);
    expect(validateDependencies('c', ['zzz'], byId)).toMatch(/no longer exists/);
    expect(validateDependencies(null, ['a', 'b'], byId)).toBeNull();
  });

  it('finds existing cycles', () => {
    expect([...cyclicTasks([a, b, { id: 'c', dependsOn: ['a'] }])].sort()).toEqual(['a', 'b', 'c']);
    expect(cyclicTasks([a, b, c]).size).toBe(0);
  });
});
