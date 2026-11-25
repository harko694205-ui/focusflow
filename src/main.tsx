import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { AppShell } from './app/AppShell';
import { Root } from './app/Root';
import { NotFound, RouteError } from './app/RouteError';
import { TooltipProvider } from './ui/Tooltip';
import { initPwa } from './pwa/pwa';

/**
 * Pages are code-split: each loads the first time it's visited (charts and the simulator
 * engine stay out of the initial download). The router loads the chunk before it switches
 * pages, so page transitions never show a half-loaded view.
 */
const page = <T,>(load: () => Promise<T>, pick: (m: T) => React.ComponentType) => async () => ({ Component: pick(await load()) });

const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    // Shown only while the very first page's code downloads.
    hydrateFallbackElement: <div className="h-dvh bg-canvas" aria-busy="true" />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, lazy: page(() => import('./routes/CommandCenter'), (m) => m.CommandCenter) },
          { path: 'timeline', lazy: page(() => import('./routes/Timeline'), (m) => m.TimelinePage) },
          { path: 'tasks', lazy: page(() => import('./routes/Tasks'), (m) => m.TasksPage) },
          { path: 'simulator', lazy: page(() => import('./routes/Simulator'), (m) => m.SimulatorPage) },
          { path: 'insights', lazy: page(() => import('./routes/Insights'), (m) => m.InsightsPage) },
          { path: 'settings', lazy: page(() => import('./routes/Settings'), (m) => m.SettingsPage) },
          { path: 'design', lazy: page(() => import('./routes/DesignSystem'), (m) => m.DesignSystem) },
          { path: '*', element: <NotFound /> },
        ],
      },
      // Full-screen, outside the app shell.
      { path: 'focus', lazy: page(() => import('./routes/Focus'), (m) => m.FocusPage) },
    ],
  },
]);

initPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
