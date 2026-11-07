import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, unwrap } from './supabase';
import { setLanguage } from './i18n';
import type { Currency, Profile, WidgetSetting } from '@/domain/types';
import type { Rates } from '@/domain/finance/totals';

export const DEFAULT_LAYOUT: WidgetSetting[] = [
  { id: 'month_calendar', visible: true },
  { id: 'week_detail', visible: true },
  { id: 'tasks', visible: true },
  { id: 'finance_summary', visible: true },
  { id: 'habits_today', visible: true },
  { id: 'habit_heatmap', visible: true },
];

interface Ctx {
  profile: Profile;
  rates: Rates;
  weekStartsOn: 0 | 1;
  update: (patch: Partial<Profile>) => Promise<unknown>;
}

const ProfileContext = createContext<Ctx | null>(null);

/** The app is dark only; the accent color comes from Settings. */
export function applyAccent(accent: Profile['accent'] | undefined) {
  const root = document.documentElement;
  if (!accent || accent === 'lime') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', accent);
  try {
    localStorage.setItem('accent', accent ?? 'lime');
  } catch {
    /* storage unavailable */
  }
}

export function ProfileProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const profileQ = useQuery({
    queryKey: ['profiles', userId],
    queryFn: async () => unwrap(await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle()) as Profile | null,
  });
  const ratesQ = useQuery({
    queryKey: ['currency_rates'],
    queryFn: async () => unwrap(await supabase.from('currency_rates').select('*')) as { currency: Currency; rate_to_mxn: string }[],
  });

  const profile = profileQ.data;
  useEffect(() => {
    if (!profile) return;
    setLanguage(profile.language);
    applyAccent(profile.accent);
  }, [profile?.language, profile?.accent]); // eslint-disable-line react-hooks/exhaustive-deps

  if (profileQ.isLoading || ratesQ.isLoading) return <div className="p-6 text-sm text-muted">…</div>;
  if (!profile) return <div className="p-6 text-sm text-expense">Profile not found. Check that the database migrations ran.</div>;

  const rates: Rates = { MXN: 1 };
  for (const r of ratesQ.data ?? []) rates[r.currency] = Number(r.rate_to_mxn);

  const value: Ctx = {
    profile: { ...profile, dashboard_layout: profile.dashboard_layout?.length ? profile.dashboard_layout : DEFAULT_LAYOUT },
    rates,
    weekStartsOn: profile.week_start,
    update: async (patch) => {
      const { error } = await supabase.from('profiles').update(patch).eq('user_id', userId);
      if (error) throw new Error(error.message);
      await profileQ.refetch();
    },
  };
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const c = useContext(ProfileContext);
  if (!c) throw new Error('useProfile outside ProfileProvider');
  return c;
}
