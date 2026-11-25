/**
 * Illustrative data for views whose real data source arrives in later phases:
 * focus history, which needs time tracking (Insights phase).
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

export const focusWeek = [
  { dow: 'Mon', planned: 270, actual: 245 },
  { dow: 'Tue', planned: 300, actual: 205 },
  { dow: 'Wed', planned: 240, actual: 95 },
  { dow: 'Thu', planned: 300, actual: null },
  { dow: 'Fri', planned: 180, actual: null },
];
