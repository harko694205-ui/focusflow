/**
 * Command plumbing shared by every feature: run a write, report the outcome with a toast,
 * and register an undo. One undo stack for the whole app, so Ctrl+Z reverts the most recent
 * change wherever it happened (tasks, timeline, …).
 */
import { toast } from './toast';

export interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

const undoStack: UndoEntry[] = [];
const MAX_UNDO = 50;

function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function reportError(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Something went wrong';
  toast(msg, { tone: 'error' });
}

async function runUndo(entry: UndoEntry, announce: boolean) {
  const i = undoStack.lastIndexOf(entry);
  if (i >= 0) undoStack.splice(i, 1);
  try {
    await entry.run();
    if (announce) toast(`Undone · ${entry.label}`, { tone: 'info' });
  } catch (err) {
    reportError(err);
  }
}

export async function undoLast(): Promise<void> {
  const entry = undoStack[undoStack.length - 1];
  if (!entry) {
    toast('Nothing to undo', { tone: 'info' });
    return;
  }
  await runUndo(entry, true);
}

export interface Outcome {
  /** Toast text. Empty string = silent (still undoable with Ctrl+Z). */
  message: string;
  undo?: UndoEntry;
}

/** Run a command; on success toast with an Undo action wired to the same entry. */
export async function run<T>(fn: () => Promise<T>, describe: (r: T) => Outcome | null): Promise<T | undefined> {
  try {
    const result = await fn();
    const d = describe(result);
    if (d) {
      const undo = d.undo;
      if (undo) pushUndo(undo);
      if (d.message) toast(d.message, undo ? { action: { label: 'Undo', run: () => void runUndo(undo, false) } } : undefined);
    }
    return result;
  } catch (err) {
    reportError(err);
    return undefined;
  }
}
