import { useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { CATEGORY_COLORS, CATEGORY_COLOR_VALUES, LIMITS } from '@/domain/constants';
import type { Category, ID, Task } from '@/domain/types';
import { Button, IconButton } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/Confirm';
import { Input } from '@/ui/Input';
import { Menu, MenuContent, MenuTrigger } from '@/ui/Menu';
import { Select } from '@/ui/Select';
import { Tooltip } from '@/ui/Tooltip';
import { settingsActions } from './actions';
import { useTerms } from '@/hooks/data';

export function CategoryManager({ categories, tasks }: { categories: Category[]; tasks: Task[] }) {
  const terms = useTerms();
  const counts = useMemo(() => {
    const m = new Map<ID, { open: number; all: number }>();
    for (const t of tasks) {
      const c = m.get(t.categoryId) ?? { open: 0, all: 0 };
      c.all++;
      if (t.status !== 'done') c.open++;
      m.set(t.categoryId, c);
    }
    return m;
  }, [tasks]);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [newName, setNewName] = useState('');
  const sorted = [...categories].sort((a, b) => a.order - b.order);

  const add = async () => {
    if (!newName.trim()) return;
    if (await settingsActions.createCategory(newName)) setNewName('');
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
        {sorted.map((c) => {
          const n = counts.get(c.id) ?? { open: 0, all: 0 };
          return (
            <li key={c.id} className="flex items-center gap-2.5 px-3 py-2">
              <ColorPicker category={c} />
              <NameField category={c} />
              <span className="num shrink-0 whitespace-nowrap text-right text-xs text-fg-subtle">
                {n.all ? `${n.open} open · ${n.all - n.open} done` : 'No tasks'}
              </span>
              <Tooltip content={categories.length <= 1 ? `Keep at least one ${terms.lower}` : `Delete ${terms.lower}`}>
                <span>
                  <IconButton
                    icon={Trash2}
                    size="sm"
                    label={`Delete ${c.name}`}
                    disabled={categories.length <= 1}
                    onClick={() => (n.all ? setDeleting(c) : void settingsActions.deleteCategory(c.id))}
                  />
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={`New ${terms.lower} name`} maxLength={LIMITS.categoryNameMax} aria-label={`New ${terms.lower} name`} className="max-w-[260px]" />
        <Button type="submit" variant="secondary" icon={Plus} disabled={!newName.trim()}>
          Add {terms.lower}
        </Button>
      </form>

      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          count={counts.get(deleting.id)?.all ?? 0}
          others={sorted.filter((c) => c.id !== deleting.id)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function NameField({ category }: { category: Category }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = async () => {
    if (draft === null) return;
    if (draft.trim() && draft.trim() !== category.name) await settingsActions.renameCategory(category.id, draft);
    setDraft(null);
  };
  return (
    <input
      value={draft ?? category.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
      maxLength={LIMITS.categoryNameMax}
      aria-label={`Rename ${category.name}`}
      className="focus-ring h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1.5 text-sm text-fg hover:bg-hover focus:bg-raised"
    />
  );
}

function ColorPicker({ category }: { category: Category }) {
  return (
    <Menu>
      <Tooltip content="Change color">
        <MenuTrigger asChild>
          <button type="button" aria-label={`Color of ${category.name}`} className="focus-ring grid size-6 shrink-0 place-items-center rounded-sm hover:bg-hover">
            <span className="size-3 rounded-xs" style={{ background: CATEGORY_COLORS[category.color] }} />
          </button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent className="min-w-0">
        <div className="grid grid-cols-4 gap-1 p-0.5" role="group" aria-label="Colors">
          {CATEGORY_COLOR_VALUES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={category.color === color}
              onClick={() => void settingsActions.recolorCategory(category.id, color)}
              className={cn('focus-ring grid size-7 place-items-center rounded-sm hover:bg-hover', category.color === color && 'bg-active')}
            >
              <span className="grid size-4 place-items-center rounded-xs" style={{ background: CATEGORY_COLORS[color] }}>
                {category.color === color && <Check size={11} strokeWidth={3} className="text-canvas" />}
              </span>
            </button>
          ))}
        </div>
      </MenuContent>
    </Menu>
  );
}

function DeleteCategoryDialog({ category, count, others, onClose }: { category: Category; count: number; others: Category[]; onClose: () => void }) {
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '');
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete ${category.name}?`}
      description="You can undo this right after."
      confirmLabel={`Move ${count} task${count === 1 ? '' : 's'} and delete`}
      tone="danger"
      disabled={!moveTo}
      onConfirm={() => settingsActions.deleteCategory(category.id, moveTo)}
    >
      <div className="flex flex-col gap-2">
        <p>
          {category.name} has {count} task{count === 1 ? '' : 's'}. Move {count === 1 ? 'it' : 'them'} to:
        </p>
        <Select value={moveTo} onValueChange={setMoveTo} options={others.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
    </ConfirmDialog>
  );
}
