import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useProfile } from '@/hooks/data';
import { autoSyncCanvas } from './actions';

/**
 * Keeps BruinLearn assignments current without anyone remembering to sync: checks the saved feed
 * when the app opens and whenever it comes back to the foreground or online (at most every few
 * hours; the service decides). Renders nothing.
 */
export function CanvasAutoSync() {
  const mode = useProfile().mode;
  const navigate = useNavigate();

  useEffect(() => {
    if (mode !== 'student') return;
    const openSettings = () => {
      navigate('/settings#bruinlearn');
      setTimeout(() => document.getElementById('bruinlearn')?.scrollIntoView({ block: 'start' }), 60);
    };
    const check = () => {
      if (document.visibilityState === 'visible') void autoSyncCanvas(openSettings);
    };
    // Let the first screen settle before going to the network.
    const t = window.setTimeout(check, 1500);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [mode, navigate]);

  return null;
}
