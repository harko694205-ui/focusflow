import { db } from '@/db/db';
import type { Category, ClassMeeting, Exam, Task, TimeBlock, WorkSession } from '@/domain/types';
import type { WorkWeek } from '@/domain/constants';
import type { Scenario } from '@/engine/types';
import { normalizeSettings, type FocusSettings } from '@/domain/focus';
import { normalizeWorkWeek } from '@/domain/workweek';
import { WORK_WEEK_KEY } from './settingsService';
import { FOCUS_SETTINGS_KEY } from './focusService';
import { PROFILE_KEY } from './settingsService';
import { readProfile, type Profile } from '@/domain/profile';

const FORMAT = 'focusflow-backup';
/**
 * v1: tasks + categories. v2: adds time blocks. v3: adds work sessions (time tracking).
 * v4: adds simulator scenarios and preferences (working hours, Focus Mode settings, profile).
 * v5: adds exams (exam prep planner).
 * v6: adds recurring classes (their meetings travel as event blocks).
 */
const VERSION = 6;

interface Preferences {
  workWeek?: WorkWeek;
  focusSettings?: FocusSettings;
  profile?: Profile;
}

interface Backup {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  categories: Category[];
  tasks: Task[];
  blocks?: TimeBlock[];
  sessions?: WorkSession[];
  scenarios?: Scenario[];
  exams?: Exam[];
  classes?: ClassMeeting[];
  preferences?: Preferences;
}

export async function buildBackup(): Promise<Backup> {
  const [categories, tasks, blocks, sessions, scenarios, exams, classes, workWeek, focusSettings, profile] = await Promise.all([
    db.categories.toArray(),
    db.tasks.toArray(),
    db.blocks.toArray(),
    db.sessions.toArray(),
    db.scenarios.toArray(),
    db.exams.toArray(),
    db.classes.toArray(),
    db.meta.get(WORK_WEEK_KEY),
    db.meta.get(FOCUS_SETTINGS_KEY),
    db.meta.get(PROFILE_KEY),
  ]);
  const preferences: Preferences = {
    ...(workWeek ? { workWeek: workWeek.value as WorkWeek } : {}),
    ...(focusSettings ? { focusSettings: focusSettings.value as FocusSettings } : {}),
    ...(profile ? { profile: profile.value as Profile } : {}),
  };
  return { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), categories, tasks, blocks, sessions, scenarios, exams, classes, preferences };
}

/** Download the workspace as JSON. Returns the number of tasks exported. */
export async function exportWorkspace(): Promise<number> {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `focusflow-${backup.exportedAt.slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return backup.tasks.length;
}

function isTask(t: unknown): t is Task {
  const x = t as Task;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.seq === 'number' &&
    typeof x.title === 'string' &&
    typeof x.categoryId === 'string' &&
    ['todo', 'in_progress', 'done'].includes(x.status) &&
    [0, 1, 2, 3].includes(x.priority) &&
    [1, 2, 3].includes(x.difficulty) &&
    typeof x.estimate === 'number' &&
    typeof x.deadline === 'number' &&
    (x.dependsOn === undefined || (Array.isArray(x.dependsOn) && x.dependsOn.every((d) => typeof d === 'string')))
  );
}

function isCategory(c: unknown): c is Category {
  const x = c as Category;
  return !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.color === 'string';
}

function isBlock(b: unknown): b is TimeBlock {
  const x = b as TimeBlock;
  return (
    !!x &&
    typeof x.id === 'string' &&
    (x.kind === 'task' || x.kind === 'event') &&
    typeof x.start === 'number' &&
    typeof x.end === 'number' &&
    x.end > x.start &&
    (x.kind === 'event' ? typeof x.title === 'string' : typeof x.taskId === 'string')
  );
}

function isSession(s: unknown): s is WorkSession {
  const x = s as WorkSession;
  return !!x && typeof x.id === 'string' && typeof x.taskId === 'string' && typeof x.start === 'number' && typeof x.end === 'number' && x.end > x.start;
}

function isClass(c: unknown): c is ClassMeeting {
  const x = c as ClassMeeting;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.categoryId === 'string' &&
    typeof x.kind === 'string' &&
    Array.isArray(x.days) &&
    x.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    typeof x.start === 'number' &&
    typeof x.end === 'number' &&
    x.end > x.start
  );
}

function isExam(e: unknown): e is Exam {
  const x = e as Exam;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.title === 'string' &&
    typeof x.categoryId === 'string' &&
    typeof x.start === 'number' &&
    typeof x.duration === 'number' &&
    typeof x.prepTarget === 'number' &&
    Array.isArray(x.topics) &&
    x.topics.every((t) => !!t && typeof t.id === 'string' && typeof t.name === 'string' && [1, 2, 3].includes(t.confidence))
  );
}

function isScenario(s: unknown): s is Scenario {
  const x = s as Scenario;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    ['draft', 'applied', 'discarded'].includes(x.status) &&
    !!x.baseline &&
    Array.isArray(x.baseline.tasks) &&
    x.baseline.tasks.every(isTask) &&
    Array.isArray(x.baseline.blocks) &&
    x.baseline.blocks.every(isBlock) &&
    Array.isArray(x.ops) &&
    x.ops.every((o) => !!o && typeof o.id === 'string' && !!o.op && typeof o.op.type === 'string')
  );
}

/** Replace the workspace with a backup. Validates everything before writing anything. */
export async function importWorkspace(json: string): Promise<number> {
  let data: Backup;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  if (data?.format !== FORMAT) throw new Error('Not a FocusFlow backup file.');
  if (data.version > VERSION) throw new Error('This backup was made by a newer version of FocusFlow.');
  if (!Array.isArray(data.tasks) || !data.tasks.every(isTask)) throw new Error('Backup contains malformed tasks.');
  if (!Array.isArray(data.categories) || !data.categories.every(isCategory)) throw new Error('Backup contains malformed categories.');
  const rawBlocks = data.blocks ?? [];
  if (!Array.isArray(rawBlocks) || !rawBlocks.every(isBlock)) throw new Error('Backup contains malformed schedule blocks.');
  const rawSessions = data.sessions ?? [];
  if (!Array.isArray(rawSessions) || !rawSessions.every(isSession)) throw new Error('Backup contains malformed time entries.');
  const scenarios = data.scenarios ?? [];
  const exams = data.exams ?? [];
  if (!Array.isArray(exams) || !exams.every(isExam)) throw new Error('Backup contains malformed exams.');
  const classes = data.classes ?? [];
  if (!Array.isArray(classes) || !classes.every(isClass)) throw new Error('Backup contains malformed classes.');
  if (!Array.isArray(scenarios) || !scenarios.every(isScenario)) throw new Error('Backup contains malformed scenarios.');
  let workWeek: WorkWeek | undefined;
  try {
    workWeek = data.preferences?.workWeek === undefined ? undefined : normalizeWorkWeek(data.preferences.workWeek);
  } catch {
    throw new Error('Backup contains malformed working hours.');
  }
  const focusSettings = data.preferences?.focusSettings === undefined ? undefined : normalizeSettings(data.preferences.focusSettings);
  const profile = data.preferences?.profile === undefined ? undefined : readProfile(data.preferences.profile);

  const tasks = data.tasks.map((t) => ({ ...t, notes: t.notes ?? '', completedAt: t.completedAt ?? null }));
  const taskIds = new Set(tasks.map((t) => t.id));
  // Drop orphaned task blocks rather than importing dangling references.
  const blocks = rawBlocks
    .filter((b) => b.kind === 'event' || taskIds.has(b.taskId!))
    .map((b) => ({ ...b, taskId: b.kind === 'task' ? b.taskId : null, title: b.title ?? '' }));
  const sessions = rawSessions
    .filter((s) => taskIds.has(s.taskId))
    .map((s) => ({ ...s, source: s.source === 'timer' ? ('timer' as const) : ('manual' as const), createdAt: s.createdAt ?? s.end }));

  await db.transaction('rw', [db.tasks, db.categories, db.blocks, db.sessions, db.scenarios, db.meta, db.exams, db.classes], async () => {
    await db.tasks.clear();
    await db.categories.clear();
    await db.blocks.clear();
    await db.sessions.clear();
    // Scenarios are snapshots of the old workspace; an older backup without them leaves none.
    await db.scenarios.clear();
    await db.scenarios.bulkAdd(scenarios);
    await db.exams.clear();
    await db.classes.clear();
    await db.classes.bulkAdd(classes.map((c) => ({ ...c, location: c.location ?? '' })));
    await db.exams.bulkAdd(exams.map((x) => ({ ...x, location: x.location ?? '', notes: x.notes ?? '' })));
    // Preferences are only replaced when the backup carries them.
    if (workWeek) await db.meta.put({ key: WORK_WEEK_KEY, value: workWeek });
    if (focusSettings) await db.meta.put({ key: FOCUS_SETTINGS_KEY, value: focusSettings });
    if (profile) await db.meta.put({ key: PROFILE_KEY, value: profile });
    await db.meta.delete('activeTimer');
    await db.meta.delete('focusSession');
    await db.categories.bulkAdd(data.categories);
    await db.tasks.bulkAdd(tasks);
    await db.blocks.bulkAdd(blocks);
    await db.sessions.bulkAdd(sessions);
    await db.meta.put({ key: 'taskSeq', value: tasks.reduce((m, t) => Math.max(m, t.seq), 0) });
  });
  return tasks.length;
}
