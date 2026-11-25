import { useMemo } from 'react';
import { format } from 'date-fns';
import { Check, Link2, Plus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { taskRef } from '@/domain/constants';
import { wouldCreateCycle } from '@/domain/dependencies';
import type { ID, Task } from '@/domain/types';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/ui/Menu';
import { Button } from '@/ui/Button';
import { Tooltip } from '@/ui/Tooltip';

/**
 * "Blocked by" picker. Offers open tasks that wouldn't create a dependency loop; links to deleted
 * tasks are hidden (and dropped on save).
 */
export function DependencyField({
  taskId,
  value,
  onChange,
  tasks,
  error,
}: {
  taskId: ID | null;
  value: ID[];
  onChange: (ids: ID[]) => void;
  tasks: Task[];
  error?: string;
}) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const selected = value.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  const options = useMemo(() => {
    // Evaluate loops against the links as currently edited, not as saved.
    const edited = new Map(byId);
    if (taskId && byId.has(taskId)) edited.set(taskId, { ...byId.get(taskId)!, dependsOn: value });
    return tasks
      .filter((t) => t.status !== 'done' && t.id !== taskId && !value.includes(t.id))
      .map((t) => ({ task: t, loop: !!taskId && wouldCreateCycle(taskId, t.id, edited) }))
      .sort((a, b) => Number(a.loop) - Number(b.loop) || a.task.deadline - b.task.deadline);
  }, [tasks, byId, taskId, value]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-fg-muted">Blocked by</span>
        <span className="text-2xs text-fg-subtle">Tasks that must be done first</span>
      </div>
      <div className={cn('flex min-h-8 flex-wrap items-center gap-1.5 rounded-sm border px-1.5 py-1', error ? 'border-negative' : 'border-line')}>
        {selected.map((t) => {
          const done = t.status === 'done';
          return (
            <span
              key={t.id}
              className="flex h-6 max-w-full items-center gap-1.5 rounded-xs border border-line bg-raised pl-1.5 pr-0.5 text-xs"
            >
              {done ? <Check size={11} className="shrink-0 text-positive" /> : <Link2 size={11} className="shrink-0 text-fg-subtle" />}
              <span className="num shrink-0 text-2xs text-fg-subtle">{taskRef(t.seq)}</span>
              <span className={cn('max-w-[220px] truncate', done ? 'text-fg-subtle line-through decoration-fg-faint' : 'text-fg-muted')}>{t.title}</span>
              <button
                type="button"
                aria-label={`Remove dependency on ${t.title}`}
                onClick={() => onChange(value.filter((id) => id !== t.id))}
                className="focus-ring flex size-5 items-center justify-center rounded-xs text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="ghost" icon={Plus} className="h-6">
              {selected.length ? 'Add' : 'Add dependency'}
            </Button>
          </MenuTrigger>
          <MenuContent className="max-h-72 w-[340px] overflow-y-auto">
            <MenuLabel>Open tasks</MenuLabel>
            {options.length === 0 && <MenuItem disabled>No other open tasks</MenuItem>}
            {options.map(({ task: t, loop }) =>
              loop ? (
                <Tooltip key={t.id} content="Already depends on this task — adding it would create a loop" side="left">
                  <div>
                    <MenuItem disabled>
                      <OptionLabel task={t} />
                    </MenuItem>
                  </div>
                </Tooltip>
              ) : (
                <MenuItem key={t.id} onSelect={() => onChange([...value, t.id])}>
                  <OptionLabel task={t} />
                </MenuItem>
              ),
            )}
          </MenuContent>
        </Menu>
      </div>
      {error && <span className="text-2xs text-negative">{error}</span>}
    </div>
  );
}

function OptionLabel({ task }: { task: Task }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="num w-9 shrink-0 text-2xs text-fg-subtle">{taskRef(task.seq)}</span>
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="num shrink-0 text-2xs text-fg-subtle">{format(task.deadline, 'EEE d')}</span>
    </span>
  );
}
