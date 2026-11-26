import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArrowRight, ChevronDown, ChevronRight, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Category, Difficulty } from '@/domain/types';
import type { CanvasPreview, PreviewCourse, PreviewRow, RowStatus } from '@/services/canvasService';
import { formatDuration } from '@/lib/format';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Tag } from '@/ui/Data';
import { canvasActions } from './actions';

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
const due = (t: number) => format(t, 'EEE MMM d · HH:mm');

const STATUS: Record<RowStatus, { label: string; tone: 'accent' | 'warning' | 'neutral' } | null> = {
  new: null,
  changed: { label: 'Due date changed', tone: 'accent' },
  same: { label: 'Already added', tone: 'neutral' },
  done: { label: 'Done', tone: 'neutral' },
  deleted: { label: 'You deleted it', tone: 'neutral' },
  past: { label: 'Past due', tone: 'neutral' },
};

interface RowState extends PreviewRow {
  estimate: number;
  difficulty: Difficulty;
}

/** Review a BruinLearn calendar before anything is added: courses, which assignments, how long each takes. */
export function ImportPreview({
  preview,
  categories,
  feedUrl,
  source,
  onClose,
}: {
  preview: CanvasPreview;
  categories: Category[];
  /** Saved with the import when the calendar came from a feed link. */
  feedUrl?: string | null;
  source: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<RowState[]>(() => preview.rows.map((r) => ({ ...r, estimate: r.item.estimate, difficulty: r.item.difficulty })));
  const [courses, setCourses] = useState<PreviewCourse[]>(preview.courses);
  const [showOther, setShowOther] = useState(false);
  const [busy, setBusy] = useState(false);

  const courseOf = useMemo(() => new Map(courses.map((c) => [c.name, c])), [courses]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const skipped = (r: RowState) => courseOf.get(r.item.course ?? '')?.target === 'skip';
  const main = rows.filter((r) => r.status === 'new' || r.status === 'changed');
  const other = rows.filter((r) => !main.includes(r));
  const chosen = rows.filter((r) => r.selected && !skipped(r));
  const adding = chosen.filter((r) => !r.taskId);
  const updating = chosen.filter((r) => r.taskId);
  const already = rows.filter((r) => r.status === 'same').length;
  const newCourses = courses.filter((c) => c.target === 'new' && chosen.some((r) => (r.item.course ?? '') === c.name));
  const totalWork = adding.reduce((a, r) => a + r.estimate, 0);

  const toggle = (uid: string, on: boolean) => setRows((xs) => xs.map((r) => (r.item.uid === uid ? { ...r, selected: on } : r)));
  const setCourse = (name: string, patch: Partial<PreviewCourse>) => setCourses((cs) => cs.map((c) => (c.name === name ? { ...c, ...patch } : c)));

  const submit = async () => {
    setBusy(true);
    const ok = await canvasActions.import(
      chosen.map((r) => ({ item: r.item, taskId: r.taskId, estimate: r.estimate, difficulty: r.difficulty })),
      courses,
      feedUrl,
    );
    setBusy(false);
    if (ok) onClose();
  };

  const options = [
    ...categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> })),
    { value: 'new', label: 'New course…' },
    { value: 'skip', label: 'Don’t import' },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title="Import from BruinLearn"
      description={`${source} · ${rows.length} item${rows.length === 1 ? '' : 's'}${already ? ` · ${already} already in FocusFlow` : ''}`}
      footer={
        <>
          <span className="mr-auto text-xs text-fg-subtle">
            {adding.length > 0 && (
              <>
                <span className="num text-fg-muted">{adding.length}</span> to add · <span className="num text-fg-muted">{formatDuration(totalWork, { compact: true })}</span> of work
              </>
            )}
            {adding.length > 0 && updating.length > 0 && ' · '}
            {updating.length > 0 && (
              <>
                <span className="num text-fg-muted">{updating.length}</span> to update
              </>
            )}
            {newCourses.length > 0 && ` · ${newCourses.length} new course${newCourses.length === 1 ? '' : 's'}`}
            {!chosen.length && 'Nothing selected'}
          </span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !chosen.length}>
            {updating.length && !adding.length ? 'Update' : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-fg-muted">Courses</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
            {courses.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <div className="flex min-w-[200px] flex-1 flex-col">
                  <span className="truncate text-sm text-fg">{c.name || 'No course'}</span>
                  <span className="text-2xs text-fg-subtle">
                    {c.count} item{c.count === 1 ? '' : 's'} in BruinLearn
                  </span>
                </div>
                <ArrowRight size={13} className="shrink-0 text-fg-faint" />
                <div className="flex w-[260px] items-center gap-1.5">
                  <Select size="sm" value={c.target} onValueChange={(v) => setCourse(c.name, { target: v })} options={options} className="min-w-0 flex-1" />
                  {c.target === 'new' && (
                    <Input size="sm" aria-label={`Name for ${c.name || 'the new course'}`} value={c.newName} maxLength={40} onChange={(e) => setCourse(c.name, { newName: e.target.value })} className="w-[110px]" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-fg-muted">
            {main.length ? 'Coming up' : 'Nothing new'}
            {main.length > 0 && <span className="num ml-1.5 text-fg-subtle">{main.length}</span>}
          </h3>
          {main.length ? (
            <RowList rows={main} skipped={skipped} byId={byId} courseOf={courseOf} toggle={toggle} setRows={setRows} />
          ) : (
            <p className="rounded-sm border border-dashed border-line px-3 py-4 text-center text-xs text-fg-subtle">Every upcoming assignment is already in FocusFlow with the right due date.</p>
          )}
        </section>

        {other.length > 0 && (
          <section className="flex flex-col gap-2">
            <button type="button" onClick={() => setShowOther((s) => !s)} aria-expanded={showOther} className="focus-ring flex items-center gap-1 self-start rounded-xs text-xs font-medium text-fg-muted hover:text-fg">
              {showOther ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Past, done or already added <span className="num text-fg-subtle">{other.length}</span>
            </button>
            {showOther && <RowList rows={other} skipped={skipped} byId={byId} courseOf={courseOf} toggle={toggle} setRows={setRows} />}
          </section>
        )}
      </div>
    </Dialog>
  );
}

function RowList({
  rows,
  skipped,
  byId,
  courseOf,
  toggle,
  setRows,
}: {
  rows: RowState[];
  skipped: (r: RowState) => boolean;
  byId: Map<string, Category>;
  courseOf: Map<string, PreviewCourse>;
  toggle: (uid: string, on: boolean) => void;
  setRows: React.Dispatch<React.SetStateAction<RowState[]>>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
      {rows.map((r) => {
        const course = courseOf.get(r.item.course ?? '');
        const cat = course && course.target !== 'new' && course.target !== 'skip' ? byId.get(course.target) : undefined;
        const off = skipped(r);
        const locked = r.status === 'same' || r.status === 'done';
        const tag = r.item.exam && !r.taskId ? { label: 'Exam? Add it under Exams', tone: 'warning' as const } : r.item.kind === 'event' && !r.taskId ? { label: 'Calendar event', tone: 'neutral' as const } : STATUS[r.status];
        const id = `canvas-${r.item.uid}`;
        return (
          <li key={r.item.uid} className={cn('flex items-center gap-3 px-3 py-2', off && 'opacity-45')}>
            <input
              id={id}
              type="checkbox"
              checked={r.selected && !off}
              disabled={off || locked}
              onChange={(e) => toggle(r.item.uid, e.target.checked)}
              className="size-3.5 shrink-0 accent-[var(--color-accent)]"
            />
            <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2">
                {r.item.exam && <GraduationCap size={12} className="shrink-0 text-warning" />}
                <span className="truncate text-sm text-fg">{r.item.title}</span>
                {tag && (
                  <Tag tone={tag.tone} className="hidden sm:inline-flex">
                    {tag.label}
                  </Tag>
                )}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
                {cat ? <CategorySwatch category={cat} /> : null}
                <span className="truncate">{off ? 'Not imported' : course?.target === 'new' ? course.newName : (cat?.name ?? r.item.course ?? '')}</span>
                <span className="text-fg-faint">·</span>
                {r.status === 'changed' && r.oldDue !== undefined && r.oldDue !== r.item.due ? (
                  <span className="num truncate">
                    <span className="line-through">{format(r.oldDue, 'MMM d HH:mm')}</span> → <span className="text-fg-muted">{due(r.item.due)}</span>
                  </span>
                ) : (
                  <span className="num truncate">{due(r.item.due)}</span>
                )}
              </span>
            </label>
            {!r.taskId && (
              <div className="w-[76px] shrink-0">
                <Select
                  size="sm"
                  value={String(r.estimate)}
                  onValueChange={(v) => setRows((xs) => xs.map((x) => (x.item.uid === r.item.uid ? { ...x, estimate: Number(v) } : x)))}
                  options={[...new Set([...ESTIMATES, r.estimate])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: formatDuration(m, { compact: true }) }))}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
