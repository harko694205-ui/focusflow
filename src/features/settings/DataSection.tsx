import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Database, Download, HardDrive, History, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { db, requestPersistentStorage } from '@/db/db';
import { taskActions } from '@/features/tasks/actions';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/Confirm';
import { settingsActions } from './actions';
import { useTerms } from '@/hooks/data';

function useStorage() {
  const counts = useLiveQuery(async () => {
    const [tasks, blocks, sessions, scenarios] = await Promise.all([db.tasks.count(), db.blocks.count(), db.sessions.count(), db.scenarios.count()]);
    return { tasks, blocks, sessions, scenarios };
  }, []);
  const [info, setInfo] = useState<{ persisted: boolean | null; usage: number | null }>({ persisted: null, usage: null });
  const refresh = async () => {
    try {
      const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? Promise.resolve(null), navigator.storage?.estimate?.() ?? Promise.resolve(null)]);
      setInfo({ persisted: persisted ?? null, usage: est?.usage ?? null });
    } catch {
      /* storage APIs unavailable */
    }
  };
  useEffect(() => void refresh(), [counts]);
  return { counts, ...info, refresh };
}

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type Pending = { kind: 'import'; file: File } | { kind: 'demo' } | { kind: 'clear' } | null;

export function DataSection() {
  const terms = useTerms();
  const s = useStorage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending>(null);
  const close = () => setPending(null);
  const exportFirst = (
    <Button variant="secondary" icon={Download} onClick={() => void settingsActions.exportBackup()}>
      Export first
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-4">
        {(
          [
            ['Tasks', s.counts?.tasks],
            ['Schedule blocks', s.counts?.blocks],
            ['Time entries', s.counts?.sessions],
            ['Scenarios', s.counts?.scenarios],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="bg-panel px-3 py-2">
            <dt className="text-2xs text-fg-subtle">{label}</dt>
            <dd className="num text-base text-fg">{n ?? '—'}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <HardDrive size={12} /> Stored only in this browser (IndexedDB){s.usage !== null && <span className="num"> · {kb(s.usage)} used</span>}
        </span>
        {s.persisted === true ? (
          <span className="flex items-center gap-1.5 text-positive">
            <ShieldCheck size={12} /> Protected from automatic cleanup
          </span>
        ) : s.persisted === false ? (
          <span className="flex items-center gap-1.5">
            The browser may clear this data when space runs low.
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await requestPersistentStorage();
                await s.refresh();
              }}
            >
              Ask to keep it
            </Button>
          </span>
        ) : null}
      </div>

      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
        <Row icon={Download} title="Export backup" detail={`Tasks, ${terms.lowerMany}, schedule, time entries, scenarios and preferences as one JSON file.`}>
          <Button variant="secondary" onClick={() => void settingsActions.exportBackup()}>
            Export
          </Button>
        </Row>
        <Row icon={Upload} title="Import backup" detail="Replace this workspace with a FocusFlow backup file.">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Choose file…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPending({ kind: 'import', file });
              e.target.value = '';
            }}
          />
        </Row>
        <Row icon={History} title="Add sample history" detail="Eight weeks of generated finished work and tracked time, so Insights has something to show. Undoable.">
          <Button variant="secondary" onClick={() => void taskActions.addSampleHistory()}>
            Add
          </Button>
        </Row>
        <Row icon={Database} title="Load demo workspace" detail="Replace tasks, schedule and time entries with the demo data.">
          <Button variant="secondary" onClick={() => setPending({ kind: 'demo' })}>
            Load demo
          </Button>
        </Row>
        <Row icon={Trash2} title="Clear all tasks" detail={`Delete every task, schedule block and time entry. ${terms.many} and preferences stay.`} danger>
          <Button variant="danger" onClick={() => setPending({ kind: 'clear' })}>
            Clear…
          </Button>
        </Row>
      </div>

      <ConfirmDialog
        open={pending?.kind === 'import'}
        onOpenChange={(o) => !o && close()}
        title="Replace this workspace?"
        confirmLabel="Replace with backup"
        tone="danger"
        secondary={exportFirst}
        onConfirm={() => pending?.kind === 'import' && settingsActions.importBackup(pending.file)}
      >
        Everything here is replaced with <span className="text-fg">{pending?.kind === 'import' ? pending.file.name : ''}</span>. This can’t be undone — export a backup first if you might want today’s data back.
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === 'demo'}
        onOpenChange={(o) => !o && close()}
        title="Load the demo workspace?"
        confirmLabel="Load demo"
        tone="danger"
        secondary={exportFirst}
        onConfirm={() => taskActions.loadDemo()}
      >
        Your tasks, schedule and time entries are replaced with demo data. This can’t be undone.
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === 'clear'}
        onOpenChange={(o) => !o && close()}
        title={`Delete all ${s.counts?.tasks ?? ''} tasks?`}
        confirmLabel="Delete everything"
        tone="danger"
        secondary={exportFirst}
        onConfirm={() => taskActions.clearAll()}
      >
        Every task, schedule block and time entry is permanently deleted. {terms.many}, working hours and Focus Mode settings stay. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

function Row({ icon: Icon, title, detail, danger, children }: { icon: typeof Download; title: string; detail: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Icon size={14} className={danger ? 'shrink-0 text-negative' : 'shrink-0 text-fg-subtle'} />
      <div className="flex min-w-[200px] flex-1 flex-col">
        <span className="text-sm text-fg">{title}</span>
        <span className="text-xs text-fg-subtle">{detail}</span>
      </div>
      {children}
    </div>
  );
}
