import { memo } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, MoreHorizontal, Pencil, RotateCcw, Signal, StickyNote, Trash2, Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PRIORITIES, PRIORITY_VALUES, taskRef } from '@/domain/constants';
import type { TaskRisk } from '@/domain/risk';
import type { Category, Task } from '@/domain/types';
import { TaskCheckbox } from '@/ui/Feedback';
import { IconButton } from '@/ui/Button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuTrigger } from '@/ui/Menu';
import { MOD } from '@/ui/Kbd';
import { CategoryLabel, DifficultyDots, DueCell, EstimateLabel, PriorityIcon, ScheduleBadge, WaitingBadge } from './TaskMeta';
import type { TaskSchedule } from '@/domain/schedule';
import { taskActions } from './actions';

interface TaskRowProps {
  task: Task;
  category?: Category;
  risk?: TaskRisk;
  scheduled?: TaskSchedule;
  /** Refs of unfinished dependencies, e.g. "FF-3, FF-7". */
  waitingOn?: string;
  now: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

export const TASK_GRID =
  'grid grid-cols-[16px_16px_minmax(0,1fr)_64px_72px_28px] md:grid-cols-[16px_16px_48px_minmax(0,1fr)_140px_64px_88px_28px] lg:grid-cols-[16px_16px_48px_minmax(0,1fr)_140px_52px_64px_88px_28px] items-center gap-x-3';

export const TaskRow = memo(function TaskRow({ task, category, risk, scheduled, waitingOn, now, selected, onSelect, onOpen }: TaskRowProps) {
  const done = task.status === 'done';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className="overflow-hidden"
    >
      <div
        role="row"
        aria-selected={selected}
        data-task-id={task.id}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className={cn(
          TASK_GRID,
          'group relative h-9 cursor-default border-b border-line px-4 text-sm transition-colors duration-75',
          selected ? 'bg-active' : 'hover:bg-hover',
        )}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}

        <TaskCheckbox
          checked={done}
          inProgress={task.status === 'in_progress'}
          onToggle={() => taskActions.toggleComplete(task.id)}
          label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        />
        <PriorityIcon priority={task.priority} />
        <span className="num hidden text-2xs text-fg-subtle md:block">{taskRef(task.seq)}</span>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
            onOpen();
          }}
          className="focus-ring flex min-w-0 items-center gap-2 rounded-xs text-left"
        >
          <span
            className={cn(
              'truncate transition-colors',
              done ? 'text-fg-subtle line-through decoration-fg-faint' : 'text-fg',
            )}
          >
            {task.title}
          </span>
          {task.notes && <StickyNote size={11} className="shrink-0 text-fg-faint" aria-label="Has notes" />}
          {task.status !== 'done' && <ScheduleBadge task={task} scheduled={scheduled} />}
          {!done && waitingOn && <WaitingBadge refs={waitingOn} />}
          {task.status === 'in_progress' && (
            <span className="shrink-0 rounded-xs bg-warning-muted px-1 text-2xs font-medium text-warning">In progress</span>
          )}
        </button>

        <CategoryLabel category={category} className="hidden md:inline-flex" />
        <span className="hidden lg:block">
          <DifficultyDots difficulty={task.difficulty} />
        </span>
        <EstimateLabel minutes={task.estimate} className="text-right" />
        <span className="flex justify-end">
          <DueCell task={task} risk={risk} now={now} />
        </span>

        <Menu>
          <MenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label="Task actions"
              size="sm"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={Pencil} shortcut={['E']} onSelect={onOpen}>
              Edit
            </MenuItem>
            <MenuItem icon={done ? RotateCcw : Check} shortcut={['X']} onSelect={() => taskActions.toggleComplete(task.id)}>
              {done ? 'Reopen' : 'Mark complete'}
            </MenuItem>
            {!done && (
              <MenuItem
                icon={Timer}
                onSelect={() => taskActions.update(task.id, { status: task.status === 'in_progress' ? 'todo' : 'in_progress' })}
              >
                {task.status === 'in_progress' ? 'Stop progress' : 'Start progress'}
              </MenuItem>
            )}
            <MenuSub label="Priority" icon={Signal}>
              {PRIORITY_VALUES.map((p) => (
                <MenuItem key={p} shortcut={[String(p + 1)]} onSelect={() => taskActions.setPriority(task.id, p)}>
                  <span className="flex items-center gap-2">
                    <PriorityIcon priority={p} withTooltip={false} />
                    {PRIORITIES[p].label}
                  </span>
                </MenuItem>
              ))}
            </MenuSub>
            <MenuItem icon={Copy} shortcut={[MOD, 'D']} onSelect={() => taskActions.duplicate(task.id)}>
              Duplicate
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} destructive shortcut={['Del']} onSelect={() => taskActions.remove([task.id])}>
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </motion.div>
  );
});
