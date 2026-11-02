import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/health/habits', key: 'health.tabs.habits' },
  { to: '/health/garmin', key: 'health.tabs.garmin' },
];

/** Health module: habits and Garmin stats as sub-modules. */
export function HealthLayout() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{t('nav.health')}</h1>
      <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2 text-sm ${isActive ? 'border-habit font-semibold' : 'border-transparent text-muted'}`}
          >
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
