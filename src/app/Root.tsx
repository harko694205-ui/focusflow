import { Outlet } from 'react-router';
import { MotionConfig } from 'motion/react';
import { FocusDriver } from '@/features/focus/FocusDriver';

/** Above every route: app-wide config and background work that must run whatever page is open. */
export function Root() {
  return (
    // JS animations follow the OS "reduce motion" setting too (CSS ones are handled in globals.css).
    <MotionConfig reducedMotion="user">
      <Outlet />
      <FocusDriver />
    </MotionConfig>
  );
}
