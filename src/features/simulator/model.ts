import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import {
  analyze,
  applyOps,
  compareTotals,
  diffSchedules,
  driftCount,
  riskChanges,
  type Analysis,
  type MetricDelta,
  type OpResult,
  type RiskChange,
  type Scenario,
  type ScheduleDiff,
  type ScheduleState,
} from '@/engine';
import type { ID, Task, TimeBlock } from '@/domain/types';

export function useScenarios(): Scenario[] | undefined {
  return useLiveQuery(() => db.scenarios.orderBy('updatedAt').reverse().toArray(), []);
}

export const IMPACT_KEYS = ['lateTasks', 'overloadedDays', 'conflicts', 'unscheduledMinutes', 'scheduledTaskMinutes', 'freeMinutes'] as const;

export interface ScenarioModel {
  original: ScheduleState;
  proposed: ScheduleState;
  results: OpResult[];
  before: Analysis;
  after: Analysis;
  diff: ScheduleDiff;
  deltas: MetricDelta[];
  risks: RiskChange[];
  /** Live records added/removed/edited since the snapshot. */
  drift: number;
  taskMap: Map<ID, Task>;
  originalBlockMap: Map<ID, TimeBlock>;
}

/**
 * Everything the simulator renders for one scenario, recomputed whenever the scenario's ops,
 * the visible range or the clock change. Pure derivation from the immutable baseline.
 */
export function useScenarioModel(
  scenario: Scenario | undefined,
  live: ScheduleState | undefined,
  range: { from: number; days: number },
  now: number,
): ScenarioModel | null {
  return useMemo(() => {
    if (!scenario) return null;
    const original = scenario.baseline;
    const { state: proposed, results } = applyOps(original, scenario.ops);
    const before = analyze(original, range, now);
    const after = analyze(proposed, range, now);
    return {
      original,
      proposed,
      results,
      before,
      after,
      diff: diffSchedules(original, proposed),
      deltas: compareTotals(before.totals, after.totals, [...IMPACT_KEYS]),
      risks: riskChanges(before, after),
      drift: live ? driftCount(original, live) : 0,
      taskMap: new Map(proposed.tasks.map((t) => [t.id, t])),
      originalBlockMap: new Map(original.blocks.map((b) => [b.id, b])),
    };
  }, [scenario, live, range.from, range.days, now]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Late-task delta for a scenario over the next 14 days — used in compact summaries (sidebar). */
export function scenarioLateDelta(s: Scenario, now: number): number {
  const range = { from: now, days: 14 };
  const before = analyze(s.baseline, range, now).totals.lateTasks;
  const after = analyze(applyOps(s.baseline, s.ops).state, range, now).totals.lateTasks;
  return after - before;
}
