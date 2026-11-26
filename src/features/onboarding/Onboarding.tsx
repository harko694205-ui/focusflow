import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ArrowRight, Briefcase, Check, FileUp, GraduationCap, Link2, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppIcon } from '@/app/AppIcon';
import { useUI } from '@/app/store';
import { dayPattern } from '@/domain/classes';
import { normalizeFeedUrl } from '@/domain/canvas';
import { finalsCountdown, isValidTerm, suggestTerm, termWeek, type Term } from '@/domain/term';
import { WORK_WEEK_PRESETS, weeklyMinutes } from '@/domain/workweek';
import { formatClock, formatDuration } from '@/lib/format';
import { applyCanvasImport, fetchFeed, previewCanvas } from '@/services/canvasService';
import { applyStudyList, previewStudyList } from '@/services/studyListService';
import { createCategory } from '@/services/taskService';
import { exploreDemo, finishOnboarding, startStudent, startWork } from '@/services/onboardingService';
import { Button } from '@/ui/Button';
import { Input, Textarea } from '@/ui/Input';

type Step = 'welcome' | 'term' | 'classes' | 'assignments' | 'student-done' | 'areas' | 'hours' | 'work-done';

const STUDENT_STEPS: Step[] = ['term', 'classes', 'assignments', 'student-done'];
const WORK_STEPS: Step[] = ['areas', 'hours', 'work-done'];

interface ClassSummary {
  course: string;
  lines: string[];
  final: boolean;
}

/** First-run setup: a few steps that fill the workspace with your real classes and work. */
export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('welcome');
  const [term, setTerm] = useState<Term>(() => suggestTerm(Date.now()));
  const [classes, setClasses] = useState<ClassSummary[] | null>(null);
  const [assignments, setAssignments] = useState<{ count: number; courses: number; live: boolean } | null>(null);
  const [areas, setAreas] = useState(['Work', 'Personal']);
  const [hours, setHours] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const path = STUDENT_STEPS.includes(step) ? STUDENT_STEPS : WORK_STEPS.includes(step) ? WORK_STEPS : null;
  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };
  const attempt = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  const finish = async (to: string, capture = false) => {
    await finishOnboarding();
    navigate(to, { replace: true });
    if (capture) useUI.getState().setCapture(true);
  };

  return (
    <div data-onboarding className="flex min-h-dvh flex-col items-center overflow-y-auto bg-canvas px-4 py-8 sm:py-14">
      <div className="flex w-full max-w-[580px] flex-col gap-6">
        <header className="flex items-center gap-2.5">
          <AppIcon size={26} />
          <span className="text-sm font-medium text-fg">FocusFlow</span>
          {path && (
            <ol aria-label="Setup progress" className="ml-auto flex items-center gap-1.5">
              {path.map((s, i) => (
                <li key={s} aria-current={s === step ? 'step' : undefined} className={cn('h-1.5 rounded-full transition-all', s === step ? 'w-5 bg-accent' : i < path.indexOf(step) ? 'w-1.5 bg-accent/60' : 'w-1.5 bg-line-strong')}>
                  <span className="sr-only">
                    Step {i + 1} of {path.length}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </header>

        <main className="flex flex-col gap-5 rounded-md border border-line bg-panel p-5 sm:p-6">
          {step === 'welcome' && (
            <>
              <Heading title="Let’s set up your week" sub="FocusFlow plans what you need to do around the time you actually have. A couple of minutes of setup and it’s ready." />
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice icon={GraduationCap} title="I’m a student" detail="Your classes, BruinLearn assignments and finals, planned around your quarter." onClick={() => go('term')} />
                <Choice icon={Briefcase} title="I’m working" detail="Projects and deadlines, planned around your working hours." onClick={() => go('areas')} />
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void attempt(async () => (await exploreDemo(), navigate('/', { replace: true })))}
                className="focus-ring flex items-center gap-1.5 self-center rounded-xs text-xs text-fg-subtle hover:text-fg"
              >
                <Sparkles size={12} /> Just looking? Explore with sample data
              </button>
            </>
          )}

          {step === 'term' && (
            <>
              <Heading title="Your quarter" sub="So FocusFlow knows which week it is and when finals start. We filled in our best guess." />
              <TermFields term={term} onChange={setTerm} />
              <Footer
                back={() => go('welcome')}
                next={() => void attempt(async () => (await startStudent(term), go('classes')))}
                nextLabel="Looks right"
                disabled={!isValidTerm(term) || !term.name.trim()}
                busy={busy}
              />
            </>
          )}

          {step === 'classes' && (
            <ClassesStep
              done={classes}
              busy={busy}
              onAdd={(text) =>
                attempt(async () => {
                  const preview = await previewStudyList(text);
                  await applyStudyList(preview);
                  setClasses(
                    preview.courses.map((c) => ({
                      course: c.newName || c.course.name,
                      lines: c.sections.filter((s) => s.selected).map((s) => `${s.kind} ${dayPattern(s.days)} ${formatClock(s.start)}`),
                      final: !!c.final?.selected,
                    })),
                  );
                })
              }
              next={() => go('assignments')}
              back={() => go('term')}
            />
          )}

          {step === 'assignments' && (
            <AssignmentsStep
              done={assignments}
              busy={busy}
              onFeed={(url) =>
                attempt(async () => {
                  const p = await previewCanvas(await fetchFeed(url));
                  const rows = p.rows.filter((r) => r.selected);
                  const r = await applyCanvasImport(rows.map((x) => ({ item: x.item, taskId: x.taskId, estimate: x.item.estimate, difficulty: x.item.difficulty })), p.courses, normalizeFeedUrl(url));
                  setAssignments({ count: r.added.length, courses: new Set(r.added.map((t) => t.categoryId)).size, live: true });
                })
              }
              onFile={(file) =>
                attempt(async () => {
                  const p = await previewCanvas(await file.text());
                  const rows = p.rows.filter((r) => r.selected);
                  const r = await applyCanvasImport(rows.map((x) => ({ item: x.item, taskId: x.taskId, estimate: x.item.estimate, difficulty: x.item.difficulty })), p.courses);
                  setAssignments({ count: r.added.length, courses: new Set(r.added.map((t) => t.categoryId)).size, live: false });
                })
              }
              next={() => go('student-done')}
              back={() => go('classes')}
            />
          )}

          {step === 'student-done' && (
            <>
              <Heading title="You’re set" sub={`${term.name} is ready.`} />
              <ul className="flex flex-col gap-2 text-sm">
                <Done ok={!!classes?.length}>{classes?.length ? `${classes.reduce((a, c) => a + c.lines.length, 0)} classes on your timeline, every week until finals` : 'No classes yet. Add them any time under Settings → Class schedule.'}</Done>
                {classes?.some((c) => c.final) && <Done ok>{`${classes.filter((c) => c.final).length} finals in Exams, ready to plan study time for`}</Done>}
                <Done ok={!!assignments?.count}>{assignments?.count ? assignments.live ? `${assignments.count} assignments from BruinLearn, which keeps syncing when you open FocusFlow` : `${assignments.count} assignments from BruinLearn. Connect the feed under Settings → BruinLearn to keep them in sync` : 'No BruinLearn assignments yet. Connect it any time under Settings → BruinLearn.'}</Done>
              </ul>
              <Tip>
                For anything else, press <span className="text-fg">New task</span> and type it how you’d say it, like <span className="num text-fg">econ ps5 fri 2h</span>.
              </Tip>
              <Footer back={() => go('assignments')} next={() => void finish('/timeline')} nextLabel="See my week" busy={busy} />
            </>
          )}

          {step === 'areas' && (
            <>
              <Heading title="What do you want to keep track of?" sub="Areas group your tasks and give them a colour. Rename or add more later." />
              <AreasField areas={areas} onChange={setAreas} />
              <Footer back={() => go('welcome')} next={() => go('hours')} disabled={!areas.some((a) => a.trim())} busy={busy} />
            </>
          )}

          {step === 'hours' && (
            <>
              <Heading title="When do you work?" sub="Your capacity. Deadlines, risk and auto-scheduling plan within these hours; fine-tune them later in Settings." />
              <div role="radiogroup" aria-label="Working hours" className="grid gap-2 sm:grid-cols-2">
                {WORK_WEEK_PRESETS.filter((p) => p.id !== 'student').map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={hours === p.id}
                    onClick={() => setHours(p.id)}
                    className={cn(
                      'focus-ring flex flex-col items-start gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-colors',
                      hours === p.id ? 'border-[rgb(124_131_255/0.55)] bg-accent-muted' : 'border-line-strong hover:bg-hover',
                    )}
                  >
                    <span className="flex w-full items-center justify-between text-sm text-fg">
                      {p.label}
                      <span className="num text-xs text-fg-subtle">{formatDuration(weeklyMinutes(p.week), { compact: true })}/wk</span>
                    </span>
                    <span className="text-xs text-fg-subtle">{p.hint}</span>
                  </button>
                ))}
              </div>
              <Footer
                back={() => go('areas')}
                next={() => void attempt(async () => (await startWork(areas, WORK_WEEK_PRESETS.find((p) => p.id === hours)!.week), go('work-done')))}
                busy={busy}
              />
            </>
          )}

          {step === 'work-done' && (
            <>
              <Heading title="You’re set" sub="Now add what’s on your plate. One line each is enough." />
              <Tip>
                Type it how you’d say it: <span className="num text-fg">client deck fri 3pm 2h</span>. FocusFlow picks up the area, the due date and how long it takes, and fills in the rest.
              </Tip>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => void finish('/')}>
                  Look around first
                </Button>
                <Button variant="primary" icon={Plus} onClick={() => void finish('/', true)}>
                  Add my first task
                </Button>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="text-xs text-negative">
              {error}
            </p>
          )}
        </main>

        {step === 'welcome' && (
          <p className="text-center text-2xs text-fg-faint">Your data stays in this browser. No account needed.</p>
        )}
        {step !== 'welcome' && !step.endsWith('done') && (
          <button
            type="button"
            onClick={() =>
              void attempt(async () => {
                // Make sure there's somewhere to put tasks, then leave the rest for later.
                await createCategory('Personal');
                await finish('/');
              })
            }
            className="focus-ring self-center rounded-xs text-2xs text-fg-faint hover:text-fg-subtle"
          >
            Skip setup
          </button>
        )}
      </div>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-lg font-medium text-fg">{title}</h1>
      <p className="text-sm text-fg-muted">{sub}</p>
    </div>
  );
}

function Choice({ icon: Icon, title, detail, onClick }: { icon: typeof Briefcase; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring group flex flex-col items-start gap-2 rounded-sm border border-line-strong bg-raised/40 p-4 text-left transition-colors hover:border-[rgb(124_131_255/0.55)] hover:bg-accent-muted"
    >
      <Icon size={18} className="text-accent" />
      <span className="flex w-full items-center justify-between text-sm font-medium text-fg">
        {title}
        <ArrowRight size={14} className="text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </span>
      <span className="text-xs text-fg-subtle">{detail}</span>
    </button>
  );
}

function Footer({ back, next, nextLabel = 'Continue', disabled, busy, extra }: { back?: () => void; next: () => void; nextLabel?: string; disabled?: boolean; busy?: boolean; extra?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-line pt-4">
      {back && (
        <Button variant="ghost" icon={ArrowLeft} onClick={back} disabled={busy}>
          Back
        </Button>
      )}
      <span className="ml-auto" />
      {extra}
      <Button variant="primary" onClick={next} disabled={disabled || busy} trailing={busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowRight size={13} />}>
        {nextLabel}
      </Button>
    </div>
  );
}

function Done({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', ok ? 'bg-positive/15 text-positive' : 'bg-line text-fg-subtle')}>{ok ? <Check size={11} strokeWidth={2.5} /> : <span className="size-1 rounded-full bg-current" />}</span>
      <span className={ok ? 'text-fg' : 'text-fg-subtle'}>{children}</span>
    </li>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <p className="rounded-sm border border-line bg-raised/40 px-3 py-2.5 text-xs text-fg-muted">{children}</p>;
}

function TermFields({ term, onChange }: { term: Term; onChange: (t: Term) => void }) {
  const ok = isValidTerm(term);
  const now = Date.now();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1.3fr_1.2fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Quarter</span>
          <Input value={term.name} maxLength={40} onChange={(e) => onChange({ ...term, name: e.target.value })} placeholder="Fall 2026" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">First day of classes</span>
          <input
            type="date"
            value={term.start}
            onChange={(e) => e.target.value && onChange({ ...term, start: e.target.value })}
            className="focus-ring num h-7 rounded-sm border border-line-strong bg-raised px-2.5 text-sm text-fg [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Weeks</span>
          <input
            type="number"
            min={1}
            max={20}
            value={term.weeks}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 20) onChange({ ...term, weeks: n });
            }}
            className="focus-ring num h-7 w-20 rounded-sm border border-line-strong bg-raised px-2.5 text-sm text-fg"
          />
        </label>
      </div>
      {ok && (
        <p className="text-xs text-fg-subtle">
          Starts {format(parseISO(term.start), 'EEEE MMM d')}. Today is <span className="text-fg-muted">{termWeek(term, now).label}</span>
          {finalsCountdown(term, now) ? ` · ${finalsCountdown(term, now)}` : ''}.
        </p>
      )}
    </div>
  );
}

function ClassesStep({ done, busy, onAdd, next, back }: { done: ClassSummary[] | null; busy: boolean; onAdd: (text: string) => Promise<void>; next: () => void; back: () => void }) {
  const [text, setText] = useState('');
  if (done) {
    return (
      <>
        <Heading title="Your classes" sub="Added to your timeline for every week of the quarter. Study time is planned around them." />
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
          {done.map((c) => (
            <li key={c.course} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="w-28 shrink-0 text-sm font-medium text-fg">{c.course}</span>
              <span className="num flex-1 text-xs text-fg-muted">{c.lines.join(' · ')}</span>
              {c.final && <span className="text-2xs text-warning">Final in Exams</span>}
            </li>
          ))}
        </ul>
        <Footer back={back} next={next} />
      </>
    );
  }
  return (
    <>
      <Heading title="Your classes" sub="Paste your Study List from MyUCLA and your lectures, discussions and finals go straight onto your schedule." />
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-fg-muted marker:text-fg-subtle">
        <li>
          In MyUCLA, open <span className="text-fg">Classes → Study List</span>.
        </li>
        <li>Select from your first course down to the last section and copy it.</li>
        <li>Paste it here.</li>
      </ol>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} spellCheck={false} aria-label="Study List" placeholder={'Economics\n\n11 - Microeconomic Theory\n…'} className="num resize-y text-xs" />
      <Footer
        back={back}
        next={() => void onAdd(text)}
        nextLabel="Add my classes"
        disabled={!text.trim()}
        busy={busy}
        extra={
          <Button variant="ghost" onClick={next} disabled={busy}>
            Skip for now
          </Button>
        }
      />
    </>
  );
}

function AssignmentsStep({
  done,
  busy,
  onFeed,
  onFile,
  next,
  back,
}: {
  done: { count: number; courses: number; live: boolean } | null;
  busy: boolean;
  onFeed: (url: string) => Promise<void>;
  onFile: (file: File) => Promise<void>;
  next: () => void;
  back: () => void;
}) {
  const [link, setLink] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  if (done) {
    return (
      <>
        <Heading title="Your assignments" sub={done.live ? 'From now on, new ones and changed due dates come in by themselves when you open FocusFlow.' : 'Imported from your file. To get new ones automatically, connect the feed link later under Settings → BruinLearn.'} />
        <Tip>
          <span className="num text-fg">{done.count}</span> upcoming assignment{done.count === 1 ? '' : 's'} added across <span className="num text-fg">{done.courses}</span> course{done.courses === 1 ? '' : 's'}, each with a time estimate you can adjust.
        </Tip>
        <Footer back={back} next={next} />
      </>
    );
  }
  return (
    <>
      <Heading title="Your assignments" sub="Connect BruinLearn once and your assignments and due dates keep themselves up to date." />
      <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-fg-muted marker:text-fg-subtle">
        <li>
          In BruinLearn, open <span className="text-fg">Calendar</span>.
        </li>
        <li>
          Click <span className="text-fg">Calendar Feed</span> (bottom right) and copy the link.
        </li>
        <li>Paste it here. It stays private, in this browser only.</li>
      </ol>
      <Input icon={Link2} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://bruinlearn.ucla.edu/feeds/calendars/user_….ics" autoComplete="off" spellCheck={false} aria-label="BruinLearn calendar feed link" />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="focus-ring flex items-center gap-1.5 self-start rounded-xs text-xs text-fg-subtle hover:text-fg">
        <FileUp size={12} /> Or import a downloaded .ics file
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />
      <Footer
        back={back}
        next={() => void onFeed(link)}
        nextLabel="Connect"
        disabled={!normalizeFeedUrl(link)}
        busy={busy}
        extra={
          <Button variant="ghost" onClick={next} disabled={busy}>
            Skip for now
          </Button>
        }
      />
    </>
  );
}

function AreasField({ areas, onChange }: { areas: string[]; onChange: (a: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const n = draft.trim();
    if (n && !areas.some((a) => a.toLowerCase() === n.toLowerCase())) onChange([...areas, n]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-1.5">
        {areas.map((a) => (
          <li key={a} className="inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong bg-raised pl-2.5 pr-1 text-sm text-fg">
            {a}
            <button type="button" aria-label={`Remove ${a}`} onClick={() => onChange(areas.filter((x) => x !== a))} className="focus-ring grid size-5 place-items-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg">
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an area, e.g. Side project" maxLength={40} className="flex-1" />
        <Button type="submit" variant="secondary" icon={Plus} disabled={!draft.trim()}>
          Add
        </Button>
      </form>
      <div className="flex flex-wrap gap-1.5 text-xs text-fg-subtle">
        Ideas:
        {['Clients', 'Admin', 'Health', 'Learning', 'Home']
          .filter((s) => !areas.includes(s))
          .map((s) => (
            <button key={s} type="button" onClick={() => onChange([...areas, s])} className="focus-ring rounded-xs text-fg-muted underline decoration-line-strong underline-offset-2 hover:text-fg">
              {s}
            </button>
          ))}
      </div>
    </div>
  );
}
