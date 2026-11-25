/**
 * Turn a scheduler recommendation into plain-language copy. Pure, so it can be tested and reused
 * (editor, tray, simulator).
 */
import { format, isSameDay } from 'date-fns';
import { taskRef } from '@/domain/constants';
import type { ID, Task } from '@/domain/types';
import type { Recommendation } from '@/engine/scheduler';
import { formatDuration } from '@/lib/format';

/** How far ahead recommendations look. */
export const PLAN_DAYS = 14;

export type Tone = 'positive' | 'warning' | 'negative' | 'muted';

export interface Explanation {
  headline: string;
  tone: Tone;
  notes: string[];
}

const when = (t: number, now: number) => (isSameDay(t, now) ? `today ${format(t, 'HH:mm')}` : format(t, 'EEE d MMM, HH:mm'));

export function explain(rec: Recommendation, task: Task, byId: ReadonlyMap<ID, Task>, now: number): Explanation {
  const ref = (id: ID) => {
    const t = byId.get(id);
    return t ? taskRef(t.seq) : 'a deleted task';
  };
  const refs = (ids: ID[]) => ids.map(ref).join(', ');
  const notes: string[] = [];

  if (rec.waitsFor.length && rec.status !== 'blocked') {
    notes.push(
      rec.earliestStart > now
        ? `Starts after ${refs(rec.waitsFor)} — no earlier than ${when(rec.earliestStart, now)}.`
        : `Waits for ${refs(rec.waitsFor)}.`,
    );
  }
  if (rec.effectiveDeadline < task.deadline && rec.status !== 'blocked') {
    notes.push(`Aim to finish by ${when(rec.effectiveDeadline, now)} so the tasks waiting on it still fit before their deadlines.`);
  }
  if (rec.relaxed) notes.push('Uses shorter sessions than usual to make the deadline.');
  if (rec.existingMinutes > 0 && rec.placedMinutes > 0) notes.push(`${formatDuration(rec.existingMinutes, { compact: true })} already on the timeline is counted.`);

  const n = rec.sessions.length;
  const sessions = `${n} session${n === 1 ? '' : 's'}`;
  switch (rec.status) {
    case 'on_time':
      return { tone: 'positive', headline: `Fits before the deadline · ${sessions}, done by ${when(rec.finish!, now)}`, notes };
    case 'scheduled':
      return { tone: 'muted', headline: rec.finish && rec.finish > task.deadline ? 'Fully scheduled, but the last block is after the deadline' : 'Already fully scheduled', notes };
    case 'late': {
      const over = Math.round((rec.finish! - task.deadline) / 60_000);
      return {
        tone: 'warning',
        headline: `Can’t finish in time · earliest finish ${when(rec.finish!, now)}`,
        notes: [`That’s ${formatDuration(over, { compact: true })} past the deadline with the time that’s free. Consider moving other work or the deadline.`, ...notes],
      };
    }
    case 'overdue':
      return { tone: 'negative', headline: `Overdue · earliest slots below, ${sessions}`, notes };
    case 'partial':
      return {
        tone: 'warning',
        headline: `Only ${formatDuration(rec.placedMinutes, { compact: true })} of ${formatDuration(rec.placedMinutes + rec.unplacedMinutes, { compact: true })} fits in the next ${PLAN_DAYS} days`,
        notes,
      };
    case 'blocked':
      return {
        tone: 'negative',
        headline: `Blocked by ${refs(rec.blockedBy)}`,
        notes: [`${refs(rec.blockedBy)} can’t be fully scheduled in the next ${PLAN_DAYS} days, so this can’t start yet.`, ...notes],
      };
  }
}
