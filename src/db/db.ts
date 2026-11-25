import Dexie, { type EntityTable } from 'dexie';
import type { Category, Task, TimeBlock } from '@/domain/types';
import type { Scenario } from '@/engine/types';
import { buildDemoBlocks, buildSeed } from './seed';

export interface MetaRow {
  key: string;
  value: unknown;
}

export class FocusFlowDB extends Dexie {
  tasks!: EntityTable<Task, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  blocks!: EntityTable<TimeBlock, 'id'>;
  scenarios!: EntityTable<Scenario, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  /** When false, a freshly created database starts empty (used by tests). */
  seedOnCreate = true;

  constructor(name = 'focusflow') {
    super(name);
    // Only indexed fields are listed; all others are stored as-is.
    this.version(1).stores({
      tasks: 'id, &seq, status, categoryId, deadline, priority, updatedAt',
      categories: 'id, order',
      meta: 'key',
    });

    // v2 — timeline: time blocks. Existing demo workspaces get a demo schedule so the
    // timeline isn't empty after upgrading; user-created tasks are never touched.
    this.version(2)
      .stores({ blocks: 'id, taskId, start, end' })
      .upgrade(async (tx) => {
        const tasks = (await tx.table('tasks').toArray()) as Task[];
        const blocks = buildDemoBlocks(tasks, Date.now());
        if (blocks.length) await tx.table('blocks').bulkAdd(blocks);
      });

    // v3 — simulator scenarios (each carries its own frozen baseline snapshot).
    this.version(3).stores({ scenarios: 'id, status, updatedAt' });

    // Runs exactly once, when the database is first created in this browser.
    this.on('populate', async (tx) => {
      if (!this.seedOnCreate) return;
      const now = Date.now();
      const { categories, tasks } = buildSeed(now);
      await tx.table('categories').bulkAdd(categories);
      await tx.table('tasks').bulkAdd(tasks);
      await tx.table('blocks').bulkAdd(buildDemoBlocks(tasks, now));
      await tx.table('meta').put({ key: 'taskSeq', value: tasks.length });
    });
  }
}

export const db = new FocusFlowDB();

/** Ask the browser not to evict our data under storage pressure. Best-effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
