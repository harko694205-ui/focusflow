import { Outlet } from 'react-router';
import { FocusDriver } from '@/features/focus/FocusDriver';

/** Above every route: background work that must keep running whatever page is open. */
export function Root() {
  return (
    <>
      <Outlet />
      <FocusDriver />
    </>
  );
}
