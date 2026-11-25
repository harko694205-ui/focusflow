import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ID, Instant } from '@/domain/types';

/** Vertical scale: one hour = 48px (15 min = 12px). */
export const HOUR_PX = 48;
export const PX_PER_MIN = HOUR_PX / 60;
export const GRID_HEIGHT = 24 * HOUR_PX;

export type TimelineView = 'week' | 'day';

export type DragMode = 'move' | 'resize-start' | 'resize-end' | 'tray' | 'create';

export interface DragState {
  mode: DragMode;
  /** Block being moved/resized. */
  blockId?: ID;
  /** Task being dragged in from the tray. */
  taskId?: ID;
  label: string;
  color: string;
  /** Duration in minutes (move/tray). */
  duration: number;
  /** Minutes between the block's top and the pointer when grabbed (move/tray). */
  grabOffset: number;
  originDay: Instant;
  originStart: number;
  originEnd: number;
  /** Current target: day start instant + minutes. `day` is null when not over a column (tray). */
  day: Instant | null;
  start: number;
  end: number;
  pointer: { x: number; y: number };
  startPointer: { x: number; y: number };
  moved: boolean;
}

export interface CreateDraft {
  day: Instant;
  start: number;
  end: number;
}

interface TimelineState {
  view: TimelineView;
  /** Any instant within the visible range. */
  anchor: Instant;
  /** -1 / 1 — direction of the last navigation, for the slide animation. */
  navDir: number;
  trayOpen: boolean;
  selectedId: ID | null;
  creating: CreateDraft | null;
  drag: DragState | null;
  /** Optimistic positions for blocks whose move is being persisted. */
  pending: Record<ID, { start: Instant; end: Instant }>;

  setView: (v: TimelineView) => void;
  goTo: (anchor: Instant, dir?: number) => void;
  setTrayOpen: (open: boolean) => void;
  select: (id: ID | null) => void;
  setCreating: (c: CreateDraft | null) => void;
  setDrag: (d: DragState | null) => void;
  setPending: (id: ID, span: { start: Instant; end: Instant } | null) => void;
}

export const useTimeline = create<TimelineState>()(
  persist(
    (set) => ({
      view: 'week',
      anchor: Date.now(),
      navDir: 0,
      trayOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1024,
      selectedId: null,
      creating: null,
      drag: null,
      pending: {},
      setView: (view) => set({ view, navDir: 0 }),
      goTo: (anchor, dir = 0) => set({ anchor, navDir: dir, selectedId: null, creating: null }),
      setTrayOpen: (trayOpen) => set({ trayOpen }),
      select: (selectedId) => set({ selectedId, creating: null }),
      setCreating: (creating) => set({ creating, selectedId: null }),
      setDrag: (drag) => set({ drag }),
      setPending: (id, span) =>
        set((s) => {
          const pending = { ...s.pending };
          if (span) pending[id] = span;
          else delete pending[id];
          return { pending };
        }),
    }),
    { name: 'ff-timeline', partialize: (s) => ({ view: s.view }) },
  ),
);
