import { describe, expect, it } from 'vitest';
import { atMinute, layoutBlocks, minuteOfDay } from '@/domain/schedule';
import type { Task, TimeBlock } from '@/domain/types';
import { makeTask } from '@/test/factory';
import { analyze, applyOps, autoplan, diffSchedules, driftCount, MAX_CHUNK, planApply, riskChanges, type ScenarioOp, type ScheduleSnapshot, type StoredOp } from '..';

const MON = new Date(2026, 10, 23); // Monday
const day = (n: number) => new Date(2026, 10, 23 + n);
const at = (d: Date, h: number, m = 0) => atMinute(d, h * 60 + m);
const NOW = at(MON, 8, 0); // before the workday starts

let bn = 0;
const block = (start: number, end: number, over: Partial<TimeBlock> = {}): TimeBlock => ({
  id: `b${++bn}`,
  kind: 'task',
  taskId: 'a',
  title: '',
  start,
  end,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
let on = 0;
const op = (o: ScenarioOp): StoredOp => ({ id: `op${++on}`, at: 0, op: o });

function deepFreeze<T>(o: T): T {
  Object.freeze(o);
  for (const v of Object.values(o as object)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
}

function snapshot(tasks: Task[], blocks: TimeBlock[]): ScheduleSnapshot {
  return deepFreeze({ takenAt: NOW, tasks, blocks });
}

const taskA = makeTask({ id: 'a', seq: 1, estimate: 120, deadline: at(day(1), 17), updatedAt: 1 });
const taskB = makeTask({ id: 'b', seq: 2, estimate: 240, deadline: at(day(4), 17), updatedAt: 1, difficulty: 3 });

/* -------------------------------------------------------------------------- */

describe('applyOps', () => {
  it('never mutates the baseline (deep-frozen input)', () => {
    const b1 = block(at(MON, 9), at(MON, 10));
    const base = snapshot([taskA, taskB], [b1]);
    const before = JSON.stringify(base);
    const { state } = applyOps(base, [
      op({ type: 'move', blockId: b1.id, start: at(MON, 13, 15), end: at(MON, 14, 15) }),
      op({ type: 'estimate', taskId: 'a', estimate: 180 }),
      op({ type: 'deadline', taskId: 'b', deadline: at(day(2), 12) }),
      op({ type: 'priority', taskId: 'b', priority: 0 }),
      op({ type: 'add', block: block(at(day(1), 9), at(day(1), 10), { id: 'new' }) }),
      op({ type: 'clearDay', day: MON.getTime() }),
      op({ type: 'autoplan', from: MON.getTime(), days: 5, strategy: 'deadline', now: NOW }),
    ]);
    expect(JSON.stringify(base)).toBe(before);
    expect(state.tasks.find((t) => t.id === 'a')!.estimate).toBe(180);
    expect(state.tasks.find((t) => t.id === 'b')!.priority).toBe(0);
  });

  it('applies move / add / remove and reports labels', () => {
    const b1 = block(at(MON, 9), at(MON, 10));
    const base = snapshot([taskA], [b1]);
    const { state, results } = applyOps(base, [
      op({ type: 'move', blockId: b1.id, start: at(MON, 14), end: at(MON, 16) }),
      op({ type: 'add', block: block(at(day(1), 9), at(day(1), 10), { id: 'x' }) }),
      op({ type: 'remove', blockId: 'x' }),
    ]);
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]).toMatchObject({ start: at(MON, 14), end: at(MON, 16) });
    expect(results.map((r) => r.skipped)).toEqual([undefined, undefined, undefined]);
    expect(results[0].label).toMatch(/Moved FF-1/);
  });

  it('skips ops that no longer make sense instead of half-applying', () => {
    const base = snapshot([taskA, { ...taskB, status: 'done' }], []);
    const { state, results } = applyOps(base, [
      op({ type: 'move', blockId: 'ghost', start: at(MON, 9), end: at(MON, 10) }),
      op({ type: 'add', block: block(at(MON, 9), at(MON, 9, 5), { id: 'short' }) }),
      op({ type: 'add', block: block(at(MON, 9), at(MON, 10), { id: 'done', taskId: 'b' }) }),
      op({ type: 'estimate', taskId: 'a', estimate: 0 }),
    ]);
    expect(results.every((r) => r.skipped)).toBe(true);
    expect(state.blocks).toHaveLength(0);
    expect(state.tasks.find((t) => t.id === 'a')!.estimate).toBe(120);
  });

  it('clearDay removes only task blocks on that day', () => {
    const base = snapshot(
      [taskA],
      [block(at(MON, 9), at(MON, 10)), block(at(MON, 11), at(MON, 11, 30), { kind: 'event', taskId: null, title: 'Standup' }), block(at(day(1), 9), at(day(1), 10))],
    );
    const { state } = applyOps(base, [op({ type: 'clearDay', day: MON.getTime() })]);
    expect(state.blocks.map((b) => [b.kind, minuteOfDay(b.start)])).toEqual([
      ['event', 660],
      ['task', 540],
    ]);
  });

  it('a day off has no capacity: auto-plan skips it and analysis counts its work as overload', () => {
    const base = snapshot([taskA], [block(at(MON, 9), at(MON, 10))]);
    const { state } = applyOps(base, [
      op({ type: 'clearDay', day: MON.getTime() }),
      op({ type: 'autoplan', from: MON.getTime(), days: 5, strategy: 'deadline', now: NOW }),
    ]);
    expect(state.offDays).toEqual(['2026-11-23']);
    expect(state.blocks.every((b) => b.start >= day(1).getTime())).toBe(true); // nothing re-planned onto Monday
    const a = analyze(state, { from: MON.getTime(), days: 5 }, NOW);
    expect(a.days[0]).toMatchObject({ off: true, capacity: 0, free: 0 });
    const withEvent = analyze(
      { ...state, blocks: [...state.blocks, block(at(MON, 14), at(MON, 15), { kind: 'event', taskId: null, title: 'Call' })] },
      { from: MON.getTime(), days: 5 },
      NOW,
    );
    expect(withEvent.days[0].overload).toBe(60);
  });

  it('is deterministic: same ops → identical result', () => {
    const base = snapshot([taskA, taskB], [block(at(MON, 9), at(MON, 10), { kind: 'event', taskId: null, title: 'Sync' })]);
    const ops = [op({ type: 'autoplan', from: MON.getTime(), days: 5, strategy: 'deadline', now: NOW })];
    expect(JSON.stringify(applyOps(base, ops).state)).toBe(JSON.stringify(applyOps(base, ops).state));
  });
});

describe('autoplan', () => {
  it('fills free working time, skipping busy time, in deadline order, without overlaps', () => {
    const meeting = block(at(MON, 9), at(MON, 10), { kind: 'event', taskId: null, title: 'Sync' });
    const placed = autoplan({ tasks: [taskB, taskA], blocks: [meeting] }, { from: MON.getTime(), days: 5, strategy: 'deadline', now: NOW, idPrefix: 'p' });
    // A (due Tue) goes first: 08:30–09:00 is only 30m, then 10:00–11:30 (90m) → 120m total.
    const a = placed.filter((b) => b.taskId === 'a');
    expect(a.map((b) => [minuteOfDay(b.start), minuteOfDay(b.end)])).toEqual([
      [510, 540],
      [600, 690],
    ]);
    const total = (id: string) => placed.filter((b) => b.taskId === id).reduce((s, b) => s + (b.end - b.start) / 60_000, 0);
    expect(total('a')).toBe(120);
    expect(total('b')).toBe(240);
    // No overlaps with each other or the meeting.
    const lay = layoutBlocks([meeting, ...placed]);
    expect([...lay.values()].every((l) => l.overlaps.length === 0)).toBe(true);
    // Everything inside working hours (Mon 08:30–12:30, 13:15–18:00).
    for (const b of placed) {
      const s = minuteOfDay(b.start);
      const e = minuteOfDay(b.end);
      expect((s >= 510 && e <= 750) || (s >= 795 && e <= 1080)).toBe(true);
      expect(e - s).toBeLessThanOrEqual(MAX_CHUNK);
    }
  });

  it('only counts unscheduled minutes and never plans in the past or for done tasks', () => {
    const now = at(MON, 14);
    const tasks = [taskA, { ...taskB, status: 'done' as const }];
    const existing = block(at(MON, 9), at(MON, 10), { taskId: 'a' });
    const placed = autoplan({ tasks, blocks: [existing] }, { from: MON.getTime(), days: 5, strategy: 'deadline', now, idPrefix: 'p' });
    expect(placed.every((b) => b.taskId === 'a' && b.start >= now)).toBe(true);
    expect(placed.reduce((s, b) => s + (b.end - b.start) / 60_000, 0)).toBe(60);
  });

  it('priority strategy schedules urgent work first', () => {
    const low = makeTask({ id: 'low', seq: 3, priority: 3, estimate: 525, deadline: at(MON, 18) });
    const urgent = makeTask({ id: 'urgent', seq: 4, priority: 0, estimate: 60, deadline: at(day(3), 18) });
    const placed = autoplan({ tasks: [low, urgent], blocks: [] }, { from: MON.getTime(), days: 1, strategy: 'priority', now: NOW, idPrefix: 'p' });
    expect(placed[0].taskId).toBe('urgent');
    expect(minuteOfDay(placed[0].start)).toBe(510);
  });
});

describe('analyze', () => {
  it('flags overload, conflicts and plan status', () => {
    const tasks = [taskA, taskB];
    const blocks = [
      block(at(MON, 8, 30), at(MON, 12, 30), { taskId: 'b' }),
      block(at(MON, 12), at(MON, 13), { taskId: 'a' }), // overlaps the first
      block(at(MON, 13, 15), at(MON, 19, 0), { taskId: 'b' }), // runs past 18:00
      block(at(day(2), 9), at(day(2), 10), { taskId: 'a' }), // after A's deadline → late
    ];
    const a = analyze({ tasks, blocks }, { from: MON.getTime(), days: 5 }, NOW);
    const mon = a.days[0];
    expect(mon.conflicts).toBe(2);
    expect(mon.overload).toBeGreaterThan(0);
    expect(a.totals.overloadedDays).toBe(1);
    expect(a.tasks.get('a')!.status).toBe('late');
    expect(a.tasks.get('b')!.status).toBe('on_track'); // 10h scheduled ≥ 4h estimate, finishes Monday
    expect(a.totals.lateTasks).toBe(1);
  });

  it('reports unscheduled work as "short"', () => {
    const a = analyze({ tasks: [taskA], blocks: [block(at(MON, 9), at(MON, 10))] }, { from: MON.getTime(), days: 5 }, NOW);
    expect(a.tasks.get('a')).toMatchObject({ status: 'short', scheduled: 60, unscheduled: 60 });
    expect(a.totals.unscheduledMinutes).toBe(60);
  });
});

describe('diff, impact and apply planning', () => {
  const b1 = block(at(MON, 9), at(MON, 10));
  const b2 = block(at(MON, 13, 15), at(MON, 14, 15));
  const base = snapshot([taskA, taskB], [b1, b2]);

  it('classifies block and task changes', () => {
    const { state } = applyOps(base, [
      op({ type: 'move', blockId: b1.id, start: at(MON, 10), end: at(MON, 11) }),
      op({ type: 'move', blockId: b2.id, start: b2.start, end: at(MON, 15) }),
      op({ type: 'add', block: block(at(day(1), 9), at(day(1), 10), { id: 'n1' }) }),
      op({ type: 'estimate', taskId: 'b', estimate: 300 }),
    ]);
    const d = diffSchedules(base, state);
    expect(d.blocks.get(b1.id)).toBe('moved');
    expect(d.blocks.get(b2.id)).toBe('resized');
    expect(d.blocks.get('n1')).toBe('added');
    expect(d.tasks.get('b')).toEqual(['estimate']);
    expect(d.originals.get(b1.id)!.start).toBe(b1.start);
  });

  it('reports which deadlines get better or worse', () => {
    const { state } = applyOps(base, [op({ type: 'move', blockId: b1.id, start: at(day(2), 9), end: at(day(2), 10) })]);
    const range = { from: MON.getTime(), days: 5 };
    const changes = riskChanges(analyze(base, range, NOW), analyze(state, range, NOW));
    expect(changes[0]).toMatchObject({ taskId: 'a', verdict: 'worse', after: 'late' });
  });

  it('writes only what the scenario changed when the live schedule is untouched', () => {
    const { state } = applyOps(base, [op({ type: 'move', blockId: b1.id, start: at(MON, 10), end: at(MON, 11) }), op({ type: 'estimate', taskId: 'a', estimate: 90 })]);
    const plan = planApply(base, state, base, 99);
    expect(plan.conflicts).toEqual([]);
    expect(plan.putBlocks.map((b) => [b.id, b.start, b.updatedAt])).toEqual([[b1.id, at(MON, 10), 99]]);
    expect(plan.putTasks.map((t) => [t.id, t.estimate])).toEqual([['a', 90]]);
    expect(plan.deleteBlockIds).toEqual([]);
  });

  it('never overwrites records edited after the snapshot', () => {
    const { state } = applyOps(base, [
      op({ type: 'move', blockId: b1.id, start: at(MON, 10), end: at(MON, 11) }),
      op({ type: 'remove', blockId: b2.id }),
      op({ type: 'estimate', taskId: 'a', estimate: 90 }),
    ]);
    const live = {
      tasks: [{ ...taskA, title: 'Renamed', updatedAt: 5 }, taskB],
      blocks: [{ ...b1, start: at(MON, 15), end: at(MON, 16), updatedAt: 5 }, b2],
    };
    const plan = planApply(base, state, live, 99);
    expect(plan.conflicts.map((c) => c.id).sort()).toEqual([b1.id, 'a'].sort());
    expect(plan.deleteBlockIds).toEqual([b2.id]); // untouched since → safe
    expect(plan.putBlocks).toEqual([]);
    expect(plan.putTasks).toEqual([]);
  });

  it('treats tasks deleted or completed since as conflicts for new blocks', () => {
    const { state } = applyOps(base, [op({ type: 'add', block: block(at(day(1), 9), at(day(1), 10), { id: 'n', taskId: 'b' }) })]);
    expect(planApply(base, state, { tasks: [taskA], blocks: [b1, b2] }, 1).conflicts).toHaveLength(1);
    expect(planApply(base, state, { tasks: [taskA, { ...taskB, status: 'done' }], blocks: [b1, b2] }, 1).conflicts).toHaveLength(1);
  });

  it('measures drift between snapshot and live', () => {
    expect(driftCount(base, base)).toBe(0);
    expect(driftCount(base, { tasks: [taskA], blocks: [b1, b2, block(at(MON, 16), at(MON, 17))] })).toBe(2); // B gone + one new block
  });
});
