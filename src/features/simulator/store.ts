import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ID, Instant } from '@/domain/types';
import type { PlanStrategy } from '@/engine/types';
import type { CreateDraft } from '@/features/timeline/store';

export type SimMode = 'edit' | 'compare';
export type SidePanel = 'impact' | 'changes' | 'unscheduled';

interface SimState {
  scenarioId: ID | null;
  mode: SimMode;
  panel: SidePanel;
  anchor: Instant;
  weekends: boolean;
  strategy: PlanStrategy;
  selectedBlockId: ID | null;
  creating: CreateDraft | null;
  set: (patch: Partial<Omit<SimState, 'set'>>) => void;
}

export const useSim = create<SimState>()(
  persist(
    (set) => ({
      scenarioId: null,
      mode: 'edit',
      panel: 'impact',
      anchor: Date.now(),
      weekends: false,
      strategy: 'deadline',
      selectedBlockId: null,
      creating: null,
      set: (patch) => set(patch),
    }),
    {
      name: 'ff-simulator',
      partialize: (s) => ({ scenarioId: s.scenarioId, mode: s.mode, panel: s.panel, weekends: s.weekends, strategy: s.strategy }),
    },
  ),
);
