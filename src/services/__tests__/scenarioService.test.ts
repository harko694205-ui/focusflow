import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { atMinute } from '@/domain/schedule';
import { applyOps } from '@/engine';
import * as svc from '../scenarioService';
import * as sched from '../scheduleService';
import * as tasks from '../taskService';

const MON = new Date(2030, 0, 7); // a future Monday so nothing is "past"
const at = (h: number, m = 0) => atMinute(MON, h * 60 + m);

async function seed() {
  const a = await tasks.createTask({ title: 'Report', notes: '', categoryId: 'c', priority: 1, difficulty: 2, estimate: 120, deadline: at(17) });
  const b = await tasks.createTask({ title: 'Deck', notes: '', categoryId: 'c', priority: 2, difficulty: 3, estimate: 180, deadline: at(17) + 3 * 86_400_000 });
  const ba = await sched.scheduleTask(a.id, at(9), at(10));
  const bb = await sched.scheduleTask(b.id, at(13, 15), at(15, 15));
  return { a, b, ba, bb };
}

beforeEach(async () => {
  db.close();
  await db.delete();
  db.seedOnCreate = false;
  await db.open();
  await db.categories.add({ id: 'c', name: 'Work', color: 'iris', order: 0, createdAt: 0 });
});

describe('scenario lifecycle', () => {
  it('snapshots the schedule; later live edits never leak into the baseline', async () => {
    const { a, ba } = await seed();
    const s = await svc.createScenario('What if');
    expect(s.baseline.tasks).toHaveLength(2);
    expect(s.baseline.blocks).toHaveLength(2);
    await sched.updateBlock(ba.id, { start: at(11), end: at(12) });
    await tasks.updateTask(a.id, { title: 'Changed live' });
    const stored = (await db.scenarios.get(s.id))!;
    expect(stored.baseline.blocks.find((b) => b.id === ba.id)!.start).toBe(at(9));
    expect(stored.baseline.tasks.find((t) => t.id === a.id)!.title).toBe('Report');
  });

  it('scenario edits never touch the live schedule', async () => {
    const { ba } = await seed();
    const liveBefore = await db.blocks.toArray();
    const s = await svc.createScenario('Edits');
    await svc.addOp(s.id, { type: 'move', blockId: ba.id, start: at(14), end: at(15) });
    await svc.addOp(s.id, { type: 'remove', blockId: ba.id });
    await svc.addOp(s.id, { type: 'autoplan', from: MON.getTime(), days: 5, strategy: 'deadline', now: at(8) });
    expect(await db.blocks.toArray()).toEqual(liveBefore);
  });

  it('removes and re-inserts ops (undo)', async () => {
    const { ba } = await seed();
    const s = await svc.createScenario('Undo');
    const o1 = await svc.addOp(s.id, { type: 'move', blockId: ba.id, start: at(14), end: at(15) });
    const o2 = await svc.addOp(s.id, { type: 'estimate', taskId: ba.taskId!, estimate: 60 });
    const removed = await svc.removeOp(s.id, o1.id);
    expect((await db.scenarios.get(s.id))!.ops.map((o) => o.id)).toEqual([o2.id]);
    await svc.insertOp(s.id, removed!.op, removed!.index);
    expect((await db.scenarios.get(s.id))!.ops.map((o) => o.id)).toEqual([o1.id, o2.id]);
  });

  it('discard and restore keep the live schedule unchanged', async () => {
    await seed();
    const before = await db.blocks.toArray();
    const s = await svc.createScenario('Throwaway', [{ type: 'clearDay', day: MON.getTime() }]);
    await svc.discardScenario(s.id);
    expect((await db.scenarios.get(s.id))!.status).toBe('discarded');
    await expect(svc.addOp(s.id, { type: 'clearDay', day: MON.getTime() })).rejects.toThrow(/discarded/);
    await svc.restoreScenario(s.id);
    expect((await db.scenarios.get(s.id))!.status).toBe('draft');
    expect(await db.blocks.toArray()).toEqual(before);
  });
});

describe('apply', () => {
  it('writes the proposal and marks the scenario applied; revert restores exactly', async () => {
    const { a, ba, bb } = await seed();
    const before = { blocks: await db.blocks.toArray(), tasks: await db.tasks.toArray() };
    const s = await svc.createScenario('Plan');
    await svc.addOp(s.id, { type: 'move', blockId: ba.id, start: at(10), end: at(11) });
    await svc.addOp(s.id, { type: 'remove', blockId: bb.id });
    await svc.addOp(s.id, { type: 'estimate', taskId: a.id, estimate: 60 });
    await svc.addOp(s.id, { type: 'add', block: { id: 'new-1', kind: 'event', taskId: null, title: 'Focus', start: at(16), end: at(17), createdAt: 0, updatedAt: 0 } });

    const res = await svc.applyScenario(s.id);
    expect(res.plan.changeCount).toBe(4);
    expect((await db.blocks.get(ba.id))!.start).toBe(at(10));
    expect(await db.blocks.get(bb.id)).toBeUndefined();
    expect(await db.blocks.get('new-1')).toBeDefined();
    expect((await db.tasks.get(a.id))!.estimate).toBe(60);
    expect((await db.scenarios.get(s.id))!.status).toBe('applied');
    await expect(svc.applyScenario(s.id)).rejects.toThrow(/applied/);

    await svc.revertApply(s.id, res);
    const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((x, y) => x.id.localeCompare(y.id));
    expect(sortById(await db.blocks.toArray())).toEqual(sortById(before.blocks));
    expect(sortById(await db.tasks.toArray())).toEqual(sortById(before.tasks));
    expect((await db.scenarios.get(s.id))!.status).toBe('draft');
  });

  it('refuses to overwrite edits made after the snapshot, writing nothing', async () => {
    const { ba, bb } = await seed();
    const s = await svc.createScenario('Stale');
    await svc.addOp(s.id, { type: 'move', blockId: ba.id, start: at(10), end: at(11) });
    await svc.addOp(s.id, { type: 'move', blockId: bb.id, start: at(15, 30), end: at(17, 30) });
    await sched.updateBlock(ba.id, { start: at(11), end: at(12) }); // user edits live afterwards
    const liveBefore = await db.blocks.toArray();

    await expect(svc.applyScenario(s.id)).rejects.toBeInstanceOf(svc.ApplyConflictError);
    expect(await db.blocks.toArray()).toEqual(liveBefore);
    expect((await db.scenarios.get(s.id))!.status).toBe('draft');

    const res = await svc.applyScenario(s.id, { skipConflicts: true });
    expect(res.skipped).toHaveLength(1);
    expect((await db.blocks.get(ba.id))!.start).toBe(at(11)); // user's edit preserved
    expect((await db.blocks.get(bb.id))!.start).toBe(at(15, 30)); // safe change applied
  });

  it('rebase re-snapshots and replays the same ops', async () => {
    const { ba } = await seed();
    const s = await svc.createScenario('Rebase');
    await svc.addOp(s.id, { type: 'estimate', taskId: ba.taskId!, estimate: 60 });
    await sched.createEvent('New meeting', at(16), at(17));
    await svc.rebaseScenario(s.id);
    const r = (await db.scenarios.get(s.id))!;
    expect(r.baseline.blocks).toHaveLength(3);
    expect(r.ops).toHaveLength(1);
    const proposed = applyOps(r.baseline, r.ops).state;
    expect(proposed.tasks.find((t) => t.id === ba.taskId)!.estimate).toBe(60);
  });
});
