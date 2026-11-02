// Turns stored Garmin Connect Personal API responses (table garmin_raw) into
// one record per day. Several syncs overlap; for each day the most recently
// fetched value wins. Field names match what Garmin actually returns.

export interface GarminRawRow {
  endpoint: string;
  window_key: string;
  status: number;
  fetched_at: string;
  data: unknown;
}

export interface GarminDay {
  date: string;
  steps: number | null;
  stepGoal: number | null;
  distanceMeters: number | null;
  stressAvg: number | null;
  stressMax: number | null;
  bodyBatteryMax: number | null;
  bodyBatteryMin: number | null;
  bodyBatteryLatest: number | null;
  restingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  caloriesTotal: number | null;
  caloriesActive: number | null;
  intensityMinutes: number | null; // moderate + 2 × vigorous, as Garmin counts them
  intensityGoal: number | null;
  sleepSeconds: number | null;
  deepSeconds: number | null;
  lightSeconds: number | null;
  remSeconds: number | null;
  awakeSeconds: number | null;
  sleepStart: number | null; // local wall-clock ms (Garmin's *Local timestamps)
  sleepEnd: number | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const get = (o: unknown, ...path: string[]): unknown => path.reduce<unknown>((x, k) => (isObj(x) ? x[k] : undefined), o);

const blank = (date: string): GarminDay => ({
  date,
  steps: null,
  stepGoal: null,
  distanceMeters: null,
  stressAvg: null,
  stressMax: null,
  bodyBatteryMax: null,
  bodyBatteryMin: null,
  bodyBatteryLatest: null,
  restingHr: null,
  minHr: null,
  maxHr: null,
  caloriesTotal: null,
  caloriesActive: null,
  intensityMinutes: null,
  intensityGoal: null,
  sleepSeconds: null,
  deepSeconds: null,
  lightSeconds: null,
  remSeconds: null,
  awakeSeconds: null,
  sleepStart: null,
  sleepEnd: null,
});

/** Copies only the values that are present, so a sparse response never erases a known one. */
function merge(day: GarminDay, patch: Partial<GarminDay>) {
  for (const [k, v] of Object.entries(patch)) if (v != null) (day as unknown as Record<string, unknown>)[k] = v;
}

export function parseGarminDays(rows: GarminRawRow[]): GarminDay[] {
  const days = new Map<string, GarminDay>();
  const day = (date: string) => {
    if (!days.has(date)) days.set(date, blank(date));
    return days.get(date)!;
  };
  // Oldest first, so later fetches overwrite earlier ones.
  const ordered = rows.filter((r) => r.status >= 200 && r.status < 300 && r.data != null).sort((a, b) => a.fetched_at.localeCompare(b.fetched_at));

  for (const r of ordered) {
    const list: unknown[] = Array.isArray(r.data) ? r.data : Array.isArray(get(r.data, 'data')) ? (get(r.data, 'data') as unknown[]) : isObj(r.data) ? [r.data] : [];
    for (const item of list) {
      const date = (get(item, 'calendarDate') ?? get(item, 'date')) as string | undefined;
      if (typeof date !== 'string') continue;
      const d = day(date.slice(0, 10));
      switch (r.endpoint) {
        case 'daily_summaries': {
          const moderate = n(get(item, 'intensityMinutes', 'moderate'));
          const vigorous = n(get(item, 'intensityMinutes', 'vigorous'));
          merge(d, {
            steps: n(get(item, 'movement', 'steps')),
            stressAvg: n(get(item, 'stress', 'avgLevel')),
            stressMax: n(get(item, 'stress', 'maxLevel')),
            bodyBatteryMax: n(get(item, 'bodyBattery', 'maxValue')),
            bodyBatteryMin: n(get(item, 'bodyBattery', 'minValue')),
            bodyBatteryLatest: n(get(item, 'bodyBattery', 'latestValue')),
            restingHr: n(get(item, 'heartRate', 'restingValue')),
            minHr: n(get(item, 'heartRate', 'minValue')),
            maxHr: n(get(item, 'heartRate', 'maxValue')),
            caloriesTotal: n(get(item, 'calories', 'burnedTotal')),
            caloriesActive: n(get(item, 'calories', 'burnedActive')),
            intensityMinutes: moderate == null && vigorous == null ? null : (moderate ?? 0) + 2 * (vigorous ?? 0),
            intensityGoal: n(get(item, 'intensityMinutes', 'goal')),
          });
          break;
        }
        case 'steps':
          merge(d, { steps: n(get(item, 'totalSteps')), stepGoal: n(get(item, 'stepGoal')), distanceMeters: n(get(item, 'totalDistance')) });
          break;
        case 'stress':
          merge(d, { stressAvg: n(get(item, 'values', 'overallStressLevel')) });
          break;
        case 'sleep':
        case 'sleep_summaries':
          merge(d, {
            sleepSeconds: n(get(item, 'sleepTimeSeconds')),
            deepSeconds: n(get(item, 'deepSleepSeconds')),
            lightSeconds: n(get(item, 'lightSleepSeconds')),
            remSeconds: n(get(item, 'remSleepSeconds')),
            awakeSeconds: n(get(item, 'awakeSleepSeconds')),
            sleepStart: n(get(item, 'sleepStartTimestampLocal')),
            sleepEnd: n(get(item, 'sleepEndTimestampLocal')),
          });
          break;
        case 'heart_rate':
          merge(d, { restingHr: n(get(item, 'restingHeartRate')), minHr: n(get(item, 'minHeartRate')), maxHr: n(get(item, 'maxHeartRate')) });
          break;
      }
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Average of the non-null values (null when there are none). */
export function avg(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Garmin's local timestamps are wall-clock ms; read them as UTC to get the local hour. */
export const localClock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
