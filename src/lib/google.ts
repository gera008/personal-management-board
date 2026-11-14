import { supabase } from './supabase';

/**
 * Pushes local calendar and task changes to Google right away instead of
 * waiting for the 10-minute job. Fire-and-forget: does nothing when Google isn't connected,
 * and errors show up in Settings › Google Calendar.
 */
let soon: ReturnType<typeof setTimeout> | undefined;
export function syncGoogleSoon() {
  // Several changes in a row (a task and its subtasks) make one sync.
  clearTimeout(soon);
  soon = setTimeout(() => {
    supabase.functions.invoke('google', { body: { mode: 'sync' } }).catch(() => undefined);
  }, 1500);
}

export async function googleCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('google', { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}
