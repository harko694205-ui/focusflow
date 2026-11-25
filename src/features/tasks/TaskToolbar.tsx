import { forwardRef } from 'react';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, CalendarClock, Check, Gauge, Layers, ListFilter, Search, Signal, Tag as TagIcon, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DIFFICULTIES, DIFFICULTY_VALUES, PRIORITIES, PRIORITY_VALUES } from '@/domain/constants';
import { DUE_BUCKETS, type DueBucket } from '@/domain/dates';
import { activeFilterCount, GROUP_LABELS, SORT_LABELS, type GroupKey, type SortKey, type StatusFilter } from '@/domain/query';
import type { Category } from '@/domain/types';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Kbd } from '@/ui/Kbd';
import { SegmentedControl } from '@/ui/Data';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from '@/ui/Menu';
import { useTaskView } from './viewStore';
import { CategorySwatch, DifficultyDots, PriorityIcon } from './TaskMeta';

interface ToolbarProps {
  categories: Category[];
  counts: Record<StatusFilter, number>;
}

export const TaskToolbar = forwardRef<HTMLInputElement, ToolbarProps>(function TaskToolbar({ categories, counts }, searchRef) {
  const { filter, sort, group, setFilter, toggleFacet, clearFacets, setSort, setGroup } = useTaskView();
  const facetCount = activeFilterCount(filter);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const chips: Array<{ key: string; label: React.ReactNode; onRemove: () => void }> = [
    ...filter.categories.map((id) => ({
      key: `c-${id}`,
      label: (
        <>
          <CategorySwatch category={catById.get(id)} />
          {catById.get(id)?.name ?? 'Deleted category'}
        </>
      ),
      onRemove: () => toggleFacet('categories', id),
    })),
    ...filter.priorities.map((p) => ({
      key: `p-${p}`,
      label: (
        <>
          <PriorityIcon priority={p} withTooltip={false} />
          {PRIORITIES[p].label}
        </>
      ),
      onRemove: () => toggleFacet('priorities', p),
    })),
    ...filter.difficulties.map((d) => ({
      key: `d-${d}`,
      label: (
        <>
          <DifficultyDots difficulty={d} />
          {DIFFICULTIES[d].label}
        </>
      ),
      onRemove: () => toggleFacet('difficulties', d),
    })),
    ...filter.due.map((b) => ({
      key: `b-${b}`,
      label: (
        <>
          <CalendarClock size={11} />
          {DUE_BUCKETS[b]}
        </>
      ),
      onRemove: () => toggleFacet('due', b),
    })),
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchRef}
          icon={Search}
          value={filter.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (filter.search) setFilter({ search: '' });
              e.currentTarget.blur();
            }
            if (e.key === 'ArrowDown' || e.key === 'Enter') e.currentTarget.blur();
          }}
          placeholder="Search tasks…"
          suffix={filter.search ? undefined : <Kbd keys={['/']} />}
          className="w-full sm:w-64"
          aria-label="Search tasks"
        />

        <SegmentedControl
          size="md"
          value={filter.status}
          onChange={(status) => setFilter({ status })}
          options={[
            { value: 'open', label: `Open ${counts.open}` },
            { value: 'done', label: `Done ${counts.done}` },
            { value: 'all', label: `All ${counts.all}` },
          ]}
        />

        <div className="flex-1" />

        {/* Filter */}
        <Menu>
          <MenuTrigger asChild>
            <Button icon={ListFilter} className={cn(facetCount > 0 && 'border-line-focus text-fg')}>
              Filter
              {facetCount > 0 && (
                <span className="num -mr-0.5 ml-0.5 rounded-xs bg-accent-muted px-1 text-2xs text-accent">{facetCount}</span>
              )}
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-52">
            <MenuSub label="Category" icon={TagIcon}>
              {categories.map((c) => (
                <MenuCheckboxItem key={c.id} checked={filter.categories.includes(c.id)} onCheckedChange={() => toggleFacet('categories', c.id)}>
                  <span className="flex items-center gap-2">
                    <CategorySwatch category={c} />
                    {c.name}
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuSub>
            <MenuSub label="Priority" icon={Signal}>
              {PRIORITY_VALUES.map((p) => (
                <MenuCheckboxItem key={p} checked={filter.priorities.includes(p)} onCheckedChange={() => toggleFacet('priorities', p)}>
                  <span className="flex items-center gap-2">
                    <PriorityIcon priority={p} withTooltip={false} />
                    {PRIORITIES[p].label}
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuSub>
            <MenuSub label="Difficulty" icon={Gauge}>
              {[...DIFFICULTY_VALUES].reverse().map((d) => (
                <MenuCheckboxItem key={d} checked={filter.difficulties.includes(d)} onCheckedChange={() => toggleFacet('difficulties', d)}>
                  <span className="flex items-center gap-2">
                    <DifficultyDots difficulty={d} />
                    {DIFFICULTIES[d].label}
                  </span>
                </MenuCheckboxItem>
              ))}
            </MenuSub>
            <MenuSub label="Deadline" icon={CalendarClock}>
              {(Object.keys(DUE_BUCKETS) as DueBucket[]).map((b) => (
                <MenuCheckboxItem key={b} checked={filter.due.includes(b)} onCheckedChange={() => toggleFacet('due', b)}>
                  {DUE_BUCKETS[b]}
                </MenuCheckboxItem>
              ))}
            </MenuSub>
            {facetCount > 0 && (
              <>
                <MenuSeparator />
                <MenuItem icon={X} onSelect={clearFacets}>
                  Clear filters
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>

        {/* Sort */}
        <Menu>
          <MenuTrigger asChild>
            <Button icon={sort.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownNarrowWide}>
              <span className="hidden sm:inline">{SORT_LABELS[sort.key]}</span>
              <span className="sm:hidden">Sort</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-52">
            <MenuLabel>Sort by</MenuLabel>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <MenuItem key={k} onSelect={() => setSort({ key: k, dir: sort.key === k ? sort.dir : 'asc' })}>
                <span className="flex w-full items-center justify-between">
                  {SORT_LABELS[k]}
                  {sort.key === k && <Check size={13} className="text-accent" />}
                </span>
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              icon={sort.dir === 'asc' ? ArrowDownNarrowWide : ArrowUpNarrowWide}
              onSelect={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            >
              {sort.dir === 'asc' ? 'Descending' : 'Ascending'}
            </MenuItem>
          </MenuContent>
        </Menu>

        {/* Group */}
        <Menu>
          <MenuTrigger asChild>
            <Button icon={Layers}>
              <span className="hidden sm:inline">{group === 'none' ? 'Group' : GROUP_LABELS[group]}</span>
            </Button>
          </MenuTrigger>
          <MenuContent align="end" className="w-48">
            <MenuLabel>Group by</MenuLabel>
            {(Object.keys(GROUP_LABELS) as GroupKey[]).map((k) => (
              <MenuItem key={k} onSelect={() => setGroup(k)}>
                <span className="flex w-full items-center justify-between">
                  {GROUP_LABELS[k]}
                  {group === k && <Check size={13} className="text-accent" />}
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-line-strong bg-raised pl-2 pr-1 text-xs text-fg-muted"
            >
              {c.label}
              <button
                onClick={c.onRemove}
                aria-label="Remove filter"
                className="focus-ring rounded-xs p-0.5 text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <button onClick={clearFacets} className="focus-ring ml-1 rounded-xs px-1 text-xs text-fg-subtle hover:text-fg">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
});
