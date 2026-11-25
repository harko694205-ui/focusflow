import { useState, type ReactNode } from 'react';
import { Archive, Copy, Filter, Pencil, Plus, Search, Settings2, Trash2, MoreHorizontal, FlaskConical, Clock } from 'lucide-react';
import { Button, IconButton } from '@/ui/Button';
import { Field, Input, Textarea } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Dialog } from '@/ui/Dialog';
import { Tooltip } from '@/ui/Tooltip';
import { Kbd, MOD } from '@/ui/Kbd';
import { Delta, Meter, Panel, PanelHeader, SegmentedControl, Stat, Tag } from '@/ui/Data';
import { Menu, MenuCheckboxItem, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from '@/ui/Menu';
import { useToast } from '@/app/toast';
import { Page, PageHeader } from './PageHeader';

const colorGroups: Array<{ title: string; tokens: Array<[name: string, note: string]> }> = [
  {
    title: 'Surfaces',
    tokens: [
      ['canvas', 'App background'],
      ['panel', 'Panels, sidebar'],
      ['raised', 'Inputs, popovers'],
      ['hover', 'Hover state'],
      ['active', 'Selected / pressed'],
    ],
  },
  {
    title: 'Text',
    tokens: [
      ['fg', 'Primary'],
      ['fg-muted', 'Secondary'],
      ['fg-subtle', 'Labels, meta'],
      ['fg-faint', 'Disabled, separators'],
    ],
  },
  {
    title: 'Signal',
    tokens: [
      ['accent', 'Focus, selection, now'],
      ['positive', 'Ahead, slack'],
      ['warning', 'At risk'],
      ['negative', 'Late, overload'],
    ],
  },
  {
    title: 'Data',
    tokens: [
      ['deep', 'Deep work'],
      ['shallow', 'Shallow work'],
      ['admin', 'Admin'],
      ['p-iris', 'Project'],
      ['p-teal', 'Project'],
      ['p-amber', 'Project'],
      ['p-rose', 'Project'],
      ['p-sky', 'Project'],
      ['p-lime', 'Project'],
      ['p-violet', 'Project'],
      ['p-slate', 'Project'],
    ],
  },
];

// Class names are spelled out so Tailwind can detect them statically.
const typeScale = [
  ['xl', 'text-xl', '24 / 32', 'Hero metric', true],
  ['lg', 'text-lg font-semibold', '20 / 28', 'Page title', false],
  ['md', 'text-md font-medium', '16 / 24', 'Section title', false],
  ['base', 'text-base', '14 / 20', 'Emphasized body', false],
  ['sm', 'text-sm', '13 / 20', 'Base UI text', false],
  ['xs', 'text-xs text-fg-muted', '12 / 16', 'Meta, secondary', false],
  ['2xs', 'eyebrow', '11 / 16', 'Labels, axes', false],
] as const;

const radii = [
  ['xs', 'rounded-xs', 2],
  ['sm', 'rounded-sm', 4],
  ['md', 'rounded-md', 6],
] as const;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Panel>
      <PanelHeader title={title} meta={description} />
      <div className="p-4">{children}</div>
    </Panel>
  );
}

function Swatch({ name, note }: { name: string; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="size-8 shrink-0 rounded-sm border border-line-strong"
        style={{ background: `var(--color-${name})` }}
      />
      <div className="min-w-0">
        <div className="num truncate text-xs text-fg">{name}</div>
        <div className="truncate text-2xs text-fg-subtle">{note}</div>
      </div>
    </div>
  );
}

export function DesignSystem() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [seg, setSeg] = useState<'day' | 'week' | 'month'>('week');
  const [sel, setSel] = useState('balanced');
  const [cols, setCols] = useState({ energy: true, estimate: true, due: true, project: false });
  const toast = useToast((s) => s.push);

  return (
    <Page>
      <PageHeader title="Design system" meta="Tokens and primitives used across FocusFlow" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Color" description="Dark-only, one accent">
          <div className="flex flex-col gap-5">
            {colorGroups.map((g) => (
              <div key={g.title}>
                <div className="eyebrow mb-2.5">{g.title}</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {g.tokens.map(([n, note]) => (
                    <Swatch key={n} name={n} note={note} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Typography" description="Inter Variable · JetBrains Mono for numbers">
            <div className="flex flex-col divide-y divide-line">
              {typeScale.map(([token, cls, metrics, use, mono]) => (
                <div key={token} className="flex items-baseline gap-4 py-2 first:pt-0 last:pb-0">
                  <span className="num w-10 shrink-0 text-2xs text-fg-subtle">{token}</span>
                  <span className={`${cls} min-w-0 flex-1 truncate ${mono ? 'num font-medium' : ''}`}>
                    {mono ? '7h 45m' : use}
                  </span>
                  <span className="num shrink-0 text-2xs text-fg-subtle">{metrics}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Spacing & radius" description="4px grid">
            <div className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                {[1, 2, 3, 4, 6, 8, 12, 16].map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1.5">
                    <div className="bg-accent-muted ring-1 ring-[rgb(124_131_255/0.35)]" style={{ width: s * 4, height: s * 4 }} />
                    <span className="num text-2xs text-fg-subtle">{s * 4}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4">
                {radii.map(([r, cls, px]) => (
                  <div key={r} className="flex items-center gap-2">
                    <div className={`size-8 border border-line-strong bg-raised ${cls}`} />
                    <span className="num text-2xs text-fg-subtle">
                      {r} · {px}px
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>

        <Section title="Buttons" description="primary · secondary · ghost · danger">
          <div className="flex flex-col gap-4">
            {(['lg', 'md', 'sm'] as const).map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-2">
                <span className="num w-6 text-2xs text-fg-subtle">{size}</span>
                <Button size={size} variant="primary" icon={Plus}>
                  New task
                </Button>
                <Button size={size} icon={FlaskConical}>
                  Simulate
                </Button>
                <Button size={size} variant="ghost">
                  Cancel
                </Button>
                <Button size={size} variant="danger" icon={Trash2}>
                  Delete
                </Button>
                <IconButton size={size} icon={Settings2} label="Settings" variant="secondary" />
                <IconButton size={size} icon={MoreHorizontal} label="More" />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6" />
              <Button disabled variant="primary">
                Disabled
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </div>
        </Section>

        <Section title="Inputs" description="28px default height">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Search">{(id) => <Input id={id} icon={Search} placeholder="Find tasks…" suffix={<Kbd keys={['/']} />} />}</Field>
            <Field label="Estimate" hint="Minutes">
              {(id) => <Input id={id} icon={Clock} defaultValue="90" suffix="min" className="[&_input]:num" />}
            </Field>
            <Field label="Strategy">
              {(id) => (
                <Select
                  id={id}
                  value={sel}
                  onValueChange={setSel}
                  options={[
                    { value: 'deadline', label: 'Earliest deadline', hint: 'EDF' },
                    { value: 'priority', label: 'Priority first' },
                    { value: 'balanced', label: 'Balanced' },
                  ]}
                />
              )}
            </Field>
            <Field label="Title" error="Give the task a title.">
              {(id) => <Input id={id} aria-invalid placeholder="Required" />}
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              {(id) => <Textarea id={id} rows={2} placeholder="Context, links, acceptance criteria…" />}
            </Field>
          </div>
        </Section>

        <Section title="Menus, tooltips & dialogs">
          <div className="flex flex-wrap items-center gap-2">
            <Menu>
              <MenuTrigger asChild>
                <Button icon={MoreHorizontal}>Task actions</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={Pencil} shortcut={['E']}>
                  Edit
                </MenuItem>
                <MenuItem icon={Copy} shortcut={[MOD, 'D']}>
                  Duplicate
                </MenuItem>
                <MenuSub label="Move to project" icon={Archive}>
                  <MenuItem>Atlas Web Redesign</MenuItem>
                  <MenuItem>Q1 Planning</MenuItem>
                </MenuSub>
                <MenuSeparator />
                <MenuItem icon={Trash2} destructive shortcut={['⌫']}>
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>

            <Menu>
              <MenuTrigger asChild>
                <Button icon={Filter}>Columns</Button>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Visible columns</MenuLabel>
                {(Object.keys(cols) as Array<keyof typeof cols>).map((k) => (
                  <MenuCheckboxItem key={k} checked={cols[k]} onCheckedChange={(v) => setCols((c) => ({ ...c, [k]: v }))}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </MenuCheckboxItem>
                ))}
              </MenuContent>
            </Menu>

            <Tooltip content="Create a task" shortcut={['C']}>
              <Button variant="ghost">Hover for tooltip</Button>
            </Tooltip>

            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Confirm dialog
            </Button>
            <Button variant="ghost" onClick={() => toast('Scenario committed · 3 changes applied')}>
              Show toast
            </Button>
          </div>
        </Section>

        <Section title="Data display">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Booked today" value="7h15" unit="/ 8h45" sub={<Delta value="+30m" tone="positive" suffix="vs. avg" />} />
              <Stat label="Projected late" value="2" unit="tasks" sub={<Delta value="+1" tone="negative" />} />
              <Stat label="Utilization" value="104" unit="%" sub={<Delta value="0%" tone="neutral" />} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag>Deep work</Tag>
              <Tag tone="accent">Draft</Tag>
              <Tag tone="positive">On track</Tag>
              <Tag tone="warning">At risk</Tag>
              <Tag tone="negative">Late</Tag>
              <Kbd keys={[MOD, 'K']} />
            </div>
            <div className="flex flex-col gap-2.5">
              <Meter value={300} max={525} />
              <Meter value={525} max={525} color="var(--color-warning)" />
              <Meter value={640} max={525} color="var(--color-negative)" />
            </div>
            <SegmentedControl
              size="md"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
            />
          </div>
        </Section>
      </div>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Rename scenario"
        description="Scenarios are private drafts until you commit them."
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Save
            </Button>
          </>
        }
      >
        <div className="p-4">
          <Field label="Name">{(id) => <Input id={id} defaultValue="Take Friday off" autoFocus />}</Field>
        </div>
      </Dialog>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Discard scenario?"
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button variant="danger" onClick={() => setConfirm(false)}>
              Discard
            </Button>
          </>
        }
      >
        <p className="px-4 py-4 text-sm text-fg-muted">
          “Take Friday off” has 1 change. Discarding it can’t be undone; your committed schedule is not affected.
        </p>
      </Dialog>
    </Page>
  );
}
