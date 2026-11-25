import {
  ChartNoAxesCombined,
  Crosshair,
  FlaskConical,
  GanttChartSquare,
  Gauge,
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
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Command Center', icon: Gauge, key: 'C', description: 'Today, load and risk at a glance' },
  { to: '/timeline', label: 'Timeline', icon: GanttChartSquare, key: 'L', description: 'Schedule against capacity' },
  { to: '/tasks', label: 'Tasks', icon: ListChecks, key: 'T', description: 'Everything on your plate' },
  { to: '/focus', label: 'Focus', icon: Crosshair, key: 'F', description: 'One task, a pomodoro timer, nothing else' },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical, key: 'S', description: 'Test schedule changes before committing' },
  { to: '/insights', label: 'Insights', icon: ChartNoAxesCombined, key: 'I', description: 'Estimates, focus and throughput' },
  { to: '/settings', label: 'Settings', icon: Settings2, key: ',', description: 'Working hours, data and preferences' },
];

export function navFor(pathname: string): NavItem {
  return NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to))) ?? NAV[0];
}
