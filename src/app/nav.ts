import {
  ChartNoAxesCombined,
  Crosshair,
  FlaskConical,
  GanttChartSquare,
  Gauge,
  GraduationCap,
  ListChecks,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Second key of the "G then X" navigation chord. */
  key: string;
  description: string;
  /** Shown in Student mode only. */
  studentOnly?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Command Center', icon: Gauge, key: 'C', description: 'Today, load and risk at a glance' },
  { to: '/timeline', label: 'Timeline', icon: GanttChartSquare, key: 'L', description: 'Schedule against capacity' },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, key: 'T', description: 'Everything on your plate' },
  { to: '/focus', label: 'Focus', icon: Crosshair, key: 'F', description: 'One task, a pomodoro timer, nothing else' },
  { to: '/exams', label: 'Exams', icon: GraduationCap, key: 'E', description: 'Midterms, finals and study plans', studentOnly: true },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical, key: 'S', description: 'Test schedule changes before committing' },
  { to: '/insights', label: 'Insights', icon: ChartNoAxesCombined, key: 'I', description: 'Estimates, focus and throughput' },
  { to: '/settings', label: 'Settings', icon: Settings2, key: ',', description: 'Working hours, data and preferences' },
];

/** The nav item for a path, or undefined for paths outside the main nav (404, design system). */
export function matchNav(pathname: string): NavItem | undefined {
  return NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(`${n.to}/`)));
}

/** Human page name for titles and the breadcrumb. */
export function pageLabel(pathname: string): string {
  return pathname === '/design' ? 'Design system' : (matchNav(pathname)?.label ?? 'Not found');
}
