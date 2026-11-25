/**
 * Exam prep planning. Pure: given an exam, what's already done and your working hours, decide
 * which days to study, for how long and on what — and how preparation is going.
 *
 * The plan follows a few well-established study habits:
 *  - spread it out: sessions over several days rather than one cram, denser near the exam;
 *  - weak topics more often: a topic rated 😬 comes up three times as often as one rated 😎;
 *  - test yourself: a timed practice exam a couple of days out, when there's enough prep time;
 *  - rest before: only a light review the day before, nothing on exam day.
 */
import { addDays, differenceInCalendarDays } from 'date-fns';
import type { WorkWeek } from './constants';
import { startOfLocalDay, workIntervals } from './schedule';
import type { Confidence, Exam, ExamDraft, ExamTopic, Instant, Minutes, Task } from './types';

export const EXAM_LIMITS = {
  titleMax: 80,
  topicMax: 80,
  topics: 40,
  duration: [15, 600] as const,
  prepTarget: [30, 100 * 60] as const,
};

/** Quick picks for the prep target. */
export const PREP_PRESETS: Array<{ label: string; minutes: Minutes }> = [
  { label: 'Quiz', minutes: 120 },
  { label: 'Midterm', minutes: 6 * 60 },
  { label: 'Final', minutes: 12 * 60 },
];

export const CONFIDENCE: Record<Confidence, { emoji: string; label: string; weight: number }> = {
  1: { emoji: '😬', label: 'Shaky', weight: 3 },
  2: { emoji: '🙂', label: 'Okay', weight: 2 },
  3: { emoji: '😎', label: 'Solid', weight: 1 },
};

const SESSION_TARGET = 100; // minutes per study session the plan aims for
const SESSION_MAX = 180;
const REVIEW_MAX = 60;

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export type ExamErrors = Partial<Record<'title' | 'categoryId' | 'start' | 'duration' | 'prepTarget' | 'topics', string>>;

export function validateExam(d: ExamDraft): ExamErrors {
  const e: ExamErrors = {};
  if (!d.title.trim()) e.title = 'Name the exam, e.g. “Midterm 1”.';
  else if (d.title.trim().length > EXAM_LIMITS.titleMax) e.title = 'That name is too long.';
  if (!d.categoryId) e.categoryId = 'Pick the course.';
  if (!Number.isFinite(d.start)) e.start = 'Pick the date and time.';
  if (!Number.isFinite(d.duration) || d.duration < EXAM_LIMITS.duration[0] || d.duration > EXAM_LIMITS.duration[1]) e.duration = 'Between 15 minutes and 10 hours.';
  if (!Number.isFinite(d.prepTarget) || d.prepTarget < EXAM_LIMITS.prepTarget[0] || d.prepTarget > EXAM_LIMITS.prepTarget[1]) e.prepTarget = 'Between 30 minutes and 100 hours.';
  if (d.topics.length > EXAM_LIMITS.topics) e.topics = `At most ${EXAM_LIMITS.topics} topics.`;
  else if (d.topics.some((t) => !t.name.trim() || t.name.length > EXAM_LIMITS.topicMax)) e.topics = 'Topics need a name (up to 80 characters).';
  return e;
}

/** Split pasted text into topics: one per line, or comma/semicolon separated on a single line. */
export function parseTopics(text: string): string[] {
  const parts = text.includes('\n') ? text.split('\n') : text.split(/[;,]/);
  return [...new Set(parts.map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean))].map((s) => s.slice(0, EXAM_LIMITS.topicMax));
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

export type SessionKind = 'study' | 'practice' | 'review';

export interface PlannedSession {
  /** Local midnight of the study day. */
  day: Instant;
  minutes: Minutes;
  kind: SessionKind;
  /** Topic names to focus on. */
  topics: string[];
}

export interface ExamPlan {
  sessions: PlannedSession[];
  total: Minutes;
  /** Prep still needed after what's done. */
  remaining: Minutes;
  status: 'ok' | 'tight' | 'no-time' | 'done';
  /** Plain-language note when the plan can't fit everything. */
  note: string | null;
}

export interface PlanInput {
  exam: Pick<Exam, 'start' | 'duration' | 'prepTarget' | 'topics'>;
  now: Instant;
  /** Prep already done (finished sessions, tracked time). */
  doneMinutes: Minutes;
  week: WorkWeek;
}

const round15 = (m: number) => Math.round(m / 15) * 15;
const minuteOfDay = (t: Instant) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

/** How many days before the exam to start, for this much prep. */
export function leadDays(remaining: Minutes): number {
  if (remaining <= 4 * 60) return 5;
  if (remaining <= 10 * 60) return 9;
  return 14;
}

/** Study days available: working days from today (if time is left) up to the day before the exam. */
export function studyDays(exam: Pick<Exam, 'start'>, now: Instant, remaining: Minutes, week: WorkWeek): Date[] {
  const examDay = startOfLocalDay(exam.start);
  const today = startOfLocalDay(now);
  const first = addDays(examDay, -leadDays(remaining));
  const days: Date[] = [];
  for (let d = first < today ? today : first; d < examDay; d = addDays(d, 1)) {
    const work = workIntervals(d, week);
    if (!work.length) continue;
    if (d.getTime() === today.getTime()) {
      // Today only counts if at least an hour of working time is left.
      const left = work.reduce((a, w) => a + Math.max(0, w.end - Math.max(w.start, minuteOfDay(now))), 0);
      if (left < 60) continue;
    }
    days.push(d);
  }
  return days;
}

/** Pick `n` of the candidate days, spread out and denser toward the exam; always the last one. */
export function pickDays(candidates: Date[], n: number): Date[] {
  const len = candidates.length;
  if (n >= len) return [...candidates];
  const chosen = new Set<number>([len - 1]);
  for (let k = 0; chosen.size < n && k < n * 4; k++) {
    const u = (k % n + 0.5) / n;
    let i = Math.min(len - 1, Math.floor(Math.pow(u, 0.65) * len));
    // Find the nearest free index, preferring earlier days (keeps spacing).
    for (let step = 0; chosen.has(i) && step < len; step++) i = (i - 1 + len) % len;
    chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => candidates[i]);
}

/** Spread topics over study sessions: weak topics appear more often; at most 3 per session. */
export function assignTopics(topics: ExamTopic[], sessions: number): string[][] {
  const out: string[][] = Array.from({ length: sessions }, () => []);
  if (!sessions || !topics.length) return out;
  const slots = [...topics]
    .sort((a, b) => a.confidence - b.confidence)
    .flatMap((t) => Array<string>(CONFIDENCE[t.confidence].weight).fill(t.name));
  // Spread each topic's repeats across sessions instead of bunching them.
  const order: string[] = [];
  const pending = new Map<string, number>();
  for (const s of slots) pending.set(s, (pending.get(s) ?? 0) + 1);
  while (pending.size) {
    for (const [name, left] of [...pending]) {
      order.push(name);
      if (left <= 1) pending.delete(name);
      else pending.set(name, left - 1);
    }
  }
  const cap = Math.max(3, Math.ceil(order.length / sessions));
  let s = 0;
  for (const name of order) {
    for (let tries = 0; tries < sessions; tries++) {
      const idx = (s + tries) % sessions;
      if (out[idx].length < Math.min(cap, 3) && !out[idx].includes(name)) {
        out[idx].push(name);
        s = idx + 1;
        break;
      }
    }
  }
  return out;
}

export function planExamPrep({ exam, now, doneMinutes, week }: PlanInput): ExamPlan {
  const remaining = Math.max(0, exam.prepTarget - doneMinutes);
  if (remaining < 15) return { sessions: [], total: 0, remaining: 0, status: 'done', note: null };
  if (exam.start <= now) return { sessions: [], total: 0, remaining, status: 'no-time', note: 'This exam has already started.' };

  const days = studyDays(exam, now, remaining, week);
  if (!days.length) {
    return { sessions: [], total: 0, remaining, status: 'no-time', note: 'No working time is left before the exam — study outside your usual hours, or adjust them in Settings.' };
  }

  const n = Math.max(1, Math.min(days.length, Math.ceil(remaining / SESSION_TARGET), 12));
  const picked = pickDays(days, Math.max(n, Math.min(days.length, 2)));
  const count = picked.length;

  // Session kinds: the last is a light review (if there are 3+), the one before a practice exam (if there's time).
  const kinds: SessionKind[] = picked.map(() => 'study');
  const dayBefore = differenceInCalendarDays(startOfLocalDay(exam.start), picked[count - 1]) === 1;
  if (count >= 3 && dayBefore) kinds[count - 1] = 'review';
  if (count >= 3 && remaining >= 4 * 60) kinds[kinds[count - 1] === 'review' ? count - 2 : count - 1] = 'practice';

  // Minutes: fixed for review and practice; the rest over study sessions, growing toward the exam.
  // A practice exam is as long as the real one, but never more than ~30% of the prep.
  const review = Math.min(REVIEW_MAX, Math.max(30, round15(remaining * 0.1)));
  const practice = Math.min(SESSION_MAX, Math.max(60, round15(Math.min(exam.duration, remaining * 0.3))));
  const minutes: number[] = kinds.map((k) => (k === 'review' ? review : k === 'practice' ? practice : 0));
  const studyIdx = kinds.map((k, i) => (k === 'study' ? i : -1)).filter((i) => i >= 0);
  const forStudy = Math.max(0, remaining - minutes.reduce((a, b) => a + b, 0));
  const weights = studyIdx.map((_, j) => 1 + (studyIdx.length > 1 ? (0.6 * j) / (studyIdx.length - 1) : 0));
  const wsum = weights.reduce((a, b) => a + b, 0);
  studyIdx.forEach((i, j) => (minutes[i] = Math.min(SESSION_MAX, Math.max(30, round15((forStudy * weights[j]) / wsum)))));
  if (!studyIdx.length && forStudy > 0) {
    // Only review/practice slots: grow the practice session to absorb what's left.
    const p = kinds.indexOf('practice');
    if (p >= 0) minutes[p] = Math.min(SESSION_MAX, minutes[p] + round15(forStudy));
  }

  const topicLists = assignTopics(exam.topics, studyIdx.length);
  const weakest = [...exam.topics].sort((a, b) => a.confidence - b.confidence).slice(0, 3).map((t) => t.name);
  const sessions: PlannedSession[] = picked.map((d, i) => ({
    day: d.getTime(),
    minutes: minutes[i],
    kind: kinds[i],
    topics: kinds[i] === 'study' ? topicLists[studyIdx.indexOf(i)] : kinds[i] === 'review' ? weakest : [],
  }));

  const total = sessions.reduce((a, s) => a + s.minutes, 0);
  const tight = total < remaining * 0.9;
  return {
    sessions,
    total,
    remaining,
    status: tight ? 'tight' : 'ok',
    note: tight
      ? `Only ${Math.round(total / 60)}h of the ${Math.round(remaining / 60)}h you wanted fits before the exam, at up to 3h a day. Start sooner next time, or add study time outside your usual hours.`
      : null,
  };
}

/** Task title for a planned session. */
export function sessionTitle(examTitle: string, s: Pick<PlannedSession, 'kind' | 'topics'>): string {
  if (s.kind === 'practice') return `${examTitle}: practice exam`;
  if (s.kind === 'review') return `${examTitle}: light review`;
  const topics = s.topics.length ? s.topics.join(', ') : 'lectures & notes';
  const title = `${examTitle}: study ${topics}`;
  return title.length > 140 ? `${title.slice(0, 137)}…` : title;
}

/** Task notes for a planned session. */
export function sessionNotes(s: Pick<PlannedSession, 'kind' | 'topics'>): string {
  if (s.kind === 'practice') return 'Do a full practice exam under timed conditions, then check your answers and note what to review.';
  if (s.kind === 'review') return `Light review only: skim your summary sheet${s.topics.length ? ` and ${s.topics.join(', ')}` : ''}. Get some sleep.`;
  return s.topics.length
    ? `Active recall: work problems and explain ${s.topics.join(', ')} without notes, then check.`
    : 'Go through lecture slides and notes; write down what you can’t explain yet.';
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                   */
/* -------------------------------------------------------------------------- */

export type PrepStatus = 'no-plan' | 'on-track' | 'behind' | 'ready' | 'past';

export interface PrepProgress {
  done: Minutes;
  target: Minutes;
  /** Prep scheduled in sessions (done or not). */
  planned: Minutes;
  /** Sessions whose day has passed without being finished. */
  missed: Task[];
  /** Next unfinished session. */
  next: Task | null;
  status: PrepStatus;
  /** 0–1. */
  ratio: number;
}

/**
 * How preparation is going. `tracked` gives time logged on each prep task; a finished session
 * counts at least its estimate, an unfinished one counts the time tracked on it.
 */
export function examProgress(exam: Pick<Exam, 'start' | 'prepTarget'>, prepTasks: Task[], tracked: ReadonlyMap<string, Minutes>, now: Instant): PrepProgress {
  let done = 0;
  for (const t of prepTasks) {
    const time = tracked.get(t.id) ?? 0;
    done += Math.min(t.estimate * 1.5, t.status === 'done' ? Math.max(t.estimate, time) : time);
  }
  done = Math.round(done);
  const open = prepTasks.filter((t) => t.status !== 'done').sort((a, b) => a.deadline - b.deadline);
  const missed = open.filter((t) => t.deadline < now);
  const next = open.find((t) => t.deadline >= now) ?? null;
  const planned = prepTasks.reduce((a, t) => a + t.estimate, 0);
  const status: PrepStatus =
    exam.start <= now ? 'past' : done >= exam.prepTarget - 5 ? 'ready' : !prepTasks.length ? 'no-plan' : missed.length ? 'behind' : 'on-track';
  return { done, target: exam.prepTarget, planned, missed, next, status, ratio: Math.min(1, done / exam.prepTarget) };
}
