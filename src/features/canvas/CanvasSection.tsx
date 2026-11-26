import { useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { FileUp, Link2, RefreshCw, Unplug } from 'lucide-react';
import type { Category } from '@/domain/types';
import { normalizeFeedUrl } from '@/domain/canvas';
import { reportError } from '@/app/commands';
import { fetchFeed, previewCanvas, setFeedUrl, type CanvasPreview } from '@/services/canvasService';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Skeleton } from '@/ui/Feedback';
import { canvasActions, useCanvasState } from './actions';
import { ImportPreview } from './ImportPreview';

interface Open {
  preview: CanvasPreview;
  source: string;
}

/** Settings → BruinLearn: sync assignments from the calendar feed, or import a downloaded .ics file. */
export function CanvasSection({ categories }: { categories: Category[] }) {
  const state = useCanvasState();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<'sync' | 'file' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sync = async (url: string) => {
    setBusy('sync');
    setError(null);
    try {
      const preview = await previewCanvas(await fetchFeed(url));
      // The link worked: keep it, so the next sync is one click.
      if (!state?.feedUrl) await setFeedUrl(normalizeFeedUrl(url));
      setOpen({ preview, source: 'Calendar feed' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async (file: File) => {
    setBusy('file');
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('That file is too large to be a course calendar.');
      setOpen({ preview: await previewCanvas(await file.text()), source: file.name });
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(null);
    }
  };

  if (!state) return <Skeleton className="h-[120px]" />;
  const valid = !!normalizeFeedUrl(link);

  return (
    <div className="flex flex-col gap-4">
      {state.feedUrl ? (
        <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line px-3 py-2.5">
          <Link2 size={14} className="shrink-0 text-positive" />
          <div className="flex min-w-[200px] flex-1 flex-col">
            <span className="text-sm text-fg">Calendar feed connected</span>
            <span className="text-xs text-fg-subtle">
              {state.lastSync ? `Last synced ${formatDistanceToNow(state.lastSync, { addSuffix: true })}` : 'Not synced yet'} · new assignments and changed due dates come in when you sync
            </span>
          </div>
          <Button variant="primary" icon={RefreshCw} onClick={() => void sync(state.feedUrl!)} disabled={!!busy} className={busy === 'sync' ? '[&_svg]:animate-spin' : undefined}>
            {busy === 'sync' ? 'Syncing…' : 'Sync now'}
          </Button>
          <Button variant="ghost" icon={Unplug} onClick={() => void canvasActions.disconnect()} disabled={!!busy}>
            Disconnect
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void sync(link);
            else setError('Paste the calendar feed link from BruinLearn. It looks like https://bruinlearn.ucla.edu/feeds/calendars/user_….ics');
          }}
        >
          <label htmlFor="canvas-feed" className="text-xs font-medium text-fg-muted">
            Calendar feed link
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="canvas-feed"
              icon={Link2}
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setError(null);
              }}
              placeholder="https://bruinlearn.ucla.edu/feeds/calendars/user_….ics"
              autoComplete="off"
              spellCheck={false}
              className="min-w-[260px] flex-1"
              aria-invalid={!!error}
            />
            <Button type="submit" variant="primary" icon={RefreshCw} disabled={!link.trim() || !!busy} className={busy === 'sync' ? '[&_svg]:animate-spin' : undefined}>
              {busy === 'sync' ? 'Syncing…' : 'Connect & sync'}
            </Button>
          </div>
          <p className="text-xs text-fg-subtle">
            In BruinLearn, open <span className="text-fg-muted">Calendar</span>, click <span className="text-fg-muted">Calendar Feed</span> at the bottom right and copy the link. It’s private to you: FocusFlow keeps it in this browser only.
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button variant="secondary" icon={FileUp} onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === 'file' ? 'Reading…' : 'Import .ics file…'}
        </Button>
        <span className="text-xs text-fg-subtle">Or open the feed link in your browser to download the file, then import it here. Works offline too.</span>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void fromFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {open && <ImportPreview preview={open.preview} categories={categories} source={open.source} onClose={() => setOpen(null)} />}
    </div>
  );
}
