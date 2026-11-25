/** Exam commands as the UI sees them: toast + undo around the exam service. */
import { run } from '@/app/commands';
import type { Confidence, Exam, ExamDraft, ID } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import * as svc from '@/services/examService';

export const examActions = {
  create: (draft: ExamDraft) =>
    run(
      () => svc.createExam(draft),
      (e) => ({
        message: `Added ${e.title}`,
        undo: { label: 'add exam', run: async () => void (await svc.deleteExam(e.id)) },
      }),
    ),

  update: (id: ID, patch: Partial<ExamDraft>, message = 'Exam updated') =>
    run(
      () => svc.updateExam(id, patch),
      ({ before, eventBefore }) => ({ message, undo: { label: 'edit exam', run: () => svc.restoreExamEdit(before, eventBefore) } }),
    ),

  setConfidence: (exam: Exam, topicId: ID, confidence: Confidence) =>
    run(
      () => svc.setTopicConfidence(exam.id, topicId, confidence),
      ({ before }) => ({ message: '', undo: { label: 'topic rating', run: () => svc.restoreExamRecord(before) } }),
    ),

  remove: (id: ID) =>
    run(
      () => svc.deleteExam(id),
      ({ exam, event, removed }) => ({
        message: `Deleted ${exam.title}${removed.tasks.length ? ` and ${removed.tasks.length} study session${removed.tasks.length === 1 ? '' : 's'}` : ''}`,
        undo: { label: 'delete exam', run: () => svc.restoreExam(exam, event, removed) },
      }),
    ),

  plan: (id: ID) =>
    run(
      () => svc.applyPlan(id),
      ({ plan, createdTaskIds, scheduled, removed }) => {
        if (!createdTaskIds.length) {
          return { message: plan.status === 'done' ? 'You’ve already prepared enough for this one' : (plan.note ?? 'Nothing to plan') };
        }
        const unplaced = plan.total - scheduled;
        return {
          message:
            `Planned ${createdTaskIds.length} study session${createdTaskIds.length === 1 ? '' : 's'} · ${formatDuration(plan.total, { compact: true })}` +
            (unplaced >= 15 ? ` · ${formatDuration(unplaced, { compact: true })} still to schedule` : ' on your timeline'),
          undo: { label: 'study plan', run: () => svc.undoPlan(createdTaskIds, removed) },
        };
      },
    ),
};
