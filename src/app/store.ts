import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ID, TaskDraft } from '@/domain/types';

export type EditorState = { mode: 'create'; defaults?: Partial<TaskDraft> } | { mode: 'edit'; id: ID } | null;

/** Ephemeral + lightly persisted UI state. Domain data lives in Dexie. */
interface UIState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  editor: EditorState;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  openCreate: (defaults?: Partial<TaskDraft>) => void;
  openEdit: (id: ID) => void;
  closeEditor: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      paletteOpen: false,
      shortcutsOpen: false,
      editor: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
      openCreate: (defaults) => set({ editor: { mode: 'create', defaults } }),
      openEdit: (id) => set({ editor: { mode: 'edit', id } }),
      closeEditor: () => set({ editor: null }),
    }),
    { name: 'ff-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }) },
  ),
);

/** True while any modal surface is open — global hotkeys stand down. */
export const isModalOpen = () => {
  const s = useUI.getState();
  return s.paletteOpen || s.shortcutsOpen || s.editor !== null || !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');
};
