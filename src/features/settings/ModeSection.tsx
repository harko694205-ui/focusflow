import { useState } from 'react';
import { Briefcase, CalendarRange, Clock, GraduationCap } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { WorkWeek } from '@/domain/constants';
import { DUE_TIME_DEFAULTS, type Mode, type Profile } from '@/domain/profile';
import { finalsCountdown, suggestTerm, termWeek, type Term } from '@/domain/term';
import { presetOf, STUDENT_PRESET, weeklyMinutes } from '@/domain/workweek';
import { formatDuration } from '@/lib/format';
import { Button } from '@/ui/Button';
import { profileActions, settingsActions } from './actions';

const MODES: Array<{ mode: Mode; label: string; hint: string; icon: typeof Briefcase }> = [
  { mode: 'work', label: 'Work', hint: 'Categories, 5 pm deadlines', icon: Briefcase },
  { mode: 'student', label: 'Student', hint: 'Courses, 11:59 pm deadlines, quarter weeks', icon: GraduationCap },
];

/** Work or Student mode, the academic term, and the default due time. */
export function ModeSection({ profile, week, now }: { profile: Profile; week: WorkWeek; now: number }) {
  const switchTo = (mode: Mode) => {
    if (mode === profile.mode) return;
    void profileActions.update(
      {
        mode,
        // Keep a custom due time; swap the default one.
        dueTime: profile.dueTime === DUE_TIME_DEFAULTS[profile.mode] ? DUE_TIME_DEFAULTS[mode] : profile.dueTime,
        term: mode === 'student' && !profile.term ? suggestTerm(now) : profile.term,
      },
      mode === 'student' ? 'Student mode on · courses, 11:59 pm deadlines and quarter weeks' : 'Work mode on',
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Mode">
        {MODES.map((m) => {
          const on = profile.mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => switchTo(m.mode)}
              className={cn(
                'focus-ring flex items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors',
                on ? 'border-[rgb(124_131_255/0.45)] bg-accent-muted' : 'border-line-strong hover:bg-hover',
              )}
            >
              <m.icon size={16} className={on ? 'text-accent' : 'text-fg-subtle'} />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-fg">{m.label}</span>
                <span className="text-xs text-fg-subtle">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {profile.mode === 'student' && (
        <>
          {profile.term && <TermEditor key={JSON.stringify(profile.term)} term={profile.term} now={now} />}
          {presetOf(week) !== 'student' && (
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-dashed border-line-strong px-3 py-2.5">
              <Clock size={14} className="shrink-0 text-fg-subtle" />
              <span className="min-w-[220px] flex-1 text-xs text-fg-muted">
                Your working hours are <span className="num text-fg">{formatDuration(weeklyMinutes(week), { compact: true })}</span> a week. Student hours plan study time across
                days, evenings and Sunday ({STUDENT_PRESET.hint}). You can fine-tune them under Working hours.
              </span>
              <Button size="sm" variant="secondary" onClick={() => void settingsActions.setWorkWeek(STUDENT_PRESET.week)}>
                Use student hours
              </Button>
            </div>
          )}
        </>
      )}

      <DueTimeField value={profile.dueTime} />
    </div>
  );
}

function TermEditor({ term, now }: { term: Term; now: number }) {
  const [draft, setDraft] = useState(term);
  const save = (next: Term) => {
    setDraft(next);
    void profileActions.update({ term: next });
  };
  const status = termWeek(term, now);
  const finals = finalsCountdown(term, now);

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-line p-3">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <CalendarRange size={13} className="text-fg-subtle" />
        <span>
          Today is <span className="font-medium text-fg">{status.label}</span>
          {finals && <span className="text-fg-subtle"> · {finals}</span>}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Term</span>
          <input
            value={draft.name}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => draft.name.trim() && draft.name !== term.name && save({ ...draft, name: draft.name.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="focus-ring h-7 rounded-sm border border-line-strong bg-raised px-2.5 text-sm text-fg"
            placeholder="Fall 2026"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">First day of instruction</span>
          <input
            type="date"
            value={draft.start}
            onChange={(e) => e.target.value && save({ ...draft, start: e.target.value })}
            className="focus-ring num h-7 rounded-sm border border-line-strong bg-raised px-2.5 text-sm text-fg [color-scheme:dark]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">Weeks</span>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.weeks}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 20) save({ ...draft, weeks: n });
            }}
            className="focus-ring num h-7 w-20 rounded-sm border border-line-strong bg-raised px-2.5 text-sm text-fg"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-fg-muted">
        <input type="checkbox" checked={draft.finals} onChange={(e) => save({ ...draft, finals: e.target.checked })} className="size-3.5 accent-[var(--color-accent)]" />
        Finals week after the last week of instruction
      </label>
      <p className="text-2xs text-fg-subtle">
        Weeks run Monday to Sunday. A term starting Thursday–Sunday (UCLA fall) begins with a partial Week 0.
      </p>
    </div>
  );
}

function DueTimeField({ value }: { value: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft);
  const commit = () => {
    if (draft !== null && !bad && draft !== value) void profileActions.update({ dueTime: draft }, `New deadlines default to ${draft}`);
    setDraft(null);
  };
  return (
    <label className="flex flex-wrap items-center gap-3">
      <span className="flex flex-col">
        <span className="text-sm text-fg">Default due time</span>
        <span className="text-xs text-fg-subtle">Used for new tasks; you can still pick any time.</span>
      </span>
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        maxLength={5}
        inputMode="numeric"
        aria-invalid={bad || undefined}
        aria-label="Default due time (24-hour, hh:mm)"
        className={cn('focus-ring num ml-auto h-7 w-20 rounded-sm border border-line-strong bg-raised px-2.5 text-center text-sm text-fg', bad && 'border-[rgb(229_83_75/0.6)] text-negative')}
      />
    </label>
  );
}
