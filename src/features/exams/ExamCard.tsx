import { useState } from 'react';
import { useNavigate } from 'react-router';
import { differenceInCalendarDays, format } from 'date-fns';
import { AlertTriangle, Check, ChevronDown, Crosshair, MapPin, MoreHorizontal, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PrepProgress, PrepStatus } from '@/domain/exam';
import type { TaskSchedule } from '@/domain/schedule';
import type { Category, Exam, ID, Task } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { taskActions } from '@/features/tasks/actions';
import { focusOn } from '@/features/focus/actions';
import { Button, IconButton } from '@/ui/Button';
import { Meter } from '@/ui/Data';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/ui/Menu';
import { Tooltip } from '@/ui/Tooltip';
import { ConfidencePicker } from './ExamEditor';
import { examActions } from './actions';
import { useExamEditor } from './store';

const STATUS: Record<PrepStatus, { label: string; tone: string }> = {
  'no-plan': { label: 'No study plan', tone: 'text-fg-subtle border-line-strong' },
  'on-track': { label: 'On track', tone: 'text-positive border-[rgb(61_184_139/0.35)] bg-positive-muted' },
  behind: { label: 'Behind', tone: 'text-warning border-[rgb(217_164_65/0.35)] bg-warning-muted' },
  ready: { label: 'Ready', tone: 'text-positive border-[rgb(61_184_139/0.35)] bg-positive-muted' },
  past: { label: 'Done', tone: 'text-fg-subtle border-line-strong' },
};

export function countdown(start: number, now: number): string {
  const days = differenceInCalendarDays(start, now);
  if (start < now) return 'Started';
  if (days === 0) return `Today ${format(start, 'HH:mm')}`;
  if (days === 1) return `Tomorrow ${format(start, 'HH:mm')}`;
  return `in ${days} days`;
}

/** Strip the "Midterm 2: " prefix from a study-session title. */
const sessionLabel = (exam: Exam, t: Task) => (t.title.startsWith(`${exam.title}: `) ? t.title.slice(exam.title.length + 2) : t.title);

export function ExamCard({
  exam,
  category,
  progress,
  sessions,
  schedule,
  now,
}: {
  exam: Exam;
  category?: Category;
  progress: PrepProgress;
  sessions: Task[];
  schedule: Map<ID, TaskSchedule>;
  now: number;
}) {
  const navigate = useNavigate();
  const openEditor = useExamEditor((s) => s.open);
  const [expanded, setExpanded] = useState(false);
  const color = categoryColor(category);
  const st = STATUS[progress.status];
  const soon = differenceInCalendarDays(exam.start, now) <= 2 && exam.start > now;
  const next = progress.next;

  return (
    <article aria-label={`${exam.title}, ${category?.name ?? ''}`} className="relative overflow-hidden rounded-md border border-line bg-panel">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden />
      <div className="flex flex-col gap-3 py-3.5 pl-5 pr-3.5">
        {/* Heading */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold tracking-tight text-fg">{exam.title}</h2>
              <span className={cn('shrink-0 rounded-xs border px-1.5 py-px text-2xs font-medium', st.tone)}>{st.label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
              <span className="text-fg-muted">{category?.name ?? 'Deleted course'}</span>
              <span className="text-fg-faint">·</span>
              <span className="num">{format(exam.start, 'EEE MMM d · HH:mm')}</span>
              <span className="text-fg-faint">·</span>
              <span className="num">{formatDuration(exam.duration, { compact: true })}</span>
              {exam.location && (
                <>
                  <span className="text-fg-faint">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} /> {exam.location}
                  </span>
                </>
              )}
            </div>
          </div>
          <span className={cn('num shrink-0 rounded-sm px-2 py-0.5 text-sm font-medium', soon ? 'bg-warning-muted text-warning' : 'bg-active text-fg')}>{countdown(exam.start, now)}</span>
          <Menu>
            <MenuTrigger asChild>
              <IconButton icon={MoreHorizontal} size="sm" label={`More for ${exam.title}`} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={Pencil} onSelect={() => openEditor({ mode: 'edit', id: exam.id })}>
                Edit exam
              </MenuItem>
              <MenuItem icon={RefreshCw} onSelect={() => void examActions.plan(exam.id)}>
                {sessions.length ? 'Re-plan studying' : 'Plan studying'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={Trash2} destructive onSelect={() => void examActions.remove(exam.id)}>
                Delete exam
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>

        {/* Progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-fg-subtle">
              <span className="num text-fg">{formatDuration(progress.done, { compact: true })}</span> of{' '}
              <span className="num">{formatDuration(progress.target, { compact: true })}</span> prepared
            </span>
            {progress.missed.length > 0 && progress.status !== 'past' && (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle size={11} /> {progress.missed.length} missed session{progress.missed.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <Meter value={progress.done} max={progress.target} color={progress.status === 'behind' ? 'var(--color-warning)' : progress.status === 'ready' ? 'var(--color-positive)' : color} height={5} />
        </div>

        {/* Topics */}
        {exam.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {exam.topics.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-raised py-0.5 pl-2 pr-0.5 text-xs text-fg-muted">
                {t.name}
                <ConfidencePicker size="sm" value={t.confidence} topic={t.name} onChange={(c) => void examActions.setConfidence(exam, t.id, c)} />
              </span>
            ))}
          </div>
        )}

        {/* Next / plan */}
        {progress.status !== 'past' && (
          <div className="flex flex-wrap items-center gap-2">
            {next ? (
              <>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                  <span className="text-fg-subtle">Next: </span>
                  <span className="num text-fg">{format(next.deadline, 'EEE MMM d')}</span> · {formatDuration(next.estimate, { compact: true })} · {sessionLabel(exam, next)}
                </span>
                <Button size="sm" variant="secondary" icon={Crosshair} onClick={() => void focusOn(next.id, navigate)}>
                  Focus
                </Button>
              </>
            ) : progress.status === 'no-plan' ? (
              <>
                <span className="min-w-0 flex-1 text-sm text-fg-subtle">No study sessions yet. FocusFlow can spread {formatDuration(exam.prepTarget, { compact: true })} of prep over the days before.</span>
                <Button size="sm" variant="primary" icon={Sparkles} onClick={() => void examActions.plan(exam.id)}>
                  Plan studying
                </Button>
              </>
            ) : progress.status === 'ready' ? (
              <span className="flex-1 text-sm text-positive">You’ve put in the prep you planned. Get some sleep before the exam.</span>
            ) : (
              <>
                <span className="min-w-0 flex-1 text-sm text-fg-subtle">No sessions left before the exam.</span>
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void examActions.plan(exam.id)}>
                  Re-plan
                </Button>
              </>
            )}
            {progress.status === 'behind' && (
              <Tooltip content="Re-spread the prep that's left over the remaining days">
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void examActions.plan(exam.id)}>
                  Catch up
                </Button>
              </Tooltip>
            )}
          </div>
        )}

        {/* Sessions */}
        {sessions.length > 0 && (
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setExpanded((x) => !x)}
              aria-expanded={expanded}
              className="focus-ring -ml-1 flex w-fit items-center gap-1 rounded-xs px-1 text-xs text-fg-subtle hover:text-fg-muted"
            >
              <ChevronDown size={12} className={cn('transition-transform', !expanded && '-rotate-90')} />
              {sessions.length} study session{sessions.length === 1 ? '' : 's'} · {sessions.filter((s) => s.status === 'done').length} done
            </button>
            {expanded && (
              <ul className="mt-1.5 flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
                {sessions.map((t) => {
                  const done = t.status === 'done';
                  const missed = !done && t.deadline < now;
                  const sched = schedule.get(t.id);
                  return (
                    <li key={t.id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        aria-label={`${done ? 'Reopen' : 'Complete'} ${t.title}`}
                        onClick={() => void taskActions.toggleComplete(t.id)}
                        className={cn('focus-ring grid size-4 shrink-0 place-items-center rounded-full border', done ? 'border-positive bg-positive text-canvas' : 'border-line-strong hover:border-fg-subtle')}
                      >
                        {done && <Check size={10} strokeWidth={3} />}
                      </button>
                      <span className="num w-[74px] shrink-0 text-fg-muted">{format(t.deadline, 'EEE MMM d')}</span>
                      <span className={cn('min-w-0 flex-1 truncate', done ? 'text-fg-subtle line-through' : 'text-fg')}>{sessionLabel(exam, t)}</span>
                      <span className="num shrink-0 text-fg-subtle">{formatDuration(t.estimate, { compact: true })}</span>
                      <span className={cn('w-16 shrink-0 text-right', missed ? 'text-warning' : 'text-fg-subtle')}>
                        {done ? 'Done' : missed ? 'Missed' : sched && sched.minutes > 0 ? (sched.next ? format(sched.next, 'HH:mm') : 'Scheduled') : 'Unplaced'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
