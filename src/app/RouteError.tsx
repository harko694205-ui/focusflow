import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router';
import { AlertTriangle, ArrowLeft, Compass, RotateCw } from 'lucide-react';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/Feedback';

/** A page's code failed to download — usually a new version was deployed, or the network dropped. */
const isChunkError = (e: unknown) => e instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(e.message);

/** Last-resort screen when a page crashes or can't load. Data in IndexedDB is unaffected. */
export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  const chunk = isChunkError(error);
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="grid h-dvh place-items-center bg-canvas px-4">
      <div className="w-full max-w-[460px] rounded-md border border-line bg-panel">
        <EmptyState
          icon={chunk ? RotateCw : AlertTriangle}
          title={chunk ? 'FocusFlow needs a reload' : 'Something went wrong on this page'}
          description={
            chunk
              ? 'Part of the app couldn’t be downloaded — FocusFlow was probably updated, or you’re offline. Your data is safe.'
              : 'Your data is safe — it’s stored in this browser and wasn’t changed. Reloading usually fixes this.'
          }
          actions={
            <>
              <Button variant="primary" icon={RotateCw} onClick={() => window.location.reload()}>
                Reload
              </Button>
              <Button variant="ghost" onClick={() => navigate('/')}>
                Go to Command Center
              </Button>
            </>
          }
          className="py-12"
        />
        {!chunk && import.meta.env.DEV && <pre className="max-h-40 overflow-auto border-t border-line px-4 py-3 text-2xs text-fg-subtle">{message}</pre>}
      </div>
    </div>
  );
}

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <EmptyState
        icon={Compass}
        title="Nothing here"
        description="That page doesn’t exist. It may have moved, or the link is incomplete."
        actions={
          <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate('/')}>
            Back to Command Center
          </Button>
        }
      />
    </div>
  );
}
