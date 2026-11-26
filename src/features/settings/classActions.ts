/** Class schedule commands: toast + undo around the class service. */
import { run } from '@/app/commands';
import type { ClassDraft, ID } from '@/domain/types';
import * as svc from '@/services/classService';
import * as studyList from '@/services/studyListService';
import type { StudyPreview } from '@/services/studyListService';

export const classActions = {
  create: (draft: ClassDraft, label: string) =>
    run(
      () => svc.createClass(draft),
      ({ cls, meetings }) => ({
        message: `Added ${label} · ${meetings} meeting${meetings === 1 ? '' : 's'} on your timeline`,
        undo: { label: 'add class', run: () => svc.restoreClass(null, cls.id, []) },
      }),
    ),

  update: (id: ID, patch: Partial<ClassDraft>) =>
    run(
      () => svc.updateClass(id, patch),
      ({ before, blocksBefore }) => ({ message: 'Class updated', undo: { label: 'edit class', run: () => svc.restoreClass(before, id, blocksBefore) } }),
    ),

  importStudyList: (preview: StudyPreview) =>
    run(
      () => studyList.applyStudyList(preview),
      (r) => {
        const n = r.classIds.length;
        const f = r.examIds.length;
        const parts = [n && `${n} class${n === 1 ? '' : 'es'}`, f && `${f} final${f === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
        return { message: `Added ${parts || 'nothing'} from MyUCLA${r.profileBefore !== undefined ? ' · term set' : ''}`, undo: { label: 'Study List import', run: () => studyList.undoStudyList(r) } };
      },
    ),

  remove: (id: ID, label: string) =>
    run(
      () => svc.deleteClass(id),
      ({ cls, blocks }) => ({ message: `Removed ${label}`, undo: { label: 'remove class', run: () => svc.restoreClass(cls, id, blocks) } }),
    ),
};
