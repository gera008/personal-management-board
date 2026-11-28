/** The app's modules, in navigation order (tab bar on phones, side bar on wide screens). */
export const MODULES = [
  { to: '/calendar', icon: 'calendar', key: 'nav.calendar' },
  { to: '/tasks', icon: 'tasks', key: 'nav.tasks' },
  { to: '/finance', icon: 'finance', key: 'nav.finance' },
  { to: '/health', icon: 'habits', key: 'nav.health' },
] as const;

/** Overview first, then the modules. */
export const NAV_ITEMS = [{ to: '/', icon: 'home', key: 'nav.home', end: true } as const, ...MODULES.map((m) => ({ ...m, end: false }))];
