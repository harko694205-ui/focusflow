/** Shared view types for the Command Center (all data comes from IndexedDB). */

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
