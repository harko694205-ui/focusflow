import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { AppShell } from './app/AppShell';
import { TooltipProvider } from './ui/Tooltip';
import { CommandCenter } from './routes/CommandCenter';
import { PlaceholderPage } from './routes/Placeholder';
import { DesignSystem } from './routes/DesignSystem';
import { TasksPage } from './routes/Tasks';
import { TimelinePage } from './routes/Timeline';
import { SimulatorPage } from './routes/Simulator';
import { InsightsPage } from './routes/Insights';
import { FocusPage } from './routes/Focus';
import { Root } from './app/Root';

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { index: true, element: <CommandCenter /> },
          { path: 'timeline', element: <TimelinePage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'simulator', element: <SimulatorPage /> },
          { path: 'insights', element: <InsightsPage /> },
          { path: 'settings', element: <PlaceholderPage page="settings" /> },
          { path: 'design', element: <DesignSystem /> },
        ],
      },
      // Full-screen, outside the app shell.
      { path: 'focus', element: <FocusPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </StrictMode>,
);
