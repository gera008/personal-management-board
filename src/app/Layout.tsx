import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';
import { useAmountsHidden } from '@/lib/privacy';
import { useIsDemo } from '@/lib/demo';
import { useIdleHome } from '@/lib/idleHome';
import { ModuleDial } from './ModuleDial';

function PrivacyToggle() {
  const { t } = useTranslation();
  const [hidden, toggle] = useAmountsHidden();
  const label = hidden ? t('privacy.show') : t('privacy.hide');
  return (
    <button onClick={toggle} className="btn-round" aria-label={label} aria-pressed={hidden} title={label}>
      <Icon name={hidden ? 'eyeOff' : 'eye'} size={22} />
    </button>
  );
}

/** The dial sits on the left edge from 1024px; below that it's at the bottom. */
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

export function Layout() {
  const { t } = useTranslation();
  // Subscribing here re-renders the whole page when amounts are hidden or shown.
  useAmountsHidden();
  const demo = useIsDemo();
  const wide = useWide();
  // Two idle minutes bring the Overview back.
  useIdleHome();
  return (
    <div className="min-h-dvh">
      <div className="lg:pl-28">
        {demo && <div className="border-b border-border bg-card px-4 py-1.5 text-center text-xs text-muted">{t('auth.demoBanner')}</div>}
        <header className="sticky top-0 z-20 bg-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:px-8">
            <Link to="/" className="flex items-center gap-2">
              <img src="/icon-192.png" alt="" className="h-8 w-8 rounded-xl" />
              <span className="text-[17px] font-semibold tracking-tight">Mios</span>
            </Link>
            <div className="flex items-center gap-2">
              <PrivacyToggle />
              <NavLink to="/settings" className={({ isActive }) => `btn-round ${isActive ? 'border-transparent bg-accent text-bg hover:bg-accent' : ''}`} aria-label={t('nav.settings')}>
                <Icon name="settings" size={22} />
              </NavLink>
            </div>
          </div>
        </header>
        <main className="pb-dial mx-auto w-full max-w-5xl px-4 pt-2 md:px-8">
          <Outlet />
        </main>
      </div>
      {/* Fade the page out behind the dial at the bottom. */}
      {!wide && <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-28 bg-gradient-to-t from-bg via-bg/80 to-transparent" />}
      <ModuleDial side={wide ? 'left' : 'bottom'} />
    </div>
  );
}
