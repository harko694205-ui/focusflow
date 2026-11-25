import { CheckCircle2, Download, MoreVertical, PlusSquare, RefreshCw, Share, WifiOff } from 'lucide-react';
import { applyUpdate, install, usePwa } from '@/pwa/pwa';
import { AppIcon } from '@/app/AppIcon';
import { Button } from '@/ui/Button';

/** Install FocusFlow as an app, see offline status, and apply updates. */
export function AppSection() {
  const { installed, canInstall, updateReady, offlineReady, platform } = usePwa();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <AppIcon size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium text-fg">{installed ? 'FocusFlow is installed' : 'Install FocusFlow'}</span>
          <span className="text-xs text-fg-subtle">
            {installed
              ? 'Running in its own window. Open it from your apps, dock or home screen.'
              : 'Get it in its own window with a home-screen or dock icon — and it opens even when you’re offline.'}
          </span>
        </div>
        {installed ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-positive">
            <CheckCircle2 size={14} /> Installed
          </span>
        ) : (
          canInstall && (
            <Button variant="primary" icon={Download} onClick={() => void install()}>
              Install app
            </Button>
          )
        )}
      </div>

      {!installed && !canInstall && <InstallSteps platform={platform} />}

      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-sm border border-line">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <WifiOff size={14} className="shrink-0 text-fg-subtle" />
          <span className="min-w-0 flex-1 text-sm text-fg-muted">
            {offlineReady
              ? 'Available offline — the app and your data are saved on this device.'
              : import.meta.env.DEV
                ? 'Offline support turns on in the deployed app (it’s off while developing).'
                : 'Saving the app for offline use…'}
          </span>
          {offlineReady && <CheckCircle2 size={14} className="shrink-0 text-positive" />}
        </div>
        {updateReady && (
          <div className="flex items-center gap-3 px-3 py-2.5">
            <RefreshCw size={14} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1 text-sm text-fg">A new version is ready.</span>
            <Button size="sm" variant="secondary" onClick={applyUpdate}>
              Reload to update
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function InstallSteps({ platform }: { platform: 'ios' | 'android' | 'desktop' }) {
  const steps =
    platform === 'ios'
      ? [
          <>Open FocusFlow in <b className="font-medium text-fg">Safari</b>.</>,
          <>Tap <Share size={13} className="mx-0.5 inline -translate-y-px" aria-label="Share" /> <b className="font-medium text-fg">Share</b> in the toolbar.</>,
          <>Choose <PlusSquare size={13} className="mx-0.5 inline -translate-y-px" aria-hidden /> <b className="font-medium text-fg">Add to Home Screen</b>, then <b className="font-medium text-fg">Add</b>.</>,
        ]
      : platform === 'android'
        ? [
            <>Open FocusFlow in <b className="font-medium text-fg">Chrome</b>.</>,
            <>Tap <MoreVertical size={13} className="mx-0.5 inline -translate-y-px" aria-label="the menu" /> in the top-right corner.</>,
            <>Choose <b className="font-medium text-fg">Install app</b> (or <b className="font-medium text-fg">Add to Home screen</b>).</>,
          ]
        : [
            <>In <b className="font-medium text-fg">Chrome</b> or <b className="font-medium text-fg">Edge</b>, click the install icon at the right end of the address bar.</>,
            <>Or open the browser menu and choose <b className="font-medium text-fg">Install FocusFlow</b> (Chrome: <i>Cast, save and share</i>; Edge: <i>Apps</i>).</>,
            <>On a Mac in <b className="font-medium text-fg">Safari</b>: <b className="font-medium text-fg">File → Add to Dock</b>.</>,
          ];
  return (
    <ol className="flex flex-col gap-1.5 rounded-sm border border-dashed border-line-strong px-3.5 py-3 text-sm text-fg-muted">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="num grid size-5 shrink-0 place-items-center rounded-full bg-active text-2xs text-fg">{i + 1}</span>
          <span className="pt-px">{s}</span>
        </li>
      ))}
    </ol>
  );
}
