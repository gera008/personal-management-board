import { describe, expect, it } from 'vitest';
import { avg, localClock, parseGarminDays, type GarminRawRow } from '../src/domain/garmin';

// Synthetic responses shaped like the Garmin Connect Personal API (no real data).
const row = (endpoint: string, data: unknown, fetched_at = '2026-11-02T12:00:00Z', status = 200): GarminRawRow => ({ endpoint, window_key: 'w', status, fetched_at, data });

const summaries = row('daily_summaries', {
  data: [
    {
      calendarDate: '2026-11-01',
      movement: { steps: 8200 },
      stress: { avgLevel: 31, maxLevel: 92 },
      bodyBattery: { maxValue: 88, minValue: 12, latestValue: 15 },
      heartRate: { restingValue: 54, minValue: 50, maxValue: 151 },
      calories: { burnedTotal: 2450, burnedActive: 520 },
      intensityMinutes: { goal: 150, moderate: 20, vigorous: 10 },
    },
  ],
});
const steps = row('steps', [{ calendarDate: '2026-11-01', totalSteps: 8210, stepGoal: 9000, totalDistance: 6400 }]);
const sleep = row('sleep_summaries', [
  {
    calendarDate: '2026-11-01',
    sleepTimeSeconds: 25200,
    deepSleepSeconds: 4800,
    lightSleepSeconds: 14400,
    remSleepSeconds: 6000,
    awakeSleepSeconds: 600,
    sleepStartTimestampLocal: Date.UTC(2026, 9, 31, 23, 15),
    sleepEndTimestampLocal: Date.UTC(2026, 10, 1, 7, 5),
  },
]);

describe('parseGarminDays', () => {
  it('merges every endpoint into one record per day', () => {
    const [d] = parseGarminDays([summaries, steps, sleep]);
    expect(d).toMatchObject({
      date: '2026-11-01',
      stepGoal: 9000,
      distanceMeters: 6400,
      stressAvg: 31,
      stressMax: 92,
      bodyBatteryMax: 88,
      bodyBatteryLatest: 15,
      restingHr: 54,
      caloriesActive: 520,
      intensityMinutes: 40, // 20 moderate + 2 × 10 vigorous
      intensityGoal: 150,
      sleepSeconds: 25200,
      deepSeconds: 4800,
    });
  });

  it('lets the most recent fetch win for the same day', () => {
    const older = row('steps', [{ calendarDate: '2026-11-01', totalSteps: 100 }], '2026-11-01T06:00:00Z');
    const newer = row('steps', [{ calendarDate: '2026-11-01', totalSteps: 9000 }], '2026-11-02T06:00:00Z');
    expect(parseGarminDays([newer, older])[0].steps).toBe(9000);
  });

  it('never erases a known value with a missing one', () => {
    const sparse = row('daily_summaries', { data: [{ calendarDate: '2026-11-01', movement: {} }] }, '2026-11-03T00:00:00Z');
    expect(parseGarminDays([steps, sparse])[0].steps).toBe(8210);
  });

  it('ignores failed or empty responses and sorts by date', () => {
    const failed = row('steps', { message: 'error' }, '2026-11-02T00:00:00Z', 500);
    const empty = row('hrv', null, '2026-11-02T00:00:00Z', 204);
    const other = row('steps', [{ calendarDate: '2026-10-31', totalSteps: 5000 }]);
    expect(parseGarminDays([steps, failed, empty, other]).map((d) => d.date)).toEqual(['2026-10-31', '2026-11-01']);
  });

  it('reads a single-object response (last night’s sleep, today’s heart rate)', () => {
    const hr = row('heart_rate', { calendarDate: '2026-11-02', restingHeartRate: 56, minHeartRate: 52, maxHeartRate: 140 });
    expect(parseGarminDays([hr])[0]).toMatchObject({ date: '2026-11-02', restingHr: 56, maxHr: 140 });
  });
});

describe('helpers', () => {
  it('averages only known values', () => {
    expect(avg([2, null, 4])).toBe(3);
    expect(avg([null])).toBeNull();
  });

  it('shows Garmin local timestamps as the local clock time', () => {
    expect(localClock(Date.UTC(2026, 9, 31, 23, 15))).toBe('23:15');
  });
});
