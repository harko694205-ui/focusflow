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
  /** Quick capture (one-line add). */
  captureOpen: boolean;
  /** Course the last quick-captured task went to (the default for the next one). */
  captureCourse: ID | null;
  editor: EditorState;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  setCapture: (open: boolean) => void;
  setCaptureCourse: (id: ID | null) => void;
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
      captureOpen: false,
      captureCourse: null,
      editor: null,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
      setPalette: (paletteOpen) => set({ paletteOpen }),
      setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
      setCapture: (captureOpen) => set({ captureOpen }),
      setCaptureCourse: (captureCourse) => set({ captureCourse }),
      openCreate: (defaults) => set({ editor: { mode: 'create', defaults } }),
      openEdit: (id) => set({ editor: { mode: 'edit', id } }),
      closeEditor: () => set({ editor: null }),
    }),
    { name: 'ff-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, captureCourse: s.captureCourse }) },
  ),
);

/** True while any modal surface is open — global hotkeys stand down. */
export const isModalOpen = () => {
  const s = useUI.getState();
  return s.paletteOpen || s.shortcutsOpen || s.captureOpen || s.editor !== null || !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]');
};
