import { format } from 'date-fns';
import { run } from '@/app/commands';
import type { ID, Instant, TimeBlock } from '@/domain/types';
import * as svc from '@/services/scheduleService';

const span = (b: Pick<TimeBlock, 'start' | 'end'>) => `${format(b.start, 'EEE HH:mm')}–${format(b.end, 'HH:mm')}`;

export const blockActions = {
  schedule: (taskId: ID, start: Instant, end: Instant, label: string) =>
    run(
      () => svc.scheduleTask(taskId, start, end),
      (b) => ({
        message: `Scheduled ${label} · ${span(b)}`,
        undo: { label: 'schedule', run: async () => void (await svc.deleteBlocks([b.id])) },
      }),
    ),

  /** Accept a recommendation: several sessions at once, undone together. */
  scheduleSessions: (taskId: ID, spans: Array<{ start: Instant; end: Instant }>, label: string) =>
    run(
      () => svc.scheduleSessions(taskId, spans),
      (bs) => ({
        message: bs.length === 1 ? `Scheduled ${label} · ${span(bs[0])}` : `Scheduled ${bs.length} sessions for ${label}`,
        undo: { label: 'schedule', run: async () => void (await svc.deleteBlocks(bs.map((b) => b.id))) },
      }),
    ),

  createEvent: (title: string, start: Instant, end: Instant) =>
    run(
      () => svc.createEvent(title, start, end),
      (b) => ({
        message: `Added “${b.title}” · ${span(b)}`,
        undo: { label: 'add event', run: async () => void (await svc.deleteBlocks([b.id])) },
      }),
    ),

  /** Move/resize. Silent on success (the block visibly moved) but undoable with Ctrl+Z. */
  move: (id: ID, start: Instant, end: Instant) =>
    run(
      () => svc.updateBlock(id, { start, end }),
      ({ before, after, taskBefore }) =>
        before.start === after.start && before.end === after.end
          ? null
          : { message: '', undo: { label: 'move', run: () => svc.restoreMove(before, taskBefore) } },
    ),

  rename: (id: ID, title: string) =>
    run(
      () => svc.updateBlock(id, { title }),
      ({ before }) => ({ message: 'Event renamed', undo: { label: 'rename', run: () => svc.restoreBlocks([before]) } }),
    ),

  remove: (ids: ID[], label = 'block') =>
    run(
      () => svc.deleteBlocks(ids),
      (removed) =>
        removed.length === 0
          ? null
          : {
              message: removed.length === 1 ? `Removed ${label} · ${span(removed[0])}` : `Removed ${removed.length} blocks`,
              undo: { label: 'remove', run: () => svc.restoreBlocks(removed) },
            },
    ),
};
