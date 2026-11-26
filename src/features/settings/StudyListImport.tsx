import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowRight, CalendarRange, GraduationCap, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dayPattern } from '@/domain/classes';
import type { Category } from '@/domain/types';
import { formatClock } from '@/lib/format';
import { previewStudyList, type StudyPreview, type StudyPreviewCourse } from '@/services/studyListService';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { Button } from '@/ui/Button';
import { Tag } from '@/ui/Data';
import { Dialog } from '@/ui/Dialog';
import { Input, Textarea } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { classActions } from './classActions';

/** Paste your MyUCLA Study List → classes (and finals) for the term, reviewed before anything is added. */
export function StudyListImport({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<StudyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async () => {
    setError(null);
    try {
      setPreview(await previewStudyList(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read that.');
    }
  };

  const update = (i: number, fn: (c: StudyPreviewCourse) => StudyPreviewCourse) => setPreview((p) => p && { ...p, courses: p.courses.map((c, j) => (j === i ? fn(c) : c)) });

  const classes = preview?.courses.reduce((a, c) => a + c.sections.filter((s) => s.selected).length, 0) ?? 0;
  const finals = preview?.courses.filter((c) => c.final?.selected).length ?? 0;

  const submit = async () => {
    if (!preview) return;
    setBusy(true);
    const ok = await classActions.importStudyList(preview);
    setBusy(false);
    if (ok) onClose();
  };

  const options = [...categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> })), { value: 'new', label: 'New course…' }];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      width="xl"
      title="Paste from MyUCLA"
      description={preview ? `${preview.courses.length} course${preview.courses.length === 1 ? '' : 's'} found` : 'Your Study List becomes your weekly classes, with finals added to Exams.'}
      footer={
        preview ? (
          <>
            <span className="mr-auto text-xs text-fg-subtle">
              {classes || finals ? (
                <>
                  <span className="num text-fg-muted">{classes}</span> class{classes === 1 ? '' : 'es'}
                  {finals > 0 && (
                    <>
                      {' '}· <span className="num text-fg-muted">{finals}</span> final{finals === 1 ? '' : 's'}
                    </>
                  )}
                </>
              ) : (
                'Nothing selected'
              )}
            </span>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy || (!classes && !finals)}>
              Add to schedule
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void read()} disabled={!text.trim()}>
              Continue
            </Button>
          </>
        )
      }
    >
      {!preview ? (
        <div className="flex flex-col gap-3 p-4">
          <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-fg-muted marker:text-fg-subtle">
            <li>
              In MyUCLA, open <span className="text-fg">Classes → Study List</span>.
            </li>
            <li>Select from your first course’s name down to the last section, and copy it.</li>
            <li>Paste it below. Nothing is added until you review it.</li>
          </ol>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            rows={12}
            autoFocus
            spellCheck={false}
            aria-label="Study List"
            aria-invalid={!!error}
            placeholder={'Economics\n\n11 - Microeconomic Theory\n…\nLec 2   Enrolled   MW   5pm-6:15pm   Broad Art Center 2160E   4.0'}
            className="num resize-y text-xs"
          />
          {error && (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {preview.term && (
            <p className="flex items-start gap-2 rounded-sm border border-line bg-raised/40 px-3 py-2 text-xs text-fg-muted">
              <CalendarRange size={13} className="mt-px shrink-0 text-accent" />
              <span>
                Your term will be set to <span className="text-fg">{preview.term.name}</span>: classes from {format(parseISO(preview.term.start), 'EEE MMM d')} for {preview.term.weeks} weeks, then finals. You can adjust it under Work or school.
              </span>
            </p>
          )}
          {preview.courses.map((c, i) => (
            <section key={`${c.course.name}-${i}`} className="overflow-hidden rounded-sm border border-line">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raised/30 px-3 py-2">
                <div className="flex min-w-[180px] flex-1 flex-col">
                  <span className="text-sm font-medium text-fg">{c.course.name}</span>
                  <span className="truncate text-2xs text-fg-subtle">{c.course.title}</span>
                </div>
                <ArrowRight size={13} className="shrink-0 text-fg-faint" />
                <div className="flex w-[280px] items-center gap-1.5">
                  <div className="min-w-0 flex-1">
                    <Select size="sm" value={c.target} onValueChange={(v) => update(i, (x) => ({ ...x, target: v }))} options={options} />
                  </div>
                  {c.target === 'new' && <Input size="sm" aria-label={`Name for ${c.course.name}`} value={c.newName} maxLength={40} onChange={(e) => update(i, (x) => ({ ...x, newName: e.target.value }))} className="w-[120px]" />}
                </div>
              </header>
              <ul className="flex flex-col divide-y divide-line">
                {c.sections.map((s, k) => {
                  const id = `sl-${i}-${k}`;
                  const note = s.exists ? 'Already added' : !/^enrolled$/i.test(s.status) ? s.status : null;
                  return (
                    <li key={id} className={cn('flex items-center gap-3 px-3 py-1.5', s.exists && 'opacity-60')}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={s.selected}
                        disabled={s.exists}
                        onChange={(e) => update(i, (x) => ({ ...x, sections: x.sections.map((y, j) => (j === k ? { ...y, selected: e.target.checked } : y)) }))}
                        className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                      />
                      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                        <span className="w-[150px] truncate text-fg">
                          {s.kind} <span className="text-xs text-fg-subtle">{s.section}</span>
                        </span>
                        <span className="num w-9 text-xs font-medium text-fg-muted">{dayPattern(s.days)}</span>
                        <span className="num w-[92px] text-xs text-fg-muted">
                          {formatClock(s.start)}–{formatClock(s.end)}
                        </span>
                        {s.location && (
                          <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-xs text-fg-subtle">
                            <MapPin size={11} className="shrink-0" /> {s.location}
                          </span>
                        )}
                      </label>
                      {note && <Tag tone="neutral">{note}</Tag>}
                    </li>
                  );
                })}
                {c.final && (
                  <li className={cn('flex items-center gap-3 px-3 py-1.5', c.final.exists && 'opacity-60')}>
                    <input
                      id={`sl-${i}-final`}
                      type="checkbox"
                      checked={c.final.selected}
                      disabled={c.final.exists}
                      onChange={(e) => update(i, (x) => ({ ...x, final: x.final && { ...x.final, selected: e.target.checked } }))}
                      className="size-3.5 shrink-0 accent-[var(--color-accent)]"
                    />
                    <label htmlFor={`sl-${i}-final`} className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                      <span className="flex w-[150px] items-center gap-1.5 text-fg">
                        <GraduationCap size={13} className="text-warning" /> Final exam
                      </span>
                      <span className="num text-xs text-fg-muted">
                        {format(c.final.start, 'EEE MMM d · HH:mm')}–{format(c.final.start + c.final.duration * 60_000, 'HH:mm')}
                      </span>
                      {c.final.location && <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{c.final.location}</span>}
                    </label>
                    {c.final.exists && <Tag tone="neutral">Already added</Tag>}
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
