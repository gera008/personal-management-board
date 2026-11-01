import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthGate } from '@/features/auth/AuthGate';
import { ProfileProvider } from '@/lib/profile';
import { Layout } from './Layout';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { FinanceLayout } from '@/features/finance/FinanceLayout';
import { FinanceHome } from '@/features/finance/FinanceHome';
import { AccountsPage } from '@/features/finance/AccountsPage';
import { CategoriesPage } from '@/features/finance/CategoriesPage';
import { BudgetsPage } from '@/features/finance/BudgetsPage';
import { RecurringPage } from '@/features/finance/RecurringPage';
import { ImportExportPage } from '@/features/finance/ImportExportPage';
import { HabitsPage } from '@/features/habits/HabitsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

// Charts (Recharts) are only loaded when Analytics opens.
const AnalyticsPage = lazy(() => import('@/features/finance/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));

export function App() {
  return (
    <AuthGate>
      {(session) => (
        <ProfileProvider userId={session.user.id}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="finance" element={<FinanceLayout />}>
                <Route index element={<FinanceHome />} />
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="categories" element={<CategoriesPage />} />
                <Route path="budgets" element={<BudgetsPage />} />
                <Route path="recurring" element={<RecurringPage />} />
                <Route path="analytics" element={<Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface" />}><AnalyticsPage /></Suspense>} />
                <Route path="data" element={<ImportExportPage />} />
              </Route>
              <Route path="habits" element={<HabitsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ProfileProvider>
      )}
    </AuthGate>
  );
}
