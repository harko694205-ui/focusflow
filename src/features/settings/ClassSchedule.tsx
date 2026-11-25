import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarOff, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CLASS_DAYS, CLASS_KINDS, classRange, dayPattern, expandClass, validateClass, weeklyClassMinutes, type ClassErrors } from '@/domain/classes';
import type { Term } from '@/domain/term';
import type { Category, ClassDraft, ClassMeeting, ID } from '@/domain/types';
import { parseClock } from '@/domain/workweek';
import { formatClock, formatDuration } from '@/lib/format';
import { useClasses } from '@/hooks/data';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { Button, IconButton } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Skeleton } from '@/ui/Feedback';
import { Tooltip } from '@/ui/Tooltip';
import { classActions } from './classActions';
import { profileActions } from './actions';

/** Weekly classes (Student mode): each becomes event blocks for every meeting of the term. */
export function ClassSchedule({ categories, term, now }: { categories: Category[]; term: Term | null; now: number }) {
  const classes = useClasses();
  const [editing, setEditing] = useState<ID | 'new' | null>(null);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const sorted = useMemo(
    () => [...(classes ?? [])].sort((a, b) => (byId.get(a.categoryId)?.order ?? 99) - (byId.get(b.categoryId)?.order ?? 99) || a.start - b.start),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [classes, categories],
  );
  const range = classRange(term, now);
  const meetings = sorted.reduce((a, c) => a + expandClass(c, range, term?.holidays).length, 0);
  const weekly = sorted.reduce((a, c) => a + weeklyClassMinutes(c), 0);
  const label = (c: Pick<ClassMeeting, 'categoryId' | 'kind'>) => `${byId.get(c.categoryId)?.name ?? 'Class'} ${c.kind}`;

  if (!classes) return <Skeleton className="h-[160px]" />;

  return (
    <div className="flex flex-col gap-4">
      {sorted.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
          {sorted.map((c) =>
            editing === c.id ? (
              <li key={c.id} className="bg-raised/40 p-3">
                <ClassForm categories={categories} initial={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <CategorySwatch category={byId.get(c.categoryId)} />
                <span className="min-w-[140px] flex-1 truncate text-sm text-fg">{label(c)}</span>
                <span className="num w-10 text-xs font-medium text-fg-muted">{dayPattern(c.days)}</span>
                <span className="num w-[92px] text-xs text-fg-muted">
                  {formatClock(c.start)}–{formatClock(c.end)}
                </span>
                <span className="hidden w-28 items-center gap-1 truncate text-xs text-fg-subtle sm:flex">
                  {c.location && (
                    <>
                      <MapPin size={11} className="shrink-0" /> {c.location}
                    </>
                  )}
                </span>
                <Tooltip content="Edit">
                  <IconButton icon={Pencil} size="sm" label={`Edit ${label(c)}`} onClick={() => setEditing(c.id)} />
                </Tooltip>
                <Tooltip content="Remove">
                  <IconButton icon={Trash2} size="sm" label={`Remove ${label(c)}`} onClick={() => void classActions.remove(c.id, label(c))} />
                </Tooltip>
              </li>
            ),
          )}
        </ul>
      )}

      {editing === 'new' ? (
        <div className="rounded-sm border border-line p-3">
          <ClassForm categories={categories} onDone={() => setEditing(null)} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant={sorted.length ? 'secondary' : 'primary'} icon={Plus} onClick={() => setEditing('new')} disabled={!categories.length}>
            Add a class
          </Button>
          {sorted.length > 0 && (
            <span className="text-xs text-fg-subtle">
              <span className="num text-fg-muted">{formatDuration(weekly, { compact: true })}</span> of class a week ·{' '}
              <span className="num text-fg-muted">{meetings}</span> meetings {term ? `in ${term.name}` : 'in the next 10 weeks'}, on your timeline
            </span>
          )}
        </div>
      )}

      {term ? (
        <Holidays term={term} />
      ) : (
        <p className="text-xs text-fg-subtle">Set your term under Work or school so classes stop for finals week and skip holidays.</p>
      )}
    </div>
  );
}

function ClassForm({ categories, initial, onDone }: { categories: Category[]; initial?: ClassMeeting; onDone: () => void }) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '');
  const [kind, setKind] = useState(initial?.kind ?? 'Lecture');
  const [days, setDays] = useState<number[]>(initial?.days ?? []);
  const [start, setStart] = useState(initial ? formatClock(initial.start) : '10:00');
  const [end, setEnd] = useState(initial ? formatClock(initial.end) : '11:50');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [submitted, setSubmitted] = useState(false);

  const draft: ClassDraft = { categoryId, kind, days, start: parseClock(start) ?? Number.NaN, end: parseClock(end) ?? Number.NaN, location };
  const errors: ClassErrors = validateClass(draft);
  const show = (k: keyof ClassErrors) => (submitted ? errors[k] : undefined);
  const course = categories.find((c) => c.id === categoryId);

  const save = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const ok = initial ? await classActions.update(initial.id, draft) : await classActions.create(draft, `${course?.name ?? 'Class'} ${kind.trim()}`);
    if (ok) onDone();
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Course</span>
          <Select value={categoryId} onValueChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> }))} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Type</span>
          <Input value={kind} onChange={(e) => setKind(e.target.value)} list="class-kinds" maxLength={30} aria-invalid={!!show('kind')} />
          <datalist id="class-kinds">
            {CLASS_KINDS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Days</span>
          <div role="group" aria-label="Days it meets" className="flex gap-1">
            {CLASS_DAYS.map((d) => {
              const on = days.includes(d.day);
              return (
                <Tooltip key={d.day} content={d.short}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={d.short}
                    onClick={() => setDays((xs) => (on ? xs.filter((x) => x !== d.day) : [...xs, d.day]))}
                    className={cn(
                      'focus-ring num grid size-7 place-items-center rounded-sm border text-xs font-medium transition-colors',
                      on ? 'border-[rgb(124_131_255/0.5)] bg-accent-muted text-fg' : 'border-line-strong text-fg-subtle hover:text-fg',
                    )}
                  >
                    {d.letter}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Time</span>
          <div className="flex items-center gap-1.5">
            <Input value={start} onChange={(e) => setStart(e.target.value)} aria-label="Starts (24-hour)" placeholder="10:00" maxLength={5} className="w-[72px] [&_input]:num [&_input]:text-center" aria-invalid={!!show('time')} />
            <span className="text-fg-faint">–</span>
            <Input value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Ends (24-hour)" placeholder="11:50" maxLength={5} className="w-[72px] [&_input]:num [&_input]:text-center" aria-invalid={!!show('time')} />
          </div>
        </div>
        <label className="flex min-w-[160px] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-fg-muted">Location</span>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Moore 100" maxLength={60} />
        </label>
      </div>

      {submitted && Object.keys(errors).length > 0 && (
        <p role="alert" className="text-xs text-negative">
          {Object.values(errors)[0]}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          {initial ? 'Save class' : 'Add class'}
        </Button>
      </div>
    </form>
  );
}

function Holidays({ term }: { term: Term }) {
  const [date, setDate] = useState('');
  const holidays = [...(term.holidays ?? [])].sort();
  const save = (next: string[], message: string) => void profileActions.update({ term: { ...term, holidays: [...new Set(next)].sort() } }, message);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <CalendarOff size={13} className="text-fg-subtle" />
        <span className="font-medium text-fg-muted">No-class days</span>
        <span className="text-fg-subtle">Holidays in {term.name}; classes skip them.</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {holidays.map((h) => (
          <span key={h} className="num inline-flex h-6 items-center gap-1 rounded-sm border border-line bg-raised pl-2 pr-0.5 text-xs text-fg-muted">
            {format(parseISO(h), 'EEE MMM d')}
            <button
              type="button"
              aria-label={`Remove ${format(parseISO(h), 'EEEE MMMM d')}`}
              onClick={() => save(holidays.filter((x) => x !== h), 'Day off removed')}
              className="focus-ring grid size-5 place-items-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Add a no-class day"
            className="focus-ring num h-6 rounded-sm border border-line-strong bg-raised px-2 text-xs text-fg [color-scheme:dark]"
          />
          <Button
            size="sm"
            variant="secondary"
            icon={Plus}
            disabled={!date}
            onClick={() => {
              save([...holidays, date], `No classes on ${format(parseISO(date), 'EEE MMM d')}`);
              setDate('');
            }}
          >
            Add
          </Button>
        </span>
      </div>
    </div>
  );
}
