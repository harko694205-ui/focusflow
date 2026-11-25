import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EMPTY_FILTER, type GroupKey, type TaskFilter, type TaskSort } from '@/domain/query';

/** Tasks view preferences — persisted so the list looks the same on return. */
interface TaskViewState {
  filter: TaskFilter;
  sort: TaskSort;
  group: GroupKey;
  setFilter: (patch: Partial<TaskFilter>) => void;
  toggleFacet: <K extends 'categories' | 'priorities' | 'difficulties' | 'due'>(key: K, value: TaskFilter[K][number]) => void;
  clearFacets: () => void;
  setSort: (sort: TaskSort) => void;
  setGroup: (group: GroupKey) => void;
}

export const useTaskView = create<TaskViewState>()(
  persist(
    (set) => ({
      filter: EMPTY_FILTER,
      sort: { key: 'deadline', dir: 'asc' },
      group: 'due',
      setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
      toggleFacet: (key, value) =>
        set((s) => {
          const list = s.filter[key] as Array<typeof value>;
          const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
          return { filter: { ...s.filter, [key]: next } };
        }),
      clearFacets: () => set((s) => ({ filter: { ...EMPTY_FILTER, status: s.filter.status } })),
      setSort: (sort) => set({ sort }),
      setGroup: (group) => set({ group }),
    }),
    {
      name: 'ff-task-view',
      // Search is transient; everything else persists.
      partialize: (s) => ({ filter: { ...s.filter, search: '' }, sort: s.sort, group: s.group }),
    },
  ),
);
