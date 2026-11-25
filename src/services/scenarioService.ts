/**
 * Scenario persistence. A scenario stores a frozen snapshot of the schedule plus an ordered list of
 * ops; the proposed schedule is always *derived* (snapshot + ops), never stored. The live schedule
 * is only written by `applyScenario`, which uses optimistic concurrency (see engine/diff planApply)
 * so changes made outside the scenario are never overwritten.
 */
import { db } from '@/db/db';
import { applyOps, planApply, type ApplyConflict, type ApplyPlan } from '@/engine';
import type { Scenario, ScenarioOp, ScheduleSnapshot, StoredOp } from '@/engine/types';
import type { ID, Task, TimeBlock } from '@/domain/types';
import { getWorkWeek } from './settingsService';

export class ScenarioError extends Error {}
export class ApplyConflictError extends Error {
  constructor(
    public conflicts: ApplyConflict[],
    public plan: ApplyPlan,
  ) {
    super(`${conflicts.length} change${conflicts.length === 1 ? '' : 's'} conflict with edits made since this scenario was created.`);
  }
}

const now = () => Date.now();
/** Structured clone so the snapshot shares no references with live objects. */
const clone = <T>(v: T): T => structuredClone(v);

async function snapshotLive(): Promise<ScheduleSnapshot> {
  const [tasks, blocks] = await Promise.all([db.tasks.toArray(), db.blocks.toArray()]);
  return { takenAt: now(), tasks: clone(tasks), blocks: clone(blocks) };
}

async function load(id: ID): Promise<Scenario> {
  const s = await db.scenarios.get(id);
  if (!s) throw new ScenarioError('Scenario not found.');
  return s;
}

function assertDraft(s: Scenario) {
  if (s.status !== 'draft') throw new ScenarioError(`This scenario was already ${s.status}.`);
}

export async function createScenario(name: string, initialOps: ScenarioOp[] = []): Promise<Scenario> {
  return db.transaction('rw', db.tasks, db.blocks, db.scenarios, async () => {
    const t = now();
    const existing = await db.scenarios.count();
    const s: Scenario = {
      id: crypto.randomUUID(),
      name: name.trim() || `Scenario ${existing + 1}`,
      status: 'draft',
      baseline: await snapshotLive(),
      ops: initialOps.map((op) => ({ id: crypto.randomUUID(), at: t, op })),
      createdAt: t,
      updatedAt: t,
      appliedAt: null,
    };
    await db.scenarios.add(s);
    return s;
  });
}

export async function addOp(id: ID, op: ScenarioOp): Promise<StoredOp> {
  return db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    assertDraft(s);
    const stored: StoredOp = { id: crypto.randomUUID(), at: now(), op: clone(op) };
    await db.scenarios.put({ ...s, ops: [...s.ops, stored], updatedAt: now() });
    return stored;
  });
}

/** Remove one op; returns it and its index so it can be re-inserted (undo). */
export async function removeOp(id: ID, opId: ID): Promise<{ op: StoredOp; index: number } | null> {
  return db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    assertDraft(s);
    const index = s.ops.findIndex((o) => o.id === opId);
    if (index === -1) return null;
    const op = s.ops[index];
    await db.scenarios.put({ ...s, ops: s.ops.filter((o) => o.id !== opId), updatedAt: now() });
    return { op, index };
  });
}

export async function insertOp(id: ID, op: StoredOp, index: number): Promise<void> {
  await db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    assertDraft(s);
    if (s.ops.some((o) => o.id === op.id)) return;
    const ops = [...s.ops];
    ops.splice(Math.min(index, ops.length), 0, op);
    await db.scenarios.put({ ...s, ops, updatedAt: now() });
  });
}

export async function renameScenario(id: ID, name: string): Promise<{ before: string }> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new ScenarioError('Name the scenario.');
  return db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    await db.scenarios.put({ ...s, name: clean.slice(0, 80), updatedAt: now() });
    return { before: s.name };
  });
}

export async function discardScenario(id: ID): Promise<void> {
  await db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    assertDraft(s);
    await db.scenarios.put({ ...s, status: 'discarded', updatedAt: now() });
  });
}

export async function restoreScenario(id: ID): Promise<void> {
  await db.transaction('rw', db.scenarios, async () => {
    const s = await load(id);
    await db.scenarios.put({ ...s, status: 'draft', appliedAt: null, updatedAt: now() });
  });
}

export async function deleteScenario(id: ID): Promise<Scenario | undefined> {
  return db.transaction('rw', db.scenarios, async () => {
    const s = await db.scenarios.get(id);
    await db.scenarios.delete(id);
    return s;
  });
}

export async function putScenario(s: Scenario): Promise<void> {
  await db.scenarios.put(s);
}

/** Replace the snapshot with the current live schedule and replay the same ops on top. */
export async function rebaseScenario(id: ID): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, db.scenarios, async () => {
    const s = await load(id);
    assertDraft(s);
    await db.scenarios.put({ ...s, baseline: await snapshotLive(), updatedAt: now() });
  });
}

export interface ApplyResult {
  plan: ApplyPlan;
  /** Live records as they were before the apply (for undo). */
  beforeBlocks: TimeBlock[];
  beforeTasks: Task[];
  addedBlockIds: ID[];
  skipped: ApplyConflict[];
}

/**
 * Write the proposal to the live schedule in one transaction. Throws ApplyConflictError when
 * anything the scenario touches changed since its snapshot, unless `skipConflicts` is set — then
 * only the non-conflicting changes are written.
 */
export async function applyScenario(id: ID, opts: { skipConflicts?: boolean } = {}): Promise<ApplyResult> {
  return db.transaction('rw', [db.tasks, db.blocks, db.scenarios, db.meta], async () => {
    const s = await load(id);
    assertDraft(s);
    const [tasks, blocks, week] = await Promise.all([db.tasks.toArray(), db.blocks.toArray(), getWorkWeek()]);
    // Same working hours the simulator previewed with, so what you saw is what gets applied.
    const proposed = applyOps(s.baseline, s.ops, week).state;
    const t = now();
    const plan = planApply(s.baseline, proposed, { tasks, blocks }, t);
    if (plan.conflicts.length && !opts.skipConflicts) throw new ApplyConflictError(plan.conflicts, plan);
    if (plan.changeCount === 0) throw new ScenarioError('Nothing to apply — this scenario makes no changes.');

    const liveBlocks = new Map(blocks.map((b) => [b.id, b]));
    const liveTasks = new Map(tasks.map((x) => [x.id, x]));
    const beforeBlocks = [...plan.putBlocks.map((b) => liveBlocks.get(b.id)), ...plan.deleteBlockIds.map((bid) => liveBlocks.get(bid))].filter(
      (b): b is TimeBlock => !!b,
    );
    const addedBlockIds = plan.putBlocks.filter((b) => !liveBlocks.has(b.id)).map((b) => b.id);
    const beforeTasks = plan.putTasks.map((x) => liveTasks.get(x.id)!).filter(Boolean);

    if (plan.deleteBlockIds.length) await db.blocks.bulkDelete(plan.deleteBlockIds);
    if (plan.putBlocks.length) await db.blocks.bulkPut(plan.putBlocks);
    if (plan.putTasks.length) await db.tasks.bulkPut(plan.putTasks);
    await db.scenarios.put({ ...s, status: 'applied', appliedAt: t, updatedAt: t });
    return { plan, beforeBlocks: clone(beforeBlocks), beforeTasks: clone(beforeTasks), addedBlockIds, skipped: plan.conflicts };
  });
}

/** Revert an apply: restore every touched live record and reopen the scenario as a draft. */
export async function revertApply(id: ID, result: ApplyResult): Promise<void> {
  await db.transaction('rw', db.tasks, db.blocks, db.scenarios, async () => {
    if (result.addedBlockIds.length) await db.blocks.bulkDelete(result.addedBlockIds);
    if (result.beforeBlocks.length) await db.blocks.bulkPut(result.beforeBlocks);
    if (result.beforeTasks.length) await db.tasks.bulkPut(result.beforeTasks);
    const s = await db.scenarios.get(id);
    if (s) await db.scenarios.put({ ...s, status: 'draft', appliedAt: null, updatedAt: now() });
  });
}
