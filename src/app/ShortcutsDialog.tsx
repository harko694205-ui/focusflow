import { Dialog } from '@/ui/Dialog';
import { Kbd, MOD } from '@/ui/Kbd';
import { NAV } from './nav';
import { useUI } from './store';

const sections: Array<{ title: string; items: Array<[keys: string[][], label: string]> }> = [
  {
    title: 'Global',
    items: [
      [[[MOD, 'K']], 'Command palette'],
      [[['C']], 'Quick add a task'],
      [[[MOD, 'Z']], 'Undo last change'],
      [[[MOD, '\\']], 'Toggle sidebar'],
      [[['?']], 'Show shortcuts'],
    ],
  },
  {
    title: 'Navigate',
    items: NAV.map((n) => [[['G', n.key]], n.label] as [string[][], string]),
  },
  {
    title: 'Task list',
    items: [
      [[['J'], ['↓']], 'Next task'],
      [[['K'], ['↑']], 'Previous task'],
      [[['E'], ['↵']], 'Edit'],
      [[['X']], 'Complete / reopen'],
      [[['S']], 'Start / stop focus timer'],
      [[['F']], 'Open in Focus Mode'],
      [[['1'], ['4']], 'Set priority (Urgent → Low)'],
      [[[MOD, 'D']], 'Duplicate'],
      [[['Del']], 'Delete'],
      [[['/']], 'Search'],
      [[['Esc']], 'Clear selection'],
    ],
  },
  {
    title: 'Timeline',
    items: [
      [[['T']], 'Jump to today'],
      [[['D'], ['W']], 'Day / week view'],
      [[['←'], ['→']], 'Previous / next (or move block a day)'],
      [[['↑'], ['↓']], 'Move selected block 15 min'],
      [[['Shift', '↓']], 'Lengthen selected block'],
      [[['E']], 'Open the block’s task'],
      [[['X']], 'Complete the block’s task'],
      [[['Del']], 'Remove block'],
      [[['Esc']], 'Deselect / cancel drag'],
    ],
  },
  {
    title: 'Simulator',
    items: [
      [[['V']], 'Toggle edit / side-by-side'],
      [[['↑'], ['↓']], 'Move selected block (in scenario)'],
      [[['Del']], 'Remove block from scenario'],
      [[[MOD, 'Z']], 'Undo last scenario change'],
    ],
  },
  {
    title: 'Task editor',
    items: [
      [[[MOD, '↵']], 'Save'],
      [[['Esc']], 'Close without saving'],
    ],
  },
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcuts);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" width="lg">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
        {sections.map((s) => (
          <section key={s.title}>
            <h3 className="eyebrow mb-1.5">{s.title}</h3>
            <ul className="flex flex-col">
              {s.items.map(([keys, label]) => (
                <li key={label} className="flex h-7 items-center justify-between gap-4 text-sm">
                  <span className="text-fg-muted">{label}</span>
                  <span className="flex items-center gap-1 text-2xs text-fg-subtle">
                    {keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && (s.title === 'Task list' && label.startsWith('Set') ? '–' : '/')}
                        <Kbd keys={k} />
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
