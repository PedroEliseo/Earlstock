import type { Bar } from '../../api/schemas';
import { alignOnCommonDates, normalizeTo100, type PriceBasis } from '../../domain/comparison';
import {
  annualizedDailyVolatility,
  cumulativeReturn,
  maxDrawdown,
  sessionCalendar,
  type VolatilityResult,
} from '../../domain/performance';

export interface ComparedStock {
  ticker: string;
  /** Exact source prices on the common dates (for display). */
  prices: string[];
  /** Index values, 100 on the first common date (for the chart). */
  normalized: number[];
  cumulativeReturn: number | null;
  /** From the stock's OWN daily observations in the compared period (not the common dates). */
  volatility: VolatilityResult;
  maxDrawdown: number | null;
}

export interface ComparisonModel {
  basis: PriceBasis;
  /** Common dates, oldest first: the ONLY dates used by the chart, the metrics and the table. */
  dates: string[];
  stocks: ComparedStock[];
}

/**
 * The single source for chart, metrics and table. Index, cumulative return and drawdown come from
 * the prices aligned on COMMON dates. Volatility needs daily returns, which the intersection cannot
 * guarantee (one stock's missing session would merge two sessions into one return for all), so it
 * is computed per stock from that stock's own bars between the first and last common date, against
 * a session reference made of every selected stock's dates in that period. Nothing comes from
 * index values.
 */
export function buildComparisonModel(
  stocks: readonly { ticker: string; bars: readonly Bar[] }[],
  basis: PriceBasis,
): ComparisonModel {
  const alignment = alignOnCommonDates(stocks, basis);
  const first = alignment.dates[0];
  const last = alignment.dates.at(-1);
  const inPeriod = (bars: readonly Bar[]) =>
    first === undefined || last === undefined
      ? []
      : bars.filter((bar) => bar.date >= first && bar.date <= last);
  const calendar = sessionCalendar(stocks.map(({ bars }) => inPeriod(bars).map((bar) => bar.date)));
  const ownBars = new Map(stocks.map(({ ticker, bars }) => [ticker, inPeriod(bars)] as const));
  return {
    basis,
    dates: alignment.dates,
    stocks: alignment.series.map(({ ticker, prices, values }) => ({
      ticker,
      prices,
      normalized: normalizeTo100(values),
      cumulativeReturn: cumulativeReturn(values),
      volatility: annualizedDailyVolatility(
        [...(ownBars.get(ticker) ?? [])]
          .sort((a, b) => (a.date < b.date ? -1 : 1))
          .map((bar) => ({ date: bar.date, value: Number(bar[basis]) })),
        calendar,
      ),
      maxDrawdown: maxDrawdown(values),
    })),
  };
}
