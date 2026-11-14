/**
 * Historical performance metrics on a chronological price series (aligned common observations).
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

/** Minimum observations for volatility: three prices give two returns, the least for a sample SD. */
export const MIN_OBSERVATIONS_FOR_VOLATILITY = 3;

/**
 * Annualized historical (realized) volatility in percent: sample SD of simple returns between
 * consecutive observations × √252 × 100. Computed from prices, never from normalized values.
 */
export function annualizedVolatility(prices: readonly number[]): number | null {
  if (prices.length < MIN_OBSERVATIONS_FOR_VOLATILITY) return null;
  const sd = sampleStandardDeviation(simpleReturns(prices));
  return sd === null ? null : sd * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
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
