/** BruinLearn import commands: toast + undo around the Canvas service. */
import { useLiveQuery } from 'dexie-react-hooks';
import { run } from '@/app/commands';
import { db } from '@/db/db';
import * as svc from '@/services/canvasService';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const canvasActions = {
  import: (choices: svc.ImportChoice[], courses: svc.PreviewCourse[], feedUrl?: string | null) =>
    run(
      () => svc.applyCanvasImport(choices, courses, feedUrl),
      (r) => {
        const parts = [r.added.length && `Added ${plural(r.added.length, 'assignment')}`, r.updatedBefore.length && `${plural(r.updatedBefore.length, 'due date')} updated`, r.newCourses.length && `${plural(r.newCourses.length, 'new course')}`].filter(Boolean);
        return { message: parts.length ? `${parts.join(' · ')} from BruinLearn` : 'BruinLearn is up to date', undo: { label: 'BruinLearn import', run: () => svc.undoCanvasImport(r) } };
      },
    ),

  disconnect: () =>
    run(
      () => svc.setFeedUrl(null),
      ({ before }) => ({ message: 'BruinLearn feed disconnected', undo: { label: 'disconnect feed', run: () => svc.restoreCanvasState(before) } }),
    ),
};

export function useCanvasState(): svc.CanvasState | undefined {
  return useLiveQuery(async () => svc.readCanvasState((await db.meta.get(svc.CANVAS_KEY))?.value), []);
}
