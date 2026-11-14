import { daysBetween } from './dates';

/**
 * Historical performance metrics on chronological price series. Cumulative return and drawdown
 * take the aligned common observations; volatility takes one stock's own daily observations.
 * Pure functions; `null` means "not enough observations", never a misleading zero. Prices are
 * JavaScript numbers here: the results are percentages for display, where binary floating point is
 * far more precise than the two decimals shown.
 *
 * These describe the past only. They are not predictions.
 */

/** Trading days per year used to annualize daily volatility. */
export const TRADING_DAYS_PER_YEAR = 252;

/** (last / first − 1) × 100. Needs at least two observations. */
export function cumulativeReturn(prices: readonly number[]): number | null {
  const first = prices[0];
  const last = prices.at(-1);
  if (prices.length < 2 || first === undefined || last === undefined || !(first > 0)) return null;
  return (last / first - 1) * 100;
}

/** Simple returns between consecutive observations: P_t / P_{t−1} − 1. */
export function simpleReturns(prices: readonly number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i += 1) {
    const previous = prices[i - 1];
    const current = prices[i];
    if (previous === undefined || current === undefined || !(previous > 0)) {
      throw new RangeError('prices must be positive');
    }
    returns.push(current / previous - 1);
  }
  return returns;
}

/**
 * Sample standard deviation (n − 1 denominator), computed in two passes (mean, then squared
 * deviations) for numerical stability. Needs at least two values.
 */
export function sampleStandardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squared = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squared / (values.length - 1));
}

/**
 * Daily volatility needs DAILY returns: a return spanning several trading sessions is larger in
 * expectation and must not be scaled as if it were one day. There is no exchange calendar in the
 * dataset, so sessions are established from the data itself:
 *
 *  1. Session reference: the union of dates on which ANY of the compared stocks has a bar within
 *     the period. Two observations of one stock are consecutive sessions only if no reference
 *     session lies between them (so a session one stock is missing is detected through the others).
 *  2. Calendar check: they must also be at most MAX_SESSION_GAP_DAYS calendar days apart (a
 *     weekend plus an adjacent holiday). A longer gap means sessions may be missing for every
 *     compared stock, which the reference cannot reveal, so continuity is not assumed.
 *
 * Returns across anything else are excluded and counted, never treated as daily.
 */
export const MAX_SESSION_GAP_DAYS = 5;

/**
 * Fewest daily returns for which annualized volatility is reported (about one month of sessions):
 * below that a sample standard deviation is too unstable to be meaningful.
 */
export const MIN_DAILY_RETURNS = 20;

export interface Observation {
  date: string;
  value: number;
}

/** All session dates observed for any of the given series, sorted and distinct. */
export function sessionCalendar(seriesDates: readonly (readonly string[])[]): string[] {
  return [...new Set(seriesDates.flat())].sort();
}

/**
 * Simple returns of one stock between CONSECUTIVE sessions only (see the rules above), plus the
 * number of intervals excluded because they span a gap. Observations must be in date order and
 * every date must appear in `calendar`.
 */
export function dailyReturns(
  observations: readonly Observation[],
  calendar: readonly string[],
): { returns: number[]; excludedIntervals: number } {
  const position = new Map(calendar.map((date, index) => [date, index] as const));
  const returns: number[] = [];
  let excludedIntervals = 0;
  for (let i = 1; i < observations.length; i += 1) {
    const previous = observations[i - 1];
    const current = observations[i];
    if (!previous || !current) continue;
    const from = position.get(previous.date);
    const to = position.get(current.date);
    if (from === undefined || to === undefined) {
      throw new RangeError('every observation date must be part of the session calendar');
    }
    if (to <= from) throw new RangeError('observations must be in strictly increasing date order');
    if (!(previous.value > 0) || !(current.value > 0))
      throw new RangeError('prices must be positive');
    const consecutive =
      to === from + 1 && daysBetween(previous.date, current.date) <= MAX_SESSION_GAP_DAYS;
    if (consecutive) returns.push(current.value / previous.value - 1);
    else excludedIntervals += 1;
  }
  return { returns, excludedIntervals };
}

export interface VolatilityResult {
  /** Annualized volatility in percent, or null when unavailable. */
  value: number | null;
  /** Daily returns used. */
  dailyReturns: number;
  /** Intervals between observations that span a gap (excluded). */
  excludedIntervals: number;
}

/**
 * Annualized historical (realized) volatility in percent from one stock's OWN observations: the
 * sample SD of its daily returns between consecutive sessions × √252 × 100. Unavailable (null)
 * with fewer than MIN_DAILY_RETURNS daily returns. Computed from prices, never from index values.
 */
export function annualizedDailyVolatility(
  observations: readonly Observation[],
  calendar: readonly string[],
): VolatilityResult {
  const { returns, excludedIntervals } = dailyReturns(observations, calendar);
  const sd = returns.length >= MIN_DAILY_RETURNS ? sampleStandardDeviation(returns) : null;
  return {
    value: sd === null ? null : sd * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100,
    dailyReturns: returns.length,
    excludedIntervals,
  };
}

/**
 * Maximum drawdown in percent: the most negative P_t / runningPeak_t − 1 over the series, the
 * baseline included. Always ≤ 0 (0 when prices never fall below a previous peak). Needs at least
 * two observations.
 */
export function maxDrawdown(prices: readonly number[]): number | null {
  if (prices.length < 2) return null;
  let peak = -Infinity;
  let worst = 0;
  for (const price of prices) {
    if (!(price > 0)) throw new RangeError('prices must be positive');
    peak = Math.max(peak, price);
    worst = Math.min(worst, price / peak - 1);
  }
  // Avoid presenting "-0": a series that never declines has a drawdown of exactly 0.
  return worst === 0 ? 0 : worst * 100;
}
