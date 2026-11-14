// Two-way Google Calendar sync.
//
//   POST {"mode":"auth-url","returnTo":"<origin>"}  (signed-in user) -> { url } to Google's consent page
//   GET  ?code=…&state=…                              Google's redirect back; stores the refresh token
//   POST {"mode":"sync"}                              pg_cron (x-cron-secret: every user) or the user (only them)
//   POST {"mode":"set-calendar","calendarId","enabled"} (signed-in user) turns a calendar on/off (off removes it from the app only)
//   POST {"mode":"disconnect"}                        (signed-in user) revokes and forgets the connection
//
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET, APP_URL (published app).
// Deploy with --no-verify-jwt: Google's redirect has no JWT, and callers are checked here.
//
// Pull: incremental (syncToken) per enabled calendar. Series the app can represent
// become one recurring event; others become read-only instance copies.
// Push: rows the app marked needs_push, plus deletions. When both sides changed
// since the last sync, the newer change wins.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import { fromGoogleRecurrence, toGoogleRecurrence } from '../_shared/rrule.ts';
import type { Recurrence } from '../_shared/recurrence.ts';
import {
  CATEGORY_PROP,
  COLOR_PROP,
  categoryFromGoogle,
  categoryToGoogle,
  reminderFromGoogle,
  reminderToGoogle,
  type CategoryColor,
  type GoogleReminders,
} from '../_shared/gmapping.ts';
import { syncTasks } from './tasks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google`;
const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const SCOPES = `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly ${TASKS_SCOPE}`;
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const API = 'https://www.googleapis.com/calendar/v3';
const ALLOWED_RETURN = [APP_URL, 'http://localhost:5173'].filter(Boolean);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// ---------- small helpers ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(CRON_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))));
}

/** OAuth state = user id + return origin + time, signed so it can't be forged. */
async function makeState(userId: string, returnTo: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, r: returnTo, t: Date.now() })));
  return `${payload}.${await hmac(payload)}`;
}

async function readState(state: string): Promise<{ u: string; r: string } | null> {
  const [payload, sig] = state.split('.');
  if (!payload || sig !== (await hmac(payload))) return null;
  const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  if (Date.now() - data.t > 15 * 60_000) return null;
  return data;
}

/** Local wall-clock date (YYYY-MM-DD) and time (HHMMSS) of an instant in a time zone. */
function localParts(iso: string, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour').replace('24', '00')}${g('minute')}${g('second')}` };
}

/**
 * Local date of one occurrence of a Google series, from the occurrence's id
 * ("<seriesId>_20260803" all-day, "<seriesId>_20260804T010000Z" timed).
 */
function instanceDate(instanceId: string, seriesId: string, tz: string): string | null {
  if (!instanceId.startsWith(`${seriesId}_`)) return null;
  const s = instanceId.slice(seriesId.length + 1);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  return m ? localParts(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, tz).date : null;
}

const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Instant of local midnight of a date in a time zone (for all-day events). */
function zonedMidnight(dateKey: string, tz: string): Date {
  const guess = Date.parse(`${dateKey}T00:00:00Z`);
  const offset = (ms: number) => {
    const l = localParts(new Date(ms).toISOString(), tz);
    return Date.parse(`${l.date}T${l.time.slice(0, 2)}:${l.time.slice(2, 4)}:${l.time.slice(4, 6)}Z`) - ms;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

// ---------- Google API ----------

async function accessToken(refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token as string;
}

async function gapi(token: string, method: string, path: string, body?: unknown, base = API) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text; // Google sometimes answers errors in plain text
  }
  return { status: res.status, ok: res.ok, data };
}

// ---------- pull: Google -> app ----------

interface GEvent {
  id: string;
  status: string;
  etag: string;
  updated: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  colorId?: string;
  reminders?: GoogleReminders;
  extendedProperties?: { private?: Record<string, string> };
}

/** What a sync needs besides the calendar: the user's categories and the calendar's default alerts. */
interface PullContext {
  categories: CategoryColor[];
  defaultReminders: { minutes: number }[];
}

function times(e: GEvent, tz: string) {
  if (e.start?.date) {
    // All-day: Google's end date is exclusive; the app stores the end of the last day.
    const start = zonedMidnight(e.start.date, tz);
    const end = new Date(zonedMidnight(e.end?.date ?? addDays(e.start.date, 1), tz).getTime() - 1000);
    return { start_at: start.toISOString(), end_at: end.toISOString(), all_day: true };
  }
  return { start_at: new Date(e.start!.dateTime!).toISOString(), end_at: new Date(e.end!.dateTime!).toISOString(), all_day: false };
}

async function pullCalendar(
  db: SupabaseClient,
  token: string,
  userId: string,
  cal: { calendar_id: string; sync_token: string | null; access_role: string | null },
  tz: string,
  ctx: PullContext,
) {
  const enc = encodeURIComponent(cal.calendar_id);
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let syncToken = cal.sync_token ?? undefined;
  for (;;) {
    const params = new URLSearchParams({ maxResults: '2500', showDeleted: 'true', singleEvents: 'false' });
    if (syncToken) params.set('syncToken', syncToken);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await gapi(token, 'GET', `/calendars/${enc}/events?${params}`);
    if (res.status === 410) {
      // Sync token expired: start over with a full sync.
      syncToken = undefined;
      pageToken = undefined;
      items.length = 0;
      continue;
    }
    if (!res.ok) throw new Error(`List ${cal.calendar_id}: ${res.status}`);
    items.push(...(res.data.items ?? []));
    pageToken = res.data.nextPageToken;
    nextSyncToken = res.data.nextSyncToken;
    if (!pageToken) break;
  }

  const readonlyCal = cal.access_role !== 'owner' && cal.access_role !== 'writer';
  const rowFor = async (googleId: string) =>
    (await db.from('events').select('id,updated_at,needs_push,google_synced_at,google_etag,exdates,recurrence').eq('user_id', userId).eq('google_calendar_id', cal.calendar_id).eq('google_event_id', googleId).maybeSingle()).data;
  const stamp = () => ({ google_synced_at: new Date().toISOString(), needs_push: false });

  // Masters first, so instance exceptions can find their series.
  items.sort((a, b) => Number(!!a.recurringEventId) - Number(!!b.recurringEventId));

  for (const e of items) {
    const existing = await rowFor(e.id);

    if (e.status === 'cancelled') {
      if (e.recurringEventId && e.originalStartTime) {
        // One occurrence removed in Google: skip that date in the series.
        const master = await rowFor(e.recurringEventId);
        const date = e.originalStartTime.date ?? localParts(e.originalStartTime.dateTime!, tz).date;
        if (master) await db.from('events').update({ exdates: [...new Set([...(master.exdates ?? []), date])], ...stamp() }).eq('id', master.id);
      }
      if (existing) await db.from('events').delete().eq('id', existing.id);
      await db.from('events').delete().eq('user_id', userId).eq('google_recurring_id', e.id);
      continue;
    }

    // Unchanged since we last saw it (e.g. our own push coming back).
    if (existing && existing.google_etag === e.etag && !existing.needs_push) continue;

    // Both sides changed since the last sync: the newer change wins.
    if (existing?.needs_push && new Date(existing.updated_at) > new Date(e.updated)) continue;

    // Category: only events we can edit; on read-only calendars it stays the app's choice.
    const category = readonlyCal
      ? undefined
      : categoryFromGoogle({ colorId: e.colorId, categoryProp: e.extendedProperties?.private?.[CATEGORY_PROP], colorProp: e.extendedProperties?.private?.[COLOR_PROP] }, ctx.categories);
    const base = {
      user_id: userId,
      title: e.summary || '(sin título)',
      notes: e.description ?? null,
      location: e.location ?? null,
      reminder_minutes: reminderFromGoogle(e.reminders, ctx.defaultReminders),
      ...(category !== undefined ? { list_id: category } : {}),
      ...times(e, tz),
      google_calendar_id: cal.calendar_id,
      google_event_id: e.id,
      google_etag: e.etag,
      google_readonly: readonlyCal,
      ...stamp(),
    };

    if (e.recurringEventId) {
      // A single occurrence edited in Google: a one-off copy linked to its series.
      const master = await rowFor(e.recurringEventId);
      if (master?.recurrence && e.originalStartTime) {
        const date = e.originalStartTime.date ?? localParts(e.originalStartTime.dateTime!, tz).date;
        await db.from('events').update({ exdates: [...new Set([...(master.exdates ?? []), date])], ...stamp() }).eq('id', master.id);
        const row = { ...base, recurrence: null, exdates: [], recurrence_parent_id: master.id };
        if (existing) await db.from('events').update(row).eq('id', existing.id);
        else await db.from('events').insert(row);
      }
      continue;
    }

    if (e.recurrence?.length) {
      const parsed = fromGoogleRecurrence(e.recurrence);
      if (parsed) {
        // Occurrences edited in Google live as their own rows; the series keeps skipping those dates.
        let exdates = parsed.exdates;
        if (existing) {
          const { data: edited } = await db.from('events').select('google_event_id').eq('recurrence_parent_id', existing.id).not('google_event_id', 'is', null);
          const dates = (edited ?? []).map((c) => instanceDate(c.google_event_id, e.id, tz)).filter((d): d is string => !!d);
          exdates = [...new Set([...exdates, ...dates])];
        }
        const row = { ...base, recurrence: parsed.rule as Recurrence, exdates };
        if (existing) await db.from('events').update(row).eq('id', existing.id);
        else await db.from('events').insert(row);
        continue;
      }
      // Not representable: store its occurrences (next year) as read-only copies.
      if (existing) await db.from('events').delete().eq('id', existing.id);
      await db.from('events').delete().eq('user_id', userId).eq('google_recurring_id', e.id);
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const inst = await gapi(token, 'GET', `/calendars/${enc}/events/${encodeURIComponent(e.id)}/instances?timeMin=${from}&timeMax=${to}&maxResults=500`);
      const rows = ((inst.data?.items ?? []) as GEvent[])
        .filter((i) => i.status !== 'cancelled')
        .map((i) => ({ ...base, ...times(i, tz), title: i.summary || base.title, reminder_minutes: reminderFromGoogle(i.reminders ?? e.reminders, ctx.defaultReminders), google_event_id: i.id, google_etag: i.etag, google_recurring_id: e.id, google_readonly: true, recurrence: null, exdates: [] }));
      if (rows.length) await db.from('events').insert(rows);
      continue;
    }

    const row = { ...base, recurrence: null, exdates: [] };
    if (existing) await db.from('events').update(row).eq('id', existing.id);
    else await db.from('events').insert(row);
  }

  await db.from('google_calendars').update({ sync_token: nextSyncToken ?? null }).eq('user_id', userId).eq('calendar_id', cal.calendar_id);
}

// ---------- push: app -> Google ----------

interface AppEvent {
  id: string;
  title: string;
  notes: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence: Recurrence | null;
  exdates: string[] | null;
  reminder_minutes: number | null;
  list_id: string | null;
  recurrence_parent_id: string | null;
  google_calendar_id: string | null;
  google_event_id: string | null;
  google_readonly: boolean;
}

function toGoogle(e: AppEvent, tz: string, categories: CategoryColor[]) {
  const body: Record<string, unknown> = {
    summary: e.title,
    description: e.notes ?? '',
    location: e.location ?? '',
    reminders: reminderToGoogle(e.reminder_minutes),
    ...categoryToGoogle(e.list_id, categories),
  };
  if (e.all_day) {
    const s = localParts(e.start_at, tz).date;
    const last = localParts(e.end_at, tz).date;
    body.start = { date: s };
    body.end = { date: addDays(last, 1) };
  } else {
    body.start = { dateTime: e.start_at, timeZone: tz };
    body.end = { dateTime: e.end_at, timeZone: tz };
  }
  // One occurrence of a Google series can't carry a recurrence (Google answers 400).
  if (!(e.recurrence_parent_id && e.google_event_id)) {
    body.recurrence = e.recurrence ? toGoogleRecurrence(e.recurrence, e.exdates ?? [], { allDay: e.all_day, timeZone: tz, localTime: localParts(e.start_at, tz).time }) : [];
  }
  return body;
}

async function push(db: SupabaseClient, token: string, userId: string, defaultCalendar: string | null, tz: string, categories: CategoryColor[]) {
  const { data: dels } = await db.from('google_deletions').select('*').eq('user_id', userId);
  for (const d of dels ?? []) {
    const res = await gapi(token, 'DELETE', `/calendars/${encodeURIComponent(d.calendar_id)}/events/${encodeURIComponent(d.event_id)}`);
    if (res.ok || res.status === 404 || res.status === 410) await db.from('google_deletions').delete().eq('user_id', userId).eq('calendar_id', d.calendar_id).eq('event_id', d.event_id);
  }

  const { data: dirty } = await db.from('events').select('*').eq('user_id', userId).eq('needs_push', true).limit(200);
  let pushed = 0;
  const failed: string[] = [];
  for (const row of (dirty ?? []) as AppEvent[]) {
    let e = row;
    // The app skips a date of a series both when it's deleted and when it was edited in
    // Google (the edited copy lives as its own row). Only deleted dates go to Google as
    // EXDATE: an EXDATE on an edited occurrence would cancel it there.
    if (e.recurrence && e.google_event_id && e.exdates?.length) {
      const { data: edited } = await db.from('events').select('google_event_id').eq('recurrence_parent_id', e.id).not('google_event_id', 'is', null);
      const keep = new Set((edited ?? []).map((c) => instanceDate(c.google_event_id, e.google_event_id!, tz)).filter(Boolean));
      if (keep.size) e = { ...e, exdates: e.exdates.filter((d) => !keep.has(d)) };
    }
    if (e.google_readonly) {
      await db.from('events').update({ needs_push: false, google_synced_at: new Date().toISOString() }).eq('id', e.id);
      continue;
    }
    const calendar = e.google_calendar_id ?? defaultCalendar;
    if (!calendar) continue; // nowhere to push yet
    const enc = encodeURIComponent(calendar);
    const res = e.google_event_id
      ? await gapi(token, 'PATCH', `/calendars/${enc}/events/${encodeURIComponent(e.google_event_id)}`, toGoogle(e, tz, categories))
      : await gapi(token, 'POST', `/calendars/${enc}/events`, toGoogle(e, tz, categories));
    if (!res.ok) {
      // One bad event mustn't stop the rest (or the pull); it stays marked and is retried next sync.
      const why = res.data?.error?.errors?.[0]?.message ?? res.data?.error?.message ?? (typeof res.data === 'string' ? res.data : '');
      failed.push(`"${e.title}": ${res.status} ${why}`.trim());
      continue;
    }
    await db
      .from('events')
      .update({ google_calendar_id: calendar, google_event_id: res.data.id, google_etag: res.data.etag, google_synced_at: new Date().toISOString(), needs_push: false })
      .eq('id', e.id);
    pushed++;
  }
  return { pushed, failed };
}

// ---------- sync orchestration ----------

/**
 * Events pushed while the default calendar was the "primary" alias came back
 * from the pull under the real calendar id as a second row. Keep the app's row
 * (it has the category and reminder), give it the real id, and drop the copy
 * without sending a deletion to Google.
 */
async function healPrimaryAlias(db: SupabaseClient, userId: string, primaryId: string) {
  const { data: aliased } = await db.from('events').select('id,google_event_id').eq('user_id', userId).eq('google_calendar_id', 'primary');
  for (const a of aliased ?? []) {
    const stamp = { google_synced_at: new Date().toISOString() };
    const { data: copy } = a.google_event_id
      ? await db.from('events').select('id,google_etag').eq('user_id', userId).eq('google_calendar_id', primaryId).eq('google_event_id', a.google_event_id).maybeSingle()
      : { data: null };
    if (copy) {
      await db.from('events').update({ recurrence_parent_id: a.id, ...stamp }).eq('recurrence_parent_id', copy.id);
      // Unlinked first, so deleting it doesn't delete the event in Google.
      await db.from('events').update({ google_event_id: null, ...stamp }).eq('id', copy.id);
      await db.from('events').delete().eq('id', copy.id);
    }
    await db.from('events').update({ google_calendar_id: primaryId, ...(copy ? { google_etag: copy.google_etag } : {}), ...stamp }).eq('id', a.id);
  }
}

async function syncUser(db: SupabaseClient, userId: string) {
  const now = new Date().toISOString();
  try {
    const { data: tok } = await db.from('google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle();
    if (!tok) return { skipped: true };
    const token = await accessToken(tok.refresh_token);
    const { data: profile } = await db.from('profiles').select('timezone').eq('user_id', userId).maybeSingle();
    const tz = profile?.timezone ?? 'America/Monterrey';
    const { data: account } = await db.from('google_accounts').select('email,default_calendar_id,tasks_enabled,scopes').eq('user_id', userId).maybeSingle();
    let defaultCalendar: string | null = account?.default_calendar_id ?? null;

    // Refresh the calendar list (names, colors, permissions), keeping the user's choices.
    const list = await gapi(token, 'GET', '/users/me/calendarList?minAccessRole=reader');
    const defaultReminders = new Map<string, { minutes: number }[]>(
      ((list.ok ? list.data.items : []) ?? []).map((c: { id: string; defaultReminders?: { minutes: number }[] }) => [c.id, c.defaultReminders ?? []]),
    );
    const { data: lists } = await db.from('task_lists').select('id,color').eq('user_id', userId).order('position');
    const categories = (lists ?? []) as CategoryColor[];
    if (list.ok) {
      const { data: known } = await db.from('google_calendars').select('calendar_id').eq('user_id', userId);
      const knownIds = new Set((known ?? []).map((k) => k.calendar_id));
      for (const c of list.data.items ?? []) {
        const info = { summary: c.summaryOverride ?? c.summary, color: c.backgroundColor ?? null, access_role: c.accessRole };
        if (knownIds.has(c.id)) await db.from('google_calendars').update(info).eq('user_id', userId).eq('calendar_id', c.id);
        else await db.from('google_calendars').insert({ user_id: userId, calendar_id: c.id, ...info, sync_enabled: !!c.primary });
      }
      // Never push to the "primary" alias: use the primary calendar's real id.
      const primaryId: string | undefined = (list.data.items ?? []).find((c: { primary?: boolean }) => c.primary)?.id;
      if (primaryId) {
        if (!defaultCalendar || defaultCalendar === 'primary') {
          defaultCalendar = primaryId;
          await db.from('google_accounts').update({ default_calendar_id: primaryId, email: account?.email ?? primaryId }).eq('user_id', userId);
        }
        await healPrimaryAlias(db, userId, primaryId);
      }
    }

    // Push first, so local edits aren't overwritten by an older Google copy.
    const { pushed, failed } = await push(db, token, userId, defaultCalendar === 'primary' ? null : defaultCalendar, tz, categories);
    const { data: cals } = await db.from('google_calendars').select('calendar_id,sync_token,access_role').eq('user_id', userId).eq('sync_enabled', true);
    for (const cal of cals ?? []) await pullCalendar(db, token, userId, cal, tz, { categories, defaultReminders: defaultReminders.get(cal.calendar_id) ?? [] });

    // Google Tasks, when turned on and allowed. A failure here doesn't undo the calendar sync.
    let tasks: { lists: number; pushed: number; failed: string[] } | { error: string } | null = null;
    if (account?.tasks_enabled && (account.scopes ?? '').includes(TASKS_SCOPE)) {
      try {
        tasks = await syncTasks(db, (method, path, b) => gapi(token, method, path, b, TASKS_API), userId);
      } catch (err) {
        tasks = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    const problems = [
      ...failed.map((f) => `Calendar ${f}`),
      ...(tasks && 'failed' in tasks ? tasks.failed.map((f) => `Tasks ${f}`) : []),
      ...(tasks && 'error' in tasks ? [`Tasks: ${tasks.error}`] : []),
    ];
    await db.from('google_accounts').update({ last_sync_at: now, last_error: problems.length ? problems.join('; ') : null }).eq('user_id', userId);
    // Default alerts per synced calendar, so a sync result shows where reminders come from.
    return { pushed, failed, tasks, calendars: (cals ?? []).length, defaultAlerts: (cals ?? []).map((c) => (defaultReminders.get(c.calendar_id) ?? []).map((r) => r.minutes)) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from('google_accounts').update({ last_error: message }).eq('user_id', userId);
    return { error: message };
  }
}

async function userFrom(req: Request, db: SupabaseClient) {
  const { data } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''));
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);

  // Google's redirect after the consent screen.
  if (req.method === 'GET' && (url.searchParams.has('code') || url.searchParams.has('error'))) {
    const state = await readState(url.searchParams.get('state') ?? '');
    const back = (status: string) => Response.redirect(`${state?.r ?? APP_URL}/settings?google=${status}`, 302);
    if (!state || url.searchParams.has('error')) return back('cancelled');
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code')!, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    });
    const tokens = await res.json();
    if (!res.ok || !tokens.refresh_token) return back('error');
    await db.from('google_tokens').upsert({ user_id: state.u, refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() });
    // The primary calendar's id is the account email; make it the default for new events.
    // calendarList (not /calendars) is readable with our scopes; its id is the real calendar id, never the "primary" alias.
    const primary = await gapi(tokens.access_token, 'GET', '/users/me/calendarList/primary');
    await db.from('google_accounts').upsert({ user_id: state.u, email: primary.data?.id ?? null, default_calendar_id: primary.data?.id ?? 'primary', scopes: tokens.scope ?? null, last_error: null });
    await syncUser(db, state.u);
    return back('connected');
  }

  const body = await req.json().catch(() => ({}));
  const fromCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;

  if (body.mode === 'sync' && fromCron) {
    const { data: users } = await db.from('google_tokens').select('user_id');
    const results = [];
    for (const u of users ?? []) results.push(await syncUser(db, u.user_id));
    return Response.json(results, { headers: cors });
  }

  const user = await userFrom(req, db);
  if (!user) return new Response('Unauthorized', { status: 401, headers: cors });

  if (body.mode === 'auth-url') {
    if (!CLIENT_ID) return Response.json({ error: 'GOOGLE_CLIENT_ID is not set' }, { status: 500, headers: cors });
    const returnTo = ALLOWED_RETURN.includes(body.returnTo) ? body.returnTo : APP_URL;
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: await makeState(user.id, returnTo),
    });
    return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }, { headers: cors });
  }
  if (body.mode === 'sync') return Response.json(await syncUser(db, user.id), { headers: cors });
  if (body.mode === 'set-calendar' && typeof body.calendarId === 'string') {
    const enabled = !!body.enabled;
    if (!enabled) {
      // Remove that calendar's events from the app only. Marking them read-only first
      // keeps the delete trigger from queueing deletions in Google.
      await db.from('events').update({ google_readonly: true, google_synced_at: new Date().toISOString() }).eq('user_id', user.id).eq('google_calendar_id', body.calendarId);
      await db.from('events').delete().eq('user_id', user.id).eq('google_calendar_id', body.calendarId);
    }
    await db.from('google_calendars').update({ sync_enabled: enabled, sync_token: null }).eq('user_id', user.id).eq('calendar_id', body.calendarId);
    return Response.json(enabled ? await syncUser(db, user.id) : { ok: true }, { headers: cors });
  }
  if (body.mode === 'set-tasks') {
    const enabled = !!body.enabled;
    const { data: account } = await db.from('google_accounts').select('scopes').eq('user_id', user.id).maybeSingle();
    if (!account) return Response.json({ error: 'Google no está conectado' }, { headers: cors });
    await db.from('google_accounts').update({ tasks_enabled: enabled }).eq('user_id', user.id);
    // Connected before Tasks was supported: Google has to be asked for the permission again.
    if (enabled && !(account.scopes ?? '').includes(TASKS_SCOPE)) return Response.json({ needsReconnect: true }, { headers: cors });
    return Response.json(enabled ? await syncUser(db, user.id) : { ok: true }, { headers: cors });
  }
  if (body.mode === 'disconnect') {
    const { data: tok } = await db.from('google_tokens').select('refresh_token').eq('user_id', user.id).maybeSingle();
    if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok.refresh_token)}`, { method: 'POST' });
    await db.from('google_tokens').delete().eq('user_id', user.id);
    await db.from('google_calendars').delete().eq('user_id', user.id);
    await db.from('google_accounts').delete().eq('user_id', user.id);
    // Read-only copies of Google series go away; other events stay in the app and simply stop syncing.
    await db.from('events').delete().eq('user_id', user.id).not('google_recurring_id', 'is', null);
    await db.from('events').update({ google_calendar_id: null, google_event_id: null, google_etag: null, google_readonly: false, needs_push: false, google_synced_at: new Date().toISOString() }).eq('user_id', user.id).not('google_event_id', 'is', null);
    await db.from('google_deletions').delete().eq('user_id', user.id);
    // Tasks stay in the app and stop syncing.
    const unlinked = { google_synced_at: new Date().toISOString(), needs_push: false };
    await db.from('task_lists').update({ google_tasklist_id: null, google_etag: null, google_pulled_at: null, ...unlinked }).eq('user_id', user.id).not('google_tasklist_id', 'is', null);
    await db.from('tasks').update({ google_task_id: null, google_tasklist_id: null, google_etag: null, ...unlinked }).eq('user_id', user.id).not('google_task_id', 'is', null);
    await db.from('subtasks').update({ google_task_id: null, google_etag: null, ...unlinked }).eq('user_id', user.id).not('google_task_id', 'is', null);
    await db.from('google_task_deletions').delete().eq('user_id', user.id);
    return Response.json({ ok: true }, { headers: cors });
  }
  return new Response('Unknown mode', { status: 400, headers: cors });
});
