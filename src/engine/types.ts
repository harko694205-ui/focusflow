/**
 * Scheduling engine — types. The engine is pure TypeScript: no React, no Dexie, no clocks
 * (callers pass `now`). Every function takes immutable inputs and returns new values, so a
 * scenario can never mutate the schedule it was forked from.
 */
import type { ID, Instant, Minutes, Priority, Task, TimeBlock } from '@/domain/types';

/** The part of the workspace the engine reasons about. */
export interface ScheduleState {
  readonly tasks: readonly Task[];
  readonly blocks: readonly TimeBlock[];
  /** Local day keys (yyyy-MM-dd) with no working capacity in this scenario ("day off"). */
  readonly offDays?: readonly string[];
}

/** A frozen copy of the live schedule, taken when a scenario is created. */
export interface ScheduleSnapshot extends ScheduleState {
  readonly takenAt: Instant;
}

export type PlanStrategy = 'deadline' | 'priority';

/** One edit inside a scenario. Ops are replayed in order on top of the snapshot. */
export type ScenarioOp =
  | { type: 'move'; blockId: ID; start: Instant; end: Instant }
  | { type: 'add'; block: TimeBlock }
  | { type: 'remove'; blockId: ID }
  | { type: 'estimate'; taskId: ID; estimate: Minutes }
  | { type: 'deadline'; taskId: ID; deadline: Instant }
  | { type: 'priority'; taskId: ID; priority: Priority }
  /**
   * Take a day off: unschedule every task block on that local day (events stay) and treat the day
   * as having no working capacity for planning and analysis — "what if I lose Friday?".
   */
  | { type: 'clearDay'; day: Instant }
  /** Fill free working time with unscheduled work, earliest first. Expanded deterministically on replay. */
  | { type: 'autoplan'; from: Instant; days: number; strategy: PlanStrategy; now: Instant };

export interface StoredOp {
  id: ID;
  at: Instant;
  op: ScenarioOp;
}

export interface OpResult {
  id: ID;
  /** Human-readable description, e.g. "Moved FF-6 to Thu 09:00". */
  label: string;
  /** Set when the op couldn't be applied (e.g. its block no longer exists). */
  skipped?: string;
  /** Number of blocks added/removed/changed. */
  affected: number;
}

export type ScenarioStatus = 'draft' | 'applied' | 'discarded';

export interface Scenario {
  id: ID;
  name: string;
  status: ScenarioStatus;
  baseline: ScheduleSnapshot;
  ops: StoredOp[];
  createdAt: Instant;
  updatedAt: Instant;
  appliedAt: Instant | null;
}
