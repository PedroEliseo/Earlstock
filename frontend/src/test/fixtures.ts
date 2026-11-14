import type { StockSummary } from '../api/schemas';
import { jsonResponse, type FakeServer } from './stubFetch';

/**
 * Synthetic data for frontend tests. Dates are computed relative to the current UTC date, so no
 * calendar date is hard-coded.
 */

/** The UTC date `days` days before today, as YYYY-MM-DD. */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function stock(ticker: string, firstDaysAgo = 400, lastDaysAgo = 1): StockSummary {
  return { ticker, firstDate: daysAgo(firstDaysAgo), lastDate: daysAgo(lastDaysAgo) };
}

/** `count` stocks named T001, T002, … sorted by ticker as the API returns them. */
export function manyStocks(count: number): StockSummary[] {
  return Array.from({ length: count }, (_, i) => stock(`T${String(i + 1).padStart(3, '0')}`));
}

/**
 * A fake GET /api/stocks honouring limit/offset. `snapshotFor(callIndex)` chooses the snapshot of
 * each response (default: always 1).
 */
export function stockListServer(
  stocks: readonly StockSummary[],
  snapshotFor: (call: number) => number = () => 1,
): FakeServer {
  let call = 0;
  return (url) => {
    const limit = Number(url.searchParams.get('limit') ?? '20');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    return jsonResponse(
      {
        data: stocks.slice(offset, offset + limit),
        pagination: { limit, offset, total: stocks.length },
      },
      { snapshot: snapshotFor(call++) },
    );
  };
}
