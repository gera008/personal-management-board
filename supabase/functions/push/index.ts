// Web Push sender.
//   {"mode":"reminders"}  called by pg_cron every 5 minutes with the x-cron-secret header:
//                         event reminders, task reminders, habit reminders, daily digest.
//   {"mode":"test"}       called by the signed-in user from Settings: sends a test push.
//
// Secrets (supabase secrets set ...): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
// and CRON_SECRET (the same value as the `cron_secret` Vault secret used by pg_cron).
// Deploy with --no-verify-jwt: callers are checked here (cron secret or the user's session).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { addDaysKey, occurrencesBetween, type Recurrence } from '../_shared/recurrence.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface Message {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

const MESSAGES = {
  en: { event: 'Event', at: 'at', task: 'Task due', habit: 'Habit reminder', digest: (n: number) => `${n} task${n === 1 ? '' : 's'} due today`, test: 'Notifications are working.' },
  es: { event: 'Evento', at: 'a las', task: 'Tarea pendiente', habit: 'Recordatorio de hábito', digest: (n: number) => `${n} tarea${n === 1 ? '' : 's'} para hoy`, test: 'Las notificaciones funcionan.' },
};

async function sendToUser(db: SupabaseClient, userId: string, msg: Message): Promise<number> {
  const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,keys').eq('user_id', userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: 3600 });
      sent++;
    } catch (err) {
      // 404/410: the browser dropped the subscription.
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', code, err);
    }
  }
  return sent;
}

/** Local date and HH:MM for a time zone. */
function localNow(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour').replace('24', '00')}:${get('minute')}` };
}

/** UTC instant of a local date + HH:MM in a time zone (handles DST by re-checking the offset). */
function zonedInstant(dateKey: string, hhmm: string, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const l = localNow(tz, new Date(ms));
    const [ly, lm, ld] = l.date.split('-').map(Number);
    const [lh, lmi] = l.time.split(':').map(Number);
    return Date.UTC(ly, lm - 1, ld, lh, lmi) - ms;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t);
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function runReminders(db: SupabaseClient) {
  const now = new Date();
  const stats = { events: 0, tasks: 0, habits: 0, digests: 0 };
  const { data: profiles } = await db.from('profiles').select('user_id,language,timezone,digest_time');
  const { data: subscribers } = await db.from('push_subscriptions').select('user_id');
  const withPush = new Set((subscribers ?? []).map((s) => s.user_id));

  for (const p of profiles ?? []) {
    if (!withPush.has(p.user_id)) continue;
    const m = MESSAGES[p.language as 'en' | 'es'] ?? MESSAGES.en;
    const local = localNow(p.timezone, now);
    const fmtTime = (iso: string) => new Intl.DateTimeFormat(p.language, { timeZone: p.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

    // Events: reminder time reached, event not more than an hour past.
    // Events linked to Google Calendar get their alert from Google (its reminders are synced), not from here.
    const { data: events } = await db
      .from('events')
      .select('id,title,start_at,reminder_minutes,all_day')
      .eq('user_id', p.user_id)
      .is('google_event_id', null)
      .is('recurrence', null)
      .not('reminder_minutes', 'is', null)
      .is('reminder_sent_at', null)
      .gte('start_at', new Date(now.getTime() - 3600_000).toISOString())
      .lte('start_at', new Date(now.getTime() + 8 * 86400_000).toISOString());
    for (const e of events ?? []) {
      if (new Date(e.start_at).getTime() - e.reminder_minutes * 60_000 > now.getTime()) continue;
      await sendToUser(db, p.user_id, { title: e.title, body: e.all_day ? m.event : `${m.event} ${m.at} ${fmtTime(e.start_at)}`, url: '/calendar', tag: `event-${e.id}` });
      await db.from('events').update({ reminder_sent_at: now.toISOString() }).eq('id', e.id);
      stats.events++;
    }

    // Recurring events: the occurrence whose reminder time has just passed (once per occurrence).
    const { data: series } = await db
      .from('events')
      .select('id,title,start_at,reminder_minutes,all_day,recurrence,exdates,reminder_sent_for')
      .eq('user_id', p.user_id)
      .is('google_event_id', null)
      .not('recurrence', 'is', null)
      .not('reminder_minutes', 'is', null)
      .lte('start_at', new Date(now.getTime() + 8 * 86400_000).toISOString());
    for (const e of series ?? []) {
      const start = localNow(p.timezone, new Date(e.start_at));
      const keys = occurrencesBetween(start.date, e.recurrence as Recurrence, addDaysKey(local.date, -1), addDaysKey(local.date, 8), e.exdates ?? []);
      const due = keys
        .map((k) => zonedInstant(k, start.time, p.timezone))
        .filter((at) => at.getTime() - e.reminder_minutes * 60_000 <= now.getTime() && at.getTime() >= now.getTime() - 3600_000)
        .filter((at) => !e.reminder_sent_for || new Date(e.reminder_sent_for) < at)
        .pop();
      if (!due) continue;
      await sendToUser(db, p.user_id, { title: e.title, body: e.all_day ? m.event : `${m.event} ${m.at} ${fmtTime(due.toISOString())}`, url: '/calendar', tag: `event-${e.id}-${due.getTime()}` });
      await db.from('events').update({ reminder_sent_for: due.toISOString() }).eq('id', e.id);
      stats.events++;
    }

    // Tasks with an explicit reminder.
    const { data: tasks } = await db
      .from('tasks')
      .select('id,title')
      .eq('user_id', p.user_id)
      .is('completed_at', null)
      .is('reminder_sent_at', null)
      .not('reminder_at', 'is', null)
      .lte('reminder_at', now.toISOString())
      .gte('reminder_at', new Date(now.getTime() - 86400_000).toISOString());
    for (const t of tasks ?? []) {
      await sendToUser(db, p.user_id, { title: m.task, body: t.title, url: `/tasks?task=${t.id}`, tag: `task-${t.id}` });
      await db.from('tasks').update({ reminder_sent_at: now.toISOString() }).eq('id', t.id);
      stats.tasks++;
    }

    // Habits with a reminder time that has passed today and isn't logged yet.
    const { data: habits } = await db
      .from('habits')
      .select('id,name,reminder_time,last_reminded_on,kind')
      .eq('user_id', p.user_id)
      .eq('archived', false)
      .not('reminder_time', 'is', null)
      .lte('start_date', local.date);
    for (const h of habits ?? []) {
      if (h.last_reminded_on === local.date || minutes(local.time) < minutes(h.reminder_time)) continue;
      const { data: logged } = await db.from('habit_logs').select('id').eq('habit_id', h.id).eq('date', local.date).maybeSingle();
      if (!logged || h.kind === 'bad') await sendToUser(db, p.user_id, { title: m.habit, body: h.name, url: '/health/habits', tag: `habit-${h.id}` });
      await db.from('habits').update({ last_reminded_on: local.date }).eq('id', h.id);
      stats.habits++;
    }

    // Daily digest of tasks due today, sent in the 5-minute window after digest_time.
    const delta = minutes(local.time) - minutes(p.digest_time);
    if (delta >= 0 && delta < 5) {
      const { count } = await db.from('tasks').select('id', { count: 'exact', head: true }).eq('user_id', p.user_id).is('completed_at', null).eq('due_date', local.date);
      if (count) {
        await sendToUser(db, p.user_id, { title: 'Mios', body: m.digest(count), url: '/tasks?list=today', tag: `digest-${local.date}` });
        stats.digests++;
      }
    }
  }
  return stats;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { mode } = await req.json().catch(() => ({ mode: 'reminders' }));
  const auth = req.headers.get('Authorization') ?? '';

  if (mode === 'test') {
    const { data } = await db.auth.getUser(auth.replace('Bearer ', ''));
    if (!data.user) return new Response('Unauthorized', { status: 401, headers: cors });
    const { data: profile } = await db.from('profiles').select('language').eq('user_id', data.user.id).maybeSingle();
    const m = MESSAGES[(profile?.language as 'en' | 'es') ?? 'en'];
    const sent = await sendToUser(db, data.user.id, { title: 'Mios', body: m.test, url: '/settings', tag: 'test' });
    return Response.json({ sent }, { headers: cors });
  }

  // Reminder runs are only allowed for pg_cron, which sends the shared secret.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Forbidden', { status: 403, headers: cors });
  return Response.json(await runReminders(db), { headers: cors });
});
