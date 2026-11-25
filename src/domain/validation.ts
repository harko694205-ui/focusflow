import { LIMITS } from './constants';
import type { TaskDraft } from './types';

export type DraftErrors = Partial<Record<keyof TaskDraft, string>>;

export function validateDraft(d: Partial<TaskDraft>): DraftErrors {
  const e: DraftErrors = {};
  const title = d.title?.trim() ?? '';
  if (!title) e.title = 'Give the task a title.';
  else if (title.length > LIMITS.titleMax) e.title = `Keep it under ${LIMITS.titleMax} characters.`;

  if (!d.categoryId) e.categoryId = 'Choose a category.';

  if (d.estimate === undefined || !Number.isFinite(d.estimate)) e.estimate = 'Enter an estimate.';
  else if (d.estimate < LIMITS.estimateMin) e.estimate = `At least ${LIMITS.estimateMin} minutes.`;
  else if (d.estimate > LIMITS.estimateMax) e.estimate = 'Over 40h — consider splitting it.';

  if (d.deadline === undefined || !Number.isFinite(d.deadline)) e.deadline = 'Set a deadline.';

  if ((d.notes?.length ?? 0) > LIMITS.notesMax) e.notes = `Notes are limited to ${LIMITS.notesMax} characters.`;
  return e;
}

export const isValid = (e: DraftErrors) => Object.keys(e).length === 0;

/**
 * Parse a human estimate: "90", "90m", "1.5h", "1h30", "1h 30m", "2:15".
 * Returns minutes, or null if unparseable.
 */
export function parseEstimate(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)$/.exec(s))) return Number(m[1]);
  if ((m = /^(\d+(?:\.\d+)?)m(?:in)?$/.exec(s))) return Math.round(Number(m[1]));
  if ((m = /^(\d+(?:\.\d+)?)h$/.exec(s))) return Math.round(Number(m[1]) * 60);
  if ((m = /^(\d+)h(\d+)m?$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+):(\d{2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}
