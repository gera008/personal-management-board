import { differenceInCalendarDays } from 'date-fns';
import { num, type Account, type AccountValuation, type Transaction } from '../types';
import { signedAmount } from './totals';

/*
 * Investment accounts keep two things apart:
 * - money moved in or out (transactions): what you contributed;
 * - what the account is worth (valuations, captured by hand).
 * Gain = value − contributed. Market changes never become income or spending.
 * Mirrors the account_balances view.
 */

type Flow = Pick<Transaction, 'account_id' | 'type' | 'direction' | 'original_amount' | 'currency' | 'base_amount_mxn' | 'status' | 'occurred_at'>;

const round2 = (n: number) => Math.round(n * 100) / 100;
const time = (iso: string) => new Date(iso).getTime();
const applied = (account: Account, txs: Flow[]) => txs.filter((t) => t.account_id === account.id && t.status === 'applied');

/** Net amount moved into the account up to `at` (inclusive), starting from its initial balance. */
export function contributedAt(account: Account, txs: Flow[], at: Date): number {
  const cutoff = at.getTime();
  return round2(
    num(account.initial_balance) + applied(account, txs).filter((t) => time(t.occurred_at) <= cutoff).reduce((s, t) => s + signedAmount(t, account.currency), 0),
  );
}

/** Money moved in or out in (from, to]. */
function flowsBetween(account: Account, txs: Flow[], from: number, to: number): number {
  return applied(account, txs)
    .filter((t) => time(t.occurred_at) > from && time(t.occurred_at) <= to)
    .reduce((s, t) => s + signedAmount(t, account.currency), 0);
}

const byDate = (a: AccountValuation, b: AccountValuation) => time(a.valued_at) - time(b.valued_at);

/** What the account is worth now: the latest valuation plus what moved after it (the book balance without one). */
export function currentValue(account: Account, txs: Flow[], valuations: AccountValuation[], now: Date = new Date()): number {
  const last = [...valuations].sort(byDate).at(-1);
  if (!last) return contributedAt(account, txs, now);
  return round2(num(last.value) + flowsBetween(account, txs, time(last.valued_at), now.getTime()));
}

export interface InvestmentPoint {
  at: Date;
  value: number;
  contributed: number;
  gain: number;
}

/** One point per valuation, oldest first, and a final one for today when money moved since the last valuation. */
export function investmentHistory(account: Account, txs: Flow[], valuations: AccountValuation[], now: Date = new Date()): InvestmentPoint[] {
  const sorted = [...valuations].sort(byDate);
  const points = sorted.map((v) => {
    const at = new Date(v.valued_at);
    const value = round2(num(v.value));
    const contributed = contributedAt(account, txs, at);
    return { at, value, contributed, gain: round2(value - contributed) };
  });
  const last = sorted.at(-1);
  if (last && time(last.valued_at) < now.getTime() && Math.abs(flowsBetween(account, txs, time(last.valued_at), now.getTime())) >= 0.005) {
    const value = currentValue(account, txs, sorted, now);
    const contributed = contributedAt(account, txs, now);
    points.push({ at: now, value, contributed, gain: round2(value - contributed) });
  }
  return points;
}

export interface ValuationChange {
  valuation: AccountValuation;
  /** Market change since the previous valuation, not counting money moved in or out (the gain to date for the first one). */
  change: number;
  pct: number | null;
}

/** Each valuation with its market change, newest first. */
export function valuationChanges(account: Account, txs: Flow[], valuations: AccountValuation[]): ValuationChange[] {
  const sorted = [...valuations].sort(byDate);
  return sorted
    .map((v, i) => {
      const prev = sorted[i - 1];
      const base = prev
        ? num(prev.value) + flowsBetween(account, txs, time(prev.valued_at), time(v.valued_at))
        : contributedAt(account, txs, new Date(v.valued_at));
      const change = round2(num(v.value) - base);
      return { valuation: v, change, pct: base > 0 ? round2((change / base) * 100) : null };
    })
    .reverse();
}

/**
 * Gain over a range of the history: since `from` (measured from the last point
 * at or before it), or since the start without one or when the whole history
 * falls inside the range.
 * The percentage is over what was invested at the start of the range plus what
 * was added during it.
 */
export function periodGain(points: InvestmentPoint[], from: Date | null): { gain: number; pct: number | null } | null {
  const last = points.at(-1);
  if (!last) return null;
  if (!from) return { gain: last.gain, pct: last.contributed > 0 ? round2((last.gain / last.contributed) * 100) : null };
  const start = [...points].reverse().find((p) => p.at <= from);
  if (!start) return periodGain(points, null);
  const gain = round2(last.gain - start.gain);
  const base = start.value + (last.contributed - start.contributed);
  return { gain, pct: base > 0 ? round2((gain / base) * 100) : null };
}

/** A value older than `days` (or none at all) should be updated. */
export const isStale = (lastValuedAt: string | null | undefined, now: Date = new Date(), days = 30): boolean =>
  !lastValuedAt || differenceInCalendarDays(now, new Date(lastValuedAt)) > days;
