/** Settings commands: toast + undo around the settings, category and backup services. */
import { run } from '@/app/commands';
import type { WorkWeek } from '@/domain/constants';
import type { CategoryColor, ID } from '@/domain/types';
import type { Profile } from '@/domain/profile';
import { weeklyMinutes } from '@/domain/workweek';
import { formatDuration } from '@/lib/format';
import * as settings from '@/services/settingsService';
import * as classes from '@/services/classService';
import * as tasks from '@/services/taskService';
import { exportWorkspace, importWorkspace } from '@/services/backup';

export const settingsActions = {
  setWorkWeek: (week: WorkWeek) =>
    run(
      () => settings.setWorkWeek(week),
      ({ before, after }) => ({
        message: `Working hours saved · ${formatDuration(weeklyMinutes(after), { compact: true })} a week`,
        undo: { label: 'working hours', run: () => settings.restoreWorkWeek(before) },
      }),
    ),

  renameCategory: (id: ID, name: string) =>
    run(
      () => tasks.updateCategory(id, { name }),
      ({ before, after }) =>
        before.name === after.name ? null : { message: `Renamed to ${after.name}`, undo: { label: 'rename category', run: () => tasks.restoreCategoryEdit(before) } },
    ),

  recolorCategory: (id: ID, color: CategoryColor) =>
    run(
      () => tasks.updateCategory(id, { color }),
      ({ before }) => ({ message: '', undo: { label: 'category color', run: () => tasks.restoreCategoryEdit(before) } }),
    ),

  createCategory: (name: string) => run(() => tasks.createCategory(name), (c) => ({ message: `Added ${c.name}` })),

  deleteCategory: (id: ID, moveTo?: ID) =>
    run(
      () => tasks.deleteCategory(id, moveTo),
      ({ category, moved, movedClasses, classBlocks }) => ({
        message: moved.length || movedClasses.length ? `Deleted ${category.name} · ${[moved.length && `${moved.length} task${moved.length === 1 ? '' : 's'}`, movedClasses.length && `${movedClasses.length} class${movedClasses.length === 1 ? '' : 'es'}`].filter(Boolean).join(' and ')} moved` : `Deleted ${category.name}`,
        undo: { label: 'delete category', run: () => tasks.restoreCategory(category, moved, movedClasses, classBlocks) },
      }),
    ),

  exportBackup: () => run(() => exportWorkspace(), (n) => ({ message: `Exported ${n} tasks` })),

  /** Replaces the workspace. Not undoable — the caller confirms first and offers an export. */
  importBackup: (file: File) =>
    run(
      async () => importWorkspace(await file.text()),
      (n) => ({ message: `Imported ${n} tasks` }),
    ),
};

/** Work / Student mode, term and default due time. */
export const profileActions = {
  update: (patch: Partial<Profile>, message = '') =>
    run(
      async () => {
        const r = await settings.setProfile(patch);
        // Class meetings follow the term (dates, length, holidays).
        if (JSON.stringify(r.before?.term ?? null) !== JSON.stringify(r.after.term)) await classes.regenerateAll();
        return r;
      },
      ({ before }) => ({
        message,
        undo: {
          label: 'profile change',
          run: async () => {
            await settings.restoreProfile(before);
            await classes.regenerateAll();
          },
        },
      }),
    ),
};
