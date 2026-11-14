import { ApiError } from '../../api/errors';
import type { Bar, StockDetail } from '../../api/schemas';
import type { ConsistentFetch } from '../../api/snapshot';
import { getStockDetail, loadPriceHistory } from '../../api/stocks';
import { commonCoverage } from '../../domain/comparison';
import type { Coverage, RangeRequest, ResolvedRange } from '../../domain/ranges';
import { resolveRange } from '../../domain/ranges';

/** A selected ticker the dataset does not contain (the API answered 404 for it). */
export class StockNotFoundError extends Error {
  override readonly name = 'StockNotFoundError';
  constructor(readonly ticker: string) {
    super(`${ticker} is not in the current dataset`);
  }
}

export interface ComparisonData {
  stocks: { ticker: string; detail: StockDetail; bars: Bar[] }[];
  /** The period all stocks have data for; null when their coverages do not overlap. */
  common: Coverage | null;
  /** The requested range resolved against the common coverage (null without overlap). */
  range: ResolvedRange | null;
}

/**
 * Loads every selected stock's metadata (in parallel), resolves the requested range against the
 * COMMON coverage, then loads each stock's prices in that range (in parallel, every page following
 * the cursor). Run through loadConsistent: all of it comes from one snapshot, or the whole
 * operation restarts; sibling requests of an abandoned attempt are cancelled.
 */
export async function loadComparison(
  fetch: ConsistentFetch,
  tickers: readonly string[],
  request: RangeRequest,
): Promise<ComparisonData> {
  const details = await Promise.all(
    tickers.map((ticker) =>
      fetch((signal) => getStockDetail(ticker, signal)).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'NOT_FOUND') {
          throw new StockNotFoundError(ticker);
        }
        throw error;
      }),
    ),
  );
  const common = commonCoverage(details.map((d) => ({ ticker: d.ticker, coverage: d.coverage })));
  if (!common) {
    return {
      stocks: details.map((detail) => ({ ticker: detail.ticker, detail, bars: [] })),
      common,
      range: null,
    };
  }
  const range = resolveRange(request, common);
  const bars = await Promise.all(tickers.map((ticker) => loadPriceHistory(fetch, ticker, range)));
  return {
    stocks: details.map((detail, index) => ({
      ticker: detail.ticker,
      detail,
      bars: bars[index] ?? [],
    })),
    common,
    range,
  };
}
