import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { useAmountsHidden } from '@/lib/privacy';
import { useIsDemo } from '@/lib/demo';

const NAV = [
  { to: '/', icon: 'home', key: 'nav.home', accent: 'text-fg' },
  { to: '/calendar', icon: 'calendar', key: 'nav.calendar', accent: 'text-calendar' },
  { to: '/tasks', icon: 'tasks', key: 'nav.tasks', accent: 'text-tasks' },
  { to: '/finance', icon: 'finance', key: 'nav.finance', accent: 'text-fg' },
  { to: '/health', icon: 'habits', key: 'nav.health', accent: 'text-habit' },
];

function PrivacyToggle({ className = '', withLabel = false }: { className?: string; withLabel?: boolean }) {
  const { t } = useTranslation();
  const [hidden, toggle] = useAmountsHidden();
  const label = hidden ? t('privacy.show') : t('privacy.hide');
  return (
    <button onClick={toggle} className={className} aria-label={label} aria-pressed={hidden} title={label}>
      <Icon name={hidden ? 'eyeOff' : 'eye'} />
      {withLabel && label}
    </button>
  );
}

export function Layout() {
  const { t } = useTranslation();
  // Subscribing here re-renders the whole page when amounts are hidden or shown.
  useAmountsHidden();
  const demo = useIsDemo();
  return (
    <div className="min-h-dvh md:flex">
      {/* Sidebar (tablet/desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-border px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="font-bold">Mios</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {[...NAV, { to: '/settings', icon: 'settings', key: 'nav.settings', accent: 'text-fg' }].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-surface font-semibold' : 'text-muted hover:bg-surface'}`}
            >
              {({ isActive }) => (
                <>
                  <Icon name={n.icon} className={isActive ? n.accent : ''} />
                  {t(n.key)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <PrivacyToggle withLabel className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface" />
      </aside>

      <div className="min-w-0 flex-1">
        {/* Top bar (phone) */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/90 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur md:hidden">
          <span className="font-bold">Mios</span>
          <div className="flex items-center gap-1">
            <PrivacyToggle className="rounded-lg p-1.5 text-muted" />
            <NavLink to="/settings" className="rounded-lg p-1.5 text-muted" aria-label={t('nav.settings')}>
              <Icon name="settings" />
            </NavLink>
          </div>
        </header>
        {demo && <div className="border-b border-border bg-surface px-4 py-1.5 text-center text-xs text-muted">{t('auth.demoBanner')}</div>}
        <main className="pb-safe mx-auto w-full max-w-5xl px-4 pt-4 md:px-8 md:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (phone) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'font-semibold text-fg' : 'text-muted'}`}>
            {({ isActive }) => (
              <>
                <Icon name={n.icon} size={22} className={isActive ? n.accent : ''} />
                {t(n.key)}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
