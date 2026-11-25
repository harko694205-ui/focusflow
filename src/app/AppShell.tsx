import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutlet } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { isTypingTarget } from '@/lib/hotkeys';
import { requestPersistentStorage } from '@/db/db';
import { TaskEditor } from '@/features/tasks/TaskEditor';
import { undoLast } from '@/features/tasks/actions';
import { useTaskView } from '@/features/tasks/viewStore';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Toaster } from './toast';
import { NAV, pageLabel as labelFor } from './nav';
import { isModalOpen, useUI } from './store';

/**
 * Global keyboard shortcuts: ⌘K palette, C new task, G→X navigation, ⌘\ sidebar, ⌘Z undo, ? help.
 * Registered in the capture phase so they run before page-level hotkeys; anything handled here
 * calls preventDefault(), which page hotkeys respect.
 */
function useShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
        return;
      }
      if (mod && (e.key === '\\' || e.code === 'Backslash')) {
        e.preventDefault();
        ui.toggleSidebar();
        return;
      }
      if (isTypingTarget(e.target) || isModalOpen()) return;

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undoLast();
        return;
      }
      if (mod || e.altKey) return;

      const key = e.key.toUpperCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const target = NAV.find((n) => n.key === key);
        if (target) {
          e.preventDefault();
          navigate(target.to);
        }
        return;
      }
      if (key === 'G') {
        e.preventDefault();
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
      } else if (key === 'C') {
        e.preventDefault();
        // On the Tasks page with a single category filter, pre-select that category.
        const cats = useTaskView.getState().filter.categories;
        ui.openCreate(pathRef.current.startsWith('/tasks') && cats.length === 1 ? { categoryId: cats[0] } : undefined);
      } else if (e.key === '?') {
        e.preventDefault();
        ui.setShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [navigate]);
}

export function AppShell() {
  const collapsed = useUI((s) => s.sidebarCollapsed);
  const mobileOpen = useUI((s) => s.mobileNavOpen);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const location = useLocation();
  useShortcuts();

  useEffect(() => {
    void requestPersistentStorage();
  }, []);
  useEffect(() => setMobileNav(false), [location.pathname, setMobileNav]);

  // Each page gets a title, and after navigating, focus moves to the new page so keyboard and
  // screen-reader users start there (not on the link they just used).
  const mainRef = useRef<HTMLElement>(null);
  // Compare paths rather than counting renders: StrictMode re-runs effects in development.
  const lastPath = useRef(location.pathname);
  const pageLabel = labelFor(location.pathname);
  useEffect(() => {
    document.title = `${pageLabel} · FocusFlow`;
    if (lastPath.current === location.pathname) return; // first page load: leave focus alone
    lastPath.current = location.pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname, pageLabel]);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only z-[70] rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:left-3 focus:top-2"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden border-r border-line transition-[width] duration-200 ease-out md:block',
          collapsed ? 'w-14' : 'w-[232px]',
        )}
      >
        <Sidebar collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-[rgb(4_4_6/0.6)] md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileNav(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 border-r border-line shadow-dialog md:hidden"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            >
              <Sidebar collapsed={false} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main
          id="main"
          ref={mainRef}
          tabIndex={-1}
          aria-label={pageLabel}
          className="min-h-0 flex-1 overflow-y-auto outline-none [scrollbar-gutter:stable]"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
              className="min-h-full"
            >
              <FrozenOutlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette />
      <TaskEditor />
      <ShortcutsDialog />
      <Toaster />
    </div>
  );
}

/**
 * The route element captured when this page mounted. During a page transition the exiting
 * wrapper would otherwise render the *new* route via <Outlet />, mounting it twice.
 */
function FrozenOutlet() {
  const outlet = useOutlet();
  const [frozen] = useState(outlet);
  return frozen;
}
