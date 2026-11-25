/**
 * Illustrative data for views whose real data source arrives in later phases:
 * focus history (needs time tracking, Phase 5) and simulator scenarios (Phase 4).
 * Everything else — tasks, schedule, load — comes from IndexedDB.
 */

export type Energy = 'deep' | 'shallow' | 'admin';

/** A block as rendered by the Command Center's Today strip (minutes-of-day). */
export interface SampleBlock {
  id: string;
  start: number;
  end: number;
  title: string;
  kind: 'task' | 'event';
  energy?: Energy;
  color?: string;
  category?: string;
}

export interface SampleScenario {
  id: string;
  name: string;
  ops: number;
  lateDelta: number;
  loadDelta: number;
  updated: string;
}

export const focusWeek = [
  { dow: 'Mon', planned: 270, actual: 245 },
  { dow: 'Tue', planned: 300, actual: 205 },
  { dow: 'Wed', planned: 240, actual: 95 },
  { dow: 'Thu', planned: 300, actual: null },
  { dow: 'Fri', planned: 180, actual: null },
];

export const scenarios: SampleScenario[] = [
  { id: 's1', name: 'Take Friday off', ops: 1, lateDelta: 2, loadDelta: 435, updated: '2h ago' },
  { id: 's2', name: 'Defer hiring by one week', ops: 3, lateDelta: -1, loadDelta: -270, updated: 'Yesterday' },
];
