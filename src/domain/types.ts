/**
 * Core domain types. Pure data — no React, no Dexie.
 * Conventions: instants are epoch ms, durations are minutes.
 */

export type ID = string;
export type Instant = number;
export type Minutes = number;

/** 0 = urgent … 3 = low */
export type Priority = 0 | 1 | 2 | 3;
/** 1 = easy, 2 = medium, 3 = hard. Hard work is placed into peak focus windows (Phase 2). */
export type Difficulty = 1 | 2 | 3;
export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Category {
  id: ID;
  name: string;
  /** Token name from CATEGORY_COLORS, e.g. "iris". */
  color: CategoryColor;
  order: number;
  createdAt: Instant;
}

export interface Task {
  id: ID;
  /** Human-friendly sequential number, displayed as FF-<seq>. */
  seq: number;
  title: string;
  notes: string;
  categoryId: ID;
  status: TaskStatus;
  priority: Priority;
  difficulty: Difficulty;
  estimate: Minutes;
  deadline: Instant;
  createdAt: Instant;
  updatedAt: Instant;
  completedAt: Instant | null;
}

/** The user-editable part of a task. */
export type TaskDraft = Pick<Task, 'title' | 'notes' | 'categoryId' | 'priority' | 'difficulty' | 'estimate' | 'deadline'> & {
  status?: TaskStatus;
};

/**
 * A span of time on the timeline. `task` blocks schedule work for a task (a task may have several);
 * `event` blocks are fixed commitments (meetings, appointments) with their own title.
 * Blocks never cross local midnight.
 */
export interface TimeBlock {
  id: ID;
  kind: 'task' | 'event';
  /** Set for kind = 'task'. */
  taskId: ID | null;
  /** Set for kind = 'event'. */
  title: string;
  start: Instant;
  end: Instant;
  createdAt: Instant;
  updatedAt: Instant;
}

export type CategoryColor = 'iris' | 'teal' | 'amber' | 'rose' | 'sky' | 'lime' | 'violet' | 'slate';
