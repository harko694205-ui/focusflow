import { useMemo, useRef, useState } from 'react';
import { addDays, format, isSameDay } from 'date-fns';
import { CalendarClock, Check, CornerDownLeft, Flag, SlidersHorizontal, Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUI } from '@/app/store';
import { learnEstimate, parseCapture, type LearnedEstimate } from '@/domain/capture';
import { WORK, workKind } from '@/domain/canvas';
import { taskRef } from '@/domain/constants';
import type { Category, ID, Task } from '@/domain/types';
import { formatDuration } from '@/lib/format';
import { useCategories, useProfile, useSessions, useTasks, useTerms } from '@/hooks/data';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Kbd } from '@/ui/Kbd';
import { Select } from '@/ui/Select';
import { CategorySwatch } from './TaskMeta';
import { taskActions } from './actions';

/** Quick add: type one line, press Enter. Opened by C, the New task buttons and the Home Screen shortcut. */
export function QuickCapture() {
  const open = useUI((s) => s.captureOpen);
  const setOpen = useUI((s) => s.setCapture);
  return open ? <CaptureDialog onClose={() => setOpen(false)} /> : null;
}

const EXAMPLES = ['econ ps4 fri 2h', 'read ch 5 for mgmt tmr', 'email TA about regrade !'];

function tomorrowAt(dueTime: string): number {
  const d = addDays(new Date(), 1);
  const [h, m] = dueTime.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function dueText(t: number): string {
  const now = new Date();
  const day = isSameDay(t, now) ? 'Today' : isSameDay(t, addDays(now, 1)) ? 'Tomorrow' : format(t, 'EEE MMM d');
  return `${day} · ${format(t, 'HH:mm')}`;
}

function estimateHint(l: LearnedEstimate, course: Category | undefined): string {
  if (l.basis === 'course') return `like your last ${l.samples} ${course?.name ?? ''} ${l.label}`.replace(/\s+/g, ' ');
  if (l.basis === 'kind') return `typical for your ${l.label}`;
  return 'a first guess';
}

function CaptureDialog({ onClose }: { onClose: () => void }) {
  const categories = useCategories() ?? [];
  const tasks = useTasks();
  const sessions = useSessions();
  const profile = useProfile();
  const terms = useTerms();
  const lastCourse = useUI((s) => s.captureCourse);
  const setLastCourse = useUI((s) => s.setCaptureCourse);
  const openCreate = useUI((s) => s.openCreate);
  const [text, setText] = useState('');
  const [course, setCourse] = useState<ID | null>(null);
  const [added, setAdded] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseCapture(text, { categories, now: Date.now(), dueTime: profile.dueTime }), [text, categories, profile.dueTime]);
  const ids = new Set(categories.map((c) => c.id));
  const categoryId = course ?? parsed.categoryId ?? (lastCourse && ids.has(lastCourse) ? lastCourse : (categories[0]?.id ?? null));
  const category = categories.find((c) => c.id === categoryId);
  const actual = useMemo(() => {
    const m = new Map<ID, number>();
    for (const s of sessions ?? []) m.set(s.taskId, (m.get(s.taskId) ?? 0) + (s.end - s.start) / 60_000);
    return m;
  }, [sessions]);
  const learned = useMemo(() => learnEstimate(parsed.title, categoryId, tasks ?? [], actual), [parsed.title, categoryId, tasks, actual]);
  const estimate = parsed.estimate ?? learned.estimate;
  const deadline = parsed.deadline ?? tomorrowAt(profile.dueTime);
  const priority = parsed.priority ?? 2;
  const ready = !!parsed.title && !!categoryId;

  const draft = () => ({ title: parsed.title, notes: '', categoryId: categoryId!, priority, difficulty: WORK[workKind(parsed.title)].difficulty, estimate, deadline });

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const t = await taskActions.create(draft());
    setBusy(false);
    if (!t) return;
    setLastCourse(t.categoryId);
    setAdded((xs) => [t, ...xs].slice(0, 4));
    setText('');
    setCourse(null);
    inputRef.current?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Quick add"
      width="lg"
      footer={
        <>
          <span className="mr-auto hidden items-center gap-3 text-2xs text-fg-subtle sm:flex">
            <span className="flex items-center gap-1">
              <Kbd keys={['Enter']} /> add
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys={['Esc']} /> {added.length ? 'done' : 'close'}
            </span>
          </span>
          <Button
            variant="ghost"
            icon={SlidersHorizontal}
            onClick={() => {
              onClose();
              openCreate(parsed.title ? draft() : categoryId ? { categoryId } : undefined);
            }}
          >
            More options
          </Button>
          <Button variant="primary" icon={CornerDownLeft} onClick={() => void submit()} disabled={!ready || busy}>
            Add
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`What do you need to do?  e.g. ${EXAMPLES[0]}`}
          aria-label="Task, with course, due date and time if you like"
          autoComplete="off"
          enterKeyHint="done"
          className="focus-ring h-11 w-full rounded-sm border border-line-strong bg-raised px-3 text-base text-fg placeholder:text-fg-faint focus:border-line-focus focus:outline-none"
        />

        {text.trim() ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-full truncate text-sm text-fg">{parsed.title || <span className="text-fg-subtle">Add a title…</span>}</span>
            <div className="w-[170px]">
              <Select
                size="sm"
                value={categoryId ?? ''}
                onValueChange={setCourse}
                options={categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> }))}
                placeholder={terms.one}
              />
            </div>
            <Chip icon={CalendarClock} on={parsed.deadline !== null} hint={parsed.deadline === null ? 'default' : undefined}>
              {dueText(deadline)}
            </Chip>
            <Chip icon={Timer} on={parsed.estimate !== null} hint={parsed.estimate === null ? estimateHint(learned, category) : undefined}>
              {formatDuration(estimate, { compact: true })}
            </Chip>
            {parsed.priority !== null && (
              <Chip icon={Flag} on>
                {parsed.priority === 0 ? 'Urgent' : 'High'}
              </Chip>
            )}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">
            Type it how you’d say it. A {terms.lower} name, a day (“fri”, “tmr”, “dec 3”), a time (“5pm”) and a length (“2h”) are picked up; leave them out and sensible defaults fill in. Try{' '}
            {EXAMPLES.map((ex, i) => (
              <span key={ex}>
                <button type="button" className="focus-ring num rounded-xs text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg" onClick={() => (setText(ex), inputRef.current?.focus())}>
                  {ex}
                </button>
                {i < EXAMPLES.length - 1 ? ' · ' : '.'}
              </span>
            ))}
          </p>
        )}

        {added.length > 0 && (
          <ul aria-live="polite" className="flex flex-col gap-1 border-t border-line pt-3">
            {added.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-xs text-fg-muted">
                <Check size={12} className="shrink-0 text-positive" />
                <span className="num text-fg-subtle">{taskRef(t.seq)}</span>
                <span className="truncate text-fg">{t.title}</span>
                <span className="shrink-0 text-fg-subtle">
                  · {categories.find((c) => c.id === t.categoryId)?.name} · {dueText(t.deadline)} · {formatDuration(t.estimate, { compact: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Dialog>
  );
}

function Chip({ icon: Icon, on, hint, children }: { icon: typeof Timer; on: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <span className={cn('num inline-flex h-6 items-center gap-1.5 rounded-sm border px-2', on ? 'border-[rgb(124_131_255/0.45)] bg-accent-muted text-fg' : 'border-line bg-raised text-fg-muted')}>
      <Icon size={12} className={on ? 'text-accent' : 'text-fg-subtle'} />
      {children}
      {hint && <span className="font-sans text-fg-subtle">· {hint}</span>}
    </span>
  );
}
