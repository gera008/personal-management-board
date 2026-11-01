import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Throws the PostgREST error so TanStack Query surfaces it. */
export function unwrap<T>(res: { data?: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
