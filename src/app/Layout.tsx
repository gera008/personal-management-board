import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { useAmountsHidden } from '@/lib/privacy';
import { useIsDemo } from '@/lib/demo';
import { useIdleHome } from '@/lib/idleHome';
import { NAV_ITEMS } from './modules';

function PrivacyToggle() {
  const { t } = useTranslation();
  const [hidden, toggle] = useAmountsHidden();
  const label = hidden ? t('privacy.show') : t('privacy.hide');
  return (
    <button onClick={toggle} className="btn-round h-10 w-10 sm:h-12 sm:w-12" aria-label={label} aria-pressed={hidden} title={label}>
      <Icon name={hidden ? 'eyeOff' : 'eye'} size={22} />
    </button>
  );
}

/** From 1024px the modules sit in a side bar; below that in a tab bar at the bottom. */
function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Module navigation. Wide screens: a bar down the left edge. Phones: a tab bar
 * along the bottom, above the home indicator.
 */
function ModuleNav({ side }: { side: 'left' | 'bottom' }) {
  const { t } = useTranslation();
  const left = side === 'left';
  return (
    <nav
      aria-label={t('nav.selector')}
      data-tabbar={left ? undefined : ''}
      className={
        left
          ? 'fixed inset-y-0 left-0 z-30 flex w-24 flex-col items-center gap-2 border-r border-border bg-bg pt-24'
          : 'fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-bg/90 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl'
      }
    >
      {NAV_ITEMS.map((m) => (
        <NavLink
          key={m.to}
          to={m.to}
          end={m.end}
          className={`group flex flex-col items-center gap-1 text-xs ${left ? 'w-20 py-1.5' : 'min-w-0 flex-1 pb-1.5 pt-2 text-[11px]'}`}
        >
          {({ isActive }) => (
            <>
              <span
                className={`flex items-center justify-center rounded-2xl transition ${left ? 'h-11 w-11' : 'h-8 w-12'} ${
                  isActive ? 'bg-accent text-bg' : 'text-muted group-hover:text-fg'
                }`}
              >
                <Icon name={m.icon} size={left ? 22 : 20} />
              </span>
              <span className={`max-w-full truncate ${isActive ? 'font-medium text-fg' : 'text-muted'}`}>{t(m.key)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The page's own big title (its first h1) once it has scrolled under the
 * header, so the header can show it in small, as iOS does.
 */
function useScrolledTitle() {
  const { pathname } = useLocation();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    // Looked up on every check: pages can swap their h1 while they load.
    let frame = 0;
    const check = () => {
      frame = 0;
      const h1 = document.querySelector('main h1');
      const header = document.querySelector('header');
      const gone = !!h1 && !!header && h1.getBoundingClientRect().bottom < header.getBoundingClientRect().bottom;
      setTitle(gone ? h1.textContent : null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return title;
}

export function Layout() {
  const { t } = useTranslation();
  // Subscribing here re-renders the whole page when amounts are hidden or shown.
  useAmountsHidden();
  const demo = useIsDemo();
  const wide = useWide();
  // Two idle minutes bring the Overview back.
  useIdleHome();
  const scrolledTitle = useScrolledTitle();
  return (
    <div className="min-h-dvh">
      {wide && <ModuleNav side="left" />}
      <div className="lg:pl-24">
        {demo && <div className="truncate border-b border-border bg-card px-4 py-1 text-center text-xs text-muted">{t('auth.demoBanner')}</div>}
        <header className="sticky top-0 z-20 bg-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:px-8 xl:max-w-6xl">
            <Link to="/" className="flex min-w-0 items-center gap-2">
              <img src="/icon-192.png" alt="" className="h-8 w-8 shrink-0 rounded-xl" />
              {/* Once the page title scrolls away it takes the place of the app's name. */}
              <span key={scrolledTitle ?? 'app'} className="animate-[fadein_.2s_ease-out] truncate text-[17px] font-semibold tracking-tight">
                {scrolledTitle ?? 'Mios'}
              </span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <PrivacyToggle />
              <NavLink
                to="/settings"
                className={({ isActive }) => `btn-round h-10 w-10 sm:h-12 sm:w-12 ${isActive ? 'border-transparent bg-accent text-bg hover:bg-accent' : ''}`}
                aria-label={t('nav.settings')}
              >
                <Icon name="settings" size={22} />
              </NavLink>
            </div>
          </div>
        </header>
        <main className="pb-nav mx-auto w-full max-w-5xl px-4 pt-1 md:px-8 xl:max-w-6xl">
          <Outlet />
        </main>
      </div>
      {!wide && <ModuleNav side="bottom" />}
    </div>
  );
}
