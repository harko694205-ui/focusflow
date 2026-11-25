import { useMemo } from 'react';
import { startOfLocalDay } from '@/domain/schedule';
import { planSchedule, type SchedulePlan } from '@/engine/scheduler';
import { useWorkspace } from '@/hooks/data';
import { PLAN_DAYS } from './explain';

export { PLAN_DAYS };

/**
 * Recommendations for the live workspace: every open task planned around what's already on the
 * timeline. Recomputed whenever tasks, blocks or the minute changes. Nothing is written —
 * callers accept a recommendation explicitly.
 */
export function useLivePlan(): SchedulePlan | undefined {
  const ws = useWorkspace();
  return useMemo(
    () =>
      ws.loading
        ? undefined
        : planSchedule({ tasks: ws.tasks, blocks: ws.blocks }, { from: startOfLocalDay(ws.now).getTime(), days: PLAN_DAYS, now: ws.now, idPrefix: 'rec' }),
    [ws.loading, ws.tasks, ws.blocks, ws.now],
  );
}
