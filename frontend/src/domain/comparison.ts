import type { Bar } from '../api/schemas';
import { type IsoDate, maxDate, minDate } from './dates';
import type { Coverage } from './ranges';

/**
 * Comparison of several stocks on their COMMON trading dates. Pure functions, independent of React,
 * MUI and the chart library.
 *
 * Alignment rule: only dates on which EVERY stock has a bar are compared (the intersection). A date
 * missing for any stock is excluded for all; nothing is forward-filled, interpolated or invented.
 */

export const PRICE_BASES = ['close', 'adjClose'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

export interface StockCoverage {
  ticker: string;
  coverage: Coverage;
}

/**
 * The period every stock has data for: the latest first date to the earliest last date. Null when
 * the coverages do not overlap at all.
 */
export function commonCoverage(stocks: readonly StockCoverage[]): Coverage | null {
  const [first, ...rest] = stocks;
  if (!first) return null;
  let { firstDate, lastDate } = first.coverage;
  for (const { coverage } of rest) {
    firstDate = maxDate(firstDate, coverage.firstDate);
    lastDate = minDate(lastDate, coverage.lastDate);
  }
  return firstDate <= lastDate ? { firstDate, lastDate } : null;
}

/**
 * Which stocks bound the common coverage: those whose history starts at the common first date
 * while another starts earlier, and those whose history ends at the common last date while another
 * ends later. Used to explain why the compared period is shorter than some stocks' histories.
 */
export function coverageConstraints(
  stocks: readonly StockCoverage[],
  common: Coverage,
): { startsLate: string[]; endsEarly: string[] } {
  const earliestFirst = stocks.reduce((d, s) => minDate(d, s.coverage.firstDate), common.firstDate);
  const latestLast = stocks.reduce((d, s) => maxDate(d, s.coverage.lastDate), common.lastDate);
  return {
    startsLate:
      earliestFirst < common.firstDate
        ? stocks.filter((s) => s.coverage.firstDate === common.firstDate).map((s) => s.ticker)
        : [],
    endsEarly:
      latestLast > common.lastDate
        ? stocks.filter((s) => s.coverage.lastDate === common.lastDate).map((s) => s.ticker)
        : [],
  };
}

export interface AlignedSeries {
  ticker: string;
  /** Exact source prices (decimal strings) on each common date, for display. */
  prices: string[];
  /** The same prices as numbers, for calculations and chart coordinates. */
  values: number[];
}

export interface Alignment {
  /** Common dates, oldest first. */
  dates: IsoDate[];
  series: AlignedSeries[];
}

export class InvalidPriceError extends Error {
  override readonly name = 'InvalidPriceError';
}

/**
 * Aligns the stocks on the dates present for ALL of them, in chronological order, taking the same
 * price basis for every stock. Every aligned price must be a positive, finite number.
 */
export function alignOnCommonDates(
  stocks: readonly { ticker: string; bars: readonly Bar[] }[],
  basis: PriceBasis,
): Alignment {
  const byTicker = stocks.map(({ ticker, bars }) => ({
    ticker,
    byDate: new Map(bars.map((bar) => [bar.date, bar] as const)),
  }));
  const [first, ...rest] = byTicker;
  const dates = first
    ? [...first.byDate.keys()].filter((date) => rest.every((s) => s.byDate.has(date))).sort()
    : [];
  return {
    dates,
    series: byTicker.map(({ ticker, byDate }) => {
      const prices = dates.map((date) => {
        const bar = byDate.get(date);
        if (!bar) throw new Error('aligned date missing');
        return bar[basis];
      });
      const values = prices.map(Number);
      if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
        throw new InvalidPriceError(`${ticker} has a non-positive or invalid price`);
      }
      return { ticker, prices, values };
    }),
  };
}

/**
 * Each value as an index of the first one: value / baseline × 100, so every series starts at
 * exactly 100 on the first common date. Requires a positive baseline (no division by zero).
 */
export function normalizeTo100(values: readonly number[]): number[] {
  const baseline = values[0];
  if (baseline === undefined) return [];
  if (!(baseline > 0) || !Number.isFinite(baseline)) {
    throw new InvalidPriceError('the baseline price must be a positive number');
  }
  return values.map((value, index) => (index === 0 ? 100 : (value / baseline) * 100));
}
