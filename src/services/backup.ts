import { db } from '@/db/db';
import type { Category, Task, TimeBlock, WorkSession } from '@/domain/types';

const FORMAT = 'focusflow-backup';
/** v1: tasks + categories. v2: adds time blocks. v3: adds work sessions (time tracking). */
const VERSION = 3;

interface Backup {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  categories: Category[];
  tasks: Task[];
  blocks?: TimeBlock[];
  sessions?: WorkSession[];
}

export async function buildBackup(): Promise<Backup> {
  const [categories, tasks, blocks, sessions] = await Promise.all([db.categories.toArray(), db.tasks.toArray(), db.blocks.toArray(), db.sessions.toArray()]);
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), categories, tasks, blocks, sessions };
}

/** Download the workspace as JSON. Returns the number of tasks exported. */
export async function exportWorkspace(): Promise<number> {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focusflow-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup.tasks.length;
}

function isTask(t: unknown): t is Task {
  const x = t as Task;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.seq === 'number' &&
    typeof x.title === 'string' &&
    typeof x.categoryId === 'string' &&
    ['todo', 'in_progress', 'done'].includes(x.status) &&
    [0, 1, 2, 3].includes(x.priority) &&
    [1, 2, 3].includes(x.difficulty) &&
    typeof x.estimate === 'number' &&
    typeof x.deadline === 'number' &&
    (x.dependsOn === undefined || (Array.isArray(x.dependsOn) && x.dependsOn.every((d) => typeof d === 'string')))
  );
}

function isCategory(c: unknown): c is Category {
  const x = c as Category;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.color === 'string';
}

function isBlock(b: unknown): b is TimeBlock {
  const x = b as TimeBlock;
  return (
    !!x &&
    typeof x.id === 'string' &&
    (x.kind === 'task' || x.kind === 'event') &&
    typeof x.start === 'number' &&
    typeof x.end === 'number' &&
    x.end > x.start &&
    (x.kind === 'event' ? typeof x.title === 'string' : typeof x.taskId === 'string')
  );
}

function isSession(s: unknown): s is WorkSession {
  const x = s as WorkSession;
  return !!x && typeof x.id === 'string' && typeof x.taskId === 'string' && typeof x.start === 'number' && typeof x.end === 'number' && x.end > x.start;
}

/** Replace the workspace with a backup. Validates everything before writing anything. */
export async function importWorkspace(json: string): Promise<number> {
  let data: Backup;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (data?.format !== FORMAT) throw new Error('Not a FocusFlow backup file.');
  if (data.version > VERSION) throw new Error('This backup was made by a newer version of FocusFlow.');
  if (!Array.isArray(data.tasks) || !data.tasks.every(isTask)) throw new Error('Backup contains malformed tasks.');
  if (!Array.isArray(data.categories) || !data.categories.every(isCategory)) throw new Error('Backup contains malformed categories.');
  const rawBlocks = data.blocks ?? [];
  if (!Array.isArray(rawBlocks) || !rawBlocks.every(isBlock)) throw new Error('Backup contains malformed schedule blocks.');
  const rawSessions = data.sessions ?? [];
  if (!Array.isArray(rawSessions) || !rawSessions.every(isSession)) throw new Error('Backup contains malformed time entries.');

  const tasks = data.tasks.map((t) => ({ ...t, notes: t.notes ?? '', completedAt: t.completedAt ?? null }));
  const taskIds = new Set(tasks.map((t) => t.id));
  // Drop orphaned task blocks rather than importing dangling references.
  const blocks = rawBlocks
    .filter((b) => b.kind === 'event' || taskIds.has(b.taskId!))
    .map((b) => ({ ...b, taskId: b.kind === 'task' ? b.taskId : null, title: b.title ?? '' }));
  const sessions = rawSessions
    .filter((s) => taskIds.has(s.taskId))
    .map((s) => ({ ...s, source: s.source === 'timer' ? ('timer' as const) : ('manual' as const), createdAt: s.createdAt ?? s.end }));

  await db.transaction('rw', db.tasks, db.categories, db.blocks, db.sessions, db.meta, async () => {
    await db.tasks.clear();
    await db.categories.clear();
    await db.blocks.clear();
    await db.sessions.clear();
    await db.meta.delete('activeTimer');
    await db.categories.bulkAdd(data.categories);
    await db.tasks.bulkAdd(tasks);
    await db.blocks.bulkAdd(blocks);
    await db.sessions.bulkAdd(sessions);
    await db.meta.put({ key: 'taskSeq', value: tasks.reduce((m, t) => Math.max(m, t.seq), 0) });
  });
  return tasks.length;
}
