import type { Task } from '@/domain/types';

let n = 0;
/** Build a task with sensible defaults; override what the test cares about. */
export function makeTask(over: Partial<Task> = {}): Task {
  n++;
  return {
    id: `t${n}`,
    seq: n,
    title: `Task ${n}`,
    notes: '',
    categoryId: 'c1',
    status: 'todo',
    priority: 2,
    difficulty: 2,
    estimate: 60,
    deadline: 0,
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    ...over,
  };
}
