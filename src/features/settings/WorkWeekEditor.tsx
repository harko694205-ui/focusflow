import { useEffect, useMemo, useState } from 'react';
import { CopyCheck, Plus, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DEFAULT_WORK_WEEK, type WorkWeek } from '@/domain/constants';
import {
  dayMinutes,
  presetOf,
  sameWeek,
  suggestInterval,
  weeklyMinutes,
  weekProblems,
  WEEKDAYS,
  WORK_WEEK_PRESETS,
  MAX_INTERVALS,
  MIN_WEEKLY,
  parseClock,
  type Weekday,
  type WorkInterval,
} from '@/domain/workweek';
import { formatClock, formatDuration } from '@/lib/format';
import { Button, IconButton } from '@/ui/Button';
import { Tooltip } from '@/ui/Tooltip';
import { settingsActions } from './actions';

const clone = (w: WorkWeek): WorkWeek => Object.fromEntries(Object.entries(w).map(([d, ivs]) => [d, ivs.map((x) => ({ ...x }))])) as WorkWeek;

/**
 * Edit the weekly working hours as a draft; nothing changes until Save, because every
 * capacity, risk and scheduling number in the app follows these hours.
 */
export function WorkWeekEditor({ week }: { week: WorkWeek }) {
  const [draft, setDraft] = useState<WorkWeek>(() => clone(week));
  // A change saved elsewhere (another tab, undo) replaces an untouched draft.
  const [base, setBase] = useState(week);
  useEffect(() => {
    if (!sameWeek(week, base)) {
      setBase(week);
      setDraft(clone(week));
    }
  }, [week, base]);

  const problems = useMemo(() => weekProblems(draft), [draft]);
  const total = weeklyMinutes(draft);
  const invalid = Object.keys(problems).length > 0 || total < MIN_WEEKLY;
  const dirty = !sameWeek(draft, week);
  const preset = presetOf(draft);

  const setDay = (day: Weekday, ivs: WorkInterval[]) => setDraft((w) => ({ ...w, [day]: ivs }));
  const copyToWorkdays = (from: Weekday) =>
    setDraft((w) => {
      const next = clone(w);
      for (const { day } of WEEKDAYS) if (day !== from && w[day].length) next[day] = w[from].map((x) => ({ ...x }));
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Presets">
        {WORK_WEEK_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            onClick={() => setDraft(clone(p.week))}
            className={cn(
              'focus-ring flex flex-col items-start rounded-sm border px-2.5 py-1.5 text-left transition-colors',
              preset === p.id ? 'border-[rgb(124_131_255/0.45)] bg-accent-muted' : 'border-line-strong hover:bg-hover',
            )}
          >
            <span className="text-xs font-medium text-fg">{p.label}</span>
            <span className="text-2xs text-fg-subtle">{p.hint}</span>
          </button>
        ))}
      </div>

      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
        {WEEKDAYS.map(({ day, short, long }) => {
          const ivs = draft[day];
          const on = ivs.length > 0;
          const problem = problems[day];
          return (
            <li key={day} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start">
              <label className="flex h-7 w-28 shrink-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setDay(day, e.target.checked ? (draft[1].length ? draft[1] : DEFAULT_WORK_WEEK[1]).map((x) => ({ ...x })) : [])}
                  className="size-3.5 accent-[var(--color-accent)]"
                  aria-label={`Work on ${long}`}
                />
                <span className={cn('text-sm', on ? 'text-fg' : 'text-fg-subtle')}>{short}</span>
              </label>

              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {on ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ivs.map((iv, i) => (
                      <span key={i} className="flex items-center gap-1 rounded-sm border border-line-strong bg-raised pl-1.5">
                        <TimeInput label={`${long} block ${i + 1} start`} value={iv.start} onChange={(start) => setDay(day, ivs.map((x, j) => (j === i ? { ...x, start } : x)))} />
                        <span className="text-fg-faint">–</span>
                        <TimeInput label={`${long} block ${i + 1} end`} value={iv.end} onChange={(end) => setDay(day, ivs.map((x, j) => (j === i ? { ...x, end } : x)))} />
                        <IconButton icon={X} size="sm" label={`Remove ${long} block ${i + 1}`} onClick={() => setDay(day, ivs.filter((_, j) => j !== i))} />
                      </span>
                    ))}
                    {ivs.length < MAX_INTERVALS && (
                      <Tooltip content="Add a block">
                        <IconButton
                          icon={Plus}
                          size="sm"
                          label={`Add a block on ${long}`}
                          onClick={() => {
                            const next = suggestInterval(ivs);
                            if (next) setDay(day, [...ivs, next]);
                          }}
                        />
                      </Tooltip>
                    )}
                  </div>
                ) : (
                  <span className="flex h-7 items-center text-sm text-fg-subtle">Not working</span>
                )}
                {problem && (
                  <span role="alert" className="text-xs text-negative">
                    {problem}
                  </span>
                )}
              </div>

              <div className="flex h-7 shrink-0 items-center gap-2 sm:w-[168px] sm:justify-end">
                <DayStrip ivs={ivs} />
                <span className="num w-11 text-right text-xs text-fg-muted">{on ? formatDuration(dayMinutes(ivs), { compact: true }) : '—'}</span>
                <Tooltip content="Copy to other working days">
                  <IconButton icon={CopyCheck} size="sm" label={`Copy ${long} to other working days`} disabled={!on || !!problem} onClick={() => copyToWorkdays(day)} />
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-fg-muted">
          <span className="num text-fg">{formatDuration(total, { compact: true })}</span> a week
          {total < MIN_WEEKLY && <span className="text-negative"> · add at least an hour</span>}
        </span>
        <div className="flex-1" />
        {!sameWeek(draft, DEFAULT_WORK_WEEK) && (
          <Button variant="ghost" icon={RotateCcw} onClick={() => setDraft(clone(DEFAULT_WORK_WEEK))}>
            Default hours
          </Button>
        )}
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(clone(week))}>
            Discard
          </Button>
        )}
        <Button variant="primary" disabled={!dirty || invalid} onClick={() => void settingsActions.setWorkWeek(draft)}>
          Save hours
        </Button>
      </div>
    </div>
  );
}

function TimeInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  // 24-hour text field (native time inputs follow the OS locale and may show AM/PM).
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && parseClock(draft) === null;
  const commit = () => {
    if (draft === null) return;
    const v = parseClock(draft);
    if (v !== null) onChange(v);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      aria-invalid={bad || undefined}
      placeholder="hh:mm"
      maxLength={5}
      value={draft ?? (value === 24 * 60 ? '24:00' : formatClock(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={cn('num h-6 w-[46px] bg-transparent text-center text-xs text-fg outline-none', bad && 'text-negative')}
    />
  );
}

/** The day at a glance: 06:00–22:00 with working blocks filled. */
function DayStrip({ ivs }: { ivs: readonly WorkInterval[] }) {
  const from = 6 * 60;
  const span = 16 * 60;
  return (
    <span className="relative hidden h-1.5 w-[80px] overflow-hidden rounded-full bg-active sm:block" aria-hidden>
      {ivs.map((x, i) => {
        const l = Math.max(0, (x.start - from) / span);
        const r = Math.min(1, (x.end - from) / span);
        return r > l ? <span key={i} className="absolute inset-y-0 bg-accent" style={{ left: `${l * 100}%`, width: `${(r - l) * 100}%` }} /> : null;
      })}
    </span>
  );
}
