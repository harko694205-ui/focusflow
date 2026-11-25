import { run } from '@/app/commands';
import { db } from '@/db/db';
import type { ScenarioOp } from '@/engine/types';
import type { ID } from '@/domain/types';
import * as svc from '@/services/scenarioService';

/** Scenario commands. Every edit is undoable with Ctrl+Z (global undo stack). */
export const scenarioActions = {
  create: (name: string, ops: ScenarioOp[] = []) =>
    run(
      () => svc.createScenario(name, ops),
      (s) => ({
        message: `Scenario “${s.name}” created from your current schedule`,
        undo: { label: 'create scenario', run: async () => void (await svc.deleteScenario(s.id)) },
      }),
    ),

  /** Edits are silent — the change is visible immediately — but undoable. */
  edit: (id: ID, op: ScenarioOp) =>
    run(
      () => svc.addOp(id, op),
      (stored) => ({ message: '', undo: { label: 'scenario change', run: async () => void (await svc.removeOp(id, stored.id)) } }),
    ),

  removeOp: (id: ID, opId: ID) =>
    run(
      () => svc.removeOp(id, opId),
      (r) => (r ? { message: 'Change removed from scenario', undo: { label: 'remove change', run: () => svc.insertOp(id, r.op, r.index) } } : null),
    ),

  rename: (id: ID, name: string) =>
    run(
      () => svc.renameScenario(id, name),
      ({ before }) => ({ message: '', undo: { label: 'rename', run: async () => void (await svc.renameScenario(id, before)) } }),
    ),

  discard: (id: ID, name: string) =>
    run(
      () => svc.discardScenario(id),
      () => ({ message: `Discarded “${name}” — your schedule is unchanged`, undo: { label: 'discard', run: () => svc.restoreScenario(id) } }),
    ),

  restore: (id: ID) => run(() => svc.restoreScenario(id), () => ({ message: 'Scenario reopened as a draft' })),

  remove: (id: ID) =>
    run(
      () => svc.deleteScenario(id),
      (s) => (s ? { message: `Deleted “${s.name}”`, undo: { label: 'delete scenario', run: () => svc.putScenario(s) } } : null),
    ),

  rebase: (id: ID) =>
    run(
      async () => {
        const before = await db.scenarios.get(id);
        await svc.rebaseScenario(id);
        return before;
      },
      (before) => ({
        message: 'Scenario rebased onto your current schedule',
        undo: before ? { label: 'rebase', run: () => svc.putScenario(before) } : undefined,
      }),
    ),

  /** Apply; conflicts are surfaced to the caller (not toasted) so the UI can explain them. */
  apply: async (id: ID, name: string, opts: { skipConflicts?: boolean } = {}) => {
    try {
      const result = await svc.applyScenario(id, opts);
      await run(
        async () => result,
        (r) => ({
          message:
            `Applied “${name}” · ${r.plan.changeCount} change${r.plan.changeCount === 1 ? '' : 's'} written to your schedule` +
            (r.skipped.length ? ` (${r.skipped.length} skipped)` : ''),
          undo: { label: 'apply scenario', run: () => svc.revertApply(id, r) },
        }),
      );
      return { ok: true as const, result };
    } catch (err) {
      if (err instanceof svc.ApplyConflictError) return { ok: false as const, conflict: err };
      await run(
        () => Promise.reject(err),
        () => null,
      );
      return { ok: false as const };
    }
  },
};
