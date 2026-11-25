import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CheckCircle2, CornerDownLeft, Keyboard, PanelLeft, Plus, Search, Undo2, Wand2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Dialog } from '@/ui/Dialog';
import { Kbd, MOD } from '@/ui/Kbd';
import { taskRef } from '@/domain/constants';
import { useTasks, useCategories, useCategoryMap } from '@/hooks/data';
import { categoryColor } from '@/features/tasks/TaskMeta';
import { undoLast } from '@/features/tasks/actions';
import { NAV } from './nav';
import { useUI } from './store';

interface Command {
  id: string;
  group: 'Navigate' | 'Actions' | 'Tasks';
  label: string;
  icon?: LucideIcon;
  dot?: string;
  hint?: string;
  shortcut?: string[];
  done?: boolean;
  run: () => void;
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const openCreate = useUI((s) => s.openCreate);
  const openEdit = useUI((s) => s.openEdit);
  const setShortcuts = useUI((s) => s.setShortcuts);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tasks = useTasks();
  const categoryMap = useCategoryMap(useCategories());

  const commands = useMemo<Command[]>(
    () => [
      ...NAV.map((n) => ({
        id: `nav-${n.to}`,
        group: 'Navigate' as const,
        label: n.label,
        icon: n.icon,
        hint: n.description,
        shortcut: ['G', n.key],
        run: () => navigate(n.to),
      })),
      { id: 'new-task', group: 'Actions', label: 'Create task', icon: Plus, shortcut: ['C'], run: () => openCreate() },
      { id: 'undo', group: 'Actions', label: 'Undo last change', icon: Undo2, shortcut: [MOD, 'Z'], run: () => void undoLast() },
      { id: 'shortcuts', group: 'Actions', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: ['?'], run: () => setShortcuts(true) },
      { id: 'sidebar', group: 'Actions', label: 'Toggle sidebar', icon: PanelLeft, shortcut: [MOD, '\\'], run: toggleSidebar },
      { id: 'kit', group: 'Actions', label: 'Open design system', icon: Wand2, run: () => navigate('/design') },
      ...[...(tasks ?? [])]
        // Open tasks first, nearest deadline first.
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.deadline - b.deadline)
        .map((t) => ({
          id: t.id,
          group: 'Tasks' as const,
          label: t.title,
          dot: categoryColor(categoryMap.get(t.categoryId)),
          hint: taskRef(t.seq),
          done: t.status === 'done',
          run: () => openEdit(t.id),
        })),
    ],
    [navigate, openCreate, openEdit, setShortcuts, toggleSidebar, tasks, categoryMap],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      let shown = 0;
      return commands.filter((c) => c.group !== 'Tasks' || (!c.done && shown++ < 4));
    }
    const words = q.split(/\s+/);
    const hits = commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // Within each group, label-prefix matches first.
    const rank = (c: Command) => (c.label.toLowerCase().startsWith(q) ? 0 : c.label.toLowerCase().includes(q) ? 1 : 2);
    const groupOrder = { Tasks: 0, Navigate: 1, Actions: 2 };
    return hits
      .map((c, i) => ({ c, i }))
      .sort((a, b) => groupOrder[a.c.group] - groupOrder[b.c.group] || rank(a.c) - rank(b.c) || a.i - b.i)
      .map((x) => x.c)
      .slice(0, 50);
  }, [commands, query]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const execute = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    // Let the dialog close before opening another one.
    requestAnimationFrame(c.run);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(results[index]);
    }
  };

  let lastGroup = '';

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Command palette" bare width="lg" className="top-[12vh] overflow-hidden">
      <div className="flex h-12 items-center gap-2.5 border-b border-line px-4">
        <Search size={15} strokeWidth={1.75} className="text-fg-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command or search tasks…"
          className="h-full flex-1 bg-transparent text-base text-fg placeholder:text-fg-subtle focus:outline-none"
          role="combobox"
          aria-expanded
          aria-controls="palette-list"
          aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
        />
        <Kbd keys={['Esc']} />
      </div>

      <div ref={listRef} id="palette-list" role="listbox" className="max-h-[min(400px,55vh)] overflow-y-auto p-1.5">
        {results.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-fg-subtle">No results for “{query}”</div>
        )}
        {results.map((c, i) => {
          const header = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          const active = i === index;
          return (
            <div key={c.id}>
              {header && <div className="eyebrow px-2.5 pb-1 pt-2.5">{header}</div>}
              <div
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={active}
                data-index={i}
                onMouseMove={() => setIndex(i)}
                onClick={() => execute(c)}
                className={cn(
                  'flex h-9 cursor-default items-center gap-3 rounded-sm px-2.5 text-sm',
                  active ? 'bg-hover text-fg' : 'text-fg-muted',
                )}
              >
                {c.icon && <c.icon size={15} strokeWidth={1.75} className={active ? 'text-fg' : 'text-fg-subtle'} />}
                {c.dot && <span className="mx-[3.5px] size-2 shrink-0 rounded-xs" style={{ background: c.dot }} />}
                <span className={cn('truncate', c.done && 'text-fg-subtle line-through')}>{c.label}</span>
                {c.done && <CheckCircle2 size={12} className="shrink-0 text-positive" />}
                {c.hint && (
                  <span className={cn('truncate text-xs text-fg-subtle', c.group === 'Tasks' && 'num')}>{c.hint}</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  {c.shortcut && <Kbd keys={c.shortcut} />}
                  {active && !c.shortcut && <CornerDownLeft size={13} className="text-fg-subtle" />}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex h-9 items-center gap-4 border-t border-line px-4 text-2xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd keys={['↑', '↓']} /> navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys={['↵']} /> select
        </span>
        <span className="ml-auto">{results.length} results</span>
      </div>
    </Dialog>
  );
}
