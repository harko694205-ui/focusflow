import { useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { ChevronDown, Download, GitBranch, HardDrive, Plus, Settings2, Upload, Wand2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import { categoryStats, summarize } from '@/domain/stats';
import { useExams, useProfile, useTerms, useWorkspace } from '@/hooks/data';
import { settingsActions } from '@/features/settings/actions';
import { CategorySwatch } from '@/features/tasks/TaskMeta';
import { NAV } from './nav';
import { AppIcon } from './AppIcon';
import { useUI } from './store';
import { Tooltip } from '@/ui/Tooltip';
import { Kbd } from '@/ui/Kbd';
import { Meter } from '@/ui/Data';
import { Skeleton } from '@/ui/Feedback';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, MenuLabel } from '@/ui/Menu';
import { scenarioLateDelta, useScenarios } from '@/features/simulator/model';
import { useSim } from '@/features/simulator/store';

export function Logo({ size = 20 }: { size?: number }) {
  return <AppIcon size={size} />;
}

export function Sidebar({ collapsed }: { collapsed: boolean }) {
  const terms = useTerms();
  const mode = useProfile().mode;
  const exams = useExams();
  const openCreate = useUI((s) => s.openCreate);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tasks, categories, risk, now, week, loading } = useWorkspace();
  const allScenarios = useScenarios();
  const drafts = useMemo(() => (allScenarios ?? []).filter((s) => s.status === 'draft'), [allScenarios]);
  const lateDeltas = useMemo(() => new Map(drafts.slice(0, 5).map((s) => [s.id, scenarioLateDelta(s, now, week)])), [drafts, now, week]);

  const summary = summarize(tasks, risk, now, week);
  const perCategory = categoryStats(tasks, categories, risk);
  const booked = summary.dueSoonMinutes;
  const capacity = summary.capacity7d;
  const badges: Record<string, number | undefined> = {
    '/tasks': loading ? undefined : summary.openCount,
    '/simulator': drafts.length || undefined,
    // Exams in the next two weeks.
    '/exams': (exams ?? []).filter((e) => e.start > now && e.start - now < 14 * 86_400_000).length || undefined,
  };

  return (
    <nav
      aria-label="Primary"
      className={cn('flex h-full flex-col bg-panel', collapsed ? 'w-14 items-center' : 'w-[232px]')}
    >
      {/* Workspace */}
      <div className={cn('flex h-12 shrink-0 items-center', collapsed ? 'justify-center' : 'px-2.5')}>
        <Menu>
          <MenuTrigger asChild>
            <button
              className={cn(
                'focus-ring flex h-8 items-center gap-2 rounded-sm transition-colors hover:bg-hover',
                collapsed ? 'w-8 justify-center' : 'w-full px-1.5',
              )}
            >
              <Logo />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left text-sm font-semibold tracking-[-0.01em]">FocusFlow</span>
                  <ChevronDown size={13} className="text-fg-subtle" />
                </>
              )}
            </button>
          </MenuTrigger>
          <MenuContent className="w-56">
            <MenuLabel>Local workspace</MenuLabel>
            <MenuItem icon={Download} onSelect={() => void settingsActions.exportBackup()}>
              Export backup
            </MenuItem>
            {/* Importing replaces everything, so it goes through Settings, which confirms first. */}
            <MenuItem icon={Upload} onSelect={() => navigate('/settings#data')}>
              Import backup…
            </MenuItem>
            <MenuItem icon={Settings2} onSelect={() => navigate('/settings')}>
              Settings
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Wand2} onSelect={() => navigate('/design')}>
              Design system
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>

      {/* New task */}
      <div className={cn('shrink-0 pb-3', collapsed ? 'px-0' : 'px-2.5')}>
        <Tooltip content="New task" shortcut={['C']} side="right" disabled={!collapsed}>
          <button
            onClick={() => openCreate()}
            className={cn(
              'focus-ring group flex h-8 items-center gap-2 rounded-sm border border-line-strong bg-raised text-sm text-fg-muted',
              'shadow-[inset_0_1px_0_rgb(255_255_255/0.03)] transition-colors hover:bg-hover hover:text-fg',
              collapsed ? 'w-8 justify-center' : 'w-full px-2.5',
            )}
          >
            <Plus size={14} strokeWidth={2} />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">New task</span>
                <Kbd keys={['C']} />
              </>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Primary nav */}
      <ul className={cn('flex shrink-0 flex-col gap-px', collapsed ? 'items-center' : 'px-2.5')}>
        {NAV.filter((item) => !item.studentOnly || mode === 'student').map((item) => {
          const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
          const badge = badges[item.to];
          return (
            <li key={item.to} className={collapsed ? '' : 'w-full'}>
              <Tooltip content={item.label} shortcut={['G', item.key]} side="right" disabled={!collapsed}>
                <NavLink
                  to={item.to}
                  onClick={() => setMobileNav(false)}
                  className={cn(
                    'focus-ring relative flex h-7 items-center gap-2.5 rounded-sm text-sm transition-colors duration-100',
                    collapsed ? 'w-8 justify-center' : 'px-2',
                    active ? 'text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-sm bg-active shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
                      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                    />
                  )}
                  <item.icon
                    size={15}
                    strokeWidth={1.75}
                    className={cn('relative shrink-0', active ? 'text-accent' : 'text-fg-subtle')}
                  />
                  {!collapsed && (
                    <>
                      <span className="relative flex-1 truncate">{item.label}</span>
                      {badge !== undefined && (
                        <span className="num relative text-2xs text-fg-subtle">{badge}</span>
                      )}
                    </>
                  )}
                </NavLink>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      {!collapsed && (
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-2.5 pb-3">
          {/* Scenarios */}
          <section>
            <h3 className="eyebrow flex h-6 items-center px-2">Draft scenarios</h3>
            <ul className="flex flex-col gap-px">
              {drafts.length === 0 && (
                <li>
                  <NavLink
                    to="/simulator"
                    className="focus-ring flex h-7 items-center gap-2 rounded-sm px-2 text-xs text-fg-subtle transition-colors hover:bg-hover hover:text-fg-muted"
                  >
                    <Plus size={12} /> Try a what-if scenario
                  </NavLink>
                </li>
              )}
              {drafts.slice(0, 5).map((s) => {
                const late = lateDeltas.get(s.id) ?? 0;
                return (
                  <li key={s.id}>
                    <NavLink
                      to="/simulator"
                      onClick={() => useSim.getState().set({ scenarioId: s.id, selectedBlockId: null, creating: null })}
                      className="focus-ring group flex h-7 items-center gap-2 rounded-sm px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                    >
                      <GitBranch size={13} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />
                      <span className="flex-1 truncate">{s.name}</span>
                      {late !== 0 ? (
                        <span
                          className={cn('num text-2xs', late > 0 ? 'text-negative' : 'text-positive')}
                          title={`${late > 0 ? '+' : ''}${late} late tasks vs. your current schedule`}
                        >
                          {late > 0 ? '+' : '−'}
                          {Math.abs(late)} late
                        </span>
                      ) : (
                        <span className="num text-2xs text-fg-subtle">{s.ops.length}Δ</span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Categories */}
          <section>
            <h3 className="eyebrow flex h-6 items-center px-2">{terms.many}</h3>
            <ul className="flex flex-col gap-px">
              {loading &&
                Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="flex h-7 items-center gap-2.5 px-2">
                    <Skeleton className="size-2" />
                    <Skeleton className="h-2.5 flex-1" />
                  </li>
                ))}
              {perCategory.map(({ category, openMinutes, troubleCount }) => (
                <li key={category.id}>
                  <NavLink
                    to={`/tasks?category=${category.id}`}
                    className="focus-ring flex h-7 items-center gap-2.5 rounded-sm px-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    <CategorySwatch category={category} />
                    <span className="flex-1 truncate">{category.name}</span>
                    {troubleCount > 0 && (
                      <Tooltip content={`${troubleCount} overdue or projected late`} side="right">
                        <span className="size-1.5 shrink-0 rounded-full bg-negative" />
                      </Tooltip>
                    )}
                    <span className="num text-2xs text-fg-subtle">{openMinutes ? formatDuration(openMinutes, { compact: true }) : '—'}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {/* Footer */}
      <div className={cn('mt-auto shrink-0 border-t border-line', collapsed ? 'w-full py-3' : 'px-4 py-3')}>
        {collapsed ? (
          <Tooltip content="Stored locally in this browser" side="right">
            <div className="flex justify-center text-fg-subtle">
              <HardDrive size={14} strokeWidth={1.75} />
            </div>
          </Tooltip>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <Tooltip content="Work due in the next 7 days vs. working time available" side="top">
                <span className="text-xs text-fg-muted">Next 7 days</span>
              </Tooltip>
              <span className="num text-xs text-fg">
                {formatDuration(booked, { compact: true })}
                <span className="text-fg-subtle"> / {formatDuration(capacity, { compact: true })}</span>
              </span>
            </div>
            <Meter value={booked} max={capacity} height={3} color={booked > capacity ? 'var(--color-negative)' : undefined} />
            <div className="flex items-center gap-1.5 text-2xs text-fg-subtle">
              <span className="size-1.5 rounded-full bg-positive" />
              Saved locally · IndexedDB
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
