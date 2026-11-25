import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { format } from 'date-fns';
import { Menu as MenuIcon, PanelLeft, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { navFor } from './nav';
import { useUI } from './store';
import { Button, IconButton } from '@/ui/Button';
import { Kbd, MOD } from '@/ui/Kbd';
import { Tooltip } from '@/ui/Tooltip';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Header() {
  const { pathname } = useLocation();
  const item = pathname === '/design' ? { label: 'Design system', icon: null } : navFor(pathname);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const setPalette = useUI((s) => s.setPalette);
  const openCreate = useUI((s) => s.openCreate);
  const now = useClock();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-canvas/80 px-3 backdrop-blur-md md:px-4">
      {/* Sidebar toggles */}
      {/* Visibility is set on wrappers: `hidden` would conflict with the button's own display class. */}
      <span className="flex md:hidden">
        <IconButton icon={MenuIcon} label="Open navigation" onClick={() => setMobileNav(true)} />
      </span>
      <span className="hidden md:flex">
        <Tooltip content="Toggle sidebar" shortcut={[MOD, '\\']}>
          <IconButton icon={PanelLeft} label="Toggle sidebar" onClick={toggleSidebar} />
        </Tooltip>
      </span>

      <div className="mx-1 hidden h-4 w-px bg-line-strong md:block" />

      {/* Breadcrumb */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="hidden text-fg-subtle sm:inline">Workspace</span>
        <span className="hidden text-fg-faint sm:inline">/</span>
        <span className="truncate font-medium text-fg">{item.label}</span>
      </div>

      <div className="flex-1" />

      {/* Search / palette trigger */}
      <button
        onClick={() => setPalette(true)}
        className={cn(
          'focus-ring hidden h-7 w-64 items-center gap-2 rounded-sm border border-line bg-panel px-2 text-sm text-fg-subtle lg:flex',
          'transition-colors hover:border-line-strong hover:text-fg-muted',
        )}
      >
        <Search size={13} strokeWidth={1.75} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <Kbd keys={[MOD, 'K']} />
      </button>
      <span className="flex lg:hidden">
        <IconButton icon={Search} label="Search" onClick={() => setPalette(true)} />
      </span>

      <div className="mx-1 hidden h-4 w-px bg-line-strong sm:block" />

      {/* Clock */}
      <div className="hidden items-baseline gap-2 px-1 sm:flex" aria-label="Current time">
        <span className="whitespace-nowrap text-xs text-fg-subtle">{format(now, 'EEE d MMM')}</span>
        <span className="num text-sm text-fg">{format(now, 'HH:mm')}</span>
      </div>

      <Tooltip content="Create a task" shortcut={['C']}>
        <Button variant="primary" icon={Plus} onClick={() => openCreate()} className="ml-1">
          <span className="hidden sm:inline">New task</span>
        </Button>
      </Tooltip>
    </header>
  );
}
