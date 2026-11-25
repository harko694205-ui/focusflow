/**
 * Task commands as the UI sees them: call the service, report the outcome,
 * and register an undo. Components call these; they never touch Dexie directly.
 */
import { run } from '@/app/commands';
import { taskRef } from '@/domain/constants';
import type { ID, Priority, Task, TaskDraft } from '@/domain/types';
import * as svc from '@/services/taskService';
import { deleteSessions } from '@/services/timeService';

export { undoLast } from '@/app/commands';

const restore = (tasks: Task[]) => () => svc.restoreTasks(tasks);
const quote = (t: Task) => (t.title.length > 48 ? `${t.title.slice(0, 46)}…` : t.title);

export const taskActions = {
  create: (draft: TaskDraft) =>
    run(
      () => svc.createTask(draft),
      (t) => ({
        message: `Created ${taskRef(t.seq)} · ${quote(t)}`,
        undo: { label: `create ${taskRef(t.seq)}`, run: async () => void (await svc.deleteTasks([t.id])) },
      }),
    ),

  update: (id: ID, patch: Partial<TaskDraft>) =>
    run(
      () => svc.updateTask(id, patch),
      ({ before, after }) => ({ message: `Saved ${taskRef(after.seq)}`, undo: { label: `edit ${taskRef(after.seq)}`, run: restore([before]) } }),
    ),

  toggleComplete: (id: ID) =>
    run(
      () => svc.toggleComplete(id),
      ({ before, after }) => ({
        message: after.status === 'done' ? `Completed ${taskRef(after.seq)} · ${quote(after)}` : `Reopened ${taskRef(after.seq)}`,
        undo: { label: after.status === 'done' ? 'complete' : 'reopen', run: restore([before]) },
      }),
    ),

  setPriority: (id: ID, priority: Priority) =>
    run(
      () => svc.updateTask(id, { priority }),
      ({ before, after }) =>
        before.priority === after.priority
          ? null
          : { message: `${taskRef(after.seq)} priority updated`, undo: { label: 'priority change', run: restore([before]) } },
    ),

  duplicate: (id: ID) =>
    run(
      () => svc.duplicateTask(id),
      (t) => ({
        message: `Duplicated as ${taskRef(t.seq)}`,
        undo: { label: 'duplicate', run: async () => void (await svc.deleteTasks([t.id])) },
      }),
    ),

  /** Deleting a task also removes its scheduled blocks; undo restores both. */
  remove: (ids: ID[]) =>
    run(
      () => svc.deleteTasks(ids),
      ({ tasks, blocks, sessions }) =>
        tasks.length === 0
          ? null
          : {
              message:
                (tasks.length === 1 ? `Deleted ${taskRef(tasks[0].seq)} · ${quote(tasks[0])}` : `Deleted ${tasks.length} tasks`) +
                (blocks.length ? ` and ${blocks.length} scheduled block${blocks.length === 1 ? '' : 's'}` : ''),
              undo: { label: 'delete', run: () => svc.restoreTasks(tasks, blocks, sessions) },
            },
    ),

  createCategory: (name: string) => run(() => svc.createCategory(name), (c) => ({ message: `Category “${c.name}” ready` })),

  /** Generated history so Insights has data; undo removes exactly what was added. */
  addSampleHistory: () =>
    run(
      () => svc.addSampleHistory(),
      (r) => ({
        message: `Added ${r.taskIds.length} finished tasks with tracked time`,
        undo: {
          label: 'sample history',
          run: async () => {
            await svc.deleteTasks(r.taskIds);
            await deleteSessions(r.sessionIds);
          },
        },
      }),
    ),

  loadDemo: () => run(() => svc.loadDemoData(), () => ({ message: 'Demo workspace loaded' })),
  clearAll: () => run(() => svc.clearTasks(), () => ({ message: 'All tasks cleared' })),
};
