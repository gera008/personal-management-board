import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Public demo account, filled with sample data by `seed_demo` and reset every
 * night. Set both variables (locally and in Vercel) to show "Try the demo".
 */
export const DEMO_EMAIL = (import.meta.env.VITE_DEMO_EMAIL as string | undefined) ?? '';
const DEMO_PASSWORD = (import.meta.env.VITE_DEMO_PASSWORD as string | undefined) ?? '';
export const demoAvailable = !!DEMO_EMAIL && !!DEMO_PASSWORD;

export const signInDemo = () => supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });

/** True while the signed-in account is the demo one. */
export function useIsDemo() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (!DEMO_EMAIL) return;
    supabase.auth.getSession().then(({ data }) => setDemo(data.session?.user.email === DEMO_EMAIL));
  }, []);
  return demo;
}
