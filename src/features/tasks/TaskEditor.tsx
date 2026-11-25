import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, nextFriday, nextMonday } from 'date-fns';
import { CalendarClock, CalendarDays, CalendarPlus, Clock, Copy, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { durationMinutes } from '@/domain/schedule';
import { blockActions } from '@/features/timeline/actions';
import { useUI } from '@/app/store';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { DIFFICULTIES, PRIORITIES, STATUSES, taskRef } from '@/domain/constants';
import { combineDateTime, splitDateTime } from '@/domain/dates';
import { isValid, parseEstimate, validateDraft, type DraftErrors } from '@/domain/validation';
import type { Difficulty, ID, Priority, Task, TaskDraft, TaskStatus } from '@/domain/types';
import { useCategories, useTask, useTaskBlocks, useTasks } from '@/hooks/data';
import { RecommendationSection } from '@/features/scheduling/Recommendation';
import { DependencyField } from './DependencyField';
import { EstimateHint, TimeSection } from '@/features/tracking/TimeSection';
import { Dialog } from '@/ui/Dialog';
import { Button, IconButton } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { SegmentedControl } from '@/ui/Data';
import { Kbd, MOD } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';
import { Skeleton } from '@/ui/Feedback';
import { taskActions } from './actions';
import { CategorySwatch, DifficultyDots, PriorityIcon } from './TaskMeta';

interface FormState {
  title: string;
  notes: string;
  categoryId: string;
  priority: Priority;
  difficulty: Difficulty;
  estimateText: string;
  date: string;
  time: string;
  status: TaskStatus;
  dependsOn: ID[];
}

const NEW_CATEGORY = '__new__';

const liveIds = (ids: ID[], tasks: Task[] | undefined) => ids.filter((id) => tasks?.some((t) => t.id === id));

function defaultDeadline(): number {
  const d = addDays(new Date(), 1);
  d.setHours(17, 0, 0, 0);
  return d.getTime();
}

function toForm(t: Partial<TaskDraft> & { status?: TaskStatus }, fallbackCategory: string): FormState {
  const { date, time } = splitDateTime(t.deadline ?? defaultDeadline());
  return {
    title: t.title ?? '',
    notes: t.notes ?? '',
    categoryId: t.categoryId ?? fallbackCategory,
    priority: t.priority ?? 2,
    difficulty: t.difficulty ?? 2,
    estimateText: t.estimate ? formatDuration(t.estimate, { compact: true }) : '1h',
    date,
    time,
    status: t.status ?? 'todo',
    dependsOn: t.dependsOn ?? [],
  };
}

function toDraft(f: FormState): Partial<TaskDraft> {
  return {
    title: f.title,
    notes: f.notes,
    categoryId: f.categoryId,
    priority: f.priority,
    difficulty: f.difficulty,
    estimate: parseEstimate(f.estimateText) ?? undefined,
    deadline: combineDateTime(f.date, f.time) ?? undefined,
    status: f.status,
    dependsOn: f.dependsOn,
  };
}

const quickDates = () => {
  const now = new Date();
  return [
    { label: 'Today', date: now },
    { label: 'Tomorrow', date: addDays(now, 1) },
    { label: 'Friday', date: nextFriday(addDays(now, -1)) },
    { label: 'Next week', date: nextMonday(now) },
  ];
};

/** Global create/edit dialog, driven by `useUI().editor`. */
export function TaskEditor() {
  const editor = useUI((s) => s.editor);
  const close = useUI((s) => s.closeEditor);
  const editId = editor?.mode === 'edit' ? editor.id : null;
  const task = useTask(editId);
  const categories = useCategories();

  // Editing a task that was deleted elsewhere (e.g. another tab) — close gracefully.
  useEffect(() => {
    if (editId && task === null) close();
  }, [editId, task, close]);

  const open = editor !== null;
  const ready = categories !== undefined && (editor?.mode !== 'edit' || !!task);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={editor?.mode === 'edit' ? (task ? `Edit ${taskRef(task.seq)}` : 'Edit task') : 'New task'}
      description={
        editor?.mode === 'edit'
          ? task
            ? `Created ${format(task.createdAt, 'MMM d, HH:mm')} · updated ${format(task.updatedAt, 'MMM d, HH:mm')}`
            : undefined
          : 'Every task needs an estimate and a deadline so FocusFlow can weigh it against your capacity.'
      }
      width="lg"
    >
      {open && !ready && <EditorSkeleton />}
      {open && ready && (
        <EditorForm
          // Remount when switching between tasks so state re-initialises.
          key={editor?.mode === 'edit' ? editor.id : 'create'}
          mode={editor!.mode}
          task={task ?? undefined}
          defaults={editor?.mode === 'create' ? editor.defaults : undefined}
          categories={categories!}
          onDone={close}
        />
      )}
    </Dialog>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-8 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-7" />
        <Skeleton className="h-7" />
        <Skeleton className="h-7" />
        <Skeleton className="h-7" />
      </div>
      <Skeleton className="h-16" />
    </div>
  );
}

function EditorForm({
  mode,
  task,
  defaults,
  categories,
  onDone,
}: {
  mode: 'create' | 'edit';
  task?: Task;
  defaults?: Partial<TaskDraft>;
  categories: NonNullable<ReturnType<typeof useCategories>>;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(task ?? defaults ?? {}, categories[0]?.id ?? ''));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCat, setNewCat] = useState<string | null>(categories.length === 0 ? '' : null);
  const titleRef = useRef<HTMLInputElement>(null);
  const allTasks = useTasks();

  const draft = toDraft(form);
  const errors: DraftErrors = useMemo(() => {
    const e = validateDraft(draft);
    if (form.estimateText.trim() && parseEstimate(form.estimateText) === null) e.estimate = 'Try “90”, “1h30” or “2.5h”.';
    return e;
  }, [draft, form.estimateText]);
  const show = (k: keyof DraftErrors) => (submitted ? errors[k] : undefined);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const estimate = parseEstimate(form.estimateText);
  // The recommendation reflects the saved task; flag it while scheduling-relevant fields are edited.
  const stale =
    !!task &&
    (draft.estimate !== task.estimate ||
      draft.deadline !== task.deadline ||
      draft.priority !== task.priority ||
      draft.difficulty !== task.difficulty ||
      draft.status !== task.status ||
      liveIds(task.dependsOn ?? [], allTasks).join() !== liveIds(form.dependsOn, allTasks).join());

  const submit = async () => {
    setSubmitted(true);
    if (newCat !== null && newCat.trim()) {
      // Pending category name typed but not confirmed — create it first.
      const c = await taskActions.createCategory(newCat);
      if (!c) return;
      setForm((f) => ({ ...f, categoryId: c.id }));
      setNewCat(null);
      draft.categoryId = c.id;
    }
    const finalErrors = validateDraft(draft);
    if (!isValid(finalErrors) || (form.estimateText.trim() && estimate === null)) {
      if (finalErrors.title) titleRef.current?.focus();
      return;
    }
    setSaving(true);
    const ok =
      mode === 'create' ? await taskActions.create(draft as TaskDraft) : await taskActions.update(task!.id, draft);
    setSaving(false);
    if (ok) onDone();
  };

  const confirmNewCategory = async () => {
    if (!newCat?.trim()) return;
    const c = await taskActions.createCategory(newCat);
    if (c) {
      set('categoryId', c.id);
      setNewCat(null);
    }
  };

  return (
    <form
      noValidate
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
        {/* Title */}
        <Field label="Title" error={show('title')}>
          {(id) => (
            <Input
              id={id}
              ref={titleRef}
              autoFocus={mode === 'create'}
              size="lg"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="e.g. Draft pricing page copy"
              aria-invalid={!!show('title')}
              maxLength={200}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Category */}
          <Field label="Category" error={show('categoryId')}>
            {(id) =>
              newCat !== null ? (
                <div className="flex gap-1.5">
                  <Input
                    id={id}
                    autoFocus
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                    placeholder="New category name"
                    maxLength={40}
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        void confirmNewCategory();
                      }
                      if (e.key === 'Escape' && categories.length) {
                        e.preventDefault();
                        e.stopPropagation();
                        setNewCat(null);
                      }
                    }}
                  />
                  <Button onClick={() => void confirmNewCategory()} disabled={!newCat.trim()}>
                    Add
                  </Button>
                </div>
              ) : (
                <Select
                  id={id}
                  value={form.categoryId}
                  onValueChange={(v) => (v === NEW_CATEGORY ? setNewCat('') : set('categoryId', v))}
                  options={[
                    ...categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> })),
                    { value: NEW_CATEGORY, label: 'New category…', leading: <Plus size={12} className="text-fg-subtle" /> },
                  ]}
                />
              )
            }
          </Field>

          {/* Priority */}
          <Field label="Priority">
            {(id) => (
              <Select
                id={id}
                value={String(form.priority)}
                onValueChange={(v) => set('priority', Number(v) as Priority)}
                options={([0, 1, 2, 3] as Priority[]).map((p) => ({
                  value: String(p),
                  label: PRIORITIES[p].label,
                  leading: <PriorityIcon priority={p} withTooltip={false} />,
                  hint: String(p + 1),
                }))}
              />
            )}
          </Field>

          {/* Estimate */}
          <Field
            label="Estimate"
            error={show('estimate')}
            hint={
              <span className="flex flex-col gap-0.5">
                <span>{estimate !== null && !errors.estimate ? `= ${formatDuration(estimate)}` : 'e.g. 45, 1h30, 2.5h'}</span>
                {!errors.estimate && (
                  <EstimateHint
                    categoryId={form.categoryId}
                    difficulty={form.difficulty}
                    estimate={estimate}
                    taskId={task?.id}
                    onUse={(m) => set('estimateText', formatDuration(m, { compact: true }))}
                  />
                )}
              </span>
            }
          >
            {(id) => (
              <Input
                id={id}
                icon={Clock}
                value={form.estimateText}
                onChange={(e) => set('estimateText', e.target.value)}
                onBlur={() => estimate !== null && set('estimateText', formatDuration(estimate, { compact: true }))}
                aria-invalid={!!show('estimate')}
                className="[&_input]:num"
              />
            )}
          </Field>

          {/* Deadline */}
          <Field label="Deadline" error={show('deadline')}>
            {(id) => (
              <div className="flex gap-1.5">
                <Input
                  id={id}
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                  aria-invalid={!!show('deadline')}
                  className="flex-1 [&_input]:num"
                />
                <Input
                  type="time"
                  aria-label="Deadline time"
                  value={form.time}
                  onChange={(e) => set('time', e.target.value)}
                  className="w-[124px] [&_input]:num"
                />
              </div>
            )}
          </Field>
        </div>

        {/* Deadline quick picks */}
        <div className="-mt-2 flex flex-wrap items-center gap-1.5 sm:pl-[calc(50%+8px)]">
          {quickDates().map((q) => {
            const value = format(q.date, 'yyyy-MM-dd');
            const active = form.date === value;
            return (
              <button
                key={q.label}
                type="button"
                onClick={() => set('date', value)}
                className={cn(
                  'focus-ring flex h-5 items-center gap-1 rounded-xs border px-1.5 text-2xs transition-colors',
                  active ? 'border-line-focus bg-accent-muted text-fg' : 'border-line text-fg-subtle hover:border-line-strong hover:text-fg-muted',
                )}
              >
                {q.label === 'Today' && <CalendarDays size={10} />}
                {q.label}
              </button>
            );
          })}
        </div>

        {/* Difficulty + Status */}
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Difficulty</span>
            <div className="flex items-center gap-3">
              <SegmentedControl
                size="md"
                value={String(form.difficulty) as '1' | '2' | '3'}
                onChange={(v) => set('difficulty', Number(v) as Difficulty)}
                options={([1, 2, 3] as Difficulty[]).map((d) => ({ value: String(d) as '1' | '2' | '3', label: DIFFICULTIES[d].label }))}
              />
              <span className="hidden items-center gap-2 text-xs text-fg-subtle sm:flex">
                <DifficultyDots difficulty={form.difficulty} />
                {DIFFICULTIES[form.difficulty].hint}
              </span>
            </div>
          </div>
          {mode === 'edit' && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Status</span>
              <SegmentedControl
                size="md"
                value={form.status}
                onChange={(v) => set('status', v)}
                options={(['todo', 'in_progress', 'done'] as TaskStatus[]).map((s) => ({ value: s, label: STATUSES[s].label }))}
              />
            </div>
          )}
        </div>

        <DependencyField
          taskId={task?.id ?? null}
          value={form.dependsOn}
          onChange={(ids) => set('dependsOn', ids)}
          tasks={allTasks ?? []}
          error={show('dependsOn')}
        />

        <Field label="Notes" error={show('notes')}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Context, links, acceptance criteria…"
            />
          )}
        </Field>

        {mode === 'edit' && task && <RecommendationSection task={task} stale={stale} />}
        {mode === 'edit' && task && <TimeSection task={task} />}
        {mode === 'edit' && task && <ScheduleSection task={task} onNavigate={onDone} />}
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-[rgb(255_255_255/0.012)] px-4 py-3">
        {mode === 'edit' && task ? (
          <div className="mr-auto flex items-center gap-1">
            <Tooltip content="Duplicate" shortcut={[MOD, 'D']}>
              <IconButton
                icon={Copy}
                label="Duplicate task"
                onClick={async () => {
                  const copy = await taskActions.duplicate(task.id);
                  if (copy) useUI.getState().openEdit(copy.id);
                }}
              />
            </Tooltip>
            <Tooltip content="Delete" shortcut={['Del']}>
              <IconButton
                icon={Trash2}
                label="Delete task"
                className="hover:text-negative"
                onClick={async () => {
                  onDone();
                  await taskActions.remove([task.id]);
                }}
              />
            </Tooltip>
          </div>
        ) : (
          <span className="mr-auto hidden items-center gap-1.5 text-2xs text-fg-subtle sm:flex">
            <Kbd keys={[MOD, '↵']} /> to save
          </span>
        )}
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={saving}>
          {mode === 'create' ? 'Create task' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

/** The task's time blocks on the timeline, with links into it. */
function ScheduleSection({ task, onNavigate }: { task: Task; onNavigate: () => void }) {
  const blocks = useTaskBlocks(task.id);
  const navigate = useNavigate();
  const total = (blocks ?? []).reduce((a, b) => a + durationMinutes(b), 0);
  const go = (path: string) => {
    onNavigate();
    navigate(path);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">Schedule</span>
        {blocks && (
          <span className={cn('num text-2xs', total >= task.estimate ? 'text-positive' : 'text-fg-subtle')}>
            {formatDuration(total, { compact: true })} of {formatDuration(task.estimate, { compact: true })} blocked
          </span>
        )}
      </div>
      {blocks === undefined ? (
        <Skeleton className="h-8" />
      ) : blocks.length === 0 ? (
        <div className="flex items-center justify-between rounded-sm border border-dashed border-line-strong px-3 py-2 text-xs text-fg-subtle">
          <span>No time blocked yet.</span>
          <Button size="sm" variant="ghost" icon={CalendarPlus} onClick={() => go('/timeline')}>
            Plan in Timeline
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-sm border border-line">
          {blocks.map((b) => (
            <li key={b.id} className="group flex h-8 items-center gap-2 border-b border-line px-2.5 text-xs last:border-0 hover:bg-hover">
              <CalendarClock size={12} className={cn('shrink-0', b.end < Date.now() ? 'text-fg-faint' : 'text-fg-subtle')} />
              <button
                type="button"
                onClick={() => go(`/timeline?block=${b.id}`)}
                className="focus-ring num flex-1 truncate rounded-xs text-left text-fg-muted hover:text-fg"
              >
                {format(b.start, 'EEE MMM d')} · {format(b.start, 'HH:mm')}–{format(b.end, 'HH:mm')}
                <span className="text-fg-subtle"> · {formatDuration(durationMinutes(b), { compact: true })}</span>
                {b.end > task.deadline && <span className="text-warning"> · after deadline</span>}
              </button>
              <IconButton
                icon={X}
                label="Remove block"
                size="sm"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => void blockActions.remove([b.id], taskRef(task.seq))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
