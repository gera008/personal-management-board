// Recurrence <-> iCalendar RRULE/EXDATE lines, as Google Calendar uses them.
// Dependency-free: shared by the app (tests) and the `google` Edge Function.
// Only rules the app can represent are translated; anything else returns null
// so the caller can treat that event as read-only.
import type { Recurrence, RecurrenceFreq } from './recurrence.ts';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQS: Record<string, RecurrenceFreq> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };

const compact = (key: string) => key.replaceAll('-', '');
const expand = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * Lines for Google's `recurrence` field. Timed events need EXDATE in the
 * event's own wall-clock time (`localTime` HHMMSS) and time zone.
 */
export function toGoogleRecurrence(rule: Recurrence, exdates: string[], opts: { allDay: boolean; timeZone: string; localTime: string }): string[] {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byweekday?.length) parts.push(`BYDAY=${rule.byweekday.map((d) => DAYS[d]).join(',')}`);
  if (rule.count != null) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(opts.allDay ? `UNTIL=${compact(rule.until)}` : `UNTIL=${compact(rule.until)}T235959Z`);
  const lines = [`RRULE:${parts.join(';')}`];
  if (exdates.length) {
    lines.push(
      opts.allDay
        ? `EXDATE;VALUE=DATE:${exdates.map(compact).join(',')}`
        : `EXDATE;TZID=${opts.timeZone}:${exdates.map((d) => `${compact(d)}T${opts.localTime}`).join(',')}`,
    );
  }
  return lines;
}

/** Parses Google's `recurrence` lines. Returns null when the rule uses something the app can't represent. */
export function fromGoogleRecurrence(lines: string[]): { rule: Recurrence; exdates: string[] } | null {
  let rule: Recurrence | null = null;
  const exdates: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('RRULE:')) {
      if (rule) return null; // several RRULEs: not representable
      const props = Object.fromEntries(
        line
          .slice(6)
          .split(';')
          .map((p) => p.split('=') as [string, string]),
      );
      const freq = FREQS[props.FREQ];
      if (!freq) return null;
      const supported = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST']);
      if (Object.keys(props).some((k) => !supported.has(k))) return null;
      const r: Recurrence = { freq, interval: props.INTERVAL ? Number(props.INTERVAL) : 1 };
      if (props.BYDAY) {
        // Only plain weekdays on weekly rules ("MO,WE"); "2TU" or BYDAY on monthly rules aren't representable.
        if (freq !== 'weekly') return null;
        const days = props.BYDAY.split(',').map((d) => DAYS.indexOf(d));
        if (days.some((d) => d < 0)) return null;
        r.byweekday = [...new Set(days)].sort((a, b) => a - b);
      }
      if (props.COUNT) r.count = Number(props.COUNT);
      else if (props.UNTIL) r.until = expand(props.UNTIL.slice(0, 8));
      rule = r;
    } else if (line.startsWith('EXDATE')) {
      const values = line.slice(line.indexOf(':') + 1).split(',');
      for (const v of values) if (/^\d{8}/.test(v)) exdates.push(expand(v.slice(0, 8)));
    } else if (line.startsWith('RDATE') || line.startsWith('EXRULE')) {
      return null;
    }
  }
  return rule ? { rule, exdates: [...new Set(exdates)].sort() } : null;
}
