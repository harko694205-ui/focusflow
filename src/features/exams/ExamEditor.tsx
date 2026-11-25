import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addDays, format } from 'date-fns';
import { CalendarClock, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { db } from '@/db/db';
import { combineDateTime, splitDateTime } from '@/domain/dates';
import { CONFIDENCE, examProgress, parseTopics, planExamPrep, PREP_PRESETS, validateExam, type ExamErrors } from '@/domain/exam';
import type { Confidence, Exam, ExamDraft, ExamTopic, ID } from '@/domain/types';
import { parseEstimate } from '@/domain/validation';
import { formatDuration } from '@/lib/format';
import { useCategories, useNow, useTerms, useWorkspace } from '@/hooks/data';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { Field, Input, Textarea } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { examActions } from './actions';
import { useExamEditor } from './store';

/** Exam add/edit dialog. Mounted once (Exams page). */
export function ExamEditor() {
  const editor = useExamEditor((s) => s.editor);
  const close = useExamEditor((s) => s.close);
  const exam = useLiveQuery(async () => (editor?.mode === 'edit' ? ((await db.exams.get(editor.id)) ?? null) : null), [editor]);
  const categories = useCategories();
  const open = !!editor && (editor.mode === 'create' || exam !== undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={editor?.mode === 'edit' ? 'Edit exam' : 'Add an exam'}
      description="FocusFlow plans review sessions before it: spread out, weak topics more often, a practice exam, and a light last day."
      width="lg"
    >
      {open && categories && (
        <ExamForm key={editor.mode === 'edit' ? editor.id : 'new'} exam={exam ?? null} defaultCategory={editor.mode === 'create' ? editor.categoryId : undefined} categories={categories} onDone={close} />
      )}
    </Dialog>
  );
}

interface FormState {
  title: string;
  categoryId: ID;
  date: string;
  time: string;
  duration: string;
  location: string;
  prep: string;
  topics: ExamTopic[];
  notes: string;
}

const KINDS = [
  { label: 'Quiz', title: 'Quiz', duration: 50, prep: 120 },
  { label: 'Midterm', title: 'Midterm', duration: 110, prep: 6 * 60 },
  { label: 'Final', title: 'Final', duration: 180, prep: 12 * 60 },
];

function toForm(exam: Exam | null, categoryId: ID): FormState {
  const start = exam?.start ?? (() => {
    const d = addDays(new Date(), 7);
    d.setHours(10, 0, 0, 0);
    return d.getTime();
  })();
  const { date, time } = splitDateTime(start);
  return {
    title: exam?.title ?? '',
    categoryId: exam?.categoryId ?? categoryId,
    date,
    time,
    duration: formatDuration(exam?.duration ?? 110, { compact: true }),
    location: exam?.location ?? '',
    prep: formatDuration(exam?.prepTarget ?? 6 * 60, { compact: true }),
    topics: exam?.topics ?? [],
    notes: exam?.notes ?? '',
  };
}

function ExamForm({ exam, defaultCategory, categories, onDone }: { exam: Exam | null; defaultCategory?: ID; categories: NonNullable<ReturnType<typeof useCategories>>; onDone: () => void }) {
  const terms = useTerms();
  const ws = useWorkspace();
  const now = useNow();
  const [form, setForm] = useState<FormState>(() => toForm(exam, defaultCategory ?? categories[0]?.id ?? ''));
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const draft: ExamDraft = {
    title: form.title,
    categoryId: form.categoryId,
    start: combineDateTime(form.date, form.time) ?? Number.NaN,
    duration: parseEstimate(form.duration) ?? Number.NaN,
    location: form.location,
    prepTarget: parseEstimate(form.prep) ?? Number.NaN,
    topics: form.topics,
    notes: form.notes,
  };
  const errors: ExamErrors = validateExam(draft);
  if (Number.isFinite(draft.start) && draft.start < now && !exam) errors.start = 'That’s in the past.';
  const show = (k: keyof ExamErrors) => (submitted ? errors[k] : undefined);

  // Prep already done for this exam (finished sessions + tracked time) counts toward the target.
  const prepTasks = useLiveQuery(async () => (exam ? db.tasks.where('examId').equals(exam.id).toArray() : []), [exam?.id]);
  const tracked = useLiveQuery(async () => {
    const ids = (prepTasks ?? []).map((t) => t.id);
    const m = new Map<string, number>();
    if (ids.length) for (const s of await db.sessions.where('taskId').anyOf(ids).toArray()) m.set(s.taskId, (m.get(s.taskId) ?? 0) + (s.end - s.start) / 60_000);
    return m;
  }, [prepTasks]);
  const doneMinutes = exam && prepTasks && tracked ? examProgress(exam, prepTasks, tracked, now).done : 0;

  const plan = useMemo(
    () => (Object.keys(errors).length ? null : planExamPrep({ exam: { ...draft }, now, doneMinutes, week: ws.week })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(draft), doneMinutes, ws.week, now, Object.keys(errors).length],
  );

  const submit = async (andPlan: boolean) => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const saved = exam ? (await examActions.update(exam.id, draft))?.after : await examActions.create(draft);
      if (!saved) return;
      if (andPlan) await examActions.plan(saved.id);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const hasPlan = (prepTasks?.length ?? 0) > 0;

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
        {/* What */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.label}
                type="button"
                onClick={() => setForm((f) => ({ ...f, title: f.title && !KINDS.some((x) => f.title.startsWith(x.title)) ? f.title : k.title, duration: formatDuration(k.duration, { compact: true }), prep: formatDuration(k.prep, { compact: true }) }))}
                className="focus-ring h-6 rounded-xs border border-line px-2 text-xs text-fg-muted hover:border-line-strong hover:text-fg"
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Exam" error={show('title')}>
              {(id) => <Input id={id} autoFocus={!exam} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Midterm 1" maxLength={80} aria-invalid={!!show('title')} />}
            </Field>
            <Field label={terms.one} error={show('categoryId')}>
              {(id) => (
                <Select
                  id={id}
                  value={form.categoryId}
                  onValueChange={(v) => set('categoryId', v)}
                  options={categories.map((c) => ({ value: c.id, label: c.name, leading: <CategorySwatch category={c} /> }))}
                />
              )}
            </Field>
          </div>
        </div>

        {/* When */}
        <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_0.8fr]">
          <Field label="Date and start time" error={show('start')}>
            {(id) => (
              <div className="flex gap-1.5">
                <Input id={id} type="date" value={form.date} onChange={(e) => set('date', e.target.value)} className="flex-1 [&_input]:num" aria-invalid={!!show('start')} />
                <Input type="time" aria-label="Start time" value={form.time} onChange={(e) => set('time', e.target.value)} className="w-[132px] [&_input]:num" />
              </div>
            )}
          </Field>
          <Field label="Location">{(id) => <Input id={id} value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Moore 100" maxLength={60} />}</Field>
          <Field label="Length" error={show('duration')}>
            {(id) => <Input id={id} value={form.duration} onChange={(e) => set('duration', e.target.value)} placeholder="1h50" className="[&_input]:num" aria-invalid={!!show('duration')} />}
          </Field>
        </div>

        {/* Prep */}
        <Field label="How much do you want to prepare?" error={show('prepTarget')} hint="Total study time, e.g. 6h. Finished sessions count toward it.">
          {(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <Input id={id} value={form.prep} onChange={(e) => set('prep', e.target.value)} className="w-24 [&_input]:num" aria-invalid={!!show('prepTarget')} />
              {PREP_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => set('prep', formatDuration(p.minutes, { compact: true }))}
                  className={cn(
                    'focus-ring h-6 rounded-xs border px-2 text-xs',
                    parseEstimate(form.prep) === p.minutes ? 'border-line-focus bg-accent-muted text-fg' : 'border-line text-fg-muted hover:border-line-strong',
                  )}
                >
                  {p.label} · {formatDuration(p.minutes, { compact: true })}
                </button>
              ))}
            </div>
          )}
        </Field>

        <TopicEditor topics={form.topics} onChange={(fn) => setForm((f) => ({ ...f, topics: fn(f.topics) }))} error={show('topics')} />

        <Field label="Notes">{(id) => <Textarea id={id} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Allowed: one page of notes, calculator…" />}</Field>

        {plan && <PlanPreview plan={plan} doneMinutes={doneMinutes} />}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-[rgb(255_255_255/0.012)] px-4 py-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => void submit(false)}>
          {exam ? 'Save' : 'Save without a plan'}
        </Button>
        <Button type="submit" variant="primary" icon={Sparkles} disabled={saving || plan?.status === 'no-time'}>
          {exam && hasPlan ? 'Save & re-plan' : 'Save & plan studying'}
        </Button>
      </div>
    </form>
  );
}

function TopicEditor({ topics, onChange, error }: { topics: ExamTopic[]; onChange: (update: (current: ExamTopic[]) => ExamTopic[]) => void; error?: string }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const have = new Set(topics.map((t) => t.name.toLowerCase()));
    const next = parseTopics(raw).filter((n) => !have.has(n.toLowerCase()));
    if (next.length) onChange((cur) => [...cur, ...next.map((name) => ({ id: crypto.randomUUID(), name, confidence: 2 as Confidence }))]);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">Topics and how well you know them</span>
      {topics.length > 0 && (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
          {topics.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-2.5 py-1">
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{t.name}</span>
              <ConfidencePicker value={t.confidence} topic={t.name} onChange={(c) => onChange((cur) => cur.map((x) => (x.id === t.id ? { ...x, confidence: c } : x)))} />
              <button type="button" aria-label={`Remove ${t.name}`} onClick={() => onChange((cur) => cur.filter((x) => x.id !== t.id))} className="focus-ring grid size-6 place-items-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (pasted.includes('\n')) {
              e.preventDefault();
              add(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            }
          }}
          placeholder="Add a topic, or paste a list from the syllabus"
          aria-label="Add topics"
          className="flex-1"
        />
        <Button type="button" variant="secondary" icon={Plus} disabled={!text.trim()} onClick={() => add(text)}>
          Add
        </Button>
      </div>
      <span className={cn('text-xs', error ? 'text-negative' : 'text-fg-subtle')}>
        {error ?? 'Weak topics (😬) come up three times as often as solid ones (😎). No topics? Sessions just cover lectures and notes.'}
      </span>
    </div>
  );
}

export function ConfidencePicker({ value, onChange, topic, size = 'md' }: { value: Confidence; onChange: (c: Confidence) => void; topic: string; size?: 'sm' | 'md' }) {
  return (
    <span role="radiogroup" aria-label={`How well you know ${topic}`} className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-line bg-canvas p-0.5">
      {([1, 2, 3] as Confidence[]).map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={CONFIDENCE[c].label}
          title={CONFIDENCE[c].label}
          onClick={() => onChange(c)}
          className={cn(
            'focus-ring grid place-items-center rounded-xs leading-none transition-[opacity,background-color]',
            size === 'sm' ? 'size-5 text-[11px]' : 'size-6 text-sm',
            value === c ? 'bg-active opacity-100' : 'opacity-40 grayscale hover:opacity-80 hover:grayscale-0',
          )}
        >
          {CONFIDENCE[c].emoji}
        </button>
      ))}
    </span>
  );
}

function PlanPreview({ plan, doneMinutes }: { plan: ReturnType<typeof planExamPrep>; doneMinutes: number }) {
  const KIND: Record<string, string> = { study: 'Study', practice: 'Practice exam', review: 'Light review' };
  return (
    <section aria-label="Study plan preview" className="flex flex-col gap-2 rounded-sm border border-dashed border-line-strong px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <CalendarClock size={13} className="text-accent" />
        <span className="font-medium text-fg">Study plan</span>
        {plan.sessions.length > 0 && (
          <span className="num text-fg-subtle">
            {plan.sessions.length} sessions · {formatDuration(plan.total, { compact: true })}
            {doneMinutes > 0 && ` · ${formatDuration(doneMinutes, { compact: true })} already done`}
          </span>
        )}
      </div>
      {plan.status === 'done' && <p className="text-xs text-positive">You’ve already prepared as much as you planned. Raise the target to add sessions.</p>}
      {plan.note && <p className={cn('text-xs', plan.status === 'no-time' ? 'text-negative' : 'text-warning')}>{plan.note}</p>}
      {plan.sessions.length > 0 && (
        <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {plan.sessions.map((s) => (
            <li key={s.day} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="num w-[74px] shrink-0 text-fg-muted">{format(s.day, 'EEE MMM d')}</span>
              <span className="num w-10 shrink-0 text-right text-fg">{formatDuration(s.minutes, { compact: true })}</span>
              <span className={cn('min-w-0 truncate', s.kind === 'study' ? 'text-fg-subtle' : s.kind === 'practice' ? 'text-accent' : 'text-positive')}>
                {KIND[s.kind]}
                {s.topics.length > 0 && s.kind === 'study' ? ` · ${s.topics.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
