import type { CategoryColor, Difficulty, Priority, TaskStatus } from './types';

export const PRIORITIES: Record<Priority, { label: string; short: string }> = {
  0: { label: 'Urgent', short: 'P0' },
  1: { label: 'High', short: 'P1' },
  2: { label: 'Normal', short: 'P2' },
  3: { label: 'Low', short: 'P3' },
};
export const PRIORITY_VALUES: Priority[] = [0, 1, 2, 3];

export const DIFFICULTIES: Record<Difficulty, { label: string; hint: string }> = {
  1: { label: 'Easy', hint: 'Routine work, fits anywhere' },
  2: { label: 'Medium', hint: 'Needs some focus' },
  3: { label: 'Hard', hint: 'Deep work — best in peak focus hours' },
};
export const DIFFICULTY_VALUES: Difficulty[] = [1, 2, 3];

export const STATUSES: Record<TaskStatus, { label: string }> = {
  todo: { label: 'To do' },
  in_progress: { label: 'In progress' },
  done: { label: 'Done' },
};
export const STATUS_VALUES: TaskStatus[] = ['todo', 'in_progress', 'done'];

export const CATEGORY_COLORS: Record<CategoryColor, string> = {
  iris: 'var(--color-p-iris)',
  teal: 'var(--color-p-teal)',
  amber: 'var(--color-p-amber)',
  rose: 'var(--color-p-rose)',
  sky: 'var(--color-p-sky)',
  lime: 'var(--color-p-lime)',
  violet: 'var(--color-p-violet)',
  slate: 'var(--color-p-slate)',
};
export const CATEGORY_COLOR_VALUES = Object.keys(CATEGORY_COLORS) as CategoryColor[];

export const TASK_REF_PREFIX = 'FF';
export const taskRef = (seq: number) => `${TASK_REF_PREFIX}-${seq}`;

export const LIMITS = {
  titleMax: 200,
  notesMax: 5000,
  estimateMin: 5,
  estimateMax: 60 * 40, // 40h — anything bigger should be split
  categoryNameMax: 40,
};

/**
 * Default working week, minutes from local midnight. Mon–Fri 08:30–12:30, 13:15–18:00 (8h45/day).
 * Editable in Settings (Phase 6). Index 0 = Sunday, matching Date#getDay().
 */
export type WorkWeek = Record<0 | 1 | 2 | 3 | 4 | 5 | 6, Array<{ start: number; end: number }>>;
const day = [
  { start: 8 * 60 + 30, end: 12 * 60 + 30 },
  { start: 13 * 60 + 15, end: 18 * 60 },
];
export const DEFAULT_WORK_WEEK: WorkWeek = { 0: [], 1: day, 2: day, 3: day, 4: day, 5: day, 6: [] };

/** Slack below this is "at risk". */
export const AT_RISK_SLACK: number = 120;
