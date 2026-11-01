import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const TABS = [
  { to: '/finance', key: 'finance.tabs.overview', end: true },
  { to: '/finance/accounts', key: 'finance.tabs.accounts' },
  { to: '/finance/categories', key: 'finance.tabs.categories' },
  { to: '/finance/budgets', key: 'finance.tabs.budgets' },
  { to: '/finance/recurring', key: 'finance.tabs.recurring' },
  { to: '/finance/analytics', key: 'finance.tabs.analytics' },
  { to: '/finance/data', key: 'finance.tabs.data' },
];

export function FinanceLayout() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{t('nav.finance')}</h1>
      <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2 text-sm ${isActive ? 'border-fg font-semibold' : 'border-transparent text-muted'}`}
          >
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
