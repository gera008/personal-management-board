// Recurrence rules for events and tasks. Dependency-free on purpose: the web
// app and the `push` Edge Function (Deno) import this same file.
//
// Dates are calendar days as 'YYYY-MM-DD' keys. Day math runs in UTC on those
// keys, so results never shift with the device's time zone.

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  freq: RecurrenceFreq;
  /** Every N days/weeks/months/years (>= 1). */
  interval: number;
  /** Weekly only: weekdays 0 (Sunday) – 6. Defaults to the anchor's weekday. */
  byweekday?: number[];
  /** Last allowed date, inclusive. */
  until?: string | null;
  /** Total number of occurrences, counted from the anchor. */
  count?: number | null;
}

const DAY = 86_400_000;

const toUtc = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDaysKey = (key: string, days: number) => toKey(toUtc(key) + days * DAY);

export const weekdayOf = (key: string) => new Date(toUtc(key)).getUTCDay();

/** Adds months to a date, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function addMonthsKey(key: string, months: number): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + months;
  const d = Number(key.slice(8, 10));
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toKey(Date.UTC(year, month, Math.min(d, last)));
}

/**
 * Yields occurrence dates in order, starting at the anchor (the first
 * occurrence), honoring interval, weekdays, count and until. Callers stop
 * iterating once past the window they need.
 */
export function* occurrences(anchor: string, rule: Recurrence): Generator<string> {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  let emitted = 0;
  const done = (key: string) => (rule.count != null && emitted >= rule.count) || (rule.until != null && key > rule.until);

  if (rule.freq === 'weekly') {
    const days = [...new Set(rule.byweekday?.length ? rule.byweekday : [weekdayOf(anchor)])].sort((a, b) => a - b);
    // Weeks are counted from the Sunday of the anchor's week.
    let weekStart = addDaysKey(anchor, -weekdayOf(anchor));
    for (;;) {
      for (const d of days) {
        const key = addDaysKey(weekStart, d);
        if (key < anchor) continue;
        if (done(key)) return;
        emitted++;
        yield key;
      }
      weekStart = addDaysKey(weekStart, 7 * interval);
    }
  }

  for (let n = 0; ; n++) {
    const key =
      rule.freq === 'daily'
        ? addDaysKey(anchor, n * interval)
        : rule.freq === 'monthly'
          ? addMonthsKey(anchor, n * interval)
          : addMonthsKey(anchor, n * interval * 12);
    if (done(key)) return;
    emitted++;
    yield key;
  }
}

/** Occurrences within [from, to] (inclusive), skipping excluded dates. */
export function occurrencesBetween(anchor: string, rule: Recurrence, from: string, to: string, exdates: string[] = []): string[] {
  const skip = new Set(exdates);
  const out: string[] = [];
  for (const key of occurrences(anchor, rule)) {
    if (key > to) break;
    if (key >= from && !skip.has(key)) out.push(key);
  }
  return out;
}

/** First occurrence strictly after `after`, or null when the rule has ended. */
export function nextOccurrence(anchor: string, rule: Recurrence, after: string): string | null {
  for (const key of occurrences(anchor, rule)) if (key > after) return key;
  return null;
}

/** How many occurrences fall strictly before `date` (its 0-based index if it is one). */
export function countBefore(anchor: string, rule: Recurrence, date: string): number {
  let n = 0;
  for (const key of occurrences(anchor, rule)) {
    if (key >= date) break;
    n++;
  }
  return n;
}

/** Normalizes user input into a valid rule (or null for "does not repeat"). */
export function cleanRule(rule: Recurrence | null | undefined): Recurrence | null {
  if (!rule) return null;
  const out: Recurrence = { freq: rule.freq, interval: Math.max(1, Math.floor(rule.interval || 1)) };
  if (rule.freq === 'weekly' && rule.byweekday?.length) out.byweekday = [...new Set(rule.byweekday)].sort((a, b) => a - b);
  if (rule.count != null && rule.count > 0) out.count = Math.floor(rule.count);
  else if (rule.until) out.until = rule.until;
  return out;
}
