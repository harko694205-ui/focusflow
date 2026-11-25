import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { AppWindow, Clock, Crosshair, Database, Keyboard, Palette, Tags } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUI } from '@/app/store';
import { useFocusSettings, useWorkspace } from '@/hooks/data';
import { FocusSettingsForm } from '@/features/focus/FocusSettingsMenu';
import { CategoryManager } from '@/features/settings/CategoryManager';
import { DataSection } from '@/features/settings/DataSection';
import { AppSection } from '@/features/settings/AppSection';
import { WorkWeekEditor } from '@/features/settings/WorkWeekEditor';
import { Button } from '@/ui/Button';
import { Skeleton } from '@/ui/Feedback';
import { Kbd } from '@/ui/Kbd';
import { Page, PageHeader } from './PageHeader';

const SECTIONS = [
  { id: 'hours', label: 'Working hours', icon: Clock },
  { id: 'focus', label: 'Focus Mode', icon: Crosshair },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'app', label: 'App', icon: AppWindow },
  { id: 'help', label: 'Shortcuts & about', icon: Keyboard },
] as const;

export function SettingsPage() {
  const ws = useWorkspace();
  const focus = useFocusSettings();
  const setShortcuts = useUI((s) => s.setShortcuts);
  const navigate = useNavigate();
  const active = useActiveSection();

  return (
    <Page>
      <PageHeader title="Settings" meta="Preferences and data for this browser. Nothing leaves your device." />
      <div className="flex gap-8">
        <nav aria-label="Settings sections" className="sticky top-0 hidden w-44 shrink-0 self-start lg:block">
          <ul className="flex flex-col gap-px">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    history.replaceState(null, '', `#${s.id}`);
                  }}
                  className={cn(
                    'focus-ring flex h-7 items-center gap-2 rounded-sm px-2 text-sm transition-colors',
                    active === s.id ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <s.icon size={14} strokeWidth={1.75} className={active === s.id ? 'text-accent' : 'text-fg-subtle'} />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 max-w-[880px] flex-1 flex-col gap-5">
          <Section id="hours" title="Working hours" description="Your capacity. Risk, load, the timeline, auto-scheduling, the simulator and insights all plan within these hours.">
            {ws.loading ? <Skeleton className="h-[320px]" /> : <WorkWeekEditor week={ws.week} />}
          </Section>

          <Section id="focus" title="Focus Mode" description="Default interval lengths and reminders. Changes apply to a running session straight away.">
            {focus ? (
              <div className="max-w-[360px]">
                <FocusSettingsForm settings={focus} />
              </div>
            ) : (
              <Skeleton className="h-[240px]" />
            )}
          </Section>

          <Section id="categories" title="Categories" description="Rename, recolor or remove categories. Deleting one moves its tasks to another.">
            {ws.loading ? <Skeleton className="h-[200px]" /> : <CategoryManager categories={ws.categories} tasks={ws.tasks} />}
          </Section>

          <Section id="data" title="Data" description="FocusFlow has no account or server: your workspace lives in this browser. Export a backup to move it or keep it safe.">
            <DataSection />
          </Section>

          <Section id="app" title="App" description="Install FocusFlow on this device and use it offline.">
            <AppSection />
          </Section>

          <Section id="help" title="Shortcuts & about">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" icon={Keyboard} onClick={() => setShortcuts(true)} trailing={<Kbd keys={['?']} />}>
                  Keyboard shortcuts
                </Button>
                <Button variant="ghost" icon={Palette} onClick={() => navigate('/design')}>
                  Design system
                </Button>
              </div>
              <p className="text-xs text-fg-subtle">
                FocusFlow <span className="num">v{__APP_VERSION__}</span> · a personal workload operating system. No account, no server: your data never leaves this device, and the app works offline once loaded.
              </p>
            </div>
          </Section>
        </div>
      </div>
    </Page>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-md border border-line bg-panel">
      <header className="border-b border-line px-4 py-3">
        <h2 id={`${id}-title`} className="text-sm font-medium text-fg">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** The section nearest the top of the scroll area, for the side nav. */
function useActiveSection() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '0px 0px -60% 0px' },
    );
    els.forEach((e) => obs.observe(e));
    // Deep link: /settings#data
    const hash = location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' });
    return () => obs.disconnect();
  }, []);
  return active;
}
