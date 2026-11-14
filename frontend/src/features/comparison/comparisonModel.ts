import type { Bar } from '../../api/schemas';
import { alignOnCommonDates, normalizeTo100, type PriceBasis } from '../../domain/comparison';
import { annualizedVolatility, cumulativeReturn, maxDrawdown } from '../../domain/performance';

export interface ComparedStock {
  ticker: string;
  /** Exact source prices on the common dates (for display). */
  prices: string[];
  /** Index values, 100 on the first common date (for the chart). */
  normalized: number[];
  cumulativeReturn: number | null;
  volatility: number | null;
  maxDrawdown: number | null;
}

export interface ComparisonModel {
  basis: PriceBasis;
  /** Common dates, oldest first: the ONLY dates used by the chart, the metrics and the table. */
  dates: string[];
  stocks: ComparedStock[];
}

/**
 * The single source for chart, metrics and table: align on common dates with one price basis, then
 * derive the index (from the aligned prices) and the metrics (from the same aligned prices, never
 * from index values).
 */
export function buildComparisonModel(
  stocks: readonly { ticker: string; bars: readonly Bar[] }[],
  basis: PriceBasis,
): ComparisonModel {
  const alignment = alignOnCommonDates(stocks, basis);
  return {
    basis,
    dates: alignment.dates,
    stocks: alignment.series.map(({ ticker, prices, values }) => ({
      ticker,
      prices,
      normalized: normalizeTo100(values),
      cumulativeReturn: cumulativeReturn(values),
      volatility: annualizedVolatility(values),
      maxDrawdown: maxDrawdown(values),
    })),
  };
}
