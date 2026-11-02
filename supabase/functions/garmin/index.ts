// Garmin Connect Personal API sync (read-only).
//   {"mode":"sync","days":7}  from pg_cron (x-cron-secret) or from the app by the owner.
//
// Secrets: GARMIN_API_KEY (personal API key from Garmin Connect web),
//          GARMIN_USER_ID (the app user the data belongs to), CRON_SECRET.
// Optional: GARMIN_API_BASE (default https://personal.connectapi.garmin.com).
// Deploy with --no-verify-jwt: callers are checked here.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET');
const API_KEY = Deno.env.get('GARMIN_API_KEY');
const OWNER = Deno.env.get('GARMIN_USER_ID');
const BASE = (Deno.env.get('GARMIN_API_BASE') ?? 'https://personal.connectapi.garmin.com').replace(/\/$/, '');
const TOKEN_URL = 'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const key = (d: Date) => d.toISOString().slice(0, 10);

/** Finds the bearer token in the token response (JSON field or plain text), without assuming its field name. */
function findToken(body: unknown): string | null {
  if (typeof body === 'string') return body.split('.').length === 3 ? body.trim() : null;
  if (body && typeof body === 'object') {
    for (const k of ['access_token', 'accessToken', 'token', 'bearerToken']) {
      const v = (body as Record<string, unknown>)[k];
      if (typeof v === 'string') return v;
    }
    for (const v of Object.values(body)) {
      const found = findToken(v);
      if (found) return found;
    }
  }
  return null;
}

async function getToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { Authorization: `ApiKey ${API_KEY}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text.slice(0, 200)}`);
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain-text token */
  }
  const token = findToken(body);
  if (!token) throw new Error('Token response had no token');
  return token;
}

/** Endpoints fetched on every sync, for the last `days` days (ranges) or today/yesterday (single-day). */
function plan(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const s = key(start);
  const e = key(end);
  const yesterday = key(new Date(end.getTime() - 86_400_000));
  const range = `${s}..${e}`;
  return [
    { endpoint: 'daily_summaries', window: range, path: `/usersummary-service/v2/dailysummaries?startDate=${s}&endDate=${e}` },
    { endpoint: 'steps', window: range, path: `/usersummary-service/stats/steps/daily/${s}/${e}` },
    { endpoint: 'stress', window: range, path: `/usersummary-service/stats/stress/daily/${s}/${e}` },
    { endpoint: 'sleep_summaries', window: range, path: `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${s}&endDate=${e}` },
    { endpoint: 'body_battery', window: range, path: `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${s}&endDate=${e}` },
    { endpoint: 'hrv', window: range, path: `/hrv-service/hrv/daily/${s}/${e}` },
    { endpoint: 'sleep', window: yesterday, path: `/sleep-service/sleep/dailySleep?date=${yesterday}` },
    { endpoint: 'heart_rate', window: e, path: `/wellness-service/wellness/dailyHeartRate?date=${e}` },
    { endpoint: 'activities', window: range, path: `/activitylist-service/activities/search/activities?start=0&limit=20&startDate=${s}&endDate=${e}` },
  ];
}

async function sync(days: number) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const now = new Date().toISOString();
  let ok = 0;
  let failed = 0;
  try {
    if (!API_KEY || !OWNER) throw new Error('GARMIN_API_KEY or GARMIN_USER_ID is not set');
    const token = await getToken();
    for (const item of plan(days)) {
      const res = await fetch(BASE + item.path, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { text: text.slice(0, 2000) };
      }
      if (res.ok) ok++;
      else failed++;
      await db.from('garmin_raw').upsert({ user_id: OWNER, endpoint: item.endpoint, window_key: item.window, status: res.status, data, fetched_at: now });
    }
    await db.from('garmin_sync_status').upsert({ user_id: OWNER, last_attempt_at: now, last_success_at: ok ? now : null, last_error: failed ? `${failed} endpoint(s) failed` : null, endpoints_ok: ok, endpoints_failed: failed });
    return { ok, failed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (OWNER) await db.from('garmin_sync_status').upsert({ user_id: OWNER, last_attempt_at: now, last_error: message, endpoints_ok: ok, endpoints_failed: failed });
    return { ok, failed, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const { mode, days } = await req.json().catch(() => ({ mode: 'sync' }));
  if (mode !== 'sync') return new Response('Unknown mode', { status: 400, headers: cors });

  // Allowed: pg_cron with the shared secret, or the owner signed in to the app.
  const fromCron = !!CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET;
  if (!fromCron) {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await db.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''));
    if (!data.user) return new Response('Unauthorized', { status: 401, headers: cors });
    if (data.user.id !== OWNER) return new Response('Forbidden', { status: 403, headers: cors });
  }
  const n = Math.min(31, Math.max(1, Number(days) || 7));
  return Response.json(await sync(n), { headers: cors });
});
