import { supabase } from './supabase';

/**
 * Pushes local calendar changes to Google right away instead of waiting for
 * the 10-minute job. Fire-and-forget: does nothing when Google isn't connected,
 * and errors show up in Settings › Google Calendar.
 */
export function syncGoogleSoon() {
  supabase.functions.invoke('google', { body: { mode: 'sync' } }).catch(() => undefined);
}

export async function googleCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('google', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
