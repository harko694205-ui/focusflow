import { useNavigate } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import { NAV } from '@/app/nav';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Data';
import { Tag } from '@/ui/Data';
import { Page, PageHeader } from './PageHeader';

type PageKey = 'timeline' | 'tasks' | 'simulator' | 'insights' | 'settings';

const plan: Record<PageKey, { phase: number; scope: string[] }> = {
  tasks: {
    phase: 1,
    scope: ['Dense keyboard-driven table with grouping', 'Inline editing and detail sheet', 'Filters by project, energy and deadline', 'Persisted to IndexedDB via Dexie'],
  },
  timeline: {
    phase: 3,
    scope: ['Day / 3-day / week time grid', 'Capacity shading and overload hatching', 'Drag and resize blocks with 15-min snap', 'Unscheduled tray and auto-fill'],
  },
  simulator: {
    phase: 4,
    scope: ['Fork the committed schedule into scenarios', 'Levers: move, defer, drop, re-estimate, change capacity', 'Baseline vs. scenario compare with animated re-flow', 'Consequence panel and atomic commit'],
  },
  insights: {
    phase: 5,
    scope: ['Estimate accuracy (planned vs. actual)', 'Load distribution by project and energy', 'Focus fragmentation trend', 'Throughput and completion history'],
  },
  settings: {
    phase: 6,
    scope: ['Weekly working hours and peak focus windows', 'Week start, time format', 'Export, import and reset local data', 'Keyboard shortcut reference'],
  },
};

export function PlaceholderPage({ page }: { page: PageKey }) {
  const nav = NAV.find((n) => n.to === `/${page}`)!;
  const { phase, scope } = plan[page];
  const navigate = useNavigate();

  return (
    <Page>
      <PageHeader title={nav.label} meta={nav.description} />
      <Panel className="max-w-[560px]">
        <div className="flex items-start gap-4 p-5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line-strong bg-raised">
            <nav.icon size={17} strokeWidth={1.75} className="text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-medium">Arrives in Phase {phase}</h2>
              <Tag tone="accent">Planned</Tag>
            </div>
            <p className="mt-1 text-sm text-fg-muted">The shell and design system are in place. This view will include:</p>
            <ul className="mt-3 flex flex-col gap-2">
              {scope.map((s) => (
                <li key={s} className="flex items-center gap-2 text-sm text-fg-muted">
                  <Check size={13} strokeWidth={2} className="shrink-0 text-fg-subtle" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {page === 'settings' && (
            <Button variant="secondary" onClick={() => navigate('/design')}>
              View design system
            </Button>
          )}
          <Button variant="ghost" trailing={<ArrowRight size={13} />} onClick={() => navigate('/')}>
            Back to Command Center
          </Button>
        </div>
      </Panel>
    </Page>
  );
}
