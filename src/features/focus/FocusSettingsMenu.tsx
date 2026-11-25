import { useState } from 'react';
import { Popover } from 'radix-ui';
import { Bell, SlidersHorizontal, Volume2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FOCUS_PRESETS, LIMITS, type FocusSettings } from '@/domain/focus';
import { useFocusSettings } from '@/hooks/data';
import { IconButton } from '@/ui/Button';
import { SegmentedControl } from '@/ui/Data';
import { Tooltip } from '@/ui/Tooltip';
import { focusActions } from './actions';
import { chime, notificationPermission, requestNotifications, unlockAudio } from './reminders';

export function presetOf(s: FocusSettings): string {
  return FOCUS_PRESETS.find((p) => p.focus === s.focus && p.shortBreak === s.shortBreak && p.longBreak === s.longBreak)?.id ?? 'custom';
}

/** Preset picker shared by the task picker and the settings popover. */
export function PresetControl({ settings }: { settings: FocusSettings }) {
  const preset = presetOf(settings);
  return (
    <SegmentedControl
      size="md"
      value={preset}
      onChange={(id) => {
        const p = FOCUS_PRESETS.find((x) => x.id === id);
        if (p) void focusActions.settings({ focus: p.focus, shortBreak: p.shortBreak, longBreak: p.longBreak });
      }}
      options={[...FOCUS_PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(preset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : [])]}
    />
  );
}

export function FocusSettingsMenu() {
  const settings = useFocusSettings();
  return (
    <Popover.Root>
      <Tooltip content="Timer settings">
        <Popover.Trigger asChild>
          <IconButton icon={SlidersHorizontal} label="Timer settings" />
        </Popover.Trigger>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[300px] rounded-md border border-line-strong bg-raised p-3.5 shadow-pop animate-pop-in"
        >
          {settings && <SettingsBody settings={settings} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SettingsBody({ settings: s }: { settings: FocusSettings }) {
  const [perm, setPerm] = useState(notificationPermission);
  const set = (patch: Partial<FocusSettings>) => void focusActions.settings(patch);

  return (
    <div className="flex flex-col gap-3.5">
      <section className="flex flex-col gap-2">
        <Heading>Intervals</Heading>
        <PresetControl settings={s} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Focus" unit="min" value={s.focus} range={LIMITS.focus} onChange={(focus) => set({ focus })} />
          <NumberField label="Short break" unit="min" value={s.shortBreak} range={LIMITS.shortBreak} onChange={(shortBreak) => set({ shortBreak })} />
          <NumberField label="Long break" unit="min" value={s.longBreak} range={LIMITS.longBreak} onChange={(longBreak) => set({ longBreak })} />
          <NumberField label="Long break every" unit="" value={s.longEvery} range={LIMITS.longEvery} onChange={(longEvery) => set({ longEvery })} />
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <Heading>Flow</Heading>
        <Toggle label="Start breaks automatically" checked={s.autoStartBreaks} onChange={(autoStartBreaks) => set({ autoStartBreaks })} />
        <Toggle label="Start focus after a break" checked={s.autoStartFocus} onChange={(autoStartFocus) => set({ autoStartFocus })} />
      </section>

      <section className="flex flex-col gap-1">
        <Heading>Reminders</Heading>
        <Toggle
          label="Chime"
          icon={<Volume2 size={12} />}
          checked={s.sound}
          onChange={(sound) => {
            set({ sound });
            if (sound) {
              unlockAudio();
              chime('break');
            }
          }}
        />
        <Toggle
          label="Desktop notification"
          icon={<Bell size={12} />}
          checked={s.notifications && perm === 'granted'}
          disabled={perm === 'unsupported' || perm === 'denied'}
          onChange={async (on) => {
            if (!on) return set({ notifications: false });
            const ok = await requestNotifications();
            setPerm(notificationPermission());
            set({ notifications: ok });
          }}
        />
        <p className="text-2xs text-fg-subtle">
          {perm === 'denied'
            ? 'Notifications are blocked for this site in your browser settings.'
            : perm === 'unsupported'
              ? 'This browser doesn’t support notifications.'
              : 'Shown when the tab is in the background.'}
        </p>
      </section>
    </div>
  );
}

const Heading = ({ children }: { children: string }) => <h3 className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">{children}</h3>;

function NumberField({ label, unit, value, range, onChange }: { label: string; unit: string; value: number; range: readonly [number, number]; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n) && draft.trim() !== '') onChange(n);
    setDraft(null);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="focus-within:border-line-focus flex h-7 items-center rounded-sm border border-line-strong bg-canvas px-2">
        <input
          type="number"
          inputMode="numeric"
          min={range[0]}
          max={range[1]}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="num w-full min-w-0 bg-transparent text-sm text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && <span className="text-2xs text-fg-subtle">{unit}</span>}
      </span>
    </label>
  );
}

function Toggle({ label, icon, checked, disabled, onChange }: { label: string; icon?: React.ReactNode; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="focus-ring -mx-1.5 flex h-7 items-center gap-2 rounded-sm px-1.5 text-left text-sm text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {icon && <span className="text-fg-subtle">{icon}</span>}
      <span className="flex-1">{label}</span>
      <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-active')}>
        <span className={cn('absolute top-0.5 size-3 rounded-full bg-fg transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}
