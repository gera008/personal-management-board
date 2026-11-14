// How app fields that Google stores differently travel to Google and back.
// Dependency-free: shared by the app (tests) and the `google` Edge Function.

// ---------- event colors <-> categories ----------

/** Google Calendar's 11 event colors (colorId -> the color its apps show). */
export const GOOGLE_EVENT_COLORS: Record<string, string> = {
  '1': '#7986CB', // Lavender
  '2': '#33B679', // Sage
  '3': '#8E24AA', // Grape
  '4': '#E67C73', // Flamingo
  '5': '#F6BF26', // Banana
  '6': '#F4511E', // Tangerine
  '7': '#039BE5', // Peacock
  '8': '#616161', // Graphite
  '9': '#3F51B5', // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

function hsl(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function colorDistance(a: string, b: string): number {
  const c = hsl(a);
  const g = hsl(b);
  if (!c || !g) return Infinity;
  const grey = c.s < 0.15;
  const gGrey = g.s < 0.15;
  if (grey || gGrey) return grey && gGrey ? Math.abs(c.l - g.l) : 10;
  const dh = Math.min(Math.abs(c.h - g.h), 360 - Math.abs(c.h - g.h)) / 180;
  return dh * 4 + Math.abs(c.s - g.s) * 0.5 + Math.abs(c.l - g.l);
}

/** The Google event color that looks most like `hex` (hue first, so a purple stays purple). */
export function nearestGoogleColor(hex: string): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, gHex] of Object.entries(GOOGLE_EVENT_COLORS)) {
    const d = colorDistance(hex, gHex);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export interface CategoryColor {
  id: string;
  color: string;
}

/**
 * A Google color per category: the closest one, but never the same for two
 * categories while there are colors left, so a color in Google still says which
 * category it is. Closest pairs are matched first.
 */
export function assignGoogleColors(categories: CategoryColor[]): Map<string, string> {
  const pairs: { cat: string; color: string; d: number }[] = [];
  for (const c of categories) for (const [id, gHex] of Object.entries(GOOGLE_EVENT_COLORS)) pairs.push({ cat: c.id, color: id, d: colorDistance(c.color, gHex) });
  pairs.sort((a, b) => a.d - b.d);
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.cat) || used.has(p.color) || p.d === Infinity) continue;
    out.set(p.cat, p.color);
    used.add(p.color);
  }
  // More categories than colors: the rest share their closest one.
  for (const c of categories) if (!out.has(c.id)) { const n = nearestGoogleColor(c.color); if (n) out.set(c.id, n); }
  return out;
}

/** Private keys on Google events: the app's category, and the color the app gave it. */
export const CATEGORY_PROP = 'miosCategory';
export const COLOR_PROP = 'miosColor';

/**
 * The category an event pulled from Google belongs to.
 * - Its color is still the one the app gave it: the hidden category.
 * - The color was changed in Google (or the event was born there with a color):
 *   the category that has that color.
 * - Color removed in Google: no category.
 * Returns undefined to keep what the app has (a color no category uses, or an
 * event the app never sent that has no color).
 */
export function categoryFromGoogle(
  ev: { colorId?: string | null; categoryProp?: string | null; colorProp?: string | null },
  categories: CategoryColor[],
): string | null | undefined {
  const colorId = ev.colorId ?? null;
  const own = ev.categoryProp ? categories.find((c) => c.id === ev.categoryProp) : undefined;
  if (ev.categoryProp != null && colorId === (ev.colorProp || null)) return own ? own.id : null;
  // Never touched by the app and no color in Google: leave the app's category alone.
  if (!colorId) return ev.categoryProp == null ? undefined : null;
  const colors = assignGoogleColors(categories);
  const match = categories.find((c) => colors.get(c.id) === colorId);
  return match ? match.id : undefined;
}

/** Fields to send to Google for an event's category. */
export function categoryToGoogle(listId: string | null | undefined, categories: CategoryColor[]) {
  const cat = listId ? categories.find((c) => c.id === listId) : undefined;
  const colorId = cat ? assignGoogleColors(categories).get(cat.id) ?? null : null;
  return {
    colorId,
    extendedProperties: { private: { [CATEGORY_PROP]: cat ? cat.id : '', [COLOR_PROP]: colorId ?? '' } },
  };
}

// ---------- reminders ----------

export interface GoogleReminders {
  useDefault?: boolean;
  overrides?: { method?: string; minutes: number }[];
}

/**
 * The app keeps one reminder per event. From Google: its own alerts, or the
 * calendar's default alerts when the event uses them; the one closest to the event wins.
 */
export function reminderFromGoogle(r: GoogleReminders | undefined, calendarDefaults: { minutes: number }[] = []): number | null {
  const list = r?.useDefault === false ? r.overrides ?? [] : r?.useDefault ? calendarDefaults : r?.overrides ?? calendarDefaults;
  if (!list.length) return null;
  return Math.min(...list.map((x) => x.minutes));
}

export function reminderToGoogle(minutes: number | null): GoogleReminders {
  return minutes == null ? { useDefault: false, overrides: [] } : { useDefault: false, overrides: [{ method: 'popup', minutes }] };
}

// ---------- task time hidden in Google Tasks notes ----------

/** Google Tasks can't store a due time, so it rides as the last line of the notes there. */
const TIME_LINE = /\n*🕒\s*(\d{1,2}):(\d{2})\s*$/u;

/** Notes as Google Tasks gets them: the app's notes plus the time line. */
export function notesForGoogle(notes: string | null, time: string | null): string {
  const body = (notes ?? '').trimEnd();
  if (!time) return body;
  const line = `🕒 ${time.slice(0, 5)}`;
  return body ? `${body}\n\n${line}` : line;
}

/** Splits Google Tasks notes into the app's notes and its due time ("HH:MM", or null when the line is gone). */
export function notesFromGoogle(notes: string | null | undefined): { notes: string | null; time: string | null } {
  const text = notes ?? '';
  const m = TIME_LINE.exec(text);
  if (!m) return { notes: text.trim() ? text.trimEnd() : null, time: null };
  const h = Number(m[1]);
  const min = Number(m[2]);
  const rest = text.slice(0, m.index).trimEnd();
  const valid = h < 24 && min < 60;
  return {
    notes: valid ? (rest || null) : text.trimEnd(),
    time: valid ? `${String(h).padStart(2, '0')}:${m[2]}` : null,
  };
}
